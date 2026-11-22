"""Recompute the retained TF-0678 evidence package using Python's standard library."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
for line in (root / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
    expected, name = line.split("  ", 1)
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name

def read(name):
    return json.loads((root / name).read_text(encoding="utf-8"))

report, gates, closeout, review = map(read, ("report.json", "gates.json", "task-closeout.json", "verifier-report.json"))
candidate = report["candidate"]["commit"]
assert all(item["candidate"] == candidate for item in (gates, closeout, review))
assert gates["product"]["dirty"] is False and gates["support"]["dirty"] is False
assert all(step["exit"] == 0 for step in gates["product"]["steps"])
assert all(step["exit"] == 0 for step in gates["support"]["steps"] if step["name"] != "harness-ci")
assert sum(suite["passed"] for suite in gates["suites"]) == report["counts"]["unit"] == 271
assert all(suite["failed"] == 0 and len(suite["cases"]) == suite["passed"] for suite in gates["suites"])
assert gates["electron"]["stats"]["expected"] == 1 and gates["electron"]["stats"]["unexpected"] == 0
assert closeout["task"]["contract"]["state"] == "done"
assert sum(event["kind"] == "accepted" for event in closeout["events"]) == 1
assert sum(event["kind"] == "repair_started" for event in closeout["events"]) == 1
assert sum(event["kind"] == "review_read_delivered" for event in closeout["events"]) == 4
assert len(review["reviewers"]) == 2
assert review["codeReview"]["report"]["findings"] == []
assert review["codeReview"]["report"]["overall_correctness"] == "patch is correct"
assert review["effect"]["outcome"] == "applied"
assert review["effect"]["proposal_digest"] == review["verificationReceipt"]["ownerProof"]["proposalDigest"]
history = read("repair-history.json")
assert len(history["workerRuns"]) == 2
assert all(worker["record"]["orchestration"]["worktreeMergeStatus"] == "merged" for worker in history["workerRuns"])
assert read("credential-scan.json")["hits"] == []
print(json.dumps({"candidate": candidate, "unit": 271, "electron": 1, "functional": "passed", "repositoryHarnessCi": "failed"}))
