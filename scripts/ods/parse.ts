// Parsing an ODS fact sheet page into sections, chunks, and nutrient limits.
// Kept separate from the network/DB code so it can be unit-tested on saved HTML.
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

export interface ParsedSection {
  section: string;
  subsection: string | null;
  text: string;
}

export interface ParsedLimit {
  lifeStage: string;
  sex: string | null;
  rdaAmount: number | null;
  rdaUnit: string | null;
  ulAmount: number | null;
  ulUnit: string | null;
}

export interface ParsedSheet {
  title: string;
  sections: ParsedSection[];
  limits: ParsedLimit[];
}

/** Headings that carry no retrievable content. */
const SKIP_SECTIONS = [
  /^disclaimer/i,
  /^where can i find out more/i,
  /^references/i,
  /^table of contents/i,
];

function clean(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * ODS templates have shifted over the years, so try a few container selectors
 * before falling back to <body>. Whichever matches first and has real text wins.
 */
function contentRoot($: cheerio.CheerioAPI) {
  const candidates = ['main', '#main-content', '.mainContent', 'article', '#content', '.content'];
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 500) return el;
  }
  return $('body');
}

/** Amount + unit out of a cell like "600 IU (15 mcg)" or "1,000 mg". */
function parseAmount(raw: string): { amount: number | null; unit: string | null } {
  const t = clean(raw);
  if (!t || /^(n\/?a|not established|nd|—|-)$/i.test(t)) return { amount: null, unit: null };
  const m = t.match(/([\d,]+(?:\.\d+)?)\s*(mcg DFE|mcg RAE|mg NE|mcg|mg|g|IU|µg)?/i);
  if (!m) return { amount: null, unit: null };
  return {
    amount: Number(m[1].replace(/,/g, '')),
    unit: m[2] ? m[2].replace(/^µg$/i, 'mcg') : null,
  };
}

/**
 * Pull RDA and Upper Limit tables. These drive the My Stack overdose check, so
 * they're stored as numbers rather than left for the model to recall.
 */
function parseLimitTables($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>): ParsedLimit[] {
  const byStage = new Map<string, ParsedLimit>();

  root.find('table').each((_, table) => {
    const $t = $(table);
    const caption = clean($t.find('caption').text() + ' ' + ($t.prev('h2,h3,p').text() ?? ''));
    const headerCells = $t.find('tr').first().find('th,td').map((_i, c) => clean($(c).text())).get();
    const headerText = (caption + ' ' + headerCells.join(' ')).toLowerCase();

    const isUL = /upper limit|tolerable upper|\bul\b/.test(headerText);
    const isRDA = /recommended|\brda\b|\bai\b|adequate intake|amounts/.test(headerText);
    if (!isUL && !isRDA) return;

    // Column holding the value: first numeric-looking column after the label.
    $t.find('tr').slice(1).each((_i, tr) => {
      const cells = $(tr).find('th,td').map((_j, c) => clean($(c).text())).get();
      if (cells.length < 2) return;

      const lifeStage = cells[0];
      if (!lifeStage || /^life stage|^age/i.test(lifeStage)) return;

      // Sex-split tables repeat the stage with Male/Female columns; capture the
      // first value column and note sex from the header when present.
      const valueCell = cells.slice(1).find((c) => /\d/.test(c)) ?? '';
      const { amount, unit } = parseAmount(valueCell);
      if (amount === null) return;

      let sex: string | null = null;
      const hIdx = cells.slice(1).findIndex((c) => /\d/.test(c));
      const header = headerCells[hIdx + 1]?.toLowerCase() ?? '';
      if (/male/.test(header) && !/female/.test(header)) sex = 'male';
      else if (/female/.test(header)) sex = 'female';

      const key = `${lifeStage}::${sex ?? ''}`;
      const existing = byStage.get(key) ?? {
        lifeStage, sex, rdaAmount: null, rdaUnit: null, ulAmount: null, ulUnit: null,
      };
      if (isUL) { existing.ulAmount = amount; existing.ulUnit = unit; }
      else { existing.rdaAmount = amount; existing.rdaUnit = unit; }
      byStage.set(key, existing);
    });
  });

  return [...byStage.values()];
}

export function parseSheet(html: string): ParsedSheet {
  const $ = cheerio.load(html);
  const root = contentRoot($);

  // Strip chrome that would otherwise leak into section text.
  root.find('script, style, nav, footer, .skip-link, .breadcrumb, .toc, #toc, table').remove();

  const title = clean($('h1').first().text() || $('title').text());

  const sections: ParsedSection[] = [];
  let currentH2 = '';
  let currentH3: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = clean(buffer.join(' '));
    buffer = [];
    if (!currentH2 || text.length < 80) return;
    if (SKIP_SECTIONS.some((re) => re.test(currentH2))) return;
    sections.push({ section: currentH2, subsection: currentH3, text });
  };

  root.find('h2, h3, p, li').each((_, el) => {
    const $el = $(el);
    const tag = (el as unknown as { tagName: string }).tagName?.toLowerCase();
    const text = clean($el.text());
    if (!text) return;

    if (tag === 'h2') {
      flush();
      currentH2 = text;
      currentH3 = null;
    } else if (tag === 'h3') {
      flush();
      currentH3 = text;
    } else {
      buffer.push(text);
    }
  });
  flush();

  // Tables were removed from `root` above, so re-parse from a fresh load.
  const $tables = cheerio.load(html);
  const limits = parseLimitTables($tables, contentRoot($tables));

  return { title, sections, limits };
}

export interface Chunk {
  section: string;
  subsection: string | null;
  ordinal: number;
  content: string;
  tokenEstimate: number;
}

/**
 * Chunk within section boundaries so every citation can name its heading.
 * Sections shorter than the target stay whole; longer ones split on sentence
 * boundaries with overlap to avoid cutting a dosage statement in half.
 */
export function chunkSections(
  sections: ParsedSection[],
  { targetChars = 1200, overlapChars = 150 }: { targetChars?: number; overlapChars?: number } = {},
): Chunk[] {
  const chunks: Chunk[] = [];
  let ordinal = 0;

  for (const s of sections) {
    const heading = s.subsection ? `${s.section} — ${s.subsection}` : s.section;
    // Prefix the heading into the embedded text: it is strong retrieval signal
    // and keeps a bare chunk interpretable on its own.
    const prefix = `${heading}\n\n`;

    if (s.text.length <= targetChars) {
      chunks.push({
        section: s.section,
        subsection: s.subsection,
        ordinal: ordinal++,
        content: prefix + s.text,
        tokenEstimate: Math.ceil((prefix.length + s.text.length) / 4),
      });
      continue;
    }

    const sentences = s.text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [s.text];
    let buf = '';
    const push = () => {
      if (!buf.trim()) return;
      chunks.push({
        section: s.section,
        subsection: s.subsection,
        ordinal: ordinal++,
        content: prefix + buf.trim(),
        tokenEstimate: Math.ceil((prefix.length + buf.length) / 4),
      });
    };

    for (const sentence of sentences) {
      if (buf.length + sentence.length > targetChars && buf.length > 0) {
        push();
        buf = buf.slice(-overlapChars) + sentence;
      } else {
        buf += sentence;
      }
    }
    push();
  }

  return chunks;
}
