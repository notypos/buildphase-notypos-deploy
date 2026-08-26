// Parsing an NCCIH health-topic page ("Herbs at a Glance" and related consumer
// pages) into sections, mirroring scripts/ods/parse.ts closely enough that the
// existing chunking logic can be reused as-is.
//
// NCCIH pages have no RDA/Upper-Limit tables (that's an ODS-only concept), so
// this module only produces sections/title, not limits.
import * as cheerio from 'cheerio';
import { chunkSections, type ParsedSection, type Chunk } from '../ods/parse';

export interface ParsedNccihSheet {
  title: string;
  sections: ParsedSection[];
}

/** Headings that carry no retrievable content on NCCIH's template. */
const SKIP_SECTIONS = [
  /^for more information/i,
  /^references/i,
  /^key references/i,
  /^table of contents/i,
  /^acknowledgments/i,
];

function clean(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * NCCIH's site (like ODS's) has shifted templates over the years and may not
 * share ODS's exact container classes, so try a broad set of candidates —
 * generic HTML5 landmarks first, then common .gov/Drupal patterns — and take
 * whichever has substantial text. This is the same "highest text density wins"
 * heuristic scripts/ods/parse.ts uses, which is what lets this module work
 * without knowing NCCIH's markup in advance.
 */
function contentRoot($: cheerio.CheerioAPI) {
  const candidates = [
    'main',
    '#main-content',
    '.main-content',
    'article',
    '#content',
    '.content',
    '.node__content',
    '.field--name-body',
    '.usa-prose',
    '.region-content',
    '.l-content',
  ];
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 500) return el;
  }
  return $('body');
}

export function parseNccihSheet(html: string): ParsedNccihSheet {
  const $ = cheerio.load(html);
  const root = contentRoot($);

  // Strip chrome that would otherwise leak into section text. Sidebar/related
  // selectors are extra insurance beyond ODS's list, since NCCIH pages often
  // carry a "related resources" rail this heuristic might otherwise sweep in.
  root
    .find(
      'script, style, nav, footer, table, .skip-link, .breadcrumb, .toc, #toc, aside, .sidebar, .related, .pane-related-pages',
    )
    .remove();

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

  return { title, sections };
}

export function chunkNccihSections(sections: ParsedSection[]): Chunk[] {
  return chunkSections(sections);
}
