import { createRoot } from 'react-dom/client';
import { HTMLFlipBook } from '@gullabs/react-flipbook';

createRoot(document.getElementById('root')).render(
  <HTMLFlipBook width={300} height={400} flippingTime={0}>
    <div style={{ background: '#fff', padding: 16 }}>Page A</div>
    <div style={{ background: '#fff', padding: 16 }}>Page B</div>
    <div style={{ background: '#fff', padding: 16 }}>Page C</div>
  </HTMLFlipBook>,
);
