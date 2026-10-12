---
id: p1-160-verseshell-process-start-20261012
title: Pre-create the VerseShell lifecycle root and verify real process.start limits (issue #160)
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Make the long-lived VerseShell process.start boundary work and be diagnosable when a host denies the lifecycle-record write, and verify with the bundled binary that its Job Object limits are actually enforced.
expectedUserBehavior:
  - A managed long-lived process starts on a host where the executor's first lifecycle write would otherwise fail opaquely with Access denied.
  - When the host denies the record write, the caller sees the executor's explicit E_PROCESS_PERSIST instead of an opaque E_PROCESS_INTERNAL.
  - A real run shows the active-process cap refusing a child spawn and the per-process commit cap refusing an allocation the same script completes without.
touchedAreas:
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.real-limits.test.ts
  - harness/specs/tasks/p1-160-verseshell-process-start-20261012.md
  - harness/specs/tasks/p1-155-windows-job-object-limits-20261011.md
  - docs/dev/p1-160-verseshell-process-start-20261012.md
  - docs/dev/p1-155-windows-job-limits-20261011.md
  - scripts/repository-artifacts.json
  - .gitignore
requiredRules:
  - verseshell-job-object-limits
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node openclaw_runtime/scripts/run-vitest.mjs run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-160-verseshell-process-start-20261012.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
acceptance:
  - governed-process.ts creates <workspace>/.ae/process-lifecycle before the first process.start, best-effort and non-fatal, with no prompt/tool/policy/default change.
  - The opt-in real-limit suite asserts the observable property of each Job Object limit (root runs, child spawn refused; allocation fails fatally) rather than a command whose own semantics mask the limit.
  - A real Windows run of the qualified ae.exe passes both real-limit suites with the opt-in flags set, and the default run skips only the gated suites.
  - The durable record states the pre-create is a diagnosability fix, not a sandbox bypass, and keeps the no-kernel-readback boundary.
  - Evidence is agent-driven only: no human operator, no elevated privileges, no unbounded exhaustion experiment.
docs:
  required: true
  paths:
    - docs/dev/p1-160-verseshell-process-start-20261012.md
---

# VerseShell process.start: lifecycle root and real-limit verification

The executor persists a lifecycle record inside `process.start` and creates
`<workspace>/.ae/process-lifecycle` as its first write. When that write is denied
the executor surfaces a bare `io::Error`, which the operation mapper reports as
`E_PROCESS_INTERNAL`. Pre-creating the directory from the host turns an opaque
failure into the executor's normal path (approval gate, then `E_PROCESS_PERSIST`).

With the directory present, the op runs, and the previously gated real-limit
suite was found to assert two commands whose own semantics hide the limit
(`cmd.exe /C` needs a helper process; PowerShell continues past a non-terminating
`OutOfMemoryException`). The suite is rewritten to a Node root so the assertions
test the Job Object, not the command.
