/**
 * Proves what health context actually reaches the model.
 *   npx tsx scripts/test-context-prompt.ts
 *
 * The claim "leaving About you blank sends nothing" is a behavioural promise, so
 * it gets asserted rather than assumed. Also checks the inverse: that a context
 * which IS supplied appears exactly once and says only what was entered.
 */
import { ageEmphasis, describeContext } from '../src/lib/rag/prompt-context';
import { EMPTY_CONTEXT, hasAnyContext, normalizeContext, type HealthContext } from '../src/lib/health-context';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? '\x1b[32mok  \x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${label}${detail ? `\n         ${detail}` : ''}`);
  cond ? pass++ : fail++;
}

const ctx = (p: Partial<HealthContext>): HealthContext => normalizeContext({ ...EMPTY_CONTEXT, ...p });

console.log('\nBlank "About you" — nothing should reach the prompt');
check('hasAnyContext(empty) is false → the client sends undefined', hasAnyContext(EMPTY_CONTEXT) === false);
check('describeContext(undefined) is empty', describeContext(undefined) === '');
check('describeContext(EMPTY_CONTEXT) is empty', describeContext(EMPTY_CONTEXT) === '',
  `got: ${JSON.stringify(describeContext(EMPTY_CONTEXT))}`);
check('ageEmphasis(null) is empty', ageEmphasis(null) === '');
check('ageEmphasis(undefined) is empty', ageEmphasis(undefined) === '');

console.log('\nPartial context — only what was entered');
const onlyAge = ctx({ ageYears: 34 });
console.log(`    ${JSON.stringify(describeContext(onlyAge))}`);
check('age only mentions the age', describeContext(onlyAge).includes('34 years old'));
check('age only does NOT invent a sex', !/female|male/.test(describeContext(onlyAge)));

const onlySex = ctx({ sex: 'female' });
console.log(`    ${JSON.stringify(describeContext(onlySex))}`);
check('sex only does NOT invent an age', !/years old/.test(describeContext(onlySex)));

console.log('\nFull context');
const full = ctx({ ageYears: 30, sex: 'female', pregnant: true });
console.log(`    ${JSON.stringify(describeContext(full))}`);
check('includes age, sex, pregnancy', ['30 years old', 'female', 'pregnant'].every((t) => describeContext(full).includes(t)));
check('appears exactly once', (describeContext(full).match(/The reader states:/g) ?? []).length === 1);

console.log('\nAge-driven emphasis');
check('72 → interaction/organ emphasis', ageEmphasis(72).includes('interactions'));
check('34 → no emphasis', ageEmphasis(34) === '');
check('15 → age-group amounts', ageEmphasis(15).includes('age group'));

console.log('\nInconsistent input is normalized away before it can reach the prompt');
const bad = ctx({ ageYears: 40, sex: 'male', pregnant: true, breastfeeding: true });
console.log(`    ${JSON.stringify(describeContext(bad))}`);
check('male + pregnant → pregnancy dropped', !describeContext(bad).includes('pregnant'));
check('male + breastfeeding → dropped', !describeContext(bad).includes('breastfeeding'));

const tooOld = ctx({ ageYears: 71, sex: 'female', pregnant: true });
check('71 + pregnant → dropped (outside 10-60)', !describeContext(tooOld).includes('pregnant'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
