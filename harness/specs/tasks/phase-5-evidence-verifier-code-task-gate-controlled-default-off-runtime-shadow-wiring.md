---
id: phase-5-evidence-verifier-code-task-gate-controlled-default-off-runtime-shadow-wiring
title: Phase 5 Evidence Verifier Code Task Gate Controlled Default-Off Runtime Shadow Wiring
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add the smallest controlled default-off runtime wiring around real runtime completion metadata for the Evidence Verifier code-task shadow collection route, producing only caller-owned in-memory diagnostics without changing completion authority, legacy terminal state, Gateway/Main/renderer/host-api/api-client/IPC/WebSocket/provider transport, persistence, UI, or active gate behavior.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-controlled-default-off-runtime-shadow-wiring.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - openclaw_runtime/src/agents/**
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/task-loop-controller.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-controlled-default-off-runtime-shadow-wiring.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - openclaw_runtime/src/agents/**
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/task-loop-controller.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - Real runtime wiring is controlled, default-off, explicit, in-memory, diagnostic-only, and non-authoritative.
  - Disabled/default runtime wiring does not call the shadow collection/producer/caller/sampler path and does not require valid verifier reports or shadow inputs.
  - Explicit `shadow_only` wiring may call only the existing pure collection helper with bounded runtime-shaped metadata supplied by the runtime caller.
  - Wiring output is caller-owned and may be delivered only through an injected in-memory diagnostic sink or direct return path used by tests; it must not persist, emit UI state, mutate runtime state, or enter model prompts/messages.
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
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, or user-visible runtime transport changes
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, log reads, transcript reads, or verifier runtime behavior from the wiring/helper
  - patch apply, file write, workspace edit, symbol mutation, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport from the wiring/helper
  - treating collection output, producer output, caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, `would_allow`, `would_block`, or `risky_allow` as task-completion evidence
featureFlags:
  - Any runtime wiring switch added in this slice must default off by omission and by explicit `disabled`.
  - The only enabled behavior allowed in this slice is explicit `shadow_only` diagnostic collection.
  - A later active pilot or product flag spec is required before any enforcement, persistence, UI, or default-on behavior.
rollback:
  - Disable or stop calling the wiring entry point; default runtime completion behavior remains unchanged.
  - Remove wiring types/functions/tests without touching completion authority.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-controlled-default-off-runtime-shadow-wiring.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-controlled-default-off-runtime-shadow-wiring.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts
  - focused TaskLoop/agent wiring unit coverage if an `openclaw_runtime/src/agents/**` path is touched
  - git diff --check -- touched route files
  - node scripts/scan-pattern.mjs --pattern "Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" touched route files
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|spawn|exec\\(|vitest|eslint|tsc|pnpm" touched runtime helper/wiring files
acceptance:
  - Disabled/default runtime wiring does not invoke collection/producer/caller/sampler and leaves completion decisions unchanged.
  - Explicit `shadow_only` runtime wiring invokes only the existing collection helper with bounded in-memory runtime-shaped samples.
  - Wiring output includes non-authority fields and proves `completionAuthority: false`, `runtimeDecisionUnaffected: true`, and `legacyDecisionUnaffected: true`.
  - Invalid explicit runtime wiring input fails closed without granting completion authority.
  - Focused tests prove disabled/default no-op behavior, explicit diagnostic collection behavior, invalid input, and no completion-state mutation.
  - No forbidden transport, persistence, prompt/model-message, service/listener, or active authority pattern is introduced.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 5 Evidence Verifier Code Task Gate Controlled Default-Off Runtime Shadow Wiring

This slice may connect real runtime completion-shaped metadata to the existing bounded shadow collection helper:

```text
real runtime completion metadata
  -> explicit default-off runtime wiring
  -> bounded collection helper only in shadow_only mode
  -> caller-owned diagnostic result or injected in-memory sink
```

It is not an active gate, persistence layer, UI surface, transport change, or completion authority.
