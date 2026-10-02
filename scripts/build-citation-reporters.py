"""Generate the vendored reporter index as an apply_patch patch.

Development only: pip install reporters-db==3.2.66. No Python runtime dependency
is required by the app. Preserve ambiguity across editions AND source reporters.
"""
import argparse
import json
from importlib.metadata import distribution
from reporters_db import REPORTERS

PIN = "3.2.66"
dist = distribution("reporters-db")
assert dist.version == PIN, "Use the pinned reporter dataset"

def normalize(value):
    return "".join(value.lower().split()).replace(".", "").replace("’", "'")

choices = {}
for reporter, definitions in REPORTERS.items():
    for index, definition in enumerate(definitions):
        for edition in definition["editions"]:
            choices.setdefault(normalize(edition), set()).add((reporter, index, edition))
        for alias, edition in definition.get("variations", {}).items():
            choices.setdefault(normalize(alias), set()).add((reporter, index, edition))

data = {
    "source": "https://github.com/freelawproject/reporters-db",
    "version": PIN,
    "reporters": {alias: normalize(next(iter(targets))[2]) if len(targets) == 1 else None
                  for alias, targets in sorted(choices.items())},
}
license_file = next(file for file in dist.files if file.name in ("LICENSE", "LICENSE.txt"))
license_text = dist.locate_file(license_file).read_text()
patch = "*** Begin Patch\n"
for filename, text in [("src/modules/citations/data/reporters.json", json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n"),
                       ("src/modules/citations/data/reporters-LICENSE.txt", license_text)]:
    patch += "*** Add File: " + filename + "\n"
    patch += "".join("+" + line + "\n" for line in text.splitlines())
patch += "*** End Patch\n"
parser = argparse.ArgumentParser()
parser.add_argument("--offset", type=int, default=0)
parser.add_argument("--length", type=int, default=1000000)
args = parser.parse_args()
print(json.dumps(patch[args.offset:args.offset + args.length], ensure_ascii=False))
