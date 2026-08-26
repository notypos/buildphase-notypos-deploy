/**
 * Ingest NCCIH ("Herbs at a Glance" and related consumer health-topic pages)
 * into the same Supabase + pgvector corpus as scripts/ingest.ts.
 *
 * WHY THIS EXISTS: ods.od.nih.gov/factsheets/list-all/ — the index the
 * challenge's own resource guide points solvers at — is NOT single-domain.
 * ODS keeps its own fact sheets for ~40 nutrients/minerals/vitamins (that's
 * what scripts/ingest.ts pulls). For herbs and botanicals (acai, turmeric,
 * ginseng, ashwagandha, ...) ODS delegates to NCCIH, a separate NIH institute
 * on a different domain. Skipping those left the corpus with zero content for
 * an entire category of real, in-scope questions (e.g. "acai may affect MRI
 * imaging of the GI tract" — a genuine NCCIH safety-section sentence that has
 * no ODS equivalent anywhere).
 *
 * MedlinePlus's natural-products section (also linked from list-all) was
 * evaluated and deliberately excluded: it was discontinued site-wide on
 * 2025-07-29 and every one of its ~65 links now resolves to the same generic
 * "database is unavailable" notice. Ingesting that would have meant 65 fact
 * sheets sharing one useless sentence — actively worse than not ingesting it.
 * Other domains list-all links to (opss.org, archived AHRQ reports, FDA
 * notices, cancer.gov PDQ, NIEHS/NIDCR/NIDA one-offs, Wayback snapshots) were
 * also left out: heterogeneous formats, mostly archival/legal rather than
 * consumer fact sheets, low value per hour of scraper work. Revisit if time
 * allows — see README's "Wanted next" / known-limitations note.
 *
 *   npx tsx scripts/ingest-nccih.ts --dry --limit 3    inspect parsing, no DB writes
 *   npx tsx scripts/ingest-nccih.ts                    ingest everything discovered
 *   npx tsx scripts/ingest-nccih.ts --only acai
 *
 * Re-running is cheap: a page whose content hash is unchanged is skipped
 * without re-embedding — same scheme as scripts/ingest.ts.
 */
import './env';
import { setDefaultResultOrder } from 'node:dns';
import { createHash } from 'node:crypto';

// Same fix as scripts/ingest.ts: force IPv4 so networks with broken IPv6
// routing (VPNs commonly) don't die with UND_ERR_CONNECT_TIMEOUT.
setDefaultResultOrder('ipv4first');
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { parseNccihSheet, chunkNccihSections } from './nccih/parse';
import { embedDocuments } from '../src/lib/embeddings';

// Discovery reads the same index scripts/ingest.ts uses — it's the one page
// the challenge resource guide actually points solvers at.
const LIST_URL = 'https://ods.od.nih.gov/factsheets/list-all/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
};

// Insurance if the index page can't be scraped or under-counts — the manual
// inventory taken 2026-08-26. Not exhaustive by design, same philosophy as
// scripts/ingest.ts's FALLBACK_SLUGS: discovery from list-all is primary.
const FALLBACK_PATHS = [
  'acai', 'aloevera', 'ashwagandha', 'astragalus', 'bilberry', 'bitterorange',
  'blackcohosh/ataglance.htm', 'bromelain', 'butterbur', 'catclaw', 'chamomile',
  'chasteberry', 'cinnamon', 'supplements/coq10', 'silver', 'cranberry',
  'dandelion', 'echinacea', 'elderberry', 'energy-drinks', 'eveningprimrose',
  'fenugreek', 'feverfew', 'flaxseed/ataglance.htm', 'garcinia-cambogia',
  'garlic', 'ginger', 'ginkgo', 'asianginseng', 'goldenseal',
  'grapeseed/ataglance.htm', 'greentea', 'hawthorn', 'hoodia', 'horsechestnut',
  'kava', 'lavender/ataglance.htm', 'licoriceroot', 'melatonin-what-you-need-to-know',
  'milkthistle', 'mistletoe', 'noni', 'passionflower', 'pomegranate',
  'probiotics', 'pycnogenol', 'redclover', 'redyeastrice', 'sawpalmetto',
  'soy', 'stjohnswort', 'stingingnettle', 'turmeric', 'valerian',
  'whitewillowbark', 'omega3', 'omega3/introduction.htm',
  'alzheimers-disease-at-a-glance', 'antioxidant-supplements-what-you-need-to-know',
  'berberine-and-weight-loss-what-you-need-to-know',
  'bodybuilding-and-performance-enhancement-supplements',
  'cannabis-marijuana-and-cannabinoids-what-you-need-to-know',
  'diabetes-and-dietary-supplements', 'eye-conditions-at-a-glance',
  'menopausal-symptoms-in-depth',
  'dimethyl-sulfoxide-dmso-and-methylsulfonylmethane-msm-for-osteoarthritis',
  'osteoarthritis-in-depth',
];

// Paths under /health/ that are indexes, provider-facing digests, or news
// items rather than a single topic's consumer fact page — not worth ingesting.
const PATH_DENYLIST = [
  /^herbsataglance\.htm$/i,
  /^providers\//i,
  /^in-the-news/i,
];

interface Args {
  dryRun: boolean;
  limit: number;
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
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 404) throw Object.assign(new Error('404'), { notFound: true });
      if (res.status === 403) {
        throw Object.assign(
          new Error('HTTP 403 — refused. NCCIH may front its site with the same kind of WAF as ODS; try disabling your VPN.'),
          { blocked: true },
        );
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      console.log(`${res.status} ${(text.length / 1024).toFixed(0)}KB ${Date.now() - started}ms`);
      return text;
    } catch (err) {
      const isTimeout = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
      const cause = (err as { cause?: unknown }).cause;
      const causeText = cause
        ? ` | cause: ${(cause as Error).message ?? String(cause)}${(cause as { code?: string }).code ? ` (${(cause as { code?: string }).code})` : ''}`
        : '';
      console.log(
        isTimeout
          ? `TIMEOUT after ${FETCH_TIMEOUT_MS / 1000}s`
          : `FAILED ${String(err).slice(0, 90)}${causeText}`,
      );
      if ((err as { notFound?: boolean; blocked?: boolean }).notFound
          || (err as { blocked?: boolean }).blocked
          || i >= tries - 1) throw err;
      const wait = 1500 * 2 ** i;
      console.log(`    retry ${i + 2}/${tries} in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** Normalize a discovered /health/... path for dedup: drop the ataglance.htm
 *  suffix and trailing slash, so "acai" and "acai/ataglance.htm" collide. */
function normalizeKey(path: string): string {
  return path.replace(/\/ataglance\.htm$/i, '').replace(/\/$/, '').toLowerCase();
}

interface Discovered {
  path: string; // as found, e.g. "acai" or "supplements/coq10" or "blackcohosh/ataglance.htm"
  url: string;
}

/** Scrape the ODS index for NCCIH-hosted health-topic links. */
async function discoverPaths(): Promise<Discovered[]> {
  console.log('  discovering NCCIH pages from the ODS index...');
  try {
    const html = await fetchText(LIST_URL);
    const $ = cheerio.load(html);
    const found = new Map<string, Discovered>();

    $('a[href*="nccih.nih.gov/health/"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      let u: URL;
      try {
        u = new URL(href);
      } catch {
        return;
      }
      if (!/(^|\.)nccih\.nih\.gov$/i.test(u.hostname)) return;
      const m = u.pathname.match(/^\/health\/(.+?)\/?$/i);
      if (!m) return;
      const path = m[1];
      if (PATH_DENYLIST.some((re) => re.test(path))) return;

      const key = normalizeKey(path);
      const existing = found.get(key);
      const isAtAGlance = /\/ataglance\.htm$/i.test(path);
      // Prefer the bare page over the /ataglance.htm variant when both exist —
      // confirmed (via the acai page) to carry the same section structure.
      if (!existing || (!isAtAGlance && /\/ataglance\.htm$/i.test(existing.path))) {
        found.set(key, { path, url: `${u.protocol}//${u.hostname}/health/${path}` });
      }
    });

    if (found.size >= 15) {
      console.log(`Discovered ${found.size} NCCIH pages from the index.`);
      return [...found.values()];
    }
    console.warn(`Index yielded only ${found.size} NCCIH links; using fallback list.`);
  } catch (err) {
    console.warn(`Could not read the index (${String(err).slice(0, 80)}); using fallback list.`);
  }
  return FALLBACK_PATHS.map((path) => ({ path, url: `https://www.nccih.nih.gov/health/${path}` }));
}

/** Build a DB-safe unique slug from a discovered path, e.g.
 *  "supplements/coq10" -> "Supplements-Coq10-NCCIH". Display name comes from
 *  the page's own <h1>, not this — this only needs to be unique and stable. */
function pathSlug(path: string): string {
  const clean = path.replace(/\/ataglance\.htm$/i, '');
  const parts = clean.split('/').filter(Boolean);
  const cased = parts.map((p) => p.replace(/(^|-)([a-z])/g, (_m, sep, c) => sep + c.toUpperCase()));
  return `${cased.join('-')}-NCCIH`;
}

async function main() {
  const args = parseArgs();
  console.log(`ingest-nccih: dryRun=${args.dryRun}`);

  const all = args.only ? [{ path: args.only, url: `https://www.nccih.nih.gov/health/${args.only}` }] : await discoverPaths();
  const targets = all.slice(0, args.limit);
  console.log(`  processing ${targets.length} page(s): ${targets.slice(0, 8).map((t) => t.path).join(', ')}${targets.length > 8 ? ', ...' : ''}\n`);

  const supabase = args.dryRun
    ? null
    : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });

  let ok = 0, skipped = 0, failed = 0, notFound = 0, totalChunks = 0;

  for (const { path, url } of targets) {
    const slug = pathSlug(path);

    try {
      const html = await fetchText(url);
      const parsed = parseNccihSheet(html);
      const chunks = chunkNccihSections(parsed.sections);
      const hash = createHash('sha256').update(parsed.sections.map((s) => s.text).join('')).digest('hex');

      if (parsed.sections.length === 0) {
        console.warn(`  ! ${slug}: parsed 0 sections — selector problem, or this is an index/non-article page`);
        failed++;
        continue;
      }

      console.log(`  ${slug}: "${parsed.title}" — ${parsed.sections.length} sections, ${chunks.length} chunks`);

      if (args.dryRun) {
        for (const s of parsed.sections.slice(0, 4)) {
          console.log(`    § ${s.section}${s.subsection ? ' — ' + s.subsection : ''}: ${s.text.slice(0, 110)}...`);
        }
        ok++;
        totalChunks += chunks.length;
        continue;
      }

      const { data: existing } = await supabase!
        .from('fact_sheets').select('id, content_hash').eq('slug', slug).maybeSingle();

      if (existing?.content_hash === hash) {
        console.log('    unchanged — skipped');
        skipped++;
        continue;
      }

      const { data: sheet, error: sheetErr } = await supabase!
        .from('fact_sheets')
        .upsert(
          {
            slug,
            supplement: parsed.title || path,
            audience: 'consumer',
            language: 'en',
            title: parsed.title,
            source_url: url,
            content_hash: null, // written only after chunks land — see scripts/ingest.ts
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'slug' },
        )
        .select('id')
        .single();
      if (sheetErr) throw sheetErr;

      await supabase!.from('chunks').delete().eq('fact_sheet_id', sheet.id);

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

      await supabase!.from('fact_sheets').update({ content_hash: hash }).eq('id', sheet.id);

      ok++;
      totalChunks += chunks.length;
    } catch (err) {
      if ((err as { notFound?: boolean }).notFound) {
        console.log(`  - ${slug}: no such page (404)`);
        notFound++;
      } else {
        console.error(`  ! ${slug}: ${String(err).slice(0, 160)}`);
        failed++;
      }
    }

    await new Promise((r) => setTimeout(r, 400)); // be polite to nccih.nih.gov
  }

  console.log(
    `\ndone — ${ok} ingested, ${skipped} unchanged, ${notFound} not found (404), ${failed} failed, ${totalChunks} chunks`,
  );
  if (failed > 0) console.log('   re-run to retry the failures; completed pages are skipped.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
