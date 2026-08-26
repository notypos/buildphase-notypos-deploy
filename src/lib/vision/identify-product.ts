// Vision-based product identification, for the "scan a product" flow.
//
// Distinct from scan-label.ts (which transcribes a Supplement Facts panel):
// this reads whatever brand/product name is printed on the FRONT of the
// package -- e.g. "Nature Made" / "Super B-Complex" -- so a photo can be
// matched against NIH's DSLD database and the manufacturer-submitted label
// shown as the source of truth, instead of transcribing nutrition numbers
// off the photo every time. Live barcode scanning (native BarcodeDetector +
// @zxing/browser) was tried first and dropped after real-device testing
// showed it unreliable -- see plan.md "Explicitly cut" for the full story.
// This reuses the same vision-model infrastructure scan-label.ts already
// has working, just with a different prompt and a different, much smaller
// output shape.
import 'server-only';
import { z } from 'zod';
import { generateStructured, LlmError } from '@/lib/llm';
import { VISION_MODEL_CANDIDATES } from '@/lib/llm/models';

export const IdentifyResultSchema = z.object({
  brandName: z.string().max(100).nullable(),
  productName: z.string().max(200).nullable(),
  // false when the photo doesn't show a legible product label at all (wrong
  // subject, unreadable blur, no brand/product text visible) -- lets the UI
  // say so instead of guessing from nothing.
  readable: z.boolean(),
  note: z.string().max(300).nullable(),
});
export type IdentifyResult = z.infer<typeof IdentifyResultSchema>;

const SYSTEM = `You identify a dietary supplement product from a photo of its front label or
packaging -- NOT the Supplement Facts panel, the branding side. You do not give health
advice, safety opinions, or recommendations; you only read what is printed.

Extract:
- brandName: the manufacturer/brand as printed (e.g. "Nature Made", "NOW Foods"). Null if
  no brand is legible.
- productName: the product name/line as printed, WITHOUT the brand (e.g. "Super B-Complex",
  "Vitamin D3 2000 IU"). Null if no product name is legible.

Set readable to false -- and leave both fields null -- only if the photo is not a legible
product label at all (wrong subject, unreadable blur, no text visible). If you can read
either a brand or a product name, readable is true even if the other field is missing or
the photo is imperfect. Use note (nullable, short) to flag anything worth double-checking,
such as a partly obscured name.

Reply with JSON only, matching the given shape exactly.`;

/**
 * @param mimeType e.g. "image/jpeg"
 * @param dataBase64 raw base64, no "data:" prefix
 */
export async function identifyProduct(mimeType: string, dataBase64: string): Promise<IdentifyResult> {
  let lastErr: unknown;

  for (const modelId of VISION_MODEL_CANDIDATES) {
    try {
      const result = await generateStructured(IdentifyResultSchema, {
        modelId,
        system: SYSTEM,
        prompt: 'Identify the brand and product name printed on this label photo, as JSON.',
        image: { mimeType, dataBase64 },
        temperature: 0,
        maxTokens: 512,
        timeoutMs: 30000,
      });
      console.log(`[identify-product] succeeded via ${modelId}`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.warn(`[identify-product] ${modelId} failed, trying next candidate: ${msg}`);
      lastErr = err;
    }
  }

  if (lastErr instanceof LlmError) throw lastErr;
  throw new LlmError('All vision models failed.', {
    status: 502,
    userMessage: 'Product recognition is temporarily unavailable. Try again in a bit.',
  });
}
