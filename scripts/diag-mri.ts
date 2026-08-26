/**
 * Standalone diagnostic: shows the actual top-8 match_chunks() results for
 * three phrasings of the MRI/acai question, bypassing the app entirely.
 * Calls the real retrieval path directly.
 *
 *   npx tsx scripts/diag-mri.ts
 *
 * Run this from your own terminal (not through the sandboxed device_bash
 * shell) -- that sandbox can't reach Gemini or Supabase at all right now
 * (confirmed: DNS/connection failures on both), which is also the most
 * likely reason `npm run dev` was crashing on first request in there.
 */
import './env';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
import { createClient } from '@supabase/supabase-js';
import { embedQuery } from '../src/lib/embeddings';

const MIN_SIM = Number(process.env.RETRIEVAL_MIN_SIMILARITY ?? 0.66);

const QUESTIONS = [
  'What should I avoid taking before an MRI?',
  'What supplements should I avoid taking before an MRI?',
  "I'm going to get an MRI, should I avoid taking any supplements?",
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const db = createClient(url, key, { auth: { persistSession: false } });

  for (const q of QUESTIONS) {
    console.log(`\n${'='.repeat(90)}\nQ: ${q}\n${'='.repeat(90)}`);

    const embedding = await embedQuery(q);
    const { data, error } = await db.rpc('match_chunks', {
      query_embedding: embedding,
      match_count: 8,
      filter_audience: 'consumer',
      filter_language: 'en',
      min_similarity: 0,
    });

    if (error) {
      console.log(`  RPC ERROR: ${error.message}`);
      continue;
    }

    const rows = (data ?? []) as Array<{
      slug: string; supplement: string; section: string | null; similarity: number; fact_sheet_id: string;
    }>;

    if (rows.length === 0) {
      console.log('  (no rows returned at all)');
      continue;
    }

    const top = rows[0].similarity;
    console.log(`  top similarity: ${top.toFixed(4)}  (floor is ${MIN_SIM}) -> ${top >= MIN_SIM ? 'PASSES' : 'REFUSED (below floor)'}\n`);

    rows.forEach((r, i) => {
      const acaiFlag = /acai/i.test(r.supplement) || /acai/i.test(r.slug) ? '  <-- ACAI/NCCIH' : '';
      const passFlag = r.similarity >= MIN_SIM ? '*' : ' ';
      console.log(
        `  ${passFlag}#${i + 1}  sim=${r.similarity.toFixed(4)}  ${r.supplement.padEnd(28)} [${r.slug}]  section="${r.section}"${acaiFlag}`,
      );
    });

    const { data: wide } = await db.rpc('match_chunks', {
      query_embedding: embedding,
      match_count: 200,
      filter_audience: 'consumer',
      filter_language: 'en',
      min_similarity: 0,
    });
    const wideRows = (wide ?? []) as Array<{ slug: string; supplement: string; similarity: number }>;
    const acaiIdx = wideRows.findIndex((r) => /acai/i.test(r.supplement) || /acai/i.test(r.slug));
    if (acaiIdx === -1) {
      console.log('  acai/NCCIH chunk: not found in corpus at all for this query embedding (top 300)');
    } else if (acaiIdx >= 8) {
      console.log(
        `  acai/NCCIH chunk: ranked #${acaiIdx + 1} overall (sim=${wideRows[acaiIdx].similarity.toFixed(4)}) -- outside top-8, so retrieveSafetySections() never sees it either`,
      );
    } else {
      console.log(`  acai/NCCIH chunk: ranked #${acaiIdx + 1} (sim=${wideRows[acaiIdx].similarity.toFixed(4)}) -- inside top-8`);
    }
  }

  // Raw check: does the acai/NCCIH chunk even exist with the audience/language
  // this app filters on? Rules out a filter mismatch vs. a pure ranking issue.
  console.log(`\n${'='.repeat(90)}\nRaw acai chunk rows (any audience/language):\n${'='.repeat(90)}`);
  const { data: acaiRows, error: acaiErr } = await db
    .from('chunks')
    .select('id, section, fact_sheets!inner(slug, supplement, audience, language)')
    .ilike('fact_sheets.slug', '%acai%');
  if (acaiErr) console.log('ERROR', acaiErr.message);
  else console.log(JSON.stringify(acaiRows, null, 2));

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
