"""Scoped, agent-driven development evidence; not formal RC acceptance."""
import json
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
runtime = root / "openclaw_runtime"
scoped_paths = [
    "README.md", "README.zh-CN.md", "README.ja-JP.md",
    "harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md",
    "docs/dev/context-orchestrator.md", "docs/dev/handoffs/LATEST.md",
    "docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md",
    "docs/dev/first-product-controlled-preview/STATUS.md",
    "openclaw_runtime/src/context-engine/context-candidate.ts",
    "openclaw_runtime/src/context-engine/context-candidate.test.ts",
    "openclaw_runtime/src/context-engine/turn-injection-budget.ts",
    "openclaw_runtime/src/context-engine/registry.ts",
    "openclaw_runtime/src/context-engine/rc03-seal-hook.ts",
    "openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts",
    "openclaw_runtime/src/agents/embedded-agent-runner/extensions.tool-registry.test.ts",
    "openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts",
    "openclaw_runtime/src/agents/rc03-entry-transitions.acceptance.test.ts",
]
gates = [
    ("runtime-entry", runtime, ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.agents.config.ts", "rc03-entry-transitions.acceptance.test.ts"]),
    ("runtime-unit", runtime, ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.unit.config.ts", "src/context-engine/context-candidate.test.ts", "src/context-engine/context-orchestrator.test.ts", "src/context-engine/context-orchestrator.compass.test.ts", "src/context-engine/assembler.test.ts", "src/context-engine/turn-injection-budget.test.ts", "src/context-engine/rc03-seal-wiring.test.ts"]),
    ("runtime-extensions", runtime, ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.agents.config.ts", "embedded-agent-runner/extensions.knowledge.test.ts", "embedded-agent-runner/extensions.working-memory.test.ts", "embedded-agent-runner/extensions.tool-registry.test.ts"]),
    ("root-focused", root, ["node", "node_modules/vitest/vitest.mjs", "run", "tests/unit/context-orchestrator-entry-scan.test.ts"]),
    ("runtime-typecheck", runtime, ["node", "scripts/run-tsgo.mjs", "-p", "tsconfig.core.json", "--incremental", "--tsBuildInfoFile", ".artifacts/tsgo-cache/core.tsbuildinfo"]),
    ("root-typecheck", root, ["node", "scripts/typecheck-agent-dev.mjs"]),
    ("comms-replay", root, ["node", "scripts/comms/replay.mjs"]),
    ("comms-compare", root, ["node", "scripts/comms/compare.mjs"]),
    ("diff-check", root, ["git", "diff", "--check", "--", *scoped_paths]),
]
result_path = out / "verification.json"
report = json.loads(result_path.read_text(encoding="utf-8")) if result_path.exists() else {
    "actor": "codex/root", "driven_by": "agent", "scope": "development-only", "gates": []
}
selected = set(sys.argv[1:])
failed = False
for name, cwd, command in gates:
    if selected and name not in selected:
        continue
    started = time.monotonic()
    print(f"Starting {name}", flush=True)
    with (out / f"{name}.log").open("w", encoding="utf-8") as log:
        result = subprocess.run(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
    row = {"gate": name, "command": command, "cwd": str(cwd), "exitCode": result.returncode,
           "seconds": round(time.monotonic() - started, 3), "log": f"{name}.log"}
    if result_path.exists():
        report = json.loads(result_path.read_text(encoding="utf-8"))
    report["gates"] = [old for old in report["gates"] if old["gate"] != name] + [row]
    result_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"{name}: exit {result.returncode} ({row['seconds']}s)", flush=True)
    failed |= result.returncode != 0
raise SystemExit(1 if failed else 0)
