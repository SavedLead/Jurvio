import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import type {
  CourtListenerOpinion,
  CourtListenerOpinionCluster,
} from "../providers/courtlistener/schema";

export interface NormalizedOpinionCluster {
  sourceClusterId: string;
  sourceDocketId: number;
  caseName: string;
  dateFiled?: string;
  sourceUpdatedAt?: string;
  precedentialStatus?: string;
  citationCount: number;
  citations: unknown[];
  judges?: string;
  syllabus?: string;
  proceduralHistory?: string;
  sourceUri: string;
  opinionIds: number[];
}

export interface NormalizedOpinion {
  sourceOpinionId: string;
  sourceClusterId: string;
  opinionType: string;
  title: string;
  authorName?: string;
  perCuriam: boolean;
  sourceUri: string;
  sourceDownloadUrl?: string;
  contentHtml: string;
  contentText: string;
  contentHash: string;
  extractionMethod: string;
  wordCount: number;
}

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function dateOnly(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString().slice(0, 10);
}

function timestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function resourceId(reference: string | number, field: string): number {
  if (typeof reference === "number") return reference;
  const raw = reference.split("?")[0]?.split("/").filter(Boolean).at(-1);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`CourtListener ${field} reference is invalid`);
  }
  return parsed;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function externalHref(value: string): string | undefined {
  try {
    const url = new URL(value, "https://www.courtlistener.com");
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function sanitizedContent(source: CourtListenerOpinion) {
  const candidates = [
    ["courtlistener_html_with_citations", present(source.html_with_citations)],
    ["courtlistener_html", present(source.html)],
    ["courtlistener_html_lawbox", present(source.html_lawbox)],
    ["courtlistener_html_columbia", present(source.html_columbia)],
    ["courtlistener_html_anon_2020", present(source.html_anon_2020)],
    ["courtlistener_xml_harvard", present(source.xml_harvard)],
  ] as const;
  const selected = candidates.find((candidate) => candidate[1]);
  const plainText = present(source.plain_text);

  if (!selected && !plainText) {
    throw new Error(`CourtListener opinion ${source.id} has no readable text`);
  }

  const extractionMethod = selected?.[0] ?? "courtlistener_plain_text";
  const input = selected?.[1] ?? `<p>${escapeHtml(plainText ?? "")}</p>`;
  const contentHtml = sanitizeHtml(input, {
    allowedTags: [
      "a", "b", "blockquote", "br", "cite", "dd", "div", "dl", "dt", "em", "h1",
      "h2", "h3", "h4", "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "s",
      "span", "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "u",
      "ul",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    transformTags: {
      a: (_tagName, attributes) => {
        const href = attributes.href ? externalHref(attributes.href) : undefined;
        const attribs: Record<string, string> = href
          ? { href, rel: "nofollow noopener" }
          : {};
        return {
          tagName: href ? "a" : "span",
          attribs,
        };
      },
    },
    allowedSchemes: ["http", "https"],
  }).trim();
  const contentText = sanitizeHtml(contentHtml, {
    allowedTags: [],
    allowedAttributes: {},
  }).replace(/\s+/g, " ").trim();

  if (!contentText) throw new Error(`CourtListener opinion ${source.id} normalized to empty text`);

  return {
    contentHtml,
    contentText,
    contentHash: createHash("sha256").update(contentHtml).digest("hex"),
    extractionMethod,
    wordCount: contentText.split(/\s+/).length,
  };
}

export function normalizeOpinionCluster(
  source: CourtListenerOpinionCluster,
): NormalizedOpinionCluster {
  const caseName = present(source.case_name_full) ??
    present(source.case_name) ?? present(source.case_name_short);
  if (!caseName) throw new Error("CourtListener opinion cluster has no case name");

  return {
    sourceClusterId: String(source.id),
    sourceDocketId: source.docket_id ?? resourceId(source.docket, "docket"),
    caseName,
    dateFiled: dateOnly(source.date_filed),
    sourceUpdatedAt: timestamp(source.date_modified),
    precedentialStatus: present(source.precedential_status),
    citationCount: source.citation_count,
    citations: source.citations,
    judges: present(source.judges),
    syllabus: present(source.syllabus),
    proceduralHistory: present(source.procedural_history),
    sourceUri: source.absolute_url,
    opinionIds: source.sub_opinions.map((reference) => resourceId(reference, "opinion")),
  };
}

export function normalizeOpinion(
  source: CourtListenerOpinion,
  cluster: NormalizedOpinionCluster,
): NormalizedOpinion {
  const sourceClusterId = String(source.cluster_id ?? resourceId(source.cluster, "cluster"));
  if (sourceClusterId !== cluster.sourceClusterId) {
    throw new Error(`Opinion ${source.id} does not belong to cluster ${cluster.sourceClusterId}`);
  }
  const content = sanitizedContent(source);
  const opinionType = present(source.type) ?? "unknown";
  const readableType = opinionType.replace(/^\d{3}-/, "").replaceAll("-", " ");

  return {
    sourceOpinionId: String(source.id),
    sourceClusterId,
    opinionType,
    title: `${cluster.caseName} — ${readableType}`,
    authorName: present(source.author_str),
    perCuriam: source.per_curiam,
    sourceUri: source.resource_uri,
    sourceDownloadUrl: present(source.download_url)
      ? externalHref(source.download_url ?? "")
      : undefined,
    ...content,
  };
}
