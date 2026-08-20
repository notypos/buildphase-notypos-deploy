/**
 * Ingest NIH ODS fact sheets into Supabase + pgvector.
 *
 *   npm run ingest -- --dry --limit 2          inspect parsing, no DB writes
 *   npm run ingest -- --limit 20               ingest 20 consumer sheets (English)
 *   npm run ingest -- --lang es                ingest the Spanish (DatosEnEspanol) sheets
 *   npm run ingest -- --audience health_professional
 *   npm run ingest -- --only VitaminD
 *
 * The flag is `--dry`, not `--dry-run`: npm owns `--dry-run` and swallows it
 * before the script ever sees it. If npm eats other flags on your shell, call
 * the script directly:  npx tsx scripts/ingest.ts --dry --limit 2
 *
 * Re-running is cheap: a sheet whose content hash is unchanged is skipped
 * without re-embedding.
 */
import './env';
import { setDefaultResultOrder } from 'node:dns';
import { createHash } from 'node:crypto';

// ods.od.nih.gov is behind Cloudflare and resolves to IPv6 first. Node prefers
// those, so on any network without working IPv6 routing (VPNs commonly) every
// request dies with UND_ERR_CONNECT_TIMEOUT after resolving fine. Force IPv4.
setDefaultResultOrder('ipv4first');
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { parseSheet, chunkSections } from './ods/parse';
import { embedDocuments } from '../src/lib/embeddings';

const BASE = 'https://ods.od.nih.gov';
const LIST_URL = `${BASE}/factsheets/list-all/`;
// Cloudflare fronts ods.od.nih.gov and 403s unrecognized agents. A descriptive
// bot UA gets refused; these are ordinary browser headers for a public page.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
};

type Audience = 'consumer' | 'health_professional';
type Lang = 'en' | 'es';

const SUFFIX: Record<string, string> = {
  'consumer:en': 'Consumer',
  'health_professional:en': 'HealthProfessional',
  'consumer:es': 'DatosEnEspanol',
  'health_professional:es': 'DatosEnEspanol',
};

// Fallback if the index page can't be scraped. Not exhaustive by design —
// discovery from list-all is the primary path.
const FALLBACK_SLUGS = [
  'VitaminA', 'VitaminB6', 'VitaminB12', 'VitaminC', 'VitaminD', 'VitaminE', 'VitaminK',
  'Thiamin', 'Riboflavin', 'Niacin', 'Folate', 'Biotin', 'PantothenicAcid', 'Choline',
  'Calcium', 'Chromium', 'Copper', 'Fluoride', 'Iodine', 'Iron', 'Magnesium', 'Manganese',
  'Molybdenum', 'Phosphorus', 'Potassium', 'Selenium', 'Zinc',
  'Omega3FattyAcids', 'Carnitine', 'Probiotics', 'Melatonin',
];

interface Args {
  dryRun: boolean;
  limit: number;
  audience: Audience;
  lang: Lang;
  only: string | null;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const val = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    dryRun: a.includes('--dry') || a.includes('--dry-run'),
    limit: Number(val('--limit') ?? 0) || Infinity,
    audience: (val('--audience') as Audience) ?? 'consumer',
    lang: (val('--lang') as Lang) ?? 'en',
    only: val('--only') ?? null,
  };
}

const FETCH_TIMEOUT_MS = 20000;

async function fetchText(url: string, tries = 3): Promise<string> {
  for (let i = 0; ; i++) {
    const started = Date.now();
    try {
      process.stdout.write(`    GET ${url} ... `);
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        // Without this a stalled connection hangs the script forever with no output.
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 404) throw Object.assign(new Error('404'), { notFound: true });
      if (res.status === 403) {
        throw Object.assign(
          new Error('HTTP 403 — Cloudflare refused the request. Try disabling your VPN.'),
          { blocked: true },
        );
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      console.log(`${res.status} ${(text.length / 1024).toFixed(0)}KB ${Date.now() - started}ms`);
      return text;
    } catch (err) {
      const isTimeout = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
      // `TypeError: fetch failed` is a useless message on its own — the real
      // reason (DNS, TLS, proxy, refused) is on err.cause.
      const cause = (err as { cause?: unknown }).cause;
      const causeText = cause
        ? ` | cause: ${(cause as Error).message ?? String(cause)}${(cause as { code?: string }).code ? ` (${(cause as { code?: string }).code})` : ''}`
        : '';
      console.log(
        isTimeout
          ? `TIMEOUT after ${FETCH_TIMEOUT_MS / 1000}s`
          : `FAILED ${String(err).slice(0, 90)}${causeText}`,
      );
      // Retrying a 403 just gets refused again — the IP or agent is the problem.
      if ((err as { notFound?: boolean; blocked?: boolean }).notFound
          || (err as { blocked?: boolean }).blocked
          || i >= tries - 1) throw err;
      const wait = 1500 * 2 ** i;
      console.log(`    retry ${i + 2}/${tries} in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** Scrape the index for real fact-sheet slugs rather than guessing them. */
async function discoverSlugs(audience: Audience, lang: Lang): Promise<string[]> {
  const suffix = SUFFIX[`${audience}:${lang}`];
  console.log('  discovering fact sheets from the ODS index...');
  try {
    const html = await fetchText(LIST_URL);
    const $ = cheerio.load(html);
    // Keyed lowercase: the index links both /chromium-Consumer and
    // /Chromium-Consumer, which are the same page and would be ingested twice.
    const found = new Map<string, string>();
    $('a[href*="/factsheets/"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const m = href.match(/\/factsheets\/([A-Za-z0-9%\-]+)-(Consumer|HealthProfessional|DatosEnEspanol)\/?$/);
      if (!m) return;
      const slug = decodeURIComponent(m[1]);
      const key = slug.toLowerCase();
      const existing = found.get(key);
      if (!existing || (slug[0] === slug[0].toUpperCase() && existing[0] !== existing[0].toUpperCase())) {
        found.set(key, slug);
      }
    });
    if (found.size >= 10) {
      console.log(`Discovered ${found.size} fact sheets from the index.`);
      return [...found.values()];
    }
    console.warn(`Index yielded only ${found.size} slugs; using fallback list.`);
  } catch (err) {
    console.warn(`Could not read the index (${String(err).slice(0, 80)}); using fallback list.`);
  }
  void suffix;
  return FALLBACK_SLUGS;
}

function sheetUrl(slug: string, audience: Audience, lang: Lang) {
  return `${BASE}/factsheets/${slug}-${SUFFIX[`${audience}:${lang}`]}/`;
}

// Overview sheets whose slug is an acronym rather than a supplement name.
const SLUG_NAMES: Record<string, string> = {
  WYNTK: 'Dietary Supplements: What You Need to Know',
  MVMS: 'Multivitamin/Mineral Supplements',
  ExerciseAndAthleticPerformance: 'Exercise and Athletic Performance',
  WeightLoss: 'Weight Loss',
};

/** Humanize a slug: 'Omega3FattyAcids' -> 'Omega 3 Fatty Acids'. */
function supplementName(slug: string) {
  if (SLUG_NAMES[slug]) return SLUG_NAMES[slug];
  return slug.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').trim();
}

async function main() {
  const args = parseArgs();
  console.log(`ingest: audience=${args.audience} lang=${args.lang} dryRun=${args.dryRun}`);

  const slugs = args.only ? [args.only] : (await discoverSlugs(args.audience, args.lang)).slice(0, args.limit);
  console.log(`  processing ${slugs.length} sheet(s): ${slugs.slice(0, 8).join(', ')}${slugs.length > 8 ? ', ...' : ''}\n`);

  const supabase = args.dryRun
    ? null
    : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });

  let ok = 0, skipped = 0, failed = 0, notFound = 0, totalChunks = 0;

  for (const slug of slugs) {
    const url = sheetUrl(slug, args.audience, args.lang);
    const fullSlug = `${slug}-${SUFFIX[`${args.audience}:${args.lang}`]}`;

    try {
      const html = await fetchText(url);
      const parsed = parseSheet(html);
      const chunks = chunkSections(parsed.sections);
      const hash = createHash('sha256').update(parsed.sections.map((s) => s.text).join('')).digest('hex');

      if (parsed.sections.length === 0) {
        console.warn(`  ! ${fullSlug}: parsed 0 sections — selector problem, check the page`);
        failed++;
        continue;
      }

      console.log(
        `  ${fullSlug}: ${parsed.sections.length} sections, ${chunks.length} chunks, ${parsed.limits.length} limit rows`,
      );

      if (args.dryRun) {
        console.log(`    title: ${parsed.title}`);
        for (const s of parsed.sections.slice(0, 3)) {
          console.log(`    § ${s.section}${s.subsection ? ' — ' + s.subsection : ''}: ${s.text.slice(0, 110)}...`);
        }
        for (const l of parsed.limits.slice(0, 3)) {
          console.log(`    ⌁ ${l.lifeStage}${l.sex ? ` (${l.sex})` : ''}: RDA ${l.rdaAmount ?? '—'} ${l.rdaUnit ?? ''} | UL ${l.ulAmount ?? '—'} ${l.ulUnit ?? ''}`);
        }
        ok++;
        totalChunks += chunks.length;
        continue;
      }

      const { data: existing } = await supabase!
        .from('fact_sheets').select('id, content_hash').eq('slug', fullSlug).maybeSingle();

      if (existing?.content_hash === hash) {
        console.log('    unchanged — skipped');
        skipped++;
        continue;
      }

      const { data: sheet, error: sheetErr } = await supabase!
        .from('fact_sheets')
        .upsert(
          {
            slug: fullSlug,
            supplement: supplementName(slug),
            audience: args.audience,
            language: args.lang,
            title: parsed.title,
            source_url: url,
            // Deliberately null: the hash is only written after chunks land, so a
            // run that dies mid-embed leaves the sheet marked incomplete and
            // gets retried instead of being skipped forever with zero chunks.
            content_hash: null,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'slug' },
        )
        .select('id')
        .single();
      if (sheetErr) throw sheetErr;

      // Replace rather than diff — chunk boundaries shift when text changes.
      await supabase!.from('chunks').delete().eq('fact_sheet_id', sheet.id);
      await supabase!.from('nutrient_limits').delete().eq('fact_sheet_id', sheet.id);

      const vectors = await embedDocuments(chunks.map((c) => c.content), {
        onProgress: ({ done, total }) =>
          process.stdout.write(`\r    embedding ${done}/${total} chunks   `),
      });
      process.stdout.write('\r');
      const rows = chunks.map((c, i) => ({
        fact_sheet_id: sheet.id,
        section: c.section,
        subsection: c.subsection,
        ordinal: c.ordinal,
        content: c.content,
        token_estimate: c.tokenEstimate,
        embedding: vectors[i],
      }));

      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase!.from('chunks').insert(rows.slice(i, i + 100));
        if (error) throw error;
      }

      if (parsed.limits.length) {
        const { error } = await supabase!.from('nutrient_limits').insert(
          parsed.limits.map((l) => ({
            fact_sheet_id: sheet.id,
            supplement: supplementName(slug),
            life_stage: l.lifeStage,
            sex: l.sex,
            rda_amount: l.rdaAmount,
            rda_unit: l.rdaUnit,
            ul_amount: l.ulAmount,
            ul_unit: l.ulUnit,
          })),
        );
        if (error) console.warn(`    limits insert failed: ${error.message}`);
      }

      // Only now is the sheet genuinely ingested.
      await supabase!.from('fact_sheets').update({ content_hash: hash }).eq('id', sheet.id);

      ok++;
      totalChunks += chunks.length;
    } catch (err) {
      if ((err as { notFound?: boolean }).notFound) {
        // The index links slugs that have no consumer version. Expected, not a failure.
        console.log(`  - ${fullSlug}: no such sheet (404)`);
        notFound++;
      } else {
        console.error(`  ! ${fullSlug}: ${String(err).slice(0, 160)}`);
        failed++;
      }
    }

    await new Promise((r) => setTimeout(r, 400)); // be polite to ods.od.nih.gov
  }

  console.log(
    `\ndone — ${ok} ingested, ${skipped} unchanged, ${notFound} not published (404), ${failed} failed, ${totalChunks} chunks`,
  );
  if (failed > 0) console.log('   re-run to retry the failures; completed sheets are skipped.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
