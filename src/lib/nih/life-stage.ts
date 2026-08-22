/**
 * Deterministic mapping from a person's age/sex/life-stage to the NIH intake
 * table row that applies to them.
 *
 * This is plain arithmetic and string parsing on purpose. Choosing which upper
 * limit applies to a 71-year-old is not a judgement call, and a model that
 * confidently picks the wrong row produces a dangerous answer that reads exactly
 * like a correct one. The model explains the finding; it never selects it.
 *
 * NIH Dietary Reference Intake tables are keyed to life stages, not to loose
 * categories like "senior". Real published rows look like:
 *   "Birth to 6 months" · "Children 1-3 years" · "Teens 14-18 years"
 *   "Adults 19-50 years" · "Adults 51-70 years" · "Adults 71+ years"
 *   "Men 19-30 years" · "Women 51+ years"
 *   "Pregnant teens" · "Breastfeeding women"
 * Wording varies per fact sheet because these are scraped, so matching parses
 * the text rather than assuming a fixed vocabulary.
 */

export type Sex = 'female' | 'male';

export interface PersonContext {
  /** Exact age in years. Fractions allowed for infants (0.5 = 6 months). */
  ageYears: number;
  /** Sex as used by the NIH intake tables. */
  sex?: Sex;
  pregnant?: boolean;
  breastfeeding?: boolean;
}

/** A `nutrient_limits.life_stage` string parsed into something comparable. */
export interface ParsedLifeStage {
  raw: string;
  minAge: number;
  maxAge: number;
  sex: Sex | null;
  pregnant: boolean;
  breastfeeding: boolean;
}

const MONTHS = /(\d+)\s*(?:to|-|–)\s*(\d+)\s*months?/i;
const BIRTH_TO_MONTHS = /birth\s*(?:to|-|–)\s*(\d+)\s*months?/i;
const YEAR_RANGE = /(\d+)\s*(?:to|-|–)\s*(\d+)\s*years?/i;
const YEARS_PLUS = /(\d+)\s*(?:\+|and older|or older|and over)/i;
const SINGLE_YEARS = /(\d+)\s*years?/i;

/**
 * Parse one scraped life-stage label. Returns null when the text carries no age
 * information at all, which is the signal to skip the row rather than guess.
 */
export function parseLifeStage(raw: string): ParsedLifeStage | null {
  const t = raw.trim();
  const lower = t.toLowerCase();

  const pregnant = /pregnan/.test(lower);
  const breastfeeding = /breastfeed|lactat|nursing/.test(lower);

  let sex: Sex | null = null;
  if (/\bwomen\b|\bfemales?\b|\bgirls?\b/.test(lower)) sex = 'female';
  else if (/\bmen\b|\bmales?\b|\bboys?\b/.test(lower)) sex = 'male';
  // Pregnancy and breastfeeding rows are female by definition even when unlabelled.
  if (!sex && (pregnant || breastfeeding)) sex = 'female';

  let minAge: number | null = null;
  let maxAge: number | null = null;
  // Inclusive-range padding must match the unit the range was written in.
  // "19-50 years" includes someone aged 50.9; "7-12 months" must NOT extend
  // into the second year. Padding months by a year applied an infant's upper
  // limit to a toddler.
  let padding = 0.999;

  let m: RegExpMatchArray | null;
  if ((m = t.match(BIRTH_TO_MONTHS))) {
    minAge = 0;
    maxAge = Number(m[1]) / 12;
    padding = 0.999 / 12;
  } else if ((m = t.match(MONTHS))) {
    minAge = Number(m[1]) / 12;
    maxAge = Number(m[2]) / 12;
    padding = 0.999 / 12;
  } else if ((m = t.match(YEAR_RANGE))) {
    minAge = Number(m[1]);
    maxAge = Number(m[2]);
  } else if ((m = t.match(YEARS_PLUS))) {
    minAge = Number(m[1]);
    maxAge = Infinity;
  } else if ((m = t.match(SINGLE_YEARS))) {
    minAge = Number(m[1]);
    maxAge = Number(m[1]);
  } else if (pregnant || breastfeeding) {
    // Age-less pregnancy/lactation rows. NIH publishes these split by teen vs
    // adult with different values, so the distinction is load-bearing: reading
    // "Pregnant teens" as the whole childbearing span made a 30-year-old match
    // the teen row.
    if (/teen|adolescen|girls?/.test(lower)) {
      minAge = 14;
      maxAge = 18;
    } else {
      minAge = 19;
      maxAge = 50;
    }
  } else if (/^\s*(adults?|men|women)\s*$/i.test(lower)) {
    // Bare "Adults" / "Men" / "Women" rows appear on some sheets.
    minAge = 19;
    maxAge = Infinity;
  } else if (/^\s*(teens?|adolescents?)\s*$/i.test(lower)) {
    minAge = 14;
    maxAge = 18;
  }

  if (minAge === null || maxAge === null) return null;

  return {
    raw: t,
    minAge,
    maxAge: maxAge === Infinity ? Infinity : maxAge + padding,
    sex,
    pregnant,
    breastfeeding,
  };
}

/** Does this row apply to this person at all? */
function applies(row: ParsedLifeStage, p: PersonContext): boolean {
  if (p.ageYears < row.minAge || p.ageYears > row.maxAge) return false;
  if (row.sex && p.sex && row.sex !== p.sex) return false;
  // A pregnancy row never applies to someone who isn't pregnant, and vice versa
  // — a pregnant person's limits differ enough that the general row is wrong.
  if (row.pregnant && !p.pregnant) return false;
  if (row.breastfeeding && !p.breastfeeding) return false;
  return true;
}

/**
 * Rank applicable rows. More specific wins: a pregnancy row beats a sex-specific
 * row, which beats a general age row; a narrow age band beats a wide one.
 */
function specificity(row: ParsedLifeStage, p: PersonContext): number {
  let score = 0;
  if (row.pregnant && p.pregnant) score += 100;
  if (row.breastfeeding && p.breastfeeding) score += 100;
  if (row.sex && p.sex && row.sex === p.sex) score += 10;
  const span = row.maxAge === Infinity ? 200 : row.maxAge - row.minAge;
  score += Math.max(0, 20 - span); // narrower band = more specific
  return score;
}

export interface LifeStageMatch<T> {
  row: T;
  parsed: ParsedLifeStage;
}

/**
 * Pick the NIH row that applies to this person.
 *
 * Returns null when nothing matches — which is a real and common outcome
 * (botanicals publish no ULs at all). Callers must surface "no limit published"
 * rather than silently reporting no problem: a safety tool that omits what it
 * could not check reads as "all clear" when it isn't.
 */
export function matchLifeStage<T extends { life_stage: string }>(
  rows: T[],
  person: PersonContext,
): LifeStageMatch<T> | null {
  const candidates: LifeStageMatch<T>[] = [];

  for (const row of rows) {
    const parsed = parseLifeStage(row.life_stage);
    if (parsed && applies(parsed, person)) candidates.push({ row, parsed });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => specificity(b.parsed, person) - specificity(a.parsed, person));
  return candidates[0];
}

/** Human-readable description of the person, for the prompt and the UI. */
export function describePerson(p: PersonContext): string {
  const bits: string[] = [`${p.ageYears} years old`];
  if (p.sex) bits.push(p.sex);
  if (p.pregnant) bits.push('pregnant');
  if (p.breastfeeding) bits.push('breastfeeding');
  return bits.join(', ');
}
