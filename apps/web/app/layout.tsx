import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '../components/providers';

export const metadata: Metadata = {
  title: 'AI Lead Intelligence CRM',
  description: 'Autonomous AI lead intelligence and sales CRM',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
