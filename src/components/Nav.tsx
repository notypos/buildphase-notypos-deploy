import { getUser } from '@/lib/supabase/server';
import AppNav from '@/components/AppNav';

export default async function Nav() {
  const user = await getUser();

  return <AppNav userEmail={user?.email ?? null} />;
}
