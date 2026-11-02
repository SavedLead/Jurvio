#!/usr/bin/env python3
"""Build data/scotus/justices.json: the SCDB justice list joined to FJC records.

Inputs (all committed or downloaded under data/, see data/README.md):
  data/scdb/codebook-majority-opinion-writer.html  SCDB online codebook page listing
      every SCDB justice id, code, name and service span.
  data/fjc/federal-judicial-service.csv, data/fjc/demographics.csv  FJC
      Biographical Directory exports (public domain, U.S. government work).

Deterministic: an SCDB justice is matched to exactly one FJC nid by last name +
first-name prefix; ties (the two John Marshall Harlans) are broken by the FJC
commission date closest to the SCDB service start. Every FJC Supreme Court
appointment row of that nid is attached to the SCDB id whose service start is
closest to the row's commission date (Rutledge 1/2 and Hughes 1/2 are separate
SCDB ids; Rehnquist/Stone/White promotions stay on one SCDB id). The script
fails if any justice or appointment cannot be matched, rather than guessing.
"""
import csv, html, json, re, sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CODEBOOK = ROOT / "data/scdb/codebook-majority-opinion-writer.html"
SERVICE = ROOT / "data/fjc/federal-judicial-service.csv"
DEMO = ROOT / "data/fjc/demographics.csv"
OUT = ROOT / "data/scotus/justices.json"


def fold(value):
    return value.replace("\u2019", "'").strip().lower()


def us_date(value):
    m = re.match(r"(\d+)/(\d+)/(\d+)", value.strip())
    return date(int(m[3]), int(m[1]), int(m[2])) if m else None


def iso(value):
    value = (value or "").strip()
    return value if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else None


def parts_date(y, m, d):
    try:
        return date(int(y), int(m), int(d)).isoformat() if y and m and d else None
    except ValueError:
        return None


def codebook_rows():
    text = CODEBOOK.read_text()
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", text, flags=re.S)
    text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)))
    seg = text[text.find("Values:"):].split("Identification Variables")[0]
    rows = re.findall(r"(\d+) ([A-Z][A-Za-z0-9]+) ([^()]+?) \(([^)]*)\)", seg)
    out = []
    for jid, code, name, span in rows:
        start, _, end = span.replace(" ", "").partition("–")
        out.append({"id": int(jid), "code": code, "name": name.strip(),
                    "start": us_date(start), "end": us_date(end) if end else None})
    ids = [r["id"] for r in out]
    if ids != list(range(1, len(ids) + 1)):
        sys.exit(f"codebook justice ids are not contiguous: {ids}")
    return out


def main():
    justices = codebook_rows()
    service = [r for r in csv.DictReader(SERVICE.open(encoding="utf-8-sig")) if r["Court Type"] == "Supreme Court"]
    demo = {r["nid"]: r for r in csv.DictReader(DEMO.open(encoding="utf-8-sig"))}
    nid_for = {}
    for j in justices:
        last, first = [p.strip() for p in j["name"].split(",", 1)]
        cands = {r["nid"] for r in service
                 if fold(r["Judge Name"].split(",")[0]) == fold(last)
                 and demo.get(r["nid"], {}).get("First Name", "").lower().startswith(first.lower()[:3])}
        if len(cands) > 1:
            def gap(nid):
                return min(abs((date.fromisoformat(r["Commission Date"]) - j["start"]).days)
                           for r in service if r["nid"] == nid and iso(r["Commission Date"]))
            cands = {min(cands, key=gap)}
        if len(cands) != 1:
            sys.exit(f"no unique FJC match for SCDB justice {j['id']} {j['code']}")
        j["nid"] = cands.pop()
    by_nid = {}
    for j in justices:
        by_nid.setdefault(j["nid"], []).append(j)
    appointments = {j["id"]: [] for j in justices}
    for r in service:
        owners = by_nid.get(r["nid"])
        if not owners:
            continue  # FJC row for someone SCDB does not list (should not happen)
        when = iso(r["Commission Date"]) or iso(r["Confirmation Date"]) or iso(r["Nomination Date"])
        owner = min(owners, key=lambda j: abs((date.fromisoformat(when) - j["start"]).days)) if when and len(owners) > 1 else owners[0]
        appointments[owner["id"]].append({
            "fjcSequence": int(r["Sequence"]),
            "appointmentTitle": r["Appointment Title"].strip() or None,
            "appointingPresident": r["Appointing President"].strip() or None,
            "nominationDate": iso(r["Nomination Date"]),
            "confirmationDate": iso(r["Confirmation Date"]),
            "commissionDate": iso(r["Commission Date"]),
            "recessAppointmentDate": iso(r["Recess Appointment Date"]),
            "senateVoteType": r["Senate Vote Type"].strip() or None,
            "senateVote": r["Ayes/Nays"].strip() or None,
            "terminationReason": r["Termination"].strip() or None,
            "terminationDate": iso(r["Termination Date"]),
        })
    missing = [j["code"] for j in justices if not appointments[j["id"]]]
    if missing:
        sys.exit(f"SCDB justices without an FJC appointment row: {missing}")
    used = sum(len(v) for v in appointments.values())
    if used != len(service):
        sys.exit(f"FJC Supreme Court rows attached {used} != {len(service)}")
    out = []
    for j in justices:
        d = demo[j["nid"]]
        full = " ".join(p for p in [d["First Name"], d["Middle Name"], d["Last Name"]] if p.strip())
        if d["Suffix"].strip():
            full += ", " + d["Suffix"].strip()
        out.append({
            "scdbJusticeId": j["id"], "scdbCode": j["code"], "scdbName": j["name"],
            "scdbServiceStart": j["start"].isoformat(), "scdbServiceEnd": j["end"].isoformat() if j["end"] else None,
            "fjcNid": j["nid"], "fullName": full,
            "birthDate": parts_date(d["Birth Year"], d["Birth Month"], d["Birth Day"]),
            "birthYear": int(d["Birth Year"]) if d["Birth Year"].strip().isdigit() else None,
            "birthPlace": ", ".join(p for p in [d["Birth City"].strip(), d["Birth State"].strip()] if p) or None,
            "deathDate": parts_date(d["Death Year"], d["Death Month"], d["Death Day"]),
            "deathYear": int(d["Death Year"]) if d["Death Year"].strip().isdigit() else None,
            "deathPlace": ", ".join(p for p in [d["Death City"].strip(), d["Death State"].strip()] if p) or None,
            "appointments": sorted(appointments[j["id"]], key=lambda a: a["fjcSequence"]),
        })
    OUT.write_text(json.dumps({
        "sources": {
            "scdbCodebook": "https://scdb.la.psu.edu/online-codebook/majority-opinion-writer/",
            "fjcService": "https://www.fjc.gov/sites/default/files/history/federal-judicial-service.csv",
            "fjcDemographics": "https://www.fjc.gov/sites/default/files/history/demographics.csv",
        },
        "justices": out}, indent=1) + "\n")
    print(f"wrote {len(out)} justices, {used} appointments -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
