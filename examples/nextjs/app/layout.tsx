import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'flipbook nextjs',
  description: '@gullabs/react-flipbook App Router example',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#f5f5f5',
          color: '#111',
        }}
      >
        {children}
      </body>
    </html>
  );
}
