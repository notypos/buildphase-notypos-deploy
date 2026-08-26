import ScanLabelForm from '@/components/ScanLabelForm';

export default function ScanPage() {
  // No sign-in required to scan — reading a label doesn't touch anyone's
  // data. Saving a result to My Stack (inside ScanLabelForm) is what
  // actually requires an account, same as the manual add form.
  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Scan a Label</h1>
      <p className="mt-1 mb-8 text-slate-600">
        Photograph a Supplement Facts panel to read its doses automatically. Sign in to add what
        you want to My Stack.
      </p>

      <ScanLabelForm />

      <p className="mt-8 rounded-xl bg-teal-50 p-5 text-sm text-teal-900">
        <span className="font-semibold">The photo is only used to read the label.</span> It is
        sent once to extract the printed doses and is not stored. The upper-limit and
        cumulative-dose check that runs on My Stack never changes based on this photo — it only
        transcribes what&apos;s printed, the same as typing it in by hand.
      </p>
    </main>
  );
}
