import { StrictMode, useCallback, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { HTMLFlipBook, usePageFlip, type WidgetEvent } from '@gullabs/react-flipbook';

/**
 * React binding showcase.
 *
 * Covers the public surface a consumer actually reaches for:
 *   - controlled `page` + `usePageFlip()`
 *   - `onFlip` / `onChangeState` / `onTurnRejected`
 *   - `direction: 'rtl'`
 *
 * Image / canvas mode was removed in 3.0.0 (ADR 0002). Use HTML pages with
 * `<img>` elements instead — see MIGRATION.md.
 */

const leafStyle = (bg: string): CSSProperties => ({
  background: bg,
  padding: 16,
  boxSizing: 'border-box',
  height: '100%',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 18,
  fontWeight: 600,
});

function HtmlDemo() {
  const book = usePageFlip(0);
  const [state, setState] = useState('read');
  const [lastReject, setLastReject] = useState<string>('—');
  const [rtl, setRtl] = useState(false);

  const onChangeState = useCallback((e: WidgetEvent<string>) => {
    setState(String(e.data));
  }, []);

  const onTurnRejected = useCallback((e: WidgetEvent<{ code?: string }>) => {
    setLastReject(JSON.stringify(e.data));
  }, []);

  const onFlip = useCallback((e: WidgetEvent<number>) => {
    // usePageFlip already tracks page via onPageChange; this is the raw event.
    void e;
  }, []);

  return (
    <section style={{ marginBottom: 48 }}>
      <h2 style={{ margin: '0 0 8px' }}>HTMLFlipBook — controlled + RTL</h2>
      <p style={{ margin: '0 0 12px', color: '#555', maxWidth: 520 }}>
        <code>usePageFlip()</code> owns <code>page</code> / <code>pageCount</code>. Toggle RTL to
        invert turn direction only — the fold still follows the finger.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => book.flipPrev()}>
          Prev
        </button>
        <button type="button" onClick={() => book.flipNext()}>
          Next
        </button>
        <button type="button" onClick={() => book.turnToPage(0)}>
          First
        </button>
        <button type="button" onClick={() => book.setPage(2)}>
          Go to page 2 (controlled)
        </button>
        <button type="button" onClick={() => setRtl((v) => !v)} aria-pressed={rtl}>
          RTL: {rtl ? 'on' : 'off'}
        </button>
      </div>

      <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: '#333' }}>
        page {book.page} / {Math.max(0, book.pageCount - 1)} · state {state} · rejected {lastReject}
      </p>

      <HTMLFlipBook
        ref={book.ref}
        width={280}
        height={360}
        size="fixed"
        flippingTime={400}
        direction={rtl ? 'rtl' : 'ltr'}
        page={book.page}
        {...book.bookProps}
        onFlip={onFlip}
        onChangeState={onChangeState}
        onTurnRejected={onTurnRejected}
        style={{ maxWidth: 560 }}
        aria-label="HTML demo flipbook"
      >
        <div style={leafStyle('#ffe4e1')}>One</div>
        <div style={leafStyle('#e0f0ff')}>Two</div>
        <div style={leafStyle('#e6ffe6')}>Three</div>
        <div style={leafStyle('#fff5cc')}>Four</div>
      </HTMLFlipBook>
    </section>
  );
}

function App() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginTop: 0 }}>@gullabs/react-flipbook</h1>
      <HtmlDemo />
    </main>
  );
}

const rootEl = document.getElementById('root');
if (!(rootEl instanceof HTMLElement)) {
  throw new Error('#root element is required');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
