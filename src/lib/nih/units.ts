/**
 * Unit normalization for nutrient amounts.
 *
 * Deliberately conservative: an unconvertible pair returns null and the caller
 * reports "could not compare" rather than guessing. A wrong conversion in a
 * dose-vs-limit check produces a confident, wrong safety answer — strictly worse
 * than admitting the comparison could not be made.
 */

export type Unit = 'mcg' | 'mg' | 'g' | 'iu';

const MASS_TO_MCG: Record<string, number> = { mcg: 1, µg: 1, ug: 1, mg: 1_000, g: 1_000_000 };

/**
 * IU is not a mass unit — it measures biological activity, so the conversion is
 * different for every nutrient AND for different chemical forms of the same one.
 * Only well-established, form-specific factors belong here.
 */
const IU_TO_MCG: Record<string, number> = {
  'vitamin d': 0.025,   // 1 IU = 0.025 mcg cholecalciferol
  'vitamin e': 0.67,    // 1 IU = 0.67 mg (670 mcg) d-alpha-tocopherol (natural)
  'vitamin a': 0.3,     // 1 IU = 0.3 mcg RAE retinol
};

export function normalizeUnit(raw?: string | null): Unit | null {
  if (!raw) return null;
  const u = raw.trim().toLowerCase().replace(/\./g, '');
  if (u === 'iu') return 'iu';
  if (u in MASS_TO_MCG) return u === 'µg' || u === 'ug' ? 'mcg' : (u as Unit);
  if (u === 'mcg dfe' || u === 'mcg rae' || u === 'mg ne') return 'mcg';
  return null;
}

/**
 * Convert an amount to micrograms. Returns null when the conversion is not
 * safely determinable — notably IU for a nutrient with no established factor.
 */
export function toMicrograms(
  amount: number,
  unit: string | null | undefined,
  nutrient?: string,
): number | null {
  const u = normalizeUnit(unit);
  if (u === null) return null;

  if (u === 'iu') {
    const key = (nutrient ?? '').trim().toLowerCase();
    const factor = Object.entries(IU_TO_MCG).find(([n]) => key.includes(n))?.[1];
    if (factor === undefined) return null; // unknown nutrient — refuse to guess
    return amount * factor;
  }

  const mult = MASS_TO_MCG[u === 'mcg' ? 'mcg' : u];
  return mult === undefined ? null : amount * mult;
}

/** Render micrograms back in the most readable unit. */
export function formatFromMicrograms(mcg: number): string {
  if (mcg >= 1_000_000) return `${+(mcg / 1_000_000).toFixed(2)} g`;
  if (mcg >= 1_000) return `${+(mcg / 1_000).toFixed(2)} mg`;
  return `${+mcg.toFixed(2)} mcg`;
}

/**
 * Normalize a nutrient name for cross-product matching, so "Vitamin D3",
 * "vitamin d-3", and "Vitamin D (as cholecalciferol)" total together.
 */
export function canonicalNutrient(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(as|from|natural|synthetic|d-alpha|dl-alpha)\b/g, ' ')
    .replace(/vitamin\s*d\s*-?\s*[23]\b/, 'vitamin d')
    .replace(/vitamin\s*b\s*-?\s*(\d+)/, 'vitamin b$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
