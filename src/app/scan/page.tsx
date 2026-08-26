import ScanTabs from '@/components/ScanTabs';

export default function ScanPage() {
  // No sign-in required to scan — reading a barcode or a label doesn't
  // touch anyone's data. Saving a result to My Stack (inside ScanTabs'
  // children) is what actually requires an account, same as the manual add
  // form.
  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Scan</h1>
      <p className="mt-1 mb-8 text-slate-600">
        Photograph the front of a bottle to pull NIH&apos;s own record for that product, or read
        the Supplement Facts panel directly if it's not in NIH&apos;s database yet. Sign in to
        add what you want to My Stack.
      </p>

      <ScanTabs />

      <p className="mt-8 rounded-xl bg-teal-50 p-5 text-sm text-teal-900">
        <span className="font-semibold">Nothing here is stored just from scanning.</span> A photo
        is sent once to identify the product or read the printed doses, then discarded. The
        upper-limit and cumulative-dose check that runs on My Stack never changes based on how an
        item got there — scanned or typed in by hand.
      </p>
    </main>
  );
}
