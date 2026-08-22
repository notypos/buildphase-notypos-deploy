import type { Metadata } from 'next';
import './globals.css';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: 'ClearLabel — supplement answers from NIH fact sheets',
  description:
    'Plain-language answers about dietary supplements, grounded in NIH Office of Dietary Supplements fact sheets, with citations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">
        <Nav />
        {children}
      </body>
    </html>
  );
}
