import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { extractCaseCitations } from '../domain/citations';
import type { CitationLink } from '../domain/link-citations';
/**
 * Text with case citations linked. `renderText` (optional) renders the plain
 * stretches between citations, e.g. to mark dictionary terms; citations
 * themselves are never passed to it.
 */
export function CitedCaseText({text,targets,renderText}:{text:string;targets:readonly CitationLink[];renderText?:(text:string)=>ReactNode}) {
  const links=new Map(targets.map(target=>[target.citationKey,target.casePublicId]));
  const parts: ReactNode[]=[];
  const plain=(value:string)=>value&&renderText?renderText(value):value;
  let cursor=0;
  for(const cite of extractCaseCitations(text)){
    const id=links.get(cite.key);
    if(!id)continue;
    parts.push(<Fragment key={`t${cursor}`}>{plain(text.slice(cursor,cite.start))}</Fragment>,<Link key={cite.start} href={`/case/${id}`}>{cite.label}</Link>);
    cursor=cite.end;
  }
  if(cursor===0)return <>{plain(text)}</>;
  parts.push(<Fragment key={`t${cursor}`}>{plain(text.slice(cursor))}</Fragment>);
  return <>{parts}</>;
}
