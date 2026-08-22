/**
 * Unit conversion tests.  npx tsx scripts/test-units.ts
 *
 * These feed the dose-vs-upper-limit comparison. A wrong conversion here yields
 * a confident wrong safety answer, so unconvertible cases must return null
 * rather than a guess.
 */
import { toMicrograms, formatFromMicrograms, canonicalNutrient } from '../src/lib/nih/units';

let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '\x1b[32mok  \x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${label.padEnd(52)} ${JSON.stringify(actual)}`);
  ok ? pass++ : fail++;
}

console.log('\nmass conversions');
check('1000 mcg -> mcg', toMicrograms(1000, 'mcg'), 1000);
check('1 mg -> mcg', toMicrograms(1, 'mg'), 1000);
check('1 g -> mcg', toMicrograms(1, 'g'), 1_000_000);
check('50 µg -> mcg', toMicrograms(50, 'µg'), 50);
check('400 mcg DFE (folate) -> mcg', toMicrograms(400, 'mcg DFE'), 400);

console.log('\nIU — nutrient-specific, must refuse when unknown');
check('2000 IU vitamin D -> 50 mcg', toMicrograms(2000, 'IU', 'Vitamin D'), 50);
check('5000 IU vitamin D -> 125 mcg', toMicrograms(5000, 'IU', 'Vitamin D3'), 125);
check('10000 IU vitamin A -> 3000 mcg', toMicrograms(10000, 'IU', 'Vitamin A'), 3000);
check('400 IU of an unknown nutrient -> null', toMicrograms(400, 'IU', 'Ashwagandha'), null);
check('400 IU with no nutrient named -> null', toMicrograms(400, 'IU'), null);
check('unrecognized unit -> null', toMicrograms(5, 'scoops'), null);

console.log('\nformatting');
check('50 mcg', formatFromMicrograms(50), '50 mcg');
check('1500 mcg -> mg', formatFromMicrograms(1500), '1.5 mg');
check('2000000 mcg -> g', formatFromMicrograms(2_000_000), '2 g');

console.log('\ncanonical names (must total across products)');
check('Vitamin D3 == Vitamin D', canonicalNutrient('Vitamin D3'), canonicalNutrient('Vitamin D'));
check('Vitamin D (as cholecalciferol) == Vitamin D', canonicalNutrient('Vitamin D (as cholecalciferol)'), canonicalNutrient('Vitamin D'));
check('vitamin d-3 == Vitamin D', canonicalNutrient('vitamin d-3'), canonicalNutrient('Vitamin D'));
check('Vitamin B-12 == Vitamin B12', canonicalNutrient('Vitamin B-12'), canonicalNutrient('Vitamin B12'));
check('Zinc != Iron', canonicalNutrient('Zinc') === canonicalNutrient('Iron'), false);

console.log('\nthe cumulative case this exists for');
// Two ordinary products, each comfortably under the limit on its own.
const multi = toMicrograms(2000, 'IU', 'Vitamin D')!;      // a multivitamin
const softgel = toMicrograms(3000, 'IU', 'Vitamin D')!;    // a D3 softgel
const ul = toMicrograms(100, 'mcg', 'Vitamin D')!;         // NIH adult UL
console.log(`  multivitamin 2000 IU = ${formatFromMicrograms(multi)}`);
console.log(`  D3 softgel   3000 IU = ${formatFromMicrograms(softgel)}`);
console.log(`  combined             = ${formatFromMicrograms(multi + softgel)}`);
console.log(`  NIH adult UL         = ${formatFromMicrograms(ul)}`);
check(
  'combined exceeds UL while NEITHER product alone does',
  [multi + softgel > ul, multi > ul, softgel > ul],
  [true, false, false],
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
