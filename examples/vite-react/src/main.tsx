import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HTMLFlipBook } from '@gullabs/react-flipbook';

const rootEl = document.getElementById('root');
if (!(rootEl instanceof HTMLElement)) {
  throw new Error('#root element is required');
}

createRoot(rootEl).render(
  <StrictMode>
    <HTMLFlipBook width={300} height={400} flippingTime={0}>
      <div style={{ background: '#fff', padding: 16 }}>Page A</div>
      <div style={{ background: '#fff', padding: 16 }}>Page B</div>
      <div style={{ background: '#fff', padding: 16 }}>Page C</div>
    </HTMLFlipBook>
  </StrictMode>,
);
