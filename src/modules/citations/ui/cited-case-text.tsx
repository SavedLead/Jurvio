import Link from 'next/link';
import { extractCaseCitations } from '../domain/citations';
import type { CitationLink } from '../domain/link-citations';
export function CitedCaseText({text,targets}:{text:string;targets:readonly CitationLink[]}) {
  const links=new Map(targets.map(target=>[target.citationKey,target.casePublicId]));
  const parts: React.ReactNode[]=[];
  let cursor=0;
  for(const cite of extractCaseCitations(text)){
    const id=links.get(cite.key);
    if(!id)continue;
    parts.push(text.slice(cursor,cite.start),<Link key={cite.start} href={`/case/${id}`}>{cite.label}</Link>);
    cursor=cite.end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
