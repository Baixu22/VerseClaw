"""Read final development evidence and prepare (never directly edit) a TF proposal."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
tf = Path.home() / ".codex/skills/task-forest/scripts/task_forest.py"

def command(args, cwd=root):
    return subprocess.run(args, cwd=cwd, capture_output=True, encoding="utf-8", check=True).stdout.strip()

def write(name, value):
    (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

report = json.loads((out / "verification.json").read_text())
assert len(report["gates"]) == 13 and all(g["exitCode"] == 0 for g in report["gates"])
counts = {}
for name in ["native-sdk", "embedded-regression", "candidate-regression", "entry-scan"]:
    log = (out / f"{name}.log").read_text(encoding="utf-8")
    counts[name] = int(re.findall(r"Tests\s+(\d+) passed", log)[-1])
sources = [
    "openclaw_runtime/src/agents/harness/context-engine-lifecycle.ts",
    "openclaw_runtime/src/agents/harness/selection.ts",
    "openclaw_runtime/src/agents/harness/selection.compass.test.ts",
    "openclaw_runtime/src/context-engine/context-candidate.ts",
    "openclaw_runtime/src/context-engine/context-orchestrator.ts",
    "openclaw_runtime/src/context-engine/turn-injection-budget.ts",
    "openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts",
    "openclaw_runtime/extensions/codex/src/app-server/run-attempt.ts",
    "openclaw_runtime/extensions/codex/src/app-server/context-engine-projection.ts",
    "openclaw_runtime/src/plugin-sdk/agent-harness-runtime.ts",
    "harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md",
]
write("source-hashes.json", {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in sources})
write("review.json", {
    "actor": "codex/root", "driven_by": "agent", "kind": "implementer-self-review",
    "independent": False,
    "scope": sources,
    "correctedDuringReview": ["Exit the native async scope for embedded child runs to prevent double accounting."],
    "remainingActionableFindingsInChangedSlice": [],
    "limitations": ["No independent agent review or external Codex app-server transport run."]
})
write("evidence.json", {
    "actor": "codex/root", "driven_by": "agent", "scope": "development-only",
    "head": command(["git", "rev-parse", "HEAD"]), "dirty": True,
    "testsPassed": counts, "totalTestsPassed": sum(counts.values()), "finalGatesPassed": len(report["gates"]),
    "codexDependency": {"tag": "rust-v0.137.0", "commit": command(["git", "rev-parse", "HEAD"], Path(sys.argv[1]))},
    "limitations": [
        "Unscoped Harness validate exit 1: three pre-existing untracked Windows cache files; scoped diff-aware run excludes only %SystemDrive%/.",
        "One embedded regression run was terminated at the unchanged 120-second no-output limit; saved log and report retained. Final rerun uses verbose reporter.",
        "check-landing exit 1, 183 repository-wide historical findings against origin/main after git fetch.",
        "No external native app-server/provider, Electron, packaged build, fresh RC acceptance, or publication.",
        "Existing shared dirty changes and this development increment remain uncommitted; TF-0013 is not closed."
    ],
})
credential_pattern = re.compile(rb"(?<![A-Za-z0-9_-])sk-(?:or-v1-)?[A-Za-z0-9_-]{24,}")
hits = sum(len(credential_pattern.findall(p.read_bytes())) for p in out.iterdir() if p.is_file())
assert hits == 0
write("credential-scan.json", {"actor": "codex/root", "driven_by": "agent", "scope": str(out), "credentialScanHits": hits, "method": "API-key-shaped token pattern over evidence files; not an exhaustive secret detector"})
node = json.loads(command(["py", "-3", "-X", "utf8", str(tf), "show", "TF-0013", "--json"]))
write("node-before.json", node)
evidence = list(node["evidence"])
for path in ["docs/dev/tf0013-native-budget-20260930.md", *[f"artifacts/tf0013-native-budget-20260930/{n}" for n in ["evidence.json", "verification.json", "source-hashes.json", "review.json"]]]:
    if path not in evidence:
        evidence.append(path)
fields = {
    "evidence": evidence,
    "summary": "COMPASS、embedded 消息替换及原生 harness SDK 组装已接入既有候选仲裁与 turn ledger；超额保留原历史，启动重试不重复收费，失败隔离和 embedded 子 scope 有开发回归。外部原生 app-server 最终请求/持久线程证据及当前干净候选四项验收尚未完成。",
    "next_action": "在 TF-0013 内补 agent 驱动的原生 app-server 最终请求与 bootstrap/retry 证据，核验 SDK scope 在实际加载/打包路径中成立；随后冻结候选核验四项 acceptance。沿用 UAS-02 spec，不解除 D7 冻结或产品锁。",
    "execution_hints": node["execution_hints"][:3] + ["原生分发/公开 SDK 共享预算开发验证已完成；fixture 不等于外部 app-server 或正式 RC 证据。不得以真人 verdict/数据为前置。"],
}
write("proposal-input.json", {
    "proposal_id": "TFP-tf0013-native-budget-development-20260930",
    "session_id": "tf0013-native-budget-20260930",
    "rationale": "接力原生 SDK 预算开发增量，记录可复现证据与剩余实际运行边界；不改变节点状态/进度或任何产品锁。",
    "changes": [{"action": "update_node", "id": "TF-0013", "fields": fields}],
})
print(json.dumps({"tests": counts, "total": sum(counts.values()), "gates": len(report["gates"]), "credentialScanHits": hits}))
