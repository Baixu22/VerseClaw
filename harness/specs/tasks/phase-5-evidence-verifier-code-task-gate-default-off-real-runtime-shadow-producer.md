---
id: phase-5-evidence-verifier-code-task-gate-default-off-real-runtime-shadow-producer
title: Phase 5 Evidence Verifier Code Task Gate Default-Off Real Runtime Shadow Producer
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add the smallest default-off real-runtime-shaped shadow producer adapter around the existing pure runtime caller adapter, producing only caller-owned diagnostic results without wiring TaskLoop, Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, persistence, UI, or completion authority.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-real-runtime-shadow-producer.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-real-runtime-shadow-producer.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - The producer adapter is pure, deterministic, in-memory, explicit-call only, and disabled by default.
  - Disabled/default mode does not invoke the caller adapter or sampler and does not require valid completion metadata, valid shadow input, or a valid verifier report.
  - Explicit `shadow_only` mode may call only the existing `buildCodeTaskEvidenceGateRuntimeCallerResult(...)` pure runtime-shaped caller adapter.
  - Producer output is caller-owned diagnostic data only and includes `sampled`, `mode`, `outcome`, `diagnosticCodes`, `nonAuthoritative: true`, `completionAuthority: false`, `runtimeDecisionUnaffected: true`, and `legacyDecisionUnaffected: true`.
  - Producer output, caller results, sampler events, shadow reports, `would_allow`, `would_block`, `risky_allow`, and `EvidenceVerifierReport` remain diagnostics only and are never task-completion evidence.
  - No active pilot, active completion gate, runtime status mutation, prompt/model-message insertion, persistence, UI, service, listener, daemon, or default-on behavior is introduced.
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
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, or real runtime caller wiring beyond the pure runtime-core producer adapter
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, log reads, transcript reads, or verifier runtime behavior from the producer/helper
  - patch apply, file write, workspace edit, symbol mutation, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport from the producer/helper
  - treating producer output, caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, `would_allow`, `would_block`, or `risky_allow` as task-completion evidence
featureFlags:
  - No product/runtime feature flag is added in this slice.
  - The producer's `mode` is explicit-call input only and defaults to `disabled`.
  - A later real runtime wiring spec must add and test any product/runtime feature flag separately before any runtime integration is allowed.
rollback:
  - Stop calling the pure producer adapter and keep all producer/caller/sampler outputs unused.
  - Remove producer types/functions and focused tests without touching runtime callers.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-real-runtime-shadow-producer.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-real-runtime-shadow-producer.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts
  - git diff --check -- openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-default-off-real-runtime-shadow-producer.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|spawn|exec\\(|vitest|eslint|tsc|pnpm" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
acceptance:
  - The producer defaults to disabled and returns `sampled: false` without requiring valid completion metadata, valid shadow input, or a valid verifier report.
  - Disabled/default mode proves it does not invoke the caller adapter or sampler.
  - Explicit `shadow_only` mode invokes only the existing pure runtime caller adapter and returns bounded diagnostic fields.
  - Valid completion, missing-report or insufficient-evidence completion, and semantic-risk completion fixtures produce sampled diagnostic results with expected allow/block/risk diagnostic codes.
  - Invalid explicit producer input fails closed without granting completion authority.
  - Producer output can be fed into the existing runtime-shaped replay/readiness helper without changing active-pilot requirements.
  - Focused tests cover disabled/default behavior, explicit sampling behavior, invalid input, replay/readiness compatibility, and non-authoritative/no-runtime-decision fields.
  - No forbidden runtime integration pattern is introduced.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 5 Evidence Verifier Code Task Gate Default-Off Real Runtime Shadow Producer

This slice adds only a minimal real-runtime-shaped producer adapter around the existing pure caller adapter:

```text
runtime-like completion metadata
  -> explicit default-off producer adapter
  -> existing pure runtime caller adapter only in shadow_only mode
  -> caller-owned diagnostic result
```

It is not active gate wiring and does not approve TaskLoop/Gateway integration or completion authority.
