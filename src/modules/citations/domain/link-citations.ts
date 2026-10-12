import { extractCaseCitations, extractCourtListenerLinks } from "./citations";
export interface CitationLink { citationKey: string; casePublicId: string }
/** Receives already sanitized court HTML. Preserve court words and existing
 * non-citation links; never process markup, attributes or nested anchors. */
export interface LinkCitationOptions {
  /** Wrap citations Jurvio does not hold yet in a marker span instead of leaving
   * them indistinguishable from prose. Keys listed in `exclude` (e.g. the
   * opinion's own citation) are never marked. */
  markUnresolved?: boolean;
  exclude?: ReadonlySet<string>;
}
export const UNRESOLVED_CITATION_TITLE = "Not yet on Jurvio";
export function linkCaseCitations(html: string, targets: readonly CitationLink[], options: LinkCitationOptions = {}): string {
  const links = new Map(targets.filter(target=>/^jv-[a-z0-9]{8,10}$/.test(target.casePublicId)).map(target=>[target.citationKey, `/case/${target.casePublicId}`]));
  const mark = options.markUnresolved === true;
  const exclude = options.exclude ?? new Set<string>();
  if (!links.size && !mark) return html;
  let skippedDepth=0;
  const skipped=new Set(['a','script','style','code','pre','textarea']);
  const rewritten=html.replace(/<a\b[^>]*href=["']https:\/\/www\.courtlistener\.com\/opinion\/\d+\/[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, anchor=>{
    const cluster=extractCourtListenerLinks(anchor)[0];
    const href=(cluster?links.get(cluster.key):undefined)??extractCaseCitations(anchor.replace(/<[^>]*>/g,'')).filter(cite=>!cite.ambiguous).map(cite=>links.get(cite.key)).find(Boolean);
    if(!href)return anchor;
    const body=anchor.slice(anchor.indexOf('>')+1,anchor.lastIndexOf('</'));
    return `<a href="${href}" class="jurvioCaseCitation">${body}</a>`;
  });
  return rewritten.split(/(<[^>]*>)/g).map(part=>{
    if (part.startsWith('<')) {
      const tag=/^<\s*(\/?)\s*([a-z0-9]+)/i.exec(part);
      if (tag && skipped.has(tag[2]!.toLowerCase()) && !part.endsWith('/>')) skippedDepth += tag[1] ? -1 : 1;
      skippedDepth=Math.max(0,skippedDepth);
      return part;
    }
    if (skippedDepth) return part;
    const citations=extractCaseCitations(part);
    let result='', cursor=0;
    for(const cite of citations){
      if (cite.ambiguous) continue;
      const href=links.get(cite.key);
      if (!href) {
        if (!mark || exclude.has(cite.key)) continue;
        result+=part.slice(cursor,cite.start)+`<span class="jurvioCitationPending" title="${UNRESOLVED_CITATION_TITLE}">${cite.label}</span>`;
        cursor=cite.end;
        continue;
      }
      result+=part.slice(cursor,cite.start)+`<a href="${href}" class="jurvioCaseCitation">${cite.label}</a>`;
      cursor=cite.end;
    }
    return result+part.slice(cursor);
  }).join('');
}
