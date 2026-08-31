/**
 * Count engine style/class writes by patching CSSOM/DOM prototypes.
 *
 * MutationObserver is the wrong instrument here: jsdom dedups identical
 * `setProperty` values (zero mutation records) while still issuing the call
 * that dirties style recalc in real browsers. Count the calls themselves.
 *
 * Element identity is resolved via WeakMaps filled by wrapping the
 * `HTMLElement.prototype.style` and `Element.prototype.classList` getters —
 * style declarations and token lists do not expose their owner element on the
 * public surface.
 */

export type StyleWriteKind =
  'setProperty' | 'removeProperty' | 'cssText' | 'zIndex' | 'classList.add' | 'classList.remove';

export type StyleWriteRecord = {
  element: Element | null;
  kind: StyleWriteKind;
};

export type StyleWriteRecorder = {
  /** Every write observed since the last `reset()` (or install). */
  readonly records: StyleWriteRecord[];
  /** Drop recorded writes without uninstalling the patches. */
  reset(): void;
  /** Total recorded writes since last reset. */
  count(): number;
  /** Distinct elements that received at least one write. */
  elements(): Set<Element>;
  /** Restore every patched descriptor. Safe to call more than once. */
  restore(): void;
};

type RestoreFn = () => void;

/** CSSStyleProperties (jsdom 26+) or CSSStyleDeclaration — wherever zIndex lives. */
function zIndexOwnerProto(): object | null {
  const CSSStyleProperties = (
    globalThis as unknown as { CSSStyleProperties?: { prototype: object } }
  ).CSSStyleProperties;
  if (CSSStyleProperties?.prototype) {
    const desc = Object.getOwnPropertyDescriptor(CSSStyleProperties.prototype, 'zIndex');
    if (desc?.set) return CSSStyleProperties.prototype;
  }

  let proto: object | null = CSSStyleDeclaration.prototype;
  while (proto && proto !== Object.prototype) {
    if (Object.getOwnPropertyDescriptor(proto, 'zIndex')?.set) return proto;
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return null;
}

/**
 * Install prototype patches. Call `restore()` from `afterEach` / `finally`.
 * Only one recorder may be active at a time.
 */
export function installStyleWriteRecorder(): StyleWriteRecorder {
  const records: StyleWriteRecord[] = [];
  const restores: RestoreFn[] = [];
  const styleToElement = new WeakMap<object, Element>();
  const classListToElement = new WeakMap<object, Element>();
  let active = true;

  const record = (target: object, kind: StyleWriteKind, via: 'style' | 'classList'): void => {
    if (!active) return;
    const element =
      via === 'style'
        ? (styleToElement.get(target) ?? null)
        : (classListToElement.get(target) ?? null);
    records.push({ element, kind });
  };

  // --- element ↔ style / classList identity -------------------------

  const styleDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
  if (styleDesc?.get) {
    const originalGet = styleDesc.get;
    Object.defineProperty(HTMLElement.prototype, 'style', {
      configurable: true,
      enumerable: styleDesc.enumerable ?? false,
      get(this: HTMLElement) {
        const style = originalGet.call(this) as CSSStyleDeclaration;
        styleToElement.set(style, this);
        return style;
      },
    });
    restores.push(() => {
      Object.defineProperty(HTMLElement.prototype, 'style', styleDesc);
    });
  }

  const classListDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'classList');
  if (classListDesc?.get) {
    const originalGet = classListDesc.get;
    Object.defineProperty(Element.prototype, 'classList', {
      configurable: true,
      enumerable: classListDesc.enumerable ?? false,
      get(this: Element) {
        const list = originalGet.call(this) as DOMTokenList;
        classListToElement.set(list, this);
        return list;
      },
    });
    restores.push(() => {
      Object.defineProperty(Element.prototype, 'classList', classListDesc);
    });
  }

  // --- CSSStyleDeclaration write surface ---------------------------
  // Use the real prototype objects — never create a throwaway element whose
  // style would show up as a mysterious bare <div> in the write log.

  const declarationProto = CSSStyleDeclaration.prototype;

  const originalSetProperty = declarationProto.setProperty;
  const originalRemoveProperty = declarationProto.removeProperty;

  declarationProto.setProperty = function (
    this: CSSStyleDeclaration,
    property: string,
    value: string | null,
    priority?: string,
  ): void {
    record(this, 'setProperty', 'style');
    return originalSetProperty.call(this, property, value, priority);
  };
  restores.push(() => {
    declarationProto.setProperty = originalSetProperty;
  });

  declarationProto.removeProperty = function (this: CSSStyleDeclaration, property: string): string {
    record(this, 'removeProperty', 'style');
    return originalRemoveProperty.call(this, property);
  };
  restores.push(() => {
    declarationProto.removeProperty = originalRemoveProperty;
  });

  const cssTextDesc = Object.getOwnPropertyDescriptor(declarationProto, 'cssText');
  if (cssTextDesc?.set && cssTextDesc.get) {
    const originalCssTextSet = cssTextDesc.set;
    const originalCssTextGet = cssTextDesc.get;
    Object.defineProperty(declarationProto, 'cssText', {
      configurable: true,
      enumerable: cssTextDesc.enumerable ?? false,
      get(this: CSSStyleDeclaration): string {
        return originalCssTextGet.call(this) as string;
      },
      set(this: CSSStyleDeclaration, value: string) {
        record(this, 'cssText', 'style');
        originalCssTextSet.call(this, value);
      },
    });
    restores.push(() => {
      Object.defineProperty(declarationProto, 'cssText', cssTextDesc);
    });
  }

  // z-index: direct assignment (`el.style.zIndex = …`) does NOT go through
  // setProperty in jsdom. Lives on CSSStyleProperties.prototype in modern
  // jsdom, not on CSSStyleDeclaration.prototype.
  const zOwner = zIndexOwnerProto();
  if (zOwner) {
    const zIndexDesc = Object.getOwnPropertyDescriptor(zOwner, 'zIndex');
    if (zIndexDesc?.set && zIndexDesc.get) {
      const originalZSet = zIndexDesc.set;
      const originalZGet = zIndexDesc.get;
      Object.defineProperty(zOwner, 'zIndex', {
        configurable: true,
        enumerable: zIndexDesc.enumerable ?? false,
        get(this: CSSStyleDeclaration): string {
          return originalZGet.call(this) as string;
        },
        set(this: CSSStyleDeclaration, value: string) {
          record(this, 'zIndex', 'style');
          originalZSet.call(this, value);
        },
      });
      restores.push(() => {
        Object.defineProperty(zOwner, 'zIndex', zIndexDesc);
      });
    }
  }

  // --- classList ---------------------------------------------------

  const originalClassAdd = DOMTokenList.prototype.add;
  const originalClassRemove = DOMTokenList.prototype.remove;

  DOMTokenList.prototype.add = function (this: DOMTokenList, ...tokens: string[]): void {
    record(this, 'classList.add', 'classList');
    return originalClassAdd.apply(this, tokens);
  };
  restores.push(() => {
    DOMTokenList.prototype.add = originalClassAdd;
  });

  DOMTokenList.prototype.remove = function (this: DOMTokenList, ...tokens: string[]): void {
    record(this, 'classList.remove', 'classList');
    return originalClassRemove.apply(this, tokens);
  };
  restores.push(() => {
    DOMTokenList.prototype.remove = originalClassRemove;
  });

  const recorder: StyleWriteRecorder = {
    records,
    reset() {
      records.length = 0;
    },
    count() {
      return records.length;
    },
    elements() {
      const out = new Set<Element>();
      for (const r of records) {
        if (r.element) out.add(r.element);
      }
      return out;
    },
    restore() {
      if (!active) return;
      active = false;
      while (restores.length) restores.pop()?.();
    },
  };

  return recorder;
}
