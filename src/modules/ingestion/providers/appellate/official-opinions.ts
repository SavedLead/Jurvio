import { createHash } from "node:crypto";
import { conditionalRequestHeaders, type HttpValidators } from "../http-validators";
import type { AppellateCourtSource } from "./registry";
import { CourtFetchHttpError } from "@/modules/operations/application/court-fetch-log";

export interface OfficialAppellateCandidate {
  courtCode:string; docketNumber:string|null; caption:string; decidedOn:string|null;
  documentUrl:string; sourceListingUrl:string; documentHashHint:string;
}

const MAX_LISTING_BYTES=8*1024*1024;
const unescape=(v:string)=>v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
const strip=(v:string)=>unescape(v.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());
function absolute(base:string, href:string){ return new URL(href,base).toString(); }
function docket(text:string){
  const standard=/\b(?:No\.?\s*)?((?:\d{1,2}-)?\d{2}-\d{3,7})\b/i.exec(text)?.[1];
  if(standard)return standard;
  const compact=/\b(\d{2})(\d{4})\.[PU]\b/i.exec(text);
  return compact ? `${compact[1]}-${compact[2]}` : null;
}
function date(text:string){
  const m=/\b(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)\b/.exec(text)
    ||/\b([01]?\d)[-\/]([0-3]?\d)[-\/](20\d{2})\b/.exec(text);
  if(m){ const y=m[1]?.length===4?m[1]:m[3], mo=m[1]?.length===4?m[2]:m[1], d=m[1]?.length===4?m[3]:m[2]; return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
  const named=/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(20\d{2})\b/i.exec(text);
  if(!named)return null;
  const months=["january","february","march","april","may","june","july","august","september","october","november","december"];
  return `${named[3]}-${String(months.indexOf((named[1]??"").toLowerCase())+1).padStart(2,"0")}-${String(named[2]).padStart(2,"0")}`;
}

export function parseOfficialAppellateListing(html:string,court:AppellateCourtSource):OfficialAppellateCandidate[]{
  const links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const seen=new Set<string>(); const out:OfficialAppellateCandidate[]=[];
  for(const link of links){
    const documentUrl=absolute(court.opinionsUrl,unescape(link[1]??"")); if(seen.has(documentUrl))continue; seen.add(documentUrl);
    const start=Math.max(0,(link.index??0)-500), end=Math.min(html.length,(link.index??0)+(link[0]?.length??0)+500);
    const context=strip(html.slice(start,end)), label=strip(link[2]??"");
    const fourth=/\b\d{6}\.[PU]\s+(.+?)\s+(?:Published|Unpublished) opinion\b/i.exec(context)?.[1]?.trim();
    const caption=(fourth ?? (label.length>=3?label:context))
      .replace(/^\s*(?:No\.?\s*)?\d{2}-\d{3,7}\s*[-:–—]?\s*/i,"")
      .replace(/^https?:\/\/\S+$/i,"Official appellate disposition")
      .slice(0,500).trim()||"Official appellate disposition";
    out.push({courtCode:court.code,docketNumber:docket(context),caption,decidedOn:date(context),documentUrl,sourceListingUrl:court.opinionsUrl,documentHashHint:createHash("sha256").update(documentUrl).digest("hex")});
  }
  return out;
}

export async function fetchOfficialAppellateListing(court: AppellateCourtSource, validators?: HttpValidators | null) {
  const response = await fetch(court.opinionsUrl, {
    headers: {
      "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1 appellate-ingestion",
      ...conditionalRequestHeaders(validators),
    },
    redirect: "follow",
  });
  const retrievedAt = new Date().toISOString();
  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");
  if (response.status === 304) {
    return { notModified: true as const, body: "", retrievedAt, etag, lastModified, candidates: [] };
  }
  if (!response.ok) throw new CourtFetchHttpError(court.opinionsUrl, response.status, `${court.code} opinions listing`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_LISTING_BYTES) throw new Error("appellate listing exceeds byte cap");
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_LISTING_BYTES) throw new Error("appellate listing exceeds byte cap");
  return {
    notModified: false as const,
    body,
    retrievedAt,
    etag,
    lastModified,
    candidates: parseOfficialAppellateListing(body, court),
  };
}
