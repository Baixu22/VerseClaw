"""Agent-driven scoped development checks; no formal RC or external transport claim."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
runtime = root / "openclaw_runtime"
sources = ["src/agents/harness/context-engine-lifecycle.ts", "src/agents/harness/selection.ts", "src/agents/harness/selection.compass.test.ts"]
gates = [
    ("native-sdk", runtime, ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.agents.config.ts", "harness/selection.compass.test.ts"]),
    ("embedded-regression", runtime, ["node", "scripts/run-vitest.mjs", "run", "--reporter=verbose", "--config", "test/vitest/vitest.agents.config.ts", "rc03-entry-transitions.acceptance.test.ts", "embedded-agent-runner/extensions.knowledge.test.ts", "embedded-agent-runner/extensions.working-memory.test.ts", "embedded-agent-runner/extensions.tool-registry.test.ts"]),
    ("candidate-regression", runtime, ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.unit.config.ts", "src/context-engine/context-candidate.test.ts", "src/context-engine/context-orchestrator.test.ts", "src/context-engine/context-orchestrator.compass.test.ts", "src/context-engine/assembler.test.ts", "src/context-engine/turn-injection-budget.test.ts", "src/context-engine/rc03-seal-wiring.test.ts"]),
    ("entry-scan", root, ["node", "node_modules/vitest/vitest.mjs", "run", "tests/unit/context-orchestrator-entry-scan.test.ts"]),
    ("runtime-types", runtime, ["node", "scripts/run-tsgo.mjs", "-p", "tsconfig.core.json", "--incremental", "--tsBuildInfoFile", ".artifacts/tsgo-cache/core.tsbuildinfo"]),
    ("root-types", root, ["node", "scripts/typecheck-agent-dev.mjs"]),
    ("lint", runtime, ["node", "scripts/run-oxlint.mjs", *sources]),
    ("format", runtime, ["node", "node_modules/oxfmt/bin/oxfmt", "--check", "--threads=1", *sources]),
    ("comms-replay", root, ["node", "scripts/comms/replay.mjs"]),
    ("comms-compare", root, ["node", "scripts/comms/compare.mjs"]),
    ("harness-validate", root, ["node", "harness/src/cli.mjs", "validate", "--spec", "harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md"]),
    ("harness-dry-run", root, ["node", "harness/src/cli.mjs", "run", "--spec", "harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md", "--dry-run"]),
    ("diff-check", root, ["git", "diff", "--check", "--", *["openclaw_runtime/" + p for p in sources], "harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md", "docs/dev/tf0013-native-budget-20260930.md"]),
]
result_path = out / "verification.json"
report = json.loads(result_path.read_text()) if result_path.exists() else {
    "actor": "codex/root", "driven_by": "agent", "scope": "development-only", "gates": []
}
selected = set(sys.argv[1:])
failed = False
for name, cwd, command in gates:
    if selected and name not in selected:
        continue
    print(f"Starting {name}", flush=True)
    started = time.monotonic()
    env = os.environ.copy()
    if name.startswith("harness-"):
        # Exclude only the pre-existing untracked Windows cache for this child.
        # Diff-aware checks of all tracked and other untracked paths still run.
        ignore = out / "harness-ignore"
        ignore.write_text("%SystemDrive%/\n")
        env.update(GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="core.excludesFile", GIT_CONFIG_VALUE_0=str(ignore))
    with (out / f"{name}.log").open("w", encoding="utf-8") as log:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    row = {"gate": name, "command": command, "cwd": str(cwd), "exitCode": result.returncode,
           "seconds": round(time.monotonic() - started, 3), "log": f"{name}.log"}
    if name.startswith("harness-"):
        row["excludedPreExistingUntrackedDirectory"] = "%SystemDrive%/"
    report["gates"] = [old for old in report["gates"] if old["gate"] != name] + [row]
    result_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"{name}: exit {result.returncode} ({row['seconds']}s)", flush=True)
    failed |= result.returncode != 0
sys.exit(int(failed))
