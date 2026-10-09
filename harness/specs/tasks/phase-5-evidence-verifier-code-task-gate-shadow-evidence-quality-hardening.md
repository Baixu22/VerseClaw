---
id: phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening
title: Phase 5 Evidence Verifier Code Task Gate Shadow Evidence Quality Hardening
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the next bounded shadow-evidence investment slice after limited default-off readiness entry tightening by adding a pure in-memory quality report helper and focused tests, without active enforcement, completion authority, persistence, product config, UI, transport, prompt/model-message, checkpoint/lifecycle, or TaskLoop terminal-state changes.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-limited-default-off-readiness-spec/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No TaskLoop, Mission, Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, prompt/model-message, checkpoint, lifecycle, persistence, UI, product config, retry, approval, repair, or tool-policy behavior changes.
  - The new helper consumes only caller-supplied in-memory evaluation, runtime replay readiness, and internal observation reports.
  - The new helper may recommend only ready_for_limited_default_off_readiness_review, continue_internal_shadow_observation_hardening, or stop_or_freeze_route.
  - Any ready decision is readiness-review only; it does not approve active enforcement, default enablement, completion blocking, runtime cutover, product config, persistence, UI, transport changes, prompt/model-message insertion, or completion proof from diagnostics.
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
  - active code-task completion gate, active pilot approved, active enforcement approved, default-on verifier gate, default enablement, completion authority, TaskLoop completion authority, Mission completion authority, checkpoint authority, lifecycle authority, reviewer prompt insertion, or model-message insertion
  - Gateway, Main, renderer, host-api, api-client, IPC, WebSocket, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, public API, or user-visible runtime transport changes
  - persistence, database, cache, file writes from runtime helpers, transcript reads, log reads, workspace scans, services, listeners, daemons, local HTTP servers, second Gateway, second runtime, external database, collector, exporter, or sidecar behavior
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, tools, patch apply, workspace edits, message sends, or transport calls from runtime helper behavior
  - treating collection output, observation output, replay/readiness output, producer output, caller results, shadow reports, sampler events, EvidenceVerifierReport, missing evidence, would_allow, would_block, risky_allow, quality output, or readiness output as task-completion evidence
featureFlags:
  - No runtime or product config flag is added by this task.
  - Existing TaskLoop shadow collection remains off by omission and disabled mode.
  - The new quality helper is explicit-call only and has no default runtime invocation.
  - Any active enforcement, persistence, UI, product config, default-on behavior, or completion authority requires a later fresh accepted spec with stronger runtime shadow evidence.
rollback:
  - Stop calling the new pure quality report helper.
  - Remove the helper/tests/docs without touching TaskLoop completion authority.
  - No runtime rollback, schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client rollback, prompt rollback, checkpoint rollback, lifecycle rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/task-loop-controller.test.ts
  - git diff --check -- harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "active pilot approved|active enforcement approved|completionAuthority:\\s*true|default-on verifier gate|default enablement|reviewer prompt insertion|model-message insertion" harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|spawn|exec\\(|readFile|transcript|log|database|cache|service|listener|daemon|sidecar|exporter|collector" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-evidence-quality-hardening.md docs/dev/runtime-research-boundaries.md
acceptance:
  - The helper is pure, deterministic, explicit-call only, and consumes only caller-supplied in-memory reports.
  - The helper output keeps nonAuthoritative true, completionAuthority false, runtimeDecisionUnaffected true, legacyDecisionUnaffected true, and activePilotRequiresFreshSpec true.
  - The helper output may recommend only ready_for_limited_default_off_readiness_review, continue_internal_shadow_observation_hardening, or stop_or_freeze_route.
  - Missing evaluation, runtime replay, or observation input routes to continue_internal_shadow_observation_hardening, not readiness review.
  - Blocked runtime replay or stop/freeze observation input routes to stop_or_freeze_route.
  - Passing quality output does not approve active pilot, default enablement, completion blocking, TaskLoop/Mission terminal-state changes, persistence, UI, product config, transport changes, prompt/model-message insertion, or completion proof from diagnostics.
  - Focused tests cover ready, hardening, and stop/freeze quality decisions.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 5 Evidence Verifier Code Task Gate Shadow Evidence Quality Hardening

This slice implements the first concrete investment after entry tightening:

```text
existing in-memory evaluation/replay/observation reports
  -> pure shadow evidence quality report
  -> readiness review / continued hardening / route freeze
```

It does not implement active enforcement, completion authority, product config, persistence, UI, transport, prompt/model-message insertion, checkpoint/lifecycle authority, or default-on runtime behavior.
