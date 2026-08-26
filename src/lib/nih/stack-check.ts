import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { matchLifeStage, type PersonContext } from './life-stage';
import { toMicrograms, formatFromMicrograms, canonicalNutrient } from './units';

/**
 * Deterministic safety checks over a supplement stack.
 *
 * Everything in this file is arithmetic and table lookup. No model is involved
 * in deciding whether a dose exceeds a limit, which limit applies, or how
 * amounts total across products. The model's job (elsewhere) is to explain
 * findings this file has already established.
 */

export interface StackIngredient {
  nutrient: string;
  amount: number;
  unit: string;
}

export interface StackEntry {
  id?: string;
  labelName: string;
  /** Normalized supplement name, joins nutrient_limits. */
  supplement?: string | null;
  doseAmount?: number | null;
  doseUnit?: string | null;
  /** Multi-ingredient products (a multivitamin) list their contents here. */
  ingredients?: StackIngredient[] | null;
}

export type FindingKind =
  | 'upper_limit'
  | 'cumulative_upper_limit'
  | 'approaching_limit'
  | 'no_limit_published'
  | 'not_comparable';

export type Severity = 'high' | 'medium' | 'info';

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  nutrient: string;
  /** Products contributing to this finding. */
  sources: string[];
  totalMcg?: number;
  limitMcg?: number;
  limitLabel?: string;
  lifeStageRow?: string;
  detail: string;
}

interface NutrientLimitRow {
  supplement: string;
  life_stage: string;
  ul_amount: number | null;
  ul_unit: string | null;
  rda_amount: number | null;
  rda_unit: string | null;
  fact_sheet_id: string | null;
}

/** Flatten a stack into per-nutrient totals, tracking which products contributed. */
function totalByNutrient(entries: StackEntry[]) {
  const totals = new Map<string, { display: string; mcg: number; sources: string[]; uncomparable: string[] }>();

  const add = (nutrient: string, amount: number, unit: string, source: string) => {
    const key = canonicalNutrient(nutrient);
    if (!key) return;
    const bucket = totals.get(key) ?? { display: nutrient, mcg: 0, sources: [], uncomparable: [] };
    const mcg = toMicrograms(amount, unit, nutrient);
    if (mcg === null) {
      // Unconvertible (e.g. IU for a nutrient with no established factor).
      if (!bucket.uncomparable.includes(source)) bucket.uncomparable.push(source);
    } else {
      bucket.mcg += mcg;
      if (!bucket.sources.includes(source)) bucket.sources.push(source);
    }
    totals.set(key, bucket);
  };

  for (const e of entries) {
    if (e.ingredients?.length) {
      for (const ing of e.ingredients) add(ing.nutrient, ing.amount, ing.unit, e.labelName);
    } else if (e.doseAmount != null && e.doseUnit && (e.supplement || e.labelName)) {
      add(e.supplement || e.labelName, e.doseAmount, e.doseUnit, e.labelName);
    }
  }
  return totals;
}

/**
 * Run the checks.
 *
 * A nutrient with no published upper limit produces an explicit
 * `no_limit_published` finding rather than silence. A safety tool that omits
 * what it could not check reads as "all clear" when it isn't.
 */
/**
 * Canonical keys of every nutrient NIH publishes ANY limit data for
 * (upper limit or not — just "is this nutrient in the table at all").
 * Used by the scanner to flag, right at scan time, which extracted items
 * the dose-safety check will actually be able to use.
 */
export async function trackedNutrientKeys(): Promise<Set<string>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('nutrient_limits').select('supplement');
  if (error) throw new Error(`Could not load nutrient limits: ${error.message}`);
  return new Set((data ?? []).map((r) => canonicalNutrient(r.supplement)));
}

export async function checkStack(entries: StackEntry[], person: PersonContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const totals = totalByNutrient(entries);
  if (totals.size === 0) return findings;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('nutrient_limits')
    .select('supplement, life_stage, ul_amount, ul_unit, rda_amount, rda_unit, fact_sheet_id');
  if (error) throw new Error(`Could not load nutrient limits: ${error.message}`);

  const rows = (data ?? []) as NutrientLimitRow[];

  // Group published limits by canonical nutrient name.
  const byNutrient = new Map<string, NutrientLimitRow[]>();
  for (const r of rows) {
    const key = canonicalNutrient(r.supplement);
    byNutrient.set(key, [...(byNutrient.get(key) ?? []), r]);
  }

  for (const [key, bucket] of totals) {
    if (bucket.uncomparable.length) {
      findings.push({
        kind: 'not_comparable',
        severity: 'info',
        nutrient: bucket.display,
        sources: bucket.uncomparable,
        detail: `The amount is listed in a unit that can't be compared to the NIH limit without a nutrient-specific conversion, so this one wasn't checked.`,
      });
    }
    if (bucket.mcg <= 0) continue;

    const candidates = (byNutrient.get(key) ?? []).filter((r) => r.ul_amount != null);
    if (candidates.length === 0) {
      findings.push({
        kind: 'no_limit_published',
        severity: 'info',
        nutrient: bucket.display,
        sources: bucket.sources,
        totalMcg: bucket.mcg,
        detail: `NIH does not publish a Tolerable Upper Intake Level for ${bucket.display}, so no dose comparison was possible. That is not the same as "safe at any amount".`,
      });
      continue;
    }

    const match = matchLifeStage(candidates, person);
    if (!match) {
      findings.push({
        kind: 'no_limit_published',
        severity: 'info',
        nutrient: bucket.display,
        sources: bucket.sources,
        totalMcg: bucket.mcg,
        detail: `NIH publishes upper limits for ${bucket.display}, but none for the age and life stage entered, so no comparison was made.`,
      });
      continue;
    }

    const limitMcg = toMicrograms(match.row.ul_amount!, match.row.ul_unit, bucket.display);
    if (limitMcg === null) {
      findings.push({
        kind: 'not_comparable',
        severity: 'info',
        nutrient: bucket.display,
        sources: bucket.sources,
        detail: `The published limit for ${bucket.display} is in a unit that can't be converted safely, so it wasn't compared.`,
      });
      continue;
    }

    const multiSource = bucket.sources.length > 1;
    const ratio = bucket.mcg / limitMcg;
    const shared = {
      nutrient: bucket.display,
      sources: bucket.sources,
      totalMcg: bucket.mcg,
      limitMcg,
      limitLabel: `${match.row.ul_amount} ${match.row.ul_unit ?? ''}`.trim(),
      lifeStageRow: match.row.life_stage,
    };

    if (ratio > 1) {
      findings.push({
        ...shared,
        kind: multiSource ? 'cumulative_upper_limit' : 'upper_limit',
        severity: 'high',
        detail: multiSource
          ? `Across ${bucket.sources.length} products, ${bucket.display} totals ${formatFromMicrograms(bucket.mcg)} per day. NIH lists an upper limit of ${formatFromMicrograms(limitMcg)} for "${match.row.life_stage}". No single product exceeds it — the total does.`
          : `${bucket.display} totals ${formatFromMicrograms(bucket.mcg)} per day. NIH lists an upper limit of ${formatFromMicrograms(limitMcg)} for "${match.row.life_stage}".`,
      });
    } else if (ratio >= 0.8) {
      findings.push({
        ...shared,
        kind: 'approaching_limit',
        severity: 'medium',
        detail: `${bucket.display} totals ${formatFromMicrograms(bucket.mcg)} per day, which is ${Math.round(ratio * 100)}% of the NIH upper limit of ${formatFromMicrograms(limitMcg)} for "${match.row.life_stage}". Food and fortified products count toward that total too.`,
      });
    }
  }

  const order: Record<Severity, number> = { high: 0, medium: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
