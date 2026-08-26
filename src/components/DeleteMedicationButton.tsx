'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function DeleteMedicationButton({ id }: { id: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from('medications').delete().eq('id', id);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      aria-label="Remove medication"
      title="Remove medication"
      className="shrink-0 rounded-md px-2 py-1 text-slate-500 transition hover:bg-red-300/10 hover:text-red-100 disabled:opacity-50"
    >
      {deleting ? '...' : '✕'}
    </button>
  );
}
