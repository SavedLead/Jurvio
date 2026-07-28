import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { getPublicCase } from "@/modules/cases/application/get-public-case";
import { listPublicCaseOpinions, listPublicDocketEntries, listPublicDocuments, listPublicParties } from "@/modules/cases/application/list-public-case-sections";
import { CaseWorkspace } from "@/modules/cases/ui/case-workspace";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";
type Props={params:Promise<{caseId:string}>};
async function load(params:Props["params"]){const {caseId}=await params;if(!/^jv-[a-z0-9]{8,10}$/.test(caseId))return null;return getPublicCase(db(),caseId);}
export async function generateMetadata({params}:Props):Promise<Metadata>{const record=await load(params);if(!record)return{title:"Case not found"};return{title:`${record.caption} — Case record`,description:`Docket, current status, parties, filings, timeline, and published opinions for ${record.caption}.`,alternates:{canonical:`/case/${record.publicId}`}};}

export default async function CasePage({params}:Props){const legalCase=await load(params);if(!legalCase)notFound();
  const [docket,documents,parties,opinions]=await Promise.all([listPublicDocketEntries(db(),legalCase.publicId,5),listPublicDocuments(db(),legalCase.publicId),listPublicParties(db(),legalCase.publicId),listPublicCaseOpinions(db(),legalCase.publicId)]);
  const requestHeaders=await headers();await recordDemandEvent(db(),{eventType:"page_view",userAgent:requestHeaders.get("user-agent"),referrer:requestHeaders.get("referer"),path:`/case/${legalCase.publicId}`,contentKind:"case",targetType:"case",targetPublicId:legalCase.publicId});
  const links=[{label:"Docket entries",value:docket.length,href:"docket"},{label:"Published filings",value:documents.length,href:"documents"},{label:"Public parties",value:parties.length,href:"parties"},{label:"Opinions",value:opinions.length,href:"opinions"}];
  return <CaseWorkspace legalCase={legalCase} active=""><section><h2>Case summary</h2><p className="sectionIntro">This page organizes the published court record. Status language is produced from qualifying docket events; allegations and party positions are not treated as established facts.</p><ul className="cards">{links.map(item=><li key={item.href}><strong>{item.value.toLocaleString()}</strong><small>{item.label}</small><Link href={`/case/${legalCase.publicId}/${item.href}` as Route}>View {item.label.toLowerCase()} →</Link></li>)}</ul></section>
    <section><h2>Recent docket activity</h2>{docket.length?<ol>{docket.map(entry=><li key={entry.publicId}><span className="meta">{entry.filedOn??"Date unavailable"}{entry.entryNumber?` · Entry ${entry.entryNumber}`:""}</span><p>{entry.description}</p></li>)}</ol>:<p>No docket entries are approved for publication.</p>}<Link href={`/case/${legalCase.publicId}/docket` as Route}>View the full docket →</Link></section>
  </CaseWorkspace>;
}
