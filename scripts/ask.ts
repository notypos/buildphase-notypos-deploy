/**
 * Exercise the live /api/ask route. Requires `npm run dev` in another terminal.
 *
 *   npx tsx scripts/ask.ts "how much vitamin C do I need?"
 *   npx tsx scripts/ask.ts --audience simple "is zinc good for colds?"
 *   npx tsx scripts/ask.ts --suite      threshold-tuning suite
 *   npx tsx scripts/ask.ts --suite --base https://your-app.vercel.app
 *
 * Hits HTTP rather than importing the lib directly: those modules are
 * server-only and depend on next/headers, which doesn't exist outside Next.
 */
import './env';

// --base wins so the same suite can be pointed at a deployment:
//   npx tsx scripts/ask.ts --suite --base https://your-app.vercel.app
const baseArg = process.argv.indexOf('--base');
const BASE =
  (baseArg >= 0 ? process.argv[baseArg + 1] : undefined) ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  'http://localhost:3000';

interface AskResponse {
  answer: { evidence: string; uncertainty: string; marketing: string; citationsUsed: number[] } | null;
  citations: { index: number; supplement: string; section: string | null; url: string }[];
  refused: boolean;
  refusalReason?: string;
  topSimilarity: number;
  error?: string;
}

async function call(question: string, audience = 'standard', language = 'en'): Promise<AskResponse> {
  const res = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, audience, language }),
  });
  const json = await res.json();
  if (!res.ok) return { ...json, refused: false, answer: null, citations: [], topSimilarity: 0 };
  return json;
}

function show(q: string, r: AskResponse) {
  console.log(`\n\x1b[1m? ${q}\x1b[0m`);
  if (r.error) return console.log(`  \x1b[31mERROR\x1b[0m ${r.error}`);
  console.log(`  top similarity: ${r.topSimilarity?.toFixed(3)}`);
  if (r.refused) return console.log(`  \x1b[33mREFUSED\x1b[0m ${r.refusalReason}`);

  const a = r.answer!;
  if (a.evidence) console.log(`\n  \x1b[32mEvidence\x1b[0m\n    ${a.evidence.replace(/\n/g, '\n    ')}`);
  if (a.uncertainty) console.log(`\n  \x1b[36mUncertain\x1b[0m\n    ${a.uncertainty.replace(/\n/g, '\n    ')}`);
  if (a.marketing) console.log(`\n  \x1b[35mMarketing\x1b[0m\n    ${a.marketing.replace(/\n/g, '\n    ')}`);
  console.log('\n  Sources:');
  for (const c of r.citations.filter((c) => a.citationsUsed.includes(c.index))) {
    console.log(`    [${c.index}] ${c.supplement} — ${c.section ?? ''}`);
  }
}

// In-scope questions should score high; out-of-scope should fall below the
// floor. If those two groups overlap, RETRIEVAL_MIN_SIMILARITY is wrong.
const SUITE: { q: string; expect: 'answer' | 'refuse' }[] = [
  { q: 'How much vitamin C do I need each day?', expect: 'answer' },
  { q: 'Can too much vitamin D be harmful?', expect: 'answer' },
  { q: 'What foods are high in iron?', expect: 'answer' },
  { q: 'Does zinc help with colds?', expect: 'answer' },
  { q: 'Is ashwagandha safe?', expect: 'answer' },
  { q: 'What is the upper limit for calcium?', expect: 'answer' },
  { q: 'Who won the 2022 World Cup?', expect: 'refuse' },
  { q: 'How do I refinance my mortgage?', expect: 'refuse' },
  { q: 'Write me a Python function to sort a list', expect: 'refuse' },
  { q: 'What is the best pre-workout brand to buy?', expect: 'refuse' },
  // NCCIH coverage (added after the acai/MRI bug: ODS has no MRI guidance
  // anywhere, but NCCIH's acai page explicitly warns it can affect MRI
  // imaging of the GI tract — scripts/ingest-nccih.ts must be run first).
  { q: 'What should I avoid taking before an MRI?', expect: 'answer' },
  { q: 'What is turmeric used for?', expect: 'answer' },
];

async function suite() {
  console.log('\nThreshold suite — in-scope should answer, out-of-scope should refuse.\n');
  const rows: { q: string; expect: string; got: string; sim: number; pass: boolean }[] = [];

  for (const { q, expect } of SUITE) {
    try {
      const r = await call(q);
      const got = r.error ? 'error' : r.refused ? 'refuse' : 'answer';
      rows.push({ q, expect, got, sim: r.topSimilarity ?? 0, pass: got === expect });
    } catch (e) {
      rows.push({ q, expect, got: `error: ${String(e).slice(0, 40)}`, sim: 0, pass: false });
    }
    await new Promise((r) => setTimeout(r, 1200)); // stay under the route's rate limit
  }

  console.log('  sim    expect  got     ok   question');
  for (const r of rows) {
    console.log(
      `  ${r.sim.toFixed(3)}  ${r.expect.padEnd(7)} ${r.got.padEnd(7)} ${r.pass ? ' \x1b[32my\x1b[0m ' : ' \x1b[31mN\x1b[0m '}  ${r.q}`,
    );
  }

  const answered = rows.filter((r) => r.expect === 'answer');
  const refused = rows.filter((r) => r.expect === 'refuse');
  const lowestInScope = Math.min(...answered.map((r) => r.sim));
  const highestOutScope = Math.max(...refused.map((r) => r.sim));

  console.log(`\n  lowest in-scope similarity : ${lowestInScope.toFixed(3)}`);
  console.log(`  highest out-of-scope       : ${highestOutScope.toFixed(3)}`);
  if (lowestInScope > highestOutScope) {
    const mid = (lowestInScope + highestOutScope) / 2;
    console.log(`  \x1b[32mSeparated.\x1b[0m Put RETRIEVAL_MIN_SIMILARITY near ${mid.toFixed(2)}.`);
  } else {
    console.log(
      `  \x1b[33mOverlapping.\x1b[0m No single threshold separates these — needs better chunking or a reranker.`,
    );
  }
  console.log(`\n  ${rows.filter((r) => r.pass).length}/${rows.length} as expected (current threshold ${process.env.RETRIEVAL_MIN_SIMILARITY ?? '0.55'})\n`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--suite')) return suite();

  const ai = args.indexOf('--audience');
  const audience = ai >= 0 ? args[ai + 1] : 'standard';
  const li = args.indexOf('--lang');
  const language = li >= 0 ? args[li + 1] : 'en';
  const question = args
    .filter(
      (a, i) =>
        !a.startsWith('--') &&
        args[i - 1] !== '--audience' &&
        args[i - 1] !== '--lang' &&
        args[i - 1] !== '--base',
    )
    .join(' ');

  if (!question) {
    console.log('Usage: npx tsx scripts/ask.ts "your question"   |   --suite');
    process.exit(1);
  }
  show(question, await call(question, audience, language));
  console.log();
}

main().catch((e) => {
  console.error(`\nCould not reach ${BASE} — is "npm run dev" running?\n`, String(e).slice(0, 200));
  process.exit(1);
});
