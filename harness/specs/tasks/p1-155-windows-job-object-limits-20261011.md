---
id: p1-155-windows-job-object-limits-20261011
title: Wire Windows Job Object resource limits and truthful receipts (issue #155)
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Send the host's memory and active-process caps to the bundled VerseShell executor, report truthfully how enforcement was established, and bound the instance-wide live managed-process count without inventing a second process manager.
expectedUserBehavior:
  - A managed tool process that requests a cap actually runs under it; exceeding a small cap fails explicitly instead of silently succeeding.
  - The receipt names the requested and applied limits, says that enforcement is Job-Object-configured and that no kernel readback exists, and never claims enforcement for a policy-denied or limit-free run.
  - Several sessions, lanes or background callers cannot each occupy the whole declared instance capacity.
touchedAreas:
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.real-limits.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.real-limits.test.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.test.ts
  - openclaw_runtime/test/vitest/vitest.verseshell.config.ts
  - harness/specs/rules/verseshell-job-object-limits.md
  - harness/specs/tasks/p1-155-windows-job-object-limits-20261011.md
  - docs/dev/p1-155-windows-job-limits-20261011.md
  - scripts/repository-artifacts.json
  - .gitignore
requiredRules:
  - verseshell-job-object-limits
  - runtime-feature-leaf-consumers
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node scripts/run-vitest.mjs run --config test/vitest/vitest.verseshell.config.ts --reporter=dot --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-155-windows-job-object-limits-20261011.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
acceptance:
  - Both managed-process boundaries send max_memory_mb (ceil of bytes/MiB, minimum 1) and max_processes, and the argument names match the executor's published schema.
  - A real Windows run of the qualified ae.exe shows the active-process cap refusing a child spawn and the per-process commit cap refusing an allocation that the same command completes without; the experiment is bounded to twice the small cap.
  - Receipts report requested/applied/enforcement/evidence/readback plus the Windows semantics note, and enforcement is never claimed for a policy-denied command or when no limits were requested.
  - Instance-wide live managed-process capacity is opt-in, bounded, released only after a terminal state, and reported through counters.
  - The long-lived process.start path's real verification is gated behind an environment flag because the shipped executor currently fails that op with Access denied on this host; the finding and its reproduction are recorded, not papered over.
  - Evidence is agent-driven only: no human operator, no elevated privileges, no unbounded exhaustion experiment.
docs:
  required: true
  paths:
    - docs/dev/p1-155-windows-job-limits-20261011.md
---

# Windows Job Object limits for managed tool processes

The executor already implements the Job Object limits; nothing was sending them. This change wires
both managed-process boundaries (`process.start` and the one-shot `exec.run`), turns the receipt from
an unconditional `unsupported` into a truthful `job-object-configured` record with the readback gap
named, and adds opt-in instance-wide capacity so multiple callers cannot each believe they own the
budget.

The real enforcement evidence comes from a bounded Windows run of the qualified binary: a child spawn
refused at `maxProcesses: 1`, and a 256 MiB allocation refused at a 64 MiB per-process commit cap
while the same command succeeds uncapped and under a 512 MiB cap.

Recorded residual: the long-lived `process.start` op fails with `Access denied (os error 5)` on this
host for every command, including requests with no limits, so that path's real verification is
opt-in; the finding is documented with its five-configuration reproduction.
