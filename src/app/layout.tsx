import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClearLabel — supplement answers from NIH fact sheets',
  description:
    'Plain-language answers about dietary supplements, grounded in NIH Office of Dietary Supplements fact sheets, with citations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
