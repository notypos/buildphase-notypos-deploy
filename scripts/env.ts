/**
 * Load environment for standalone scripts.
 *
 * `import 'dotenv/config'` reads `.env` ONLY. Next.js reads `.env.local`
 * natively, so the app works, but scripts run outside Next and see nothing.
 * Load .env.local first — dotenv does not overwrite already-set vars, so the
 * first file to define a key wins.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

for (const file of ['.env.local', '.env']) {
  config({ path: resolve(root, file) });
}
