/**
 * DSLD match-scoring tests. npx tsx scripts/test-dsld-match.ts
 *
 * Regression test for the Aug 26 bug: a plain "Super B-Complex" photo
 * (Nature Made) matched DSLD's "Super B-Complex WITH VITAMIN C" instead --
 * a same-brand hit whose ingredient list is materially different, which is
 * worse than no match. pickBestMatch()/scoreMatches() in src/lib/dsld/client.ts
 * now score on word overlap against what the vision model actually read, not
 * brand alone -- these tests use synthetic hits (no network) to pin that
 * behavior down.
 */
import { pickBestMatch, scoreMatches } from '../src/lib/dsld/match';
import type { DsldSearchHit } from '../src/lib/dsld/client';

let pass = 0, fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '\x1b[32mok  \x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${label.padEnd(60)} ${JSON.stringify(actual)}`);
  ok ? pass++ : fail++;
}

const superB: DsldSearchHit = { id: 'plain', fullName: 'Super B-Complex', brandName: 'Nature Made' };
const superBVitC: DsldSearchHit = { id: 'vitc', fullName: 'Super B-Complex with Vitamin C', brandName: 'Nature Made' };
const otherBrand: DsldSearchHit = { id: 'other', fullName: 'Super B-Complex', brandName: 'NOW Foods' };

console.log('\nthe reported bug: plain product name must not match the fancier variant');
check(
  'DSLD order (Vitamin C variant first) does not fool the picker',
  pickBestMatch([superBVitC, superB], 'Nature Made', 'Super B-Complex')?.id,
  'plain',
);
check(
  'DSLD order (plain first) still picks correctly',
  pickBestMatch([superB, superBVitC], 'Nature Made', 'Super B-Complex')?.id,
  'plain',
);
check(
  'photo that DOES say "with Vitamin C" prefers that variant',
  pickBestMatch([superB, superBVitC], 'Nature Made', 'Super B-Complex with Vitamin C')?.id,
  'vitc',
);

console.log('\nbrand still matters more than name overlap');
check(
  'right brand beats same/similar name under the wrong brand',
  pickBestMatch([otherBrand, superB], 'Nature Made', 'Super B-Complex')?.id,
  'plain',
);

console.log('\nfallback behavior when identification is incomplete');
check('no hits -> null', pickBestMatch([], 'Nature Made', 'Super B-Complex'), null);
check(
  'no product name given -> shorter/plainer name wins as the safer default',
  pickBestMatch([superBVitC, superB], 'Nature Made', null)?.id,
  'plain',
);
check(
  'no brand or name -> first hit, not a crash',
  pickBestMatch([superB, superBVitC], null, null)?.id,
  'plain',
);

console.log('\nscoreMatches exposes the full ranking, not just the winner');
const ranked = scoreMatches([superBVitC, superB, otherBrand], 'Nature Made', 'Super B-Complex');
check('ranking length matches input', ranked.length, 3);
check('ranking is sorted best-first', ranked[0]?.hit.id, 'plain');
check('same-brand near-miss still outranks the wrong brand', ranked[1]?.hit.id, 'vitc');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
