// Vision extraction for the label scanner. Reads a photographed "Supplement
// Facts" / "Nutrition Facts" panel and returns structured rows the same
// shape the manual My Stack form already produces — so the result plugs
// straight into stack_items and stack-check.ts without a new data path.
//
// This is a read, not a judgment: the model never decides whether a dose is
// safe, it only transcribes what's printed on the label. The upper-limit /
// cumulative-dose comparison stays entirely in src/lib/nih/stack-check.ts.
import 'server-only';
import { z } from 'zod';
import { generateStructured, LlmError } from '@/lib/llm';
import { VISION_MODEL_CANDIDATES } from '@/lib/llm/models';

export const SCAN_UNITS = ['mcg', 'mg', 'g', 'iu'] as const;

const ScanItemSchema = z.object({
  labelName: z.string().min(1).max(200),
  doseAmount: z.number().positive().nullable(),
  doseUnit: z.enum(SCAN_UNITS).nullable(),
});

export const ScanResultSchema = z.object({
  productName: z.string().max(200).nullable(),
  items: z.array(ScanItemSchema).max(30),
  // false when the photo isn't a legible supplement/nutrition facts panel at
  // all (wrong subject, too blurry, cropped) — lets the UI say so instead of
  // silently returning an empty list.
  readable: z.boolean(),
  note: z.string().max(300).nullable(),
});

export type ScanResult = z.infer<typeof ScanResultSchema>;
export type ScanItem = z.infer<typeof ScanItemSchema>;

const SYSTEM = `You transcribe photographed dietary supplement labels — specifically the
"Supplement Facts" or "Nutrition Facts" panel — into structured JSON. You do not give
health advice, safety opinions, or recommendations; you only read what is printed.

For each ingredient/nutrient row with a numeric amount, extract:
- labelName: the ingredient name exactly as printed (e.g. "Vitamin D3 (Cholecalciferol)")
- doseAmount: the numeric amount per serving (e.g. 2000, 50)
- doseUnit: one of "mcg", "mg", "g", "iu" — convert obvious equivalents (e.g. "µg" -> "mcg",
  "IU" -> "iu"). If the amount is given only as "% Daily Value" with no absolute unit, or the
  unit isn't one of those four, set doseUnit and doseAmount to null but still include the row
  with its labelName.

Also extract productName if a product/brand name is visible on the label (null if not).

Set readable to false — and leave items empty — only if the photo is not a legible
supplement or nutrition facts panel at all (wrong subject, unreadable blur, no panel
visible). If you can read at least one row, readable is true even if the photo is
imperfect. Use note (nullable, short) to flag anything the person should double-check,
such as a blurry number or a serving size larger than 1 unit.

Reply with JSON only, matching the given shape exactly.`;

/**
 * @param mimeType e.g. "image/jpeg"
 * @param dataBase64 raw base64, no "data:" prefix
 */
export async function scanLabelImage(mimeType: string, dataBase64: string): Promise<ScanResult> {
  let lastErr: unknown;

  for (const modelId of VISION_MODEL_CANDIDATES) {
    try {
      const result = await generateStructured(ScanResultSchema, {
        modelId,
        system: SYSTEM,
        prompt: 'Extract every nutrient/ingredient row from this label photo as JSON.',
        image: { mimeType, dataBase64 },
        temperature: 0,
        maxTokens: 2048,
        timeoutMs: 45000,
      });
      console.log(`[scan] succeeded via ${modelId}`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.warn(`[scan] ${modelId} failed, trying next candidate: ${msg}`);
      lastErr = err;
    }
  }

  if (lastErr instanceof LlmError) throw lastErr;
  throw new LlmError('All vision models failed.', {
    status: 502,
    userMessage: 'Label scanning is temporarily unavailable. Try again in a bit.',
  });
}
