/**
 * Preflight: verifies env vars, Supabase reachability, schema, and embeddings.
 *   npx tsx scripts/check.ts
 */
import './env';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

const ok = (m: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m: string, fix: string) => {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}\n         fix: ${fix}`);
  failures++;
};
let failures = 0;

async function main() {
  console.log('\nClearLabel preflight\n');

  console.log('Environment variables');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const gemini = process.env.GEMINI_API_KEY;

  if (!url) bad('NEXT_PUBLIC_SUPABASE_URL missing', 'Supabase → Connect → Project URL');
  else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))
    bad(`NEXT_PUBLIC_SUPABASE_URL looks wrong: ${url}`, 'should be https://<ref>.supabase.co with no path');
  else ok(`NEXT_PUBLIC_SUPABASE_URL  ${url}`);

  if (!anon) bad('NEXT_PUBLIC_SUPABASE_ANON_KEY missing', 'Settings → API Keys → publishable key');
  else ok(`NEXT_PUBLIC_SUPABASE_ANON_KEY  ${anon.slice(0, 12)}...`);

  if (!secret) bad('SUPABASE_SERVICE_ROLE_KEY missing', 'Settings → API Keys → secret key');
  else if (secret === anon) bad('SUPABASE_SERVICE_ROLE_KEY is the same as the anon key', 'use the SECRET key, not publishable');
  else ok(`SUPABASE_SERVICE_ROLE_KEY  ${secret.slice(0, 12)}...`);

  if (!gemini) bad('GEMINI_API_KEY missing', 'https://aistudio.google.com/apikey');
  else ok(`GEMINI_API_KEY  ${gemini.slice(0, 8)}...`);

  if (failures) {
    console.log(`\n${failures} problem(s) — fix .env.local and re-run.\n`);
    process.exit(1);
  }

  console.log('\nSupabase');
  const db = createClient(url!, secret!, { auth: { persistSession: false } });

  for (const table of ['fact_sheets', 'chunks', 'nutrient_limits', 'profiles', 'conversations']) {
    const { error, count } = await db.from(table).select('*', { count: 'exact', head: true });
    if (error) bad(`table "${table}" not reachable: ${error.message}`, 'run supabase/migrations/0001_init.sql in the SQL editor');
    else ok(`table ${table.padEnd(16)} ${count ?? 0} rows`);
  }

  const { error: rpcErr } = await db.rpc('match_chunks', {
    query_embedding: Array(768).fill(0),
    match_count: 1,
    filter_audience: 'consumer',
    filter_language: 'en',
    min_similarity: 0,
  });
  if (rpcErr) bad(`match_chunks() failed: ${rpcErr.message}`, 'ensure the vector extension is enabled, then re-run the migration');
  else ok('match_chunks() callable');

  console.log('\nEmbeddings');
  try {
    const ai = new GoogleGenAI({ apiKey: gemini! });
    const r = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: ['vitamin D upper limit'],
      config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 },
    });
    const dims = r.embeddings?.[0]?.values?.length ?? 0;
    if (dims === 768) ok(`Gemini gemini-embedding-001 returned ${dims} dimensions`);
    else bad(`expected 768 dimensions, got ${dims}`, 'schema expects vector(768)');
  } catch (e) {
    bad(`Gemini embedding call failed: ${String(e).slice(0, 120)}`, 'check GEMINI_API_KEY at https://aistudio.google.com/apikey');
  }

  console.log(failures ? `\n${failures} problem(s).\n` : '\nAll checks passed — run: npx tsx scripts/ingest.ts --limit 5\n');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
