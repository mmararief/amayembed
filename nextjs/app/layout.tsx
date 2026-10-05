import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stream API — Next.js Player',
  description: 'Self-hosted multi-provider streaming player powered by Vyla SDK & Next.js',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
