---
lifecycleStatus: archived
id: role-first-memory-governance-v6
title: Role-first memory real utility governance v6
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add real-data memory usefulness feedback, utility reports, and a compact Quality UI without writing native OpenClaw memory.
touchedAreas:
  - openclaw_runtime/src/memory/**
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - electron/services/workspace-permissions.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/types/memory.ts
  - shared/i18n/locales/**
  - tests/unit/role-memory-v2.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/e2e/role-memory-panel.spec.ts
  - docs/clawx-design-overview.md
  - harness/specs/**
expectedUserBehavior:
  - Users can record helpful, neutral, harmful, missing-needed, or corrected feedback for role-memory injection/card usefulness.
  - Users can inspect a Quality tab that shows sample size, data quality, missing evidence, real aggregate metrics, and per-card utility state.
  - Metrics that lack enough real data show null/insufficient evidence rather than fabricated scores.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/role-memory-v2.test.ts tests/unit/role-orchestration-methods.test.ts
  - pnpm exec playwright test tests/e2e/role-memory-panel.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - memory.feedback is registered as operator.write and records explicit utility feedback.
  - memory.feedbackList, memory.utilityReport, and memory.evalReport are registered as operator.read methods.
  - Utility reports use real feedback, injection, review, conflict, and retention state; taskSuccessDelta remains null without paired eval data.
  - Role Memory UI mutations still use hostApi.gateway.rpc only and never direct IPC or direct Gateway HTTP.
  - Native OpenClaw memory remains a read-only evidence layer; no MEMORY.md, QMD, dreaming, memorySearch index, or old memory-cards.json mutation is introduced.
docs:
  required: true
  note: Update docs/clawx-design-overview.md with v6 real utility loop and Quality UI.
---

# Role-First Memory Governance v6

## Summary

Add a real utility loop to Role Memory without turning native OpenClaw memory into a second writable source of truth.

Role Memory remains the governed runtime context layer. Native memory remains a read-only evidence/material layer. v6 measures usefulness only from real stored signals: injection explain logs, card/proposal/conflict state, retention suggestions, review outcomes, and explicit user/reviewer feedback.

## Required Rules

- `gateway-backend-communication`

## Scope

- Add feedback records for card/injection usefulness.
- Add utility/eval reports that return `null` and missing-evidence explanations when data is insufficient.
- Add read/write gateway RPC registration with correct operator scopes.
- Add a compact Quality surface to the Roles/Agents Role Memory UI.
- Keep renderer traffic on `hostApi.gateway.rpc`.
- Do not migrate, read, delete, or modify old `memory-cards.json`.
- Do not write `MEMORY.md`, QMD, dreams, or the native memorySearch index.

## Acceptance Criteria

- `memory.feedback` records explicit feedback with outcome, optional injection/card ids, role, task success label, actor, and timestamp.
- `memory.feedbackList` lists feedback by role/card/injection/outcome.
- `memory.utilityReport` computes metrics only from real local data and never fabricates task success deltas.
- `memory.evalReport` may include a selector dry run but must use the same runtime selection path as `memory.simulateInjection`.
- Reports expose `dataQuality` and `missingEvidence`; missing memory-on/off eval pairs keep `taskSuccessDelta = null`.
- Quality UI shows sample size, real metric values, missing evidence, and per-card utility state.
- Injection history lets users record helpful/harmful/missing/corrected feedback.
- All user-visible strings are i18n-covered for `en`, `zh`, `ja`, and `ru`.

## Validation

```text
pnpm run typecheck
pnpm exec vitest run tests/unit/role-memory-v2.test.ts tests/unit/role-orchestration-methods.test.ts
pnpm exec vitest run tests/unit/role-spawn.test.ts tests/unit/role-runtime-mvp.test.ts tests/unit/workspace-permissions.test.ts tests/unit/gateway-permissions-api.test.ts
pnpm exec playwright test tests/e2e/role-memory-panel.spec.ts
pnpm harness validate --spec harness/specs/tasks/role-first-memory-governance-v6.md
pnpm harness run --spec harness/specs/tasks/role-first-memory-governance-v6.md --dry-run
pnpm run comms:replay
pnpm run comms:compare
```
