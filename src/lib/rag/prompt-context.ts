/**
 * Pure prompt-fragment builders.
 *
 * Deliberately free of `server-only` and of any I/O: these decide exactly what
 * personal information reaches the model, which is a promise worth being able to
 * assert directly (scripts/test-context-prompt.ts) rather than reason about.
 */
import type { HealthContext } from '@/lib/health-context';

/**
 * Emphasis that follows from the reader's age rather than from a button they
 * clicked. Reading level is a presentation choice; whether interactions and
 * organ-function notes get foregrounded is a function of who is reading.
 */
export function ageEmphasis(ageYears: number | null | undefined): string {
  if (ageYears == null) return '';
  if (ageYears >= 65)
    return ' Give extra prominence to medication interactions and to kidney or liver considerations wherever the sources mention them.';
  if (ageYears < 18)
    return ' Where the sources give amounts for this age group specifically, lead with those rather than adult amounts.';
  return '';
}

/**
 * Render the session health context for the prompt.
 *
 * Age, sex, and life stage only — that is what NIH reference tables are keyed
 * to. Returns an empty string when nothing was supplied, so a blank "About you"
 * contributes literally nothing to the prompt.
 *
 * This text goes to the generation provider; it must never be appended to a
 * retrieval query (guarded in src/lib/embeddings.ts).
 */
export function describeContext(ctx?: HealthContext): string {
  if (!ctx) return '';
  const bits: string[] = [];
  if (ctx.ageYears !== null) bits.push(`${ctx.ageYears} years old`);
  if (ctx.sex) bits.push(ctx.sex);
  if (ctx.pregnant) bits.push('pregnant');
  if (ctx.breastfeeding) bits.push('breastfeeding');
  if (!bits.length) return '';
  return `\nThe reader states: ${bits.join(', ')}. Use this only to surface the amounts and cautions the sources publish for that group.\n`;
}
