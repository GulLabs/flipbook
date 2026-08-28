export const FLIPBOOK_CSS = `.stf__parent {
  position: relative;
  display: block;
  box-sizing: border-box;
  transform: translateZ(0);
  -ms-touch-action: pan-y;
  touch-action: pan-y;
}

.stf__wrapper {
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

.stf__parent canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  left: 0;
  top: 0;
}

.stf__block {
  position: absolute;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  perspective: 2000px;
  user-select: none;
  -webkit-user-select: none;
}

.stf__item {
  display: none;
  position: absolute;
  transform-style: preserve-3d;
}

.stf__outerShadow,
.stf__innerShadow,
.stf__hardShadow,
.stf__hardInnerShadow {
  position: absolute;
  left: 0;
  top: 0;
}
`;

const STYLE_ATTR = 'data-gullabs-flipbook';

export function ensureFlipbookStyles(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.head.querySelector(`style[${STYLE_ATTR}]`)) {
    return;
  }
  const style = document.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  style.textContent = FLIPBOOK_CSS;
  document.head.appendChild(style);
}
