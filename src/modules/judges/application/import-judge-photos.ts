import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

// Wikidata Query Service. Judge portraits come from Wikimedia Commons (P18),
// matched to our roster two ways:
//   A. EXACT, by the "Biographical Directory of Federal Judges numeric ID"
//      property (P12000), which is precisely our judge.fjc_nid — no name
//      ambiguity. Covers the Article III bench.
//   B. CONSERVATIVE, by exact normalized name for people whose Wikidata
//      occupation is "United States federal judge" (Q1006696), applied only when
//      the name is unambiguous on BOTH sides. Fills Article I + Article III gaps
//      without risking a wrong face on the wrong judge.
// Commons images are freely licensed (federal judges' official portraits are
// overwhelmingly public domain); we store the source entity for attribution.
export const WDQS_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "Jurvio judge photo importer/1.0 (https://jurvio.com; judges@jurvio.com)";

type Binding = Record<string, { value: string } | undefined>;

async function sparql(query: string): Promise<Binding[]> {
  const url = `${WDQS_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`WDQS query failed (${response.status})`);
  const json = await response.json() as { results?: { bindings?: Binding[] } };
  return json.results?.bindings ?? [];
}

// P18 image bindings arrive as a Commons Special:FilePath URL; normalize to https
// and request a bounded thumbnail so the UI never pulls a multi-MB original.
function thumbnail(imageUrl: string): string {
  const https = imageUrl.replace(/^http:\/\//, "https://");
  return https.includes("?") ? `${https}&width=400` : `${https}?width=400`;
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export async function importJudgePhotos(sql: Sql): Promise<{
  fjcMatched: number; fjcUpdated: number; nameCandidates: number; nameUpdated: number;
}> {
  // Lane A — exact by FJC numeric ID (P12000).
  const fjcRows = await sparql(
    "SELECT ?p ?fjc ?img WHERE { ?p wdt:P12000 ?fjc . ?p wdt:P18 ?img . }",
  );
  let fjcUpdated = 0;
  for (const row of fjcRows) {
    const fjc = row.fjc?.value, img = row.img?.value, entity = row.p?.value;
    if (!fjc || !img) continue;
    const updated = await sql`
      UPDATE judge SET photo_url = ${thumbnail(img)}, photo_source_url = ${entity ?? null}, updated_at = now()
      WHERE fjc_nid = ${fjc} AND photo_url IS DISTINCT FROM ${thumbnail(img)}
      RETURNING id
    `;
    fjcUpdated += updated.length;
  }

  // Lane B — conservative exact-name for US federal judges with a portrait.
  const nameRows = await sparql(
    `SELECT ?name ?img WHERE {
       ?p wdt:P106 wd:Q1006696 . ?p wdt:P18 ?img .
       ?p rdfs:label ?name . FILTER(lang(?name) = "en")
     }`,
  );
  // Keep only names that map to exactly one Wikidata portrait (drop collisions).
  const byName = new Map<string, { name: string; img: string; count: number }>();
  for (const row of nameRows) {
    const name = row.name?.value, img = row.img?.value;
    if (!name || !img) continue;
    const key = normalizeName(name);
    if (!key || key.split(" ").length < 2) continue;
    const existing = byName.get(key);
    if (existing) existing.count += 1;
    else byName.set(key, { name, img, count: 1 });
  }
  let nameUpdated = 0, nameCandidates = 0;
  for (const [key, entry] of byName) {
    if (entry.count !== 1) continue; // ambiguous on the Wikidata side — skip
    nameCandidates += 1;
    // Only fill when this normalized name is unique among OUR roster judges and
    // that judge has no photo yet — never overwrite an exact FJC-ID match.
    const updated = await sql`
      UPDATE judge SET photo_url = ${thumbnail(entry.img)}, photo_source_url = ${"wikidata:label-match"}, updated_at = now()
      WHERE normalized_name = ${key} AND photo_url IS NULL
        AND (fjc_nid IS NOT NULL OR brmag_id IS NOT NULL)
        AND (SELECT count(*) FROM judge j2 WHERE j2.normalized_name = ${key}
              AND (j2.fjc_nid IS NOT NULL OR j2.brmag_id IS NOT NULL)) = 1
      RETURNING id
    `;
    nameUpdated += updated.length;
  }

  return { fjcMatched: fjcRows.length, fjcUpdated, nameCandidates, nameUpdated };
}
