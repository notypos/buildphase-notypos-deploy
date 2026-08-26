'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function DeleteMedicationButton({ id }: { id: string }) {
  const router = useRouter();

  async function handleDelete() {
    const supabase = createClient();
    await supabase.from('medications').delete().eq('id', id);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      className="text-xs font-medium text-slate-400 hover:text-red-700"
      aria-label="Remove medication"
    >
      Remove
    </button>
  );
}
