'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function DeleteStackItemButton({ id }: { id: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    const supabase = createClient();
    // RLS scopes this to the signed-in user's own rows regardless.
    await supabase.from('stack_items').delete().eq('id', id);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      aria-label="Remove"
      title="Remove"
      className="text-slate-400 hover:text-red-700 disabled:opacity-50"
    >
      {deleting ? '…' : '✕'}
    </button>
  );
}
