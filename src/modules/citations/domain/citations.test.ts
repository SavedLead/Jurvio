import { describe, expect, it } from "vitest";
import { citationKey, extractCaseCitations, extractCourtListenerLinks, identityCitations } from "./citations";
import { linkCaseCitations } from "./link-citations";
describe("case citation identities",()=>{
  it("normalizes spacing while preserving first page and reporter series",()=>{
    expect(citationKey('347 U. S. 483')).toBe(citationKey('347 U.S. 483'));
    expect(extractCaseCitations('Brown v. Board, 347 U. S. 483, 495 (1954); 123 F.3d 456; 22 F. Supp. 2d 99').map(c=>c.key)).toEqual(['347us483','123f3d456','22fsupp2d99']);
    expect(citationKey('123 F.2d 456')).not.toBe(citationKey('123 F.3d 456'));
  });
  it("never treats statutes, dates, slip placeholders or short forms as identities",()=>{
    expect(extractCaseCitations('42 U.S.C. 1983; 347 U.S., at 495; Id. at 99; 600 U.S. ___; 2026 09 30')).toEqual([]);
  });
  it("reads both official and structured CourtListener metadata",()=>{
    expect(identityCitations(['347 U.S. 483',{volume:347,reporter:'U.S.',page:'483',type:2},'This mentions 42 U.S.C. 1983'])).toEqual(['347 U.S. 483']);
  });
  it("retains source spans and multiple occurrences",()=>{
    const text='See 347 U.S. 483 and 347 U. S. 483.';
    for(const cite of extractCaseCitations(text))expect(text.slice(cite.start,cite.end)).toBe(cite.label);
    expect(extractCaseCitations(text)).toHaveLength(2);
  });
  it("recognizes state reporters, local aliases and long electronic citation pages",()=>{
    const text='100 N.Y.2d 1; 12 Cal. App. 4th 321; 7 Mass. 123; 2008 U.S. Dist. LEXIS 12345678; 2020 WL 1234567';
    expect(extractCaseCitations(text).map(c=>c.key)).toEqual(['100ny2d1','12calapp4th321','7mass123','2008usdistlexis12345678','2020wl1234567']);
    expect(citationKey('347 U. S. Rep. 483')).toBe('347us483');
  });
  it("recognizes nominative Supreme Court citations without overlapping inner matches",()=>{
    const text='Marbury, 5 U.S. (1 Cranch) 137; 17 U. S. (4 Wheat.) 316.';
    const cites=extractCaseCitations(text);
    expect(cites.map(c=>c.key)).toEqual(['5us137','17us316']);
    for(const cite of cites)expect(text.slice(cite.start,cite.end)).toBe(cite.label);
    expect(identityCitations('5 U.S. (1 Cranch) 137')).toEqual(['5 U.S. (1 Cranch) 137']);
  });
  it("does not guess an ambiguous historical reporter even with a supplied destination",()=>{
    expect(extractCaseCitations('1 P.R. 1')[0]?.ambiguous).toBe(true);
    expect(identityCitations('1 P.R. 1')).toEqual([]);
    expect(linkCaseCitations('<p>1 P.R. 1</p>',[{citationKey:'1pr1',casePublicId:'jv-abcd1234'}])).toBe('<p>1 P.R. 1</p>');
  });
  it("does not let earlier unrelated numbers swallow later citations",()=>{
    expect(extractCaseCitations('2024 discussion of 100 N.Y.2d 1 and 347 U.S. 483').map(c=>c.key)).toEqual(['100ny2d1','347us483']);
  });
  it("handles a long opinion with bounded reporter scanning",()=>{
    const text='The court considered 347 U.S. 483 and 12 Cal. App. 4th 321. '.repeat(2000);
    expect(extractCaseCitations(text)).toHaveLength(4000);
  });
});
describe("crawlable court text links",()=>{
  const targets=[{citationKey:'347us483',casePublicId:'jv-abcd1234'}];
  it("renders real internal anchors without changing court text",()=>{
    expect(linkCaseCitations('<p>See 347 U. S. 483, 495.</p>',targets)).toBe('<p>See <a href="/case/jv-abcd1234" class="jurvioCaseCitation">347 U. S. 483</a>, 495.</p>');
  });
  it("rewrites known CourtListener source links to the canonical case",()=>{
    const html='<p><a href="https://www.courtlistener.com/opinion/123/brown/" rel="nofollow noopener"><i>Brown v. Board</i></a></p>';
    expect(extractCourtListenerLinks(html)[0]?.key).toBe('cl-cluster:123');
    expect(linkCaseCitations(html,[{citationKey:'cl-cluster:123',casePublicId:'jv-abcd1234'}])).toBe('<p><a href="/case/jv-abcd1234" class="jurvioCaseCitation"><i>Brown v. Board</i></a></p>');
  });
  it("avoids attributes, nested links, code and unresolved matches",()=>{
    const html='<p title="347 U.S. 483"><a href="/other"><i>347 U.S. 483</i></a><code>347 U.S. 483</code> 123 F.3d 456</p>';
    expect(linkCaseCitations(html,targets)).toBe(html);
    expect(linkCaseCitations('<p>347 U.S. 483</p>',[{citationKey:'347us483',casePublicId:'../../bad'}])).toBe('<p>347 U.S. 483</p>');
  });
});
