'use client';

import { useState } from 'react';
import BarcodeScanForm from '@/components/BarcodeScanForm';
import ScanLabelForm from '@/components/ScanLabelForm';

/**
 * Two scanning modes, matching the dual input BioStacks uses: a barcode scan
 * that pulls NIH's own record as source of truth (see /api/product-lookup),
 * falling back to the existing vision-OCR label reader when a product isn't
 * in NIH's database yet or the barcode isn't recognized -- reading the label
 * directly never "dead-ends" the way a database-only lookup would.
 */
export default function ScanTabs() {
  const [tab, setTab] = useState<'barcode' | 'photo'>('barcode');

  const tabClass = (t: typeof tab) =>
    `rounded-lg px-3.5 py-2 text-sm font-medium transition ${
      tab === t ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => setTab('barcode')} className={tabClass('barcode')}>
          Scan barcode
        </button>
        <button type="button" onClick={() => setTab('photo')} className={tabClass('photo')}>
          Photograph label
        </button>
      </div>
      {tab === 'barcode' ? <BarcodeScanForm onNoMatch={() => setTab('photo')} /> : <ScanLabelForm />}
    </div>
  );
}
