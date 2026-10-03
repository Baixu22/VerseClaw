---
id: phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-readiness
title: Phase 5 Evidence Verifier Code Task Gate Default-Off Shadow Sampler Readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a pure bounded default-off shadow sampler event and summary contract around the standalone Evidence Verifier code-task completion sanity helper, without wiring runtime callers or adding active completion authority.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-readiness.md
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-mvp.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-readiness.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - The current helper remains pure, deterministic, in-memory, and explicit-call only.
  - The sampler contract is a pure helper surface only; it does not add a runtime caller.
  - Any future sampler must be default-off, shadow-only, non-authoritative, rollback-by-stop-calling, and unable to block or approve completion.
  - `would_allow`, `would_block`, `risky_allow`, `EvidenceVerifierReport`, sampler events, and sampler summaries remain diagnostics only and must not become task-completion evidence.
  - Active pilot and active completion gates remain out of scope until runtime shadow evidence satisfies a later stricter spec.
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
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, or runtime caller wiring in this slice
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, or verifier runtime behavior from the helper or sampler contract
  - patch apply, file write, workspace edit, symbol mutation, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport from the helper
  - treating shadow reports, sampler reports, EvidenceVerifierReport, missing evidence, `would_allow`, `would_block`, or `risky_allow` as task-completion evidence
featureFlags:
  - This slice introduces no runtime feature flag.
  - A later implementation spec must name any default-off sampler flag, prove the disabled-by-default path, and keep rollback to disabling or not calling the sampler.
rollback:
  - Stop calling the pure sampler helper and keep the existing offline-only report/evaluation helper unchanged.
  - Remove the sampler event and summary helper plus focused tests without touching runtime callers.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-readiness.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-readiness.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts
  - rg -n "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
acceptance:
  - Current offline corpus metrics remain at sampler-entry thresholds: at least 100 labeled samples, block precision at least 80%, false-block rate at most 20%, false-allow rate at most 25% or most false allows tagged risky, and useful-block to false-block ratio at least 4:1.
  - A bounded sampler contract is implemented rather than active runtime enforcement.
  - The sampler contract identifies allowed inputs, explicit non-authority language, event fields, aggregation fields, risk tiers, false-block taxonomy, retention/non-persistence stance, and rollback.
  - The sampler contract identifies limitations for semantic false allows when EvidenceVerifierReport does not contain enough diff or obligation mapping detail.
  - No TaskLoop, Mission, Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, service, listener, daemon, persistence, or active gate wiring is introduced by this readiness package.
  - Focused tests cover default-off disabled behavior, explicit shadow-only sampling, invalid sampler input, aggregate sampler summaries, and non-authoritative/no-retention fields.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 5 Evidence Verifier Code Task Gate Default-Off Shadow Sampler Readiness

This slice implements the pure sampler contract after the 120-sample offline corpus improved enough to justify sampler design.

It does not add a runtime caller. It records and tests the contract a later runtime integration must preserve:

```text
offline helper and metrics
  -> default-off sampler contract helper
  -> explicit runtime caller only in a later accepted implementation spec
  -> active pilot only after runtime shadow evidence clears stricter thresholds
```

The implemented deliverable is a bounded sampler event and aggregate summary contract with tests proving disabled/default-off behavior. The helper and sampler remain diagnostics only; neither can prove completion or correctness.
