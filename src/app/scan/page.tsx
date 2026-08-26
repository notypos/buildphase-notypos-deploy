import ScanTabs from '@/components/ScanTabs';

export default function ScanPage() {
  // No sign-in required to scan — reading a barcode or a label doesn't
  // touch anyone's data. Saving a result to My Stack (inside ScanTabs'
  // children) is what actually requires an account, same as the manual add
  // form.
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 md:px-8 md:py-12">
      <div className="mb-8 max-w-3xl">
        <p className="mb-3 text-sm font-semibold text-clear-verified">NIH DSLD product lookup</p>
        <h1 className="text-3xl font-bold text-white md:text-5xl">Scan a supplement</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-300">
          Find the product label, then see what NIH says about its ingredients. Product data comes
          from the manufacturer label in NIH DSLD; evidence comes from NIH ODS and NCCIH fact sheets.
        </p>
      </div>

      <ScanTabs />

      <p className="mt-8 rounded-lg border border-teal-300/20 bg-teal-300/[0.08] p-5 text-sm leading-relaxed text-teal-50">
        <span className="font-semibold">Nothing here is stored just from scanning.</span> A photo is
        sent once to identify the product or read printed doses, then discarded. The upper-limit and
        cumulative-dose check in My Stack is deterministic whether an item was scanned or typed.
      </p>
    </main>
  );
}
