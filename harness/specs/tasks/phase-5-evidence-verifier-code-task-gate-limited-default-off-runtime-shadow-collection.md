---
id: phase-5-evidence-verifier-code-task-gate-limited-default-off-runtime-shadow-collection
title: Phase 5 Evidence Verifier Code Task Gate Limited Default-Off Runtime Shadow Collection
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add the smallest bounded default-off runtime shadow collection helper around the existing producer adapter, keeping collection explicit, in-memory, caller-owned, diagnostic-only, and non-authoritative without wiring TaskLoop, Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, persistence, UI, or completion authority.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-runtime-shadow-collection.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-runtime-shadow-collection.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - The collection helper is pure, deterministic, in-memory, explicit-call only, and disabled by default.
  - Disabled/default mode does not invoke the producer, caller adapter, or sampler and does not require valid sample metadata, completion metadata, shadow input, or verifier reports.
  - Explicit `shadow_only` mode may call only the existing `buildCodeTaskEvidenceGateRuntimeShadowProducerResult(...)` producer adapter for caller-supplied in-memory samples.
  - Collection is bounded by an explicit or default sample limit and reports dropped sample count rather than scanning, reading logs, or persisting overflow.
  - Collection output may include existing runtime replay/readiness reports, but these remain diagnostic-only and cannot approve active gates.
  - Collection output, producer output, caller results, sampler events, shadow reports, `would_allow`, `would_block`, `risky_allow`, and `EvidenceVerifierReport` remain diagnostics only and are never task-completion evidence.
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
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, or real runtime wiring beyond the pure runtime-core collection helper
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, log reads, transcript reads, or verifier runtime behavior from the collection helper
  - patch apply, file write, workspace edit, symbol mutation, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport from the collection helper
  - treating collection output, producer output, caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, `would_allow`, `would_block`, or `risky_allow` as task-completion evidence
featureFlags:
  - No product/runtime feature flag is added in this slice.
  - The collection helper's `mode` is explicit-call input only and defaults to `disabled`.
  - A later real runtime wiring spec must add and test any product/runtime feature flag separately before any runtime integration is allowed.
rollback:
  - Stop calling the pure collection helper and keep all collection/producer/caller/sampler outputs unused.
  - Remove collection types/functions and focused tests without touching runtime callers.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-runtime-shadow-collection.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-runtime-shadow-collection.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts
  - git diff --check -- openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-limited-default-off-runtime-shadow-collection.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md runtime-research/agent-runtime-index.md
  - rg -n "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|spawn|exec\\(|vitest|eslint|tsc|pnpm" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
acceptance:
  - The collection helper defaults to disabled and returns `sampledCount: 0` without requiring valid samples, valid completion metadata, valid shadow input, or valid verifier reports.
  - Disabled/default mode proves it does not invoke the producer/caller/sampler path.
  - Explicit `shadow_only` mode invokes only the existing producer adapter for bounded caller-supplied samples.
  - Collection applies a deterministic sample limit and reports requested, accepted, dropped, sampled, disabled, and invalid counts.
  - Collection can produce existing runtime replay/readiness output from producer-owned caller inputs without changing active-pilot requirements.
  - Invalid explicit collection input fails closed without granting completion authority.
  - Focused tests cover disabled/default behavior, sample-limit behavior, explicit replay/readiness behavior, invalid input, and non-authoritative/no-runtime-decision fields.
  - No forbidden runtime integration pattern is introduced.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md
    - runtime-research/agent-runtime-index.md
---

# Phase 5 Evidence Verifier Code Task Gate Limited Default-Off Runtime Shadow Collection

This slice adds only a bounded in-memory collection helper:

```text
caller-supplied runtime-like completion samples
  -> explicit default-off collection helper
  -> existing default-off producer only in shadow_only mode
  -> existing runtime replay/readiness helper
  -> caller-owned diagnostic collection result
```

It is not TaskLoop/Gateway wiring, persistence, active pilot approval, or completion authority.
