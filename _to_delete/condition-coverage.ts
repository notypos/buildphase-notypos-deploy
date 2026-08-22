/**
 * Which health conditions does the ingested NIH corpus actually discuss?
 *
 *   npx tsx scripts/condition-coverage.ts
 *   npx tsx scripts/condition-coverage.ts --show "Chronic kidney disease"
 *
 * Settles an otherwise unanswerable design question with evidence: a condition
 * checkbox is only worth a user's attention if ODS says something about it. This
 * counts mentions across every chunk and reports which supplements discuss each
 * condition, so the checklist is built from the corpus rather than from guesses.
 */
import './env';
import { createClient } from '@supabase/supabase-js';

/** Candidate conditions with the phrasings ODS actually uses. */
const CANDIDATES: { group: string; label: string; patterns: string[] }[] = [
  { group: 'Kidney & Liver', label: 'Chronic kidney disease', patterns: ['kidney disease', 'renal disease', 'renal failure', 'chronic kidney'] },
  { group: 'Kidney & Liver', label: 'Kidney dialysis', patterns: ['dialysis', 'hemodialysis'] },
  { group: 'Kidney & Liver', label: 'Liver disease', patterns: ['liver disease', 'hepatic', 'cirrhosis'] },

  { group: 'Metabolic & Cardiovascular', label: 'Type 1 diabetes', patterns: ['type 1 diabetes'] },
  { group: 'Metabolic & Cardiovascular', label: 'Type 2 diabetes', patterns: ['type 2 diabetes'] },
  { group: 'Metabolic & Cardiovascular', label: 'Diabetes (any)', patterns: ['diabetes', 'diabetic'] },
  { group: 'Metabolic & Cardiovascular', label: 'High blood pressure', patterns: ['high blood pressure', 'hypertension'] },
  { group: 'Metabolic & Cardiovascular', label: 'Heart disease', patterns: ['heart disease', 'cardiovascular disease', 'coronary'] },
  { group: 'Metabolic & Cardiovascular', label: 'High cholesterol', patterns: ['cholesterol', 'hyperlipidemia'] },
  { group: 'Metabolic & Cardiovascular', label: 'Metabolic syndrome', patterns: ['metabolic syndrome'] },
  { group: 'Metabolic & Cardiovascular', label: 'PCOS', patterns: ['polycystic ovary', 'pcos'] },

  { group: 'Thyroid', label: 'Hypothyroidism', patterns: ['hypothyroid'] },
  { group: 'Thyroid', label: 'Hyperthyroidism', patterns: ['hyperthyroid'] },
  { group: 'Thyroid', label: 'Autoimmune thyroid disease', patterns: ['hashimoto', 'autoimmune thyroid'] },
  { group: 'Thyroid', label: 'Thyroid disease (any)', patterns: ['thyroid'] },

  { group: 'Digestive / Absorption', label: 'Celiac disease', patterns: ['celiac'] },
  { group: 'Digestive / Absorption', label: "Crohn's disease", patterns: ['crohn'] },
  { group: 'Digestive / Absorption', label: 'Inflammatory bowel disease', patterns: ['inflammatory bowel', 'ulcerative colitis'] },
  { group: 'Digestive / Absorption', label: 'Atrophic gastritis', patterns: ['atrophic gastritis', 'gastritis'] },
  { group: 'Digestive / Absorption', label: 'Bariatric / stomach surgery', patterns: ['bariatric', 'gastric bypass', 'weight-loss surgery', 'gastrectomy'] },
  { group: 'Digestive / Absorption', label: 'Malabsorption (any)', patterns: ['malabsorption', 'absorb less', 'reduced absorption'] },

  { group: 'Blood / Nutrient', label: 'Iron-deficiency anemia', patterns: ['iron-deficiency anemia', 'iron deficiency anemia'] },
  { group: 'Blood / Nutrient', label: 'Pernicious / B12 anemia', patterns: ['pernicious anemia', 'b12 deficiency'] },
  { group: 'Blood / Nutrient', label: 'Hemochromatosis / iron overload', patterns: ['hemochromatosis', 'iron overload'] },
  { group: 'Blood / Nutrient', label: 'Anemia (any)', patterns: ['anemia', 'anaemia'] },

  { group: 'Bone / Neuro / Eye', label: 'Osteoporosis', patterns: ['osteoporosis', 'bone density', 'bone loss'] },
  { group: 'Bone / Neuro / Eye', label: 'Migraine', patterns: ['migraine'] },
  { group: 'Bone / Neuro / Eye', label: 'Macular degeneration', patterns: ['macular degeneration', 'amd'] },
  { group: 'Bone / Neuro / Eye', label: "Alzheimer's / cognitive decline", patterns: ['alzheimer', 'cognitive decline', 'dementia'] },

  { group: 'Other', label: 'HIV/AIDS', patterns: ['hiv', 'aids'] },
  { group: 'Other', label: 'Rheumatoid arthritis', patterns: ['rheumatoid arthritis'] },
  { group: 'Other', label: 'Osteoarthritis', patterns: ['osteoarthritis'] },
  { group: 'Other', label: 'Cancer', patterns: ['cancer', 'chemotherapy'] },
  { group: 'Other', label: 'Pregnancy', patterns: ['pregnan'] },
  { group: 'Other', label: 'Vegetarian / vegan diet', patterns: ['vegetarian', 'vegan'] },
  { group: 'Other', label: 'Alcohol use disorder', patterns: ['alcohol'] },
];

interface Chunk { content: string; section: string | null; fact_sheet_id: string }

async function main() {
  const showOnly = process.argv.includes('--show') ? process.argv[process.argv.indexOf('--show') + 1] : null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: sheets, error: se } = await supabase.from('fact_sheets').select('id, supplement');
  if (se) throw new Error(se.message);
  const nameById = new Map((sheets ?? []).map((s) => [s.id as string, s.supplement as string]));

  // Pull every chunk once and match locally — 579 rows is nothing, and it avoids
  // 37 round trips.
  const all: Chunk[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('chunks').select('content, section, fact_sheet_id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as Chunk[]));
    if (!data || data.length < PAGE) break;
  }
  console.log(`\nScanning ${all.length} chunks from ${nameById.size} fact sheets.\n`);

  const results = CANDIDATES.map((c) => {
    const hits = all.filter((ch) => {
      const t = ch.content.toLowerCase();
      return c.patterns.some((p) => t.includes(p));
    });
    const supplements = [...new Set(hits.map((h) => nameById.get(h.fact_sheet_id) ?? '?'))];
    return { ...c, chunkHits: hits.length, supplements, hits };
  });

  if (showOnly) {
    const r = results.find((x) => x.label.toLowerCase() === showOnly.toLowerCase());
    if (!r) return console.log(`No candidate named "${showOnly}".`);
    console.log(`${r.label} — ${r.chunkHits} chunks across ${r.supplements.length} sheets\n`);
    for (const h of r.hits.slice(0, 12)) {
      const snippet = h.content.replace(/\s+/g, ' ').slice(0, 200);
      console.log(`  [${nameById.get(h.fact_sheet_id)}] ${h.section ?? ''}\n    ${snippet}…\n`);
    }
    return;
  }

  let group = '';
  console.log('  chunks  sheets  condition                          discussed in');
  console.log('  ' + '-'.repeat(96));
  for (const r of results.sort((a, b) => b.chunkHits - a.chunkHits)) {
    if (r.group !== group) { group = r.group; }
  }
  for (const g of [...new Set(CANDIDATES.map((c) => c.group))]) {
    console.log(`\n  ${g}`);
    for (const r of results.filter((x) => x.group === g).sort((a, b) => b.chunkHits - a.chunkHits)) {
      const verdict = r.chunkHits === 0 ? '\x1b[31m' : r.chunkHits < 3 ? '\x1b[33m' : '\x1b[32m';
      const top = r.supplements.slice(0, 4).join(', ') + (r.supplements.length > 4 ? `, +${r.supplements.length - 4}` : '');
      console.log(`  ${verdict}${String(r.chunkHits).padStart(6)}\x1b[0m  ${String(r.supplements.length).padStart(6)}  ${r.label.padEnd(34)} ${top || '—'}`);
    }
  }

  const worth = results.filter((r) => r.chunkHits >= 3);
  const thin = results.filter((r) => r.chunkHits > 0 && r.chunkHits < 3);
  const absent = results.filter((r) => r.chunkHits === 0);

  console.log(`\n  \x1b[32m${worth.length} well covered\x1b[0m (3+ chunks) · \x1b[33m${thin.length} thin\x1b[0m (1-2) · \x1b[31m${absent.length} absent\x1b[0m`);
  console.log(`\n  Ship the well-covered ones. Absent conditions would only ever return`);
  console.log(`  "no specific guidance", which spends attention and returns nothing.\n`);
  console.log(`  Inspect one:  npx tsx scripts/condition-coverage.ts --show "Chronic kidney disease"\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
