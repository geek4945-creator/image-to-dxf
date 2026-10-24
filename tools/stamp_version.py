#!/usr/bin/env python3
"""Stamp the Hard Version 1.5 build id into docs/version.json, docs/js/version.js and the ?v= cache-busters in
docs/index.html. Build id = <semver>-b<number of commits after this one is made>. Usage: tools/stamp_version.py [build]"""
import json, re, subprocess, sys, datetime, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
NAME, SEMVER = "Hard Version 1.5", "1.5.0"
def main():
    if len(sys.argv) > 1: build = sys.argv[1]
    else:
        n = int(subprocess.check_output(["git", "rev-list", "--count", "HEAD"], cwd=ROOT).decode().strip())
        build = f"{SEMVER}-b{n + 1}"
    date = datetime.date.today().isoformat()
    info = {"name": NAME, "version": SEMVER, "build": build, "date": date,
            "notes": "https://github.com/geek4945-creator/image-to-dxf/releases"}
    docs = ROOT / "docs"
    (docs / "version.json").write_text(json.dumps(info, indent=1) + "\n")
    (docs / "js" / "version.js").write_text("window.I2D_VERSION=" + json.dumps(info) + ";\n")
    idx = docs / "index.html"; h = idx.read_text()
    h = re.sub(r'((?:src|href)="(?:js/[\w.-]+\.js|style\.css))(?:\?v=[^"]*)?"', lambda m: f'{m.group(1)}?v={build}"', h)
    idx.write_text(h)
    print(build)
if __name__ == "__main__": main()
