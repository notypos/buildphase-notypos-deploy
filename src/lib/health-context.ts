/**
 * Session-only health context.
 *
 * PRIVACY CONTRACT — the whole design rests on this:
 *   - lives in sessionStorage, cleared when the tab closes
 *   - sent with a request, used for that request, never written to the database
 *   - never logged, never cached
 *   - never included in an embedding call (see src/lib/embeddings.ts) — the
 *     embedding provider's free tier trains on submitted content
 *
 * Only supplements and explicitly-saved Decision Cards persist.
 *
 * Scope note: we collect only what NIH tables key on. No conditions, no
 * medications, no medical history.
 */

export type Sex = 'female' | 'male';

/**
 * Minimum necessary personalization.
 *
 * Only what NIH reference tables are actually keyed to. Conditions and
 * medications are deliberately NOT collected: ODS discusses a limited set of
 * them, so most entries would return "no specific guidance", and asking for a
 * medical history to produce that is a bad trade. Condition and interaction
 * information is surfaced from the retrieved fact sheet instead, when it exists.
 */
export interface HealthContext {
  /** Exact age in years — drives NIH life-stage row selection. */
  ageYears: number | null;
  sex: Sex | null;
  pregnant: boolean;
  breastfeeding: boolean;
}

export const EMPTY_CONTEXT: HealthContext = {
  ageYears: null,
  sex: null,
  pregnant: false,
  breastfeeding: false,
};


/** Pregnancy/lactation only apply to some people; don't ask everyone. */
export function showsPregnancyOptions(ctx: HealthContext): boolean {
  return ctx.sex === 'female' && ctx.ageYears !== null && ctx.ageYears >= 10 && ctx.ageYears <= 60;
}

export function hasAnyContext(ctx: HealthContext): boolean {
  return ctx.ageYears !== null || ctx.sex !== null || ctx.pregnant || ctx.breastfeeding;
}

/** Short summary for the collapsed panel header. */
export function summarize(ctx: HealthContext): string {
  if (!hasAnyContext(ctx)) return 'Not set — answers will be general';
  const bits: string[] = [];
  if (ctx.ageYears !== null) bits.push(`${ctx.ageYears}`);
  if (ctx.sex) bits.push(ctx.sex);
  if (ctx.pregnant) bits.push('pregnant');
  if (ctx.breastfeeding) bits.push('breastfeeding');
  return bits.join(' · ');
}

const KEY = 'clearlabel.health-context';

export function loadContext(): HealthContext {
  if (typeof window === 'undefined') return EMPTY_CONTEXT;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? { ...EMPTY_CONTEXT, ...JSON.parse(raw) } : EMPTY_CONTEXT;
  } catch {
    return EMPTY_CONTEXT;
  }
}

export function saveContext(ctx: HealthContext): void {
  if (typeof window === 'undefined') return;
  try {
    // sessionStorage, not localStorage: this should not outlive the tab.
    window.sessionStorage.setItem(KEY, JSON.stringify(ctx));
  } catch {
    /* private browsing or storage disabled — the app still works, just unremembered */
  }
}

export function clearContext(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Reading level derived from age. Presentation only — it never affects which NIH
 * limit applies, and it is not how safety emphasis is decided (that follows from
 * age directly, server-side).
 */
export function defaultReadingLevel(ageYears: number | null): 'simple' | 'standard' {
  if (ageYears === null) return 'standard';
  return ageYears < 18 || ageYears >= 70 ? 'simple' : 'standard';
}
