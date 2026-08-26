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
    `rounded-lg px-3.5 py-2 text-sm font-medium transition ${
      tab === t ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => setTab('product')} className={tabClass('product')}>
          Scan product
        </button>
        <button type="button" onClick={() => setTab('photo')} className={tabClass('photo')}>
          Read nutrition label
        </button>
      </div>
      {tab === 'product' ? <ScanProductForm onNoMatch={() => setTab('photo')} /> : <ScanLabelForm />}
    </div>
  );
}
