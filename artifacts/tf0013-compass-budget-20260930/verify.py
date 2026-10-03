"""Reproduce the scoped TF-0013 development gates; never claims RC acceptance."""
import json
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
runtime = root / "openclaw_runtime"
gates = [
    ("native-harness", runtime, ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.agents.config.ts", "harness/selection.compass.test.ts"]),
    ("reply-wiring", runtime, ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.auto-reply-top-level.config.ts", "reply.compass.test.ts"]),
    ("runtime-unit", runtime, ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.unit.config.ts", "src/context-engine/context-orchestrator.compass.test.ts", "src/context-engine/context-orchestrator.test.ts", "src/context-engine/context-candidate.test.ts", "src/context-engine/assembler.test.ts", "src/context-engine/turn-injection-budget.test.ts", "src/context-engine/rc03-seal-wiring.test.ts"]),
    ("runtime-entry", runtime, ["node", "scripts/run-vitest.mjs", "run", "--config", "test/vitest/vitest.agents.config.ts", "rc03-entry-transitions.acceptance.test.ts"]),
    ("root-focused", root, ["node", "node_modules/vitest/vitest.mjs", "run", "tests/unit/context-orchestrator-entry-scan.test.ts", "tests/unit/cli-runner-intensity-policy.test.ts", "tests/unit/r3-2-memory-injection-receipt-wiring.test.ts", "tests/unit/r3-2-memory-injection-receipt-persist.test.ts"]),
    ("root-typecheck", root, ["node", "scripts/typecheck-agent-dev.mjs"]),
    ("runtime-typecheck", runtime, ["node", "scripts/run-tsgo.mjs", "-p", "tsconfig.core.json", "--incremental", "--tsBuildInfoFile", ".artifacts/tsgo-cache/core.tsbuildinfo"]),
    ("comms-replay", root, ["node", "scripts/comms/replay.mjs"]),
    ("comms-compare", root, ["node", "scripts/comms/compare.mjs"]),
    ("diff-check", root, ["git", "diff", "--check"]),
]
results = []
for name, cwd, command in gates:
    started = time.monotonic()
    print(f"Starting {name}", flush=True)
    with (out / f"{name}.log").open("w", encoding="utf-8") as log:
        result = subprocess.run(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
    results.append({"gate": name, "command": command, "cwd": str(cwd), "exitCode": result.returncode, "seconds": round(time.monotonic() - started, 3), "log": f"{name}.log"})
    (out / "verification.json").write_text(json.dumps({"actor": "codex/root", "driven_by": "agent", "scope": "development-only", "gates": results}, indent=2) + "\n", encoding="utf-8")
    print(f"{name}: exit {result.returncode} ({results[-1]['seconds']}s)", flush=True)
raise SystemExit(0 if all(row["exitCode"] == 0 for row in results) else 1)
