'use client';

import { useState } from 'react';
import ScanProductForm from '@/components/ScanProductForm';
import ScanLabelForm from '@/components/ScanLabelForm';

/**
 * Two scanning modes. "Scan product" photographs the front of the bottle
 * and matches it to NIH's own DSLD record (source of truth, not a re-read
 * of a photo) -- see /api/scan-product. "Read nutrition label" is the
 * original vision-OCR reader, kept as the fallback for anything not in
 * NIH's database yet, so scanning never dead-ends.
 */
export default function ScanTabs() {
  const [tab, setTab] = useState<'product' | 'photo'>('product');

  const tabClass = (t: typeof tab) =>
    `rounded-md px-3.5 py-2 text-sm font-semibold transition ${
      tab === t
        ? 'bg-violet-300/[0.18] text-white ring-1 ring-violet-300/[0.35]'
        : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
    }`;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
      <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-[#07111f]/70 p-1">
        <button type="button" onClick={() => setTab('product')} className={tabClass('product')}>
          Scan product
        </button>
        <button type="button" onClick={() => setTab('photo')} className={tabClass('photo')}>
          Read Supplement Facts
        </button>
      </div>
      {tab === 'product' ? <ScanProductForm onNoMatch={() => setTab('photo')} /> : <ScanLabelForm />}
    </div>
  );
}
