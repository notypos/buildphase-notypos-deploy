/**
 * Life-stage matcher tests.  npx tsx scripts/test-life-stage.ts
 *
 * This is the safety-critical path: it decides WHICH NIH upper limit applies to
 * a person. Two real bugs were caught here — month ranges padded as years (an
 * infant's limit reaching a toddler) and age-less "Pregnant teens" matching a
 * 30-year-old. Re-run after any change to parseLifeStage.
 */
import { parseLifeStage, matchLifeStage } from '../src/lib/nih/life-stage';

// Labels in the shapes actually scraped from ODS sheets.
const rows = [
  'Birth to 6 months', 'Infants 7-12 months', 'Children 1-3 years', 'Children 4-8 years',
  'Children 9-13 years', 'Teens 14-18 years', 'Adults 19-50 years', 'Adults 51-70 years',
  'Adults 71+ years', 'Men 19-30 years', 'Women 19-30 years', 'Pregnant teens',
  'Pregnant women', 'Breastfeeding teens', 'Breastfeeding women',
].map((life_stage) => ({ life_stage, ul_amount: life_stage.length }));

console.log('--- parse check');
for (const r of ['Birth to 6 months','Adults 71+ years','Teens 14-18 years','Pregnant women','Men 19-30 years','Adults']) {
  const p = parseLifeStage(r);
  console.log(`  ${r.padEnd(22)} -> ${p ? `${p.minAge}..${p.maxAge===Infinity?'inf':p.maxAge.toFixed(1)} sex=${p.sex??'-'} preg=${p.pregnant}` : 'UNPARSED'}`);
}

console.log('\n--- match check');
const people = [
  { label: '3-month-old',              ctx: { ageYears: 0.25 } },
  { label: '2-year-old',               ctx: { ageYears: 2 } },
  { label: '16yo female',              ctx: { ageYears: 16, sex: 'female' as const } },
  { label: '16yo female, pregnant',    ctx: { ageYears: 16, sex: 'female' as const, pregnant: true } },
  { label: '28yo male',                ctx: { ageYears: 28, sex: 'male' as const } },
  { label: '30yo female, pregnant',    ctx: { ageYears: 30, sex: 'female' as const, pregnant: true } },
  { label: '30yo female, breastfeeding', ctx: { ageYears: 30, sex: 'female' as const, breastfeeding: true } },
  { label: '55yo female  (was "senior")', ctx: { ageYears: 55, sex: 'female' as const } },
  { label: '72yo male',                ctx: { ageYears: 72, sex: 'male' as const } },
  { label: '50yo (boundary)',          ctx: { ageYears: 50 } },
  { label: '51yo (boundary)',          ctx: { ageYears: 51 } },
];
for (const { label, ctx } of people) {
  const m = matchLifeStage(rows, ctx);
  console.log(`  ${label.padEnd(28)} -> ${m ? m.row.life_stage : 'NO MATCH'}`);
}

console.log('\n--- no-UL-published case');
console.log('  ashwagandha (empty table) ->', matchLifeStage([], { ageYears: 30 }) ?? 'null  (caller must say "no limit published")');
