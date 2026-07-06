---
id: phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-implementation
title: Phase 5 Evidence Verifier Code Task Gate Default-Off Shadow Sampler Implementation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a pure runtime-shaped caller adapter for the default-off Evidence Verifier code-task shadow sampler contract without wiring TaskLoop, Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, persistence, or active completion authority.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-implementation.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-implementation.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - The runtime-shaped caller adapter is pure, deterministic, in-memory, explicit-call only, and disabled by default.
  - Disabled/default mode does not require a valid shadow input and does not call the sampler contract.
  - Explicit `shadow_only` mode may call the sampler contract and returns only diagnostic sampler output.
  - Caller results, sampler events, shadow reports, `would_allow`, `would_block`, and `risky_allow` remain diagnostics only and are never task-completion evidence.
  - No active pilot, active completion gate, completion authority, runtime status mutation, prompt/model-message insertion, persistence, UI, service, listener, daemon, or default-on behavior is introduced.
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
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, or actual runtime caller wiring beyond the pure runtime-core adapter
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, or verifier runtime behavior from the helper
  - patch apply, file write, workspace edit, symbol mutation, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport from the helper
  - treating caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, `would_allow`, `would_block`, or `risky_allow` as task-completion evidence
featureFlags:
  - No real runtime feature flag is added in this pure adapter slice.
  - The adapter's `mode` is explicit-call input only and defaults to `disabled`.
  - A later real runtime wiring spec must add and test any product/runtime feature flag separately.
rollback:
  - Stop calling the pure adapter and keep the sampler/helper outputs unused.
  - Remove the adapter types/functions and focused tests without touching runtime callers.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-implementation.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-shadow-sampler-implementation.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts
  - rg -n "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
acceptance:
  - The adapter defaults to disabled and returns a non-sampled result without requiring valid shadow input.
  - Explicit `shadow_only` mode invokes the existing sampler contract and returns bounded sampler event fields.
  - Invalid explicit `shadow_only` input fails closed as invalid adapter input without granting completion authority.
  - Caller results include stable non-authority fields: `nonAuthoritative: true`, `completionAuthority: false`, `runtimeDecisionUnaffected: true`, and `legacyDecisionUnaffected: true`.
  - Focused tests prove disabled/default behavior, explicit sampling behavior, invalid input, and aggregate caller summary counters.
  - No forbidden runtime integration pattern is introduced.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md
    - runtime-research/agent-runtime-index.md
---

# Phase 5 Evidence Verifier Code Task Gate Default-Off Shadow Sampler Implementation

This slice adds only a pure runtime-shaped adapter around the sampler contract:

```text
runtime-shaped completion metadata
  -> explicit default-off caller adapter
  -> default-off sampler event only when mode is shadow_only
  -> caller-owned diagnostic result
```

It is not real TaskLoop/Gateway wiring and does not create an active completion gate.
