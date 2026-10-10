---
lifecycleStatus: archived
id: phase-8-ast-editplan-astgrep-readonly-candidate-generation
title: Phase 8 AST EditPlan ast-grep Readonly Candidate Generation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the corrected AST route phase 2 as a real ast-grep readonly candidate-generation adapter that accepts caller-owned explicit TypeScript/TSX targets and emits EditPlan IR plus diagnostics only, preserving AST as structured code-edit planning and not runtime intelligence, runtime optimization, runtime authority, or task-completion evidence.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-editplan-astgrep-readonly-candidate-generation.md
  - openclaw_runtime/src/runtime-core/ast-grep-edit-plan-adapter.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/fixtures/ast-grep-edit-plan/**
  - tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts
  - tests/unit/runtime-ast-edit-plan-foundation.test.ts
  - tests/unit/runtime-ast-patch-planner-route-correction.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-astgrep-readonly-candidate-generation/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-8-ast-editplan-astgrep-readonly-candidate-generation.md
  - openclaw_runtime/src/runtime-core/ast-grep-edit-plan-adapter.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/fixtures/ast-grep-edit-plan/**
  - tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts
  - tests/unit/runtime-ast-edit-plan-foundation.test.ts
  - tests/unit/runtime-ast-patch-planner-*.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-astgrep-readonly-candidate-generation/**
  - runtime-research/ast-grep/rule-structure.md
  - runtime-research/ast-grep/patch-flow.md
  - runtime-research/ast-grep/useful-tests.md
  - runtime-research/ast-grep/clawx-mapping.md
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged when the adapter is not explicitly called.
  - Adapter input is caller-owned, explicit, bounded, and in-memory for this phase.
  - The adapter supports TypeScript/TSX ast-grep-style pattern/fix candidate generation and returns EditPlan IR plus bounded diagnostics.
  - Candidate generation is deterministic, bounded, fail-closed, readonly, non-authoritative, and not task-completion evidence.
  - The existing TypeScript/TSX text matcher remains a prototype/fallback safety skeleton and is not expanded into the corrected production engine.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - patch apply, file write, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete, or mutating planner behavior
  - TaskLoop automatic AST invocation, TaskLoop decision authority, TaskLoop completion authority, checkpoint authority, lifecycle authority, reviewer prompt insertion, or model-message insertion
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, or default provider registration integration
  - default-on AST behavior, automatic adapter invocation, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport
  - treating ast-grep results, readonly scan output, EditPlan output, preview diff text, preview diff hash, match count, or candidate text as verifier evidence for completed edits
  - renderer direct IPC or direct Gateway HTTP/WebSocket
featureFlags:
  - No new runtime flag is required for this adapter because it is an explicit in-memory helper only.
  - Existing runtime.astPatchPlanner.readonlyScan and runtime.astPatchPlanner.previewDiff remain default false by omission for the prototype helper.
  - Any later adapter gate must be explicit, disabled by default, reversible, and unable to enable apply, workspace edit, symbol mutation, TaskLoop invocation, Gateway/Main/renderer route, provider transport, prompt insertion, completion authority, persistence, service/listener/daemon behavior, or default-on behavior.
rollback:
  - Stop calling the ast-grep adapter and discard any in-memory candidate output.
  - Remove the adapter file, focused tests, fixtures, spec, and handoff entry without touching TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, AgentMap, Symbol, or Evidence Verifier paths.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-astgrep-readonly-candidate-generation.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-editplan-astgrep-readonly-candidate-generation.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-foundation.test.ts tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts tests/unit/runtime-ast-patch-planner-rule-validation.test.ts tests/unit/runtime-ast-patch-planner-resume-drift.test.ts tests/unit/runtime-ast-patch-planner-contracts.test.ts
  - pnpm --config.verify-deps-before-run=false run tsgo:core
  - pnpm --config.verify-deps-before-run=false run comms:replay
  - pnpm --config.verify-deps-before-run=false run comms:compare
  - git diff --check
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|workspaceEdit|applyPatch|ast-grep.*apply|rename|replaceBody|insertBefore|insertAfter|safeDelete" openclaw_runtime/src/runtime-core/ast-grep-edit-plan-adapter.ts openclaw_runtime/src/runtime-core/ast-edit-plan.ts tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts harness/specs/tasks/phase-8-ast-editplan-astgrep-readonly-candidate-generation.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/ast-grep-edit-plan-adapter.ts openclaw_runtime/src/runtime-core/ast-edit-plan.ts tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts harness/specs/tasks/phase-8-ast-editplan-astgrep-readonly-candidate-generation.md docs/dev/runtime-research-boundaries.md
acceptance:
  - Harness context and validation pass, or validation without --no-diff is blocked only by unrelated dirty tree state and --no-diff structural validation passes.
  - The adapter emits EditPlan IR through the phase 1 EditPlan shape and does not bypass or replace EditPlan.
  - The adapter accepts only caller-owned explicit in-memory targets in this phase and rejects missing, globbed, or unbounded targets.
  - Fixtures cover React prop rename, API call migration, import rewrite, Electron IPC route rename, deprecated option removal, invalid rule, overbroad rule, overlap conflict, and drift/fingerprint mismatch.
  - Tests prove deterministic ordering, bounded output, fail-closed invalid/overbroad handling, non-authoritative apply eligibility, source hash/checkpoint drift diagnostics, and no file mutation.
  - The current TypeScript/TSX text matcher remains documented and tested as prototype/fallback safety skeleton only.
  - The runtime index records phase 2 status without widening authority.
  - README.md, README.zh-CN.md, and README.ja-JP.md are reviewed; no product docs update is required unless behavior, flows, or interfaces become user-visible.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 8 AST EditPlan ast-grep Readonly Candidate Generation

This phase implements only the corrected AST route's readonly candidate-generation slice:

```text
AgentMap/Symbol-selected explicit targets
  -> real ast-grep readonly candidate generation
  -> EditPlan IR plus diagnostics
```

It does not implement apply, workspace edit, symbol mutation, TaskLoop/Gateway/Main/renderer integration, provider transport changes, prompt/model-message insertion, persistence, services, or default-on behavior. EditPlan output and ast-grep results are planning diagnostics only and are not task-completion evidence.
