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
