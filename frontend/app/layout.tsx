import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sortline - Waste Classification',
  description: 'Detect and classify waste materials in photos.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-mono antialiased">{children}</body>
    </html>
  );
}
