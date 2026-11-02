#!/usr/bin/env python3
"""Read-only report of Docker volumes on the builder host.

Inputs (files written by the workflow): sysdf.txt (docker system df -v),
inspect.tsv (name|created|labels-json|mountpoint), mounts.tsv
(container|status|image|created|mount names). Reads volume mountpoints with
stat/listdir only. Never writes, deletes or mounts anything.
"""
import json, os, re, sys, time
from collections import Counter, defaultdict

work = sys.argv[1]
HEX64 = re.compile(r"^[0-9a-f]{64}$")
UNITS = {"B": 1, "kB": 1e3, "KB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12}

def parse_size(s):
    m = re.match(r"^([0-9.]+)([kKMGT]?B)$", s.strip())
    return float(m.group(1)) * UNITS[m.group(2)] if m else 0.0

def h(n):
    for u in ("B", "kB", "MB", "GB", "TB"):
        if n < 1000 or u == "TB":
            return f"{n:.1f}{u}" if u != "B" else f"{int(n)}B"
        n /= 1000.0

sizes, links = {}, {}
sec = None
for line in open(os.path.join(work, "sysdf.txt"), encoding="utf-8", errors="replace"):
    if line.startswith("Local Volumes space usage"):
        sec = "v"; continue
    if line.startswith("Build cache usage"):
        sec = None
    if sec == "v":
        parts = line.split()
        if len(parts) == 3 and parts[0] != "VOLUME":
            sizes[parts[0]] = parse_size(parts[2]); links[parts[0]] = int(parts[1])

vols = {}
for line in open(os.path.join(work, "inspect.tsv"), encoding="utf-8", errors="replace"):
    line = line.rstrip("\n")
    if not line:
        continue
    name, created, labels, mp = line.split("|", 3)
    try:
        lab = json.loads(labels) or {}
    except Exception:
        lab = {}
    vols[name] = dict(name=name, created=created[:19], labels=lab, mp=mp,
                      size=sizes.get(name, 0.0), links=links.get(name, -1),
                      anon=bool(HEX64.match(name)))

users = defaultdict(list)
for line in open(os.path.join(work, "mounts.tsv"), encoding="utf-8", errors="replace"):
    parts = line.rstrip("\n").split("|")
    if len(parts) >= 5:
        for m in parts[4].split(","):
            m = m.strip()
            if m:
                users[m].append(f"{parts[0]}({parts[1][:20]}; {parts[2]})")

def fingerprint(v):
    d = os.path.join(v["mp"])
    try:
        ents = sorted(os.listdir(d))
    except Exception as e:
        return dict(kind="unreadable", note=type(e).__name__)
    fp = dict(kind="other", top=",".join(ents[:8]) + ("..." if len(ents) > 8 else ""))
    if "PG_VERSION" in ents:
        fp["kind"] = "postgres-datadir"
        try:
            fp["pg"] = open(os.path.join(d, "PG_VERSION")).read().strip()
        except Exception:
            pass
        try:
            fp["dbs"] = len([x for x in os.listdir(os.path.join(d, "base")) if x.isdigit()])
        except Exception:
            pass
        fp["pid_file"] = "postmaster.pid" in ents
    elif not ents:
        fp["kind"] = "empty"
    newest = 0.0
    n = 0
    for root, _dirs, files in os.walk(d):
        for f in files:
            n += 1
            try:
                newest = max(newest, os.lstat(os.path.join(root, f)).st_mtime)
            except Exception:
                pass
        if n > 20000:
            break
    fp["files"] = n
    fp["last_write"] = time.strftime("%Y-%m-%dT%H:%M", time.gmtime(newest)) if newest else "-"
    return fp

allv = list(vols.values())
for v in allv:
    v["fp"] = fingerprint(v)

def summary(rows, title):
    tot = sum(r["size"] for r in rows)
    print(f"{title}: count={len(rows)} size={h(tot)}")

print("=== TOTALS ===")
summary(allv, "all volumes")
summary([v for v in allv if v["links"] == 0], "unused (links=0)")
summary([v for v in allv if v["links"] != 0], "in use (links!=0)")
summary([v for v in allv if v["anon"]], "anonymous (64-hex name)")
summary([v for v in allv if not v["anon"]], "named")
summary([v for v in allv if v["labels"]], "with any label")

print("\n=== CONTENT KIND (unused only) ===")
kc = Counter(); ks = Counter()
for v in allv:
    if v["links"] == 0:
        k = v["fp"]["kind"] + (" pg" + v["fp"].get("pg", "?") if v["fp"]["kind"] == "postgres-datadir" else "")
        kc[k] += 1; ks[k] += v["size"]
for k, c in kc.most_common():
    print(f"{k}: count={c} size={h(ks[k])}")
dbc = Counter(v["fp"].get("dbs") for v in allv if v["fp"]["kind"] == "postgres-datadir" and v["links"] == 0)
print("postgres datadirs by number of databases in base/ (3 = template0/template1/postgres only; 4 = plus one app DB such as CI's jurvio):", dict(dbc))

print("\n=== SIZE DISTRIBUTION (unused) ===")
edges = [(0, "0B"), (1e6, "<1MB"), (10e6, "1-10MB"), (50e6, "10-50MB"), (100e6, "50-100MB"),
         (250e6, "100-250MB"), (1e9, "250MB-1GB"), (5e9, "1-5GB"), (float("inf"), ">5GB")]
bc = Counter(); bs = Counter()
for v in allv:
    if v["links"] != 0:
        continue
    for lim, lab in edges:
        if (lim == 0 and v["size"] == 0) or (lim > 0 and v["size"] < lim):
            bc[lab] += 1; bs[lab] += v["size"]; break
for _lim, lab in edges:
    if bc[lab]:
        print(f"{lab:>10}: count={bc[lab]:4d} size={h(bs[lab])}")

print("\n=== CREATED BY DAY (UTC), unused ===")
dc = Counter(); ds = Counter()
for v in allv:
    if v["links"] == 0:
        dc[v["created"][:10]] += 1; ds[v["created"][:10]] += v["size"]
for d in sorted(dc):
    print(f"{d}: count={dc[d]:4d} size={h(ds[d])}")

print("\n=== LABELS (key=value counts) ===")
lc = Counter()
for v in allv:
    for k, val in v["labels"].items():
        lc[f"{k}={val}"] += 1
for k, c in lc.most_common(40):
    print(f"{c:4d}  {k}")
if not lc:
    print("(no volume has any label)")

print("\n=== IN-USE VOLUMES ===")
for v in sorted(allv, key=lambda x: -x["size"]):
    if v["links"] != 0 or users.get(v["name"]):
        print(f"{v['name'][:64]} size={h(v['size'])} links={v['links']} created={v['created']} labels={json.dumps(v['labels'])[:200]} used_by={users.get(v['name'])} fp={v['fp']}")

print("\n=== NAMED (non-anonymous) VOLUMES ===")
for v in sorted(allv, key=lambda x: -x["size"]):
    if not v["anon"]:
        print(f"{v['name'][:64]} size={h(v['size'])} links={v['links']} created={v['created']} labels={json.dumps(v['labels'])[:200]} fp={v['fp']}")

print("\n=== TOP 40 BY SIZE ===")
for v in sorted(allv, key=lambda x: -x["size"])[:40]:
    print(f"{v['name'][:16]} size={h(v['size'])} links={v['links']} created={v['created']} labels={json.dumps(v['labels'])[:160]} fp={v['fp']}")

print("\n=== OLDEST 10 / NEWEST 10 ===")
s = sorted(allv, key=lambda x: x["created"])
for v in s[:10] + [None] + s[-10:]:
    if v is None:
        print("..."); continue
    print(f"{v['name'][:16]} size={h(v['size'])} links={v['links']} created={v['created']} kind={v['fp']['kind']} last_write={v['fp'].get('last_write')}")
