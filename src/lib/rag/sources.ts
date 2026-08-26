// Which NIH institute a citation actually comes from.
//
// The corpus is no longer single-agency: ODS (Office of Dietary Supplements)
// covers ~40 nutrients/minerals/vitamins; NCCIH (National Center for
// Complementary and Integrative Health) covers herbs and botanicals that ODS
// delegates out to. A citation's source_url is the ground truth for which one
// answered a given question — this derives the label from it rather than
// hardcoding "NIH Office of Dietary Supplements" everywhere, which became
// wrong the moment an NCCIH page could be cited.
export function agencyForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'ods.od.nih.gov') return 'NIH Office of Dietary Supplements';
    if (host === 'nccih.nih.gov') return 'NIH National Center for Complementary and Integrative Health';
    return 'NIH';
  } catch {
    return 'NIH';
  }
}

/** Short form for inline UI tags, e.g. next to a citation link. */
export function agencyShort(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'ods.od.nih.gov') return 'ODS';
    if (host === 'nccih.nih.gov') return 'NCCIH';
    return 'NIH';
  } catch {
    return 'NIH';
  }
}
