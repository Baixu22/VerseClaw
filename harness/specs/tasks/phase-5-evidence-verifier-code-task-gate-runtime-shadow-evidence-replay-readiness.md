---
id: phase-5-evidence-verifier-code-task-gate-runtime-shadow-evidence-replay-readiness
title: Phase 5 Evidence Verifier Code Task Gate Runtime Shadow Evidence Replay Readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a pure runtime-shaped shadow evidence replay/readiness helper for the default-off Evidence Verifier code-task sampler route, using caller-supplied labeled replay samples without wiring runtime producers or adding active completion authority.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-runtime-shadow-evidence-replay-readiness.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-runtime-shadow-evidence-replay-readiness.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - Replay helpers consume only caller-supplied in-memory samples and labels.
  - Replay helpers do not read logs, scan workspaces, execute validators, start services, persist output, or subscribe to runtime events.
  - Replay readiness can recommend only offline/runtime-shadow evidence next steps; it cannot approve active gates or prove completion correctness.
  - Runtime-shaped replay output remains diagnostic-only and non-authoritative.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - default-on verifier completion gate, active code-task completion gate, TaskLoop completion authority, Mission completion authority, checkpoint authority, lifecycle authority, reviewer prompt insertion, or model-message insertion
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, or actual runtime producer wiring
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, log reads, transcript reads, or verifier runtime behavior from the replay helper
  - patch apply, file write, workspace edit, symbol mutation, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport from the helper
  - treating replay reports, caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, `would_allow`, `would_block`, or `risky_allow` as task-completion evidence
featureFlags:
  - No runtime feature flag is added.
  - Replay is explicit-call only and receives all samples in memory.
rollback:
  - Stop calling the replay helper and keep existing sampler/helper output unused.
  - Remove replay types/functions/tests without touching runtime callers.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-runtime-shadow-evidence-replay-readiness.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-runtime-shadow-evidence-replay-readiness.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts
  - rg -n "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
acceptance:
  - Replay helper evaluates caller-supplied runtime-shaped samples into true_allow, useful_block, false_block, false_allow, inconclusive, and not_evaluated counters.
  - Replay readiness reports runtime shadow sample count, evaluated candidate count, false-block/false-allow rates, useful-block ratio, risky false-allow share, and non-authority counts.
  - Replay readiness can produce ready only for shadow evidence review; active pilot remains blocked without a later spec.
  - Focused tests cover ready and blocked replay readiness cases.
  - No forbidden runtime integration pattern is introduced.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 5 Evidence Verifier Code Task Gate Runtime Shadow Evidence Replay Readiness

This slice closes the route with a pure replay/readiness helper:

```text
caller-supplied runtime-shaped samples
  -> default-off caller adapter results
  -> labeled replay metrics
  -> shadow-evidence readiness decision
```

It still does not wire real runtime producers or authorize active completion gates.
