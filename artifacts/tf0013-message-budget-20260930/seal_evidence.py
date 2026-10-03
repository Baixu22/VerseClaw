"""Read the development gate artifacts and bind them to the tested source."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

out = Path(__file__).resolve().parent
root = out.parents[1]
def read(name):
    return json.loads((out / name).read_text(encoding="utf-8-sig"))

verification = read("verification.json")
assert len(verification["gates"]) == 9
assert all(row["exitCode"] == 0 for row in verification["gates"])
review = read("autoreview.json")
assert review["findings"] == []
assert read("harness-results.json")["validate"] == 0
assert read("harness-results.json")["dryRun"] == 0
assert read("static-results.json")["oxlint"] == 0
assert read("static-results.json")["formatScoped"] == 0
assert read("task-forest-results.json")["validate"] == 0
assert read("task-forest-results.json")["export"] == 0
assert read("task-forest-node.json")["status"] == "in_progress"
counts = {}
for name in ["runtime-entry", "runtime-unit", "runtime-extensions", "root-focused"]:
    log = (out / f"{name}.log").read_text(encoding="utf-8")
    match = re.search(r"Tests\s+(\d+) passed\s+\((\d+)\)", log)
    assert match and match[1] == match[2], name
    counts[name] = int(match[1])

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

changed = subprocess.check_output(["git", "diff", "--name-only"], cwd=root, text=True).splitlines()
sources = [name for name in changed if name.startswith("openclaw_runtime/") or name.startswith("harness/specs/")]
source_data = {
    "actor": "codex/root", "driven_by": "agent", "scope": "development-only",
    "testedBaseHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
    "sourceDirtyAtValidation": True,
    "sha256": {name: sha(root / name) for name in sources},
    "tests": counts, "totalTestsPassed": sum(counts.values()),
    "notExecuted": ["formal RC-09/10", "Electron", "native plugin external service", "paid provider"],
}
(out / "source-hashes.json").write_text(json.dumps(source_data, indent=2) + "\n", encoding="utf-8")

patterns = [r"\bsk-[A-Za-z0-9_-]{24,}", r"\bgh[pousr]_[A-Za-z0-9]{30,}", r"\bAKIA[A-Z0-9]{16}\b"]
hits = []
for path in out.iterdir():
    if path.is_file() and path.name not in {"SHA256SUMS", "secret-scan.json"}:
        content = path.read_text(encoding="utf-8-sig", errors="replace")
        if any(re.search(pattern, content) for pattern in patterns):
            hits.append(path.name)
assert not hits, hits
(out / "secret-scan.json").write_text(json.dumps({"actor": "codex/root", "driven_by": "agent",
    "scope": "high-confidence key patterns in this evidence directory", "hits": hits}, indent=2) + "\n", encoding="utf-8")
files = sorted(path for path in out.iterdir() if path.is_file() and path.name != "SHA256SUMS")
(out / "SHA256SUMS").write_text("".join(f"{sha(path)}  {path.name}\n" for path in files), encoding="utf-8")
print(json.dumps({"testsPassed": sum(counts.values()), "evidenceFiles": len(files), "secretHits": len(hits)}))
