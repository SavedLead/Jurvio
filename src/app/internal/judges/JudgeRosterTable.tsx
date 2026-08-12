"use client";

import { useMemo, useState, type CSSProperties } from "react";

export type JudgeRow = {
  publicId: string;
  displayName: string;
  courtName: string | null;
  category: "scotus" | "appeals" | "district" | "other" | null;
  status: "active" | "senior" | "former";
  appointedYear: number | null;
  president: string | null;
  presidentParty: string | null;
  serviceTerms: number;
  assignments: number;
  observations: number;
  published: boolean;
};

const CATEGORY_LABEL: Record<string, string> = {
  all: "All branches",
  scotus: "Supreme Court",
  appeals: "Courts of Appeals",
  district: "District Courts",
  other: "Other",
};

const STATUS_LABEL: Record<JudgeRow["status"], string> = {
  active: "Active",
  senior: "Senior",
  former: "Former",
};

type SortKey =
  | "displayName" | "courtName" | "category" | "status"
  | "appointedYear" | "president" | "assignments" | "observations";

const RENDER_CAP = 500;

export default function JudgeRosterTable({ judges }: { judges: JudgeRow[] }) {
  const [category, setCategory] = useState<string>("all");
  const [court, setCourt] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [president, setPresident] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("displayName");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  // Category tab counts (independent of the other filters).
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: judges.length, scotus: 0, appeals: 0, district: 0, other: 0 };
    for (const j of judges) counts[j.category ?? "other"] = (counts[j.category ?? "other"] ?? 0) + 1;
    return counts;
  }, [judges]);

  // Courts + presidents available within the selected branch, for the dropdowns.
  const courtsInCategory = useMemo(() => {
    const set = new Set<string>();
    for (const j of judges) {
      if (category !== "all" && (j.category ?? "other") !== category) continue;
      if (j.courtName) set.add(j.courtName);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [judges, category]);

  const presidents = useMemo(() => {
    const set = new Set<string>();
    for (const j of judges) if (j.president) set.add(j.president);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [judges]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = judges.filter((j) => {
      if (category !== "all" && (j.category ?? "other") !== category) return false;
      if (court !== "all" && j.courtName !== court) return false;
      if (status !== "all" && j.status !== status) return false;
      if (president !== "all" && j.president !== president) return false;
      if (q && !j.displayName.toLowerCase().includes(q) && !(j.courtName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
    rows.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
    return rows;
  }, [judges, category, court, status, president, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  };
  const arrow = (key: SortKey) => (key === sortKey ? (sortDir === 1 ? " ▲" : " ▼") : "");

  const th: CSSProperties = { textAlign: "left", padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap", borderBottom: "1px solid var(--jc-border,#e2e8f0)", fontSize: 12, letterSpacing: ".02em", color: "#475569", userSelect: "none" };
  const td: CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--jc-border,#eef2f7)", fontSize: 14, verticalAlign: "top" };
  const ctrl: CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", fontSize: 14, color: "#0f172a" };
  const tab = (active: boolean): CSSProperties => ({
    padding: "8px 14px", borderRadius: 999, border: "1px solid " + (active ? "#4f46e5" : "#cbd5e1"),
    background: active ? "#4f46e5" : "#fff", color: active ? "#fff" : "#334155",
    fontWeight: 600, fontSize: 13, cursor: "pointer",
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {(["all", "scotus", "appeals", "district"] as const).map((c) => (
          <button key={c} type="button" style={tab(category === c)}
            onClick={() => { setCategory(c); setCourt("all"); }}>
            {CATEGORY_LABEL[c]} <span style={{ opacity: 0.75 }}>({categoryCounts[c]?.toLocaleString() ?? 0})</span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <input style={{ ...ctrl, minWidth: 220, flex: "1 1 220px" }} placeholder="Search judge or court…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={ctrl} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="senior">Senior</option>
          <option value="former">Former</option>
        </select>
        <select style={{ ...ctrl, maxWidth: 320 }} value={court} onChange={(e) => setCourt(e.target.value)}>
          <option value="all">{category === "all" ? "Any court" : `Any ${CATEGORY_LABEL[category].toLowerCase()}`}</option>
          {courtsInCategory.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={{ ...ctrl, maxWidth: 260 }} value={president} onChange={(e) => setPresident(e.target.value)}>
          <option value="all">Any appointing president</option>
          {presidents.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ fontSize: 13, color: "#64748b", marginLeft: "auto" }}>
          {filtered.length.toLocaleString()} judge{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={th} onClick={() => toggleSort("displayName")}>Judge{arrow("displayName")}</th>
              <th style={th} onClick={() => toggleSort("courtName")}>Court{arrow("courtName")}</th>
              <th style={th} onClick={() => toggleSort("category")}>Branch{arrow("category")}</th>
              <th style={th} onClick={() => toggleSort("status")}>Status{arrow("status")}</th>
              <th style={th} onClick={() => toggleSort("appointedYear")}>Appointed{arrow("appointedYear")}</th>
              <th style={th} onClick={() => toggleSort("president")}>Nominating president{arrow("president")}</th>
              <th style={th} onClick={() => toggleSort("assignments")}>Cases{arrow("assignments")}</th>
              <th style={th} onClick={() => toggleSort("observations")}>Analytics{arrow("observations")}</th>
              <th style={th}>Publishing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, RENDER_CAP).map((j) => (
              <tr key={j.publicId}>
                <td style={td}><a href={`/judges/${j.publicId}`} target="_blank" rel="noreferrer"
                  style={{ color: "#4f46e5", textDecoration: "none", fontWeight: 600 }}>{j.displayName}</a></td>
                <td style={td}>{j.courtName ?? <span style={{ color: "#94a3b8" }}>Unmapped</span>}</td>
                <td style={td}>{CATEGORY_LABEL[j.category ?? "other"]}</td>
                <td style={td}>
                  <span style={{ fontWeight: 600, color: j.status === "active" ? "#047857" : j.status === "senior" ? "#b45309" : "#64748b" }}>
                    {STATUS_LABEL[j.status]}
                  </span>
                </td>
                <td style={td}>{j.appointedYear ?? "—"}</td>
                <td style={td}>{j.president ?? "—"}{j.presidentParty ? <span style={{ color: "#94a3b8" }}> · {j.presidentParty}</span> : null}</td>
                <td style={td}>{j.assignments.toLocaleString()}</td>
                <td style={td}>{j.observations.toLocaleString()}</td>
                <td style={{ ...td, color: j.published ? "#047857" : "#b45309", fontWeight: 600 }}>
                  {j.published ? "Published" : "Repair pending"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > RENDER_CAP ? (
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 8 }}>
          Showing the first {RENDER_CAP.toLocaleString()} of {filtered.length.toLocaleString()} — refine the filters above to narrow the list.
        </p>
      ) : null}
    </div>
  );
}
