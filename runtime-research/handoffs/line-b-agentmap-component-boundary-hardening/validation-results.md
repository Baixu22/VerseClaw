# Validation Results

Status: pass with unrelated dirty-tree blockers recorded.

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-component-boundary-hardening.test.ts tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts tests/unit/runtime-agent-map-default-on-deep-validation.test.ts tests/unit/runtime-agent-map-production-entry-readiness.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```

## Boundary Scans

Required scans cover AgentMap flags/runtime usage, renderer direct IPC/Gateway, sentinel leakage, provider ordering, persistence APIs, service/listener/database/server creation, mutation/apply/edit, default-on/default cutover/production-ready wording, authority terms, README/i18n docs sync, and touched Main/Gateway/host-api/api-client/provider transport paths.

## Current Record

- Corpus: 64/64 pass.
- Rollback: pass.
- Leakage proof: pass, `leakage_count = 0`.
- Provider ordering proof: pass, `provider_ordering_drift = 0`.
- Persistence proof: pass, `candidate_persistence = 0`.
- Authority boundary proof: pass, `authority_escalation = 0`.
- Telemetry boundary: pass.
- Comms replay/compare: skipped unless communication paths are touched.

## Live Commands

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md`: passed.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md`: blocked by unrelated dirty-tree changes outside this task's touched areas.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md --no-diff`: passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-component-boundary-hardening.test.ts tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts tests/unit/runtime-agent-map-default-on-deep-validation.test.ts tests/unit/runtime-agent-map-production-entry-readiness.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/task-loop-controller.test.ts`: passed, 7 files / 88 tests.
- `pnpm --config.verify-deps-before-run=false run typecheck`: failed on unrelated `src/lib/host-api.ts` dirty-tree edits, `SystemScanPayload` and `SystemDeleteItemsPayload` missing from imports.

## Clean Overlay Proof

The live dirty tree already contains broad unrelated changes. The normal harness validate failure names many files outside this task's owned surface. The typecheck failure is in `src/lib/host-api.ts`, which is not part of this AgentMap boundary hardening package. The new focused suite compiles and passes, and `harness validate --no-diff` validates this spec structurally.

This package touched only:

- `harness/specs/tasks/phase-line-b-agentmap-component-boundary-hardening.md`
- `runtime-research/handoffs/line-b-agentmap-component-boundary-hardening/**`
- `tests/unit/runtime-agent-map-component-boundary-hardening.test.ts`
- `runtime-research/agent-runtime-index.md`
