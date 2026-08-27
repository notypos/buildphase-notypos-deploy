import AskExperience from '@/components/AskExperience';

export const metadata = { title: 'Ask ClearLabel - NIH supplement evidence' };

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const q = Array.isArray(params.q) ? params.q[0] : params.q;

  return <AskExperience initialQuestion={q ?? ''} />;
}
