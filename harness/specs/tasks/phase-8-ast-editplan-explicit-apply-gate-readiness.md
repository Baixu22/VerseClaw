---
id: phase-8-ast-editplan-explicit-apply-gate-readiness
title: Phase 8 AST EditPlan Explicit Apply Gate Readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the corrected AST route phase 4 as a pure bounded explicit apply gate readiness helper that accepts an existing EditPlan IR, phase 3 Evidence Verifier readiness report, EvidenceVerifierReport, current source fingerprints, and explicit operator approval, while preserving AST as structured code-edit planning only.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-editplan-explicit-apply-gate-readiness.md
  - openclaw_runtime/src/runtime-core/ast-edit-plan-apply-gate-readiness.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts
  - tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts
  - tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts
  - tests/unit/runtime-evidence-verifier-contracts.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-explicit-apply-gate-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-8-ast-editplan-explicit-apply-gate-readiness.md
  - openclaw_runtime/src/runtime-core/ast-edit-plan-apply-gate-readiness.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan-evidence-verifier-readiness.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan.ts
  - openclaw_runtime/src/runtime-core/evidence-verifier.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts
  - tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts
  - tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts
  - tests/unit/runtime-evidence-verifier-contracts.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-explicit-apply-gate-readiness/**
  - runtime-research/handoffs/phase-8-ast-editplan-evidence-verifier-readiness/README.md
  - runtime-research/handoffs/phase-8-ast-editplan-astgrep-readonly-candidate-generation/README.md
  - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/**
  - runtime-research/ast-grep/patch-flow.md
  - runtime-research/ast-grep/clawx-mapping.md
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged when the helper is not explicitly called.
  - The helper accepts only an existing EditPlan IR, phase 3 readiness report, EvidenceVerifierReport, current source/preview/plan fingerprints, and explicit operator approval.
  - Output is an ApplyGateReadinessReport with an ApplyGateDecision of blocked, review_required, or approved_for_explicit_apply.
  - approved_for_explicit_apply is only a readiness result for a later controlled explicit apply pilot; it does not apply patches, write files, edit workspaces, mutate symbols, or prove task completion.
  - The helper is deterministic, bounded, pure, in-memory, fail-closed, and explicit-call only.
  - Preview diffs, match counts, candidate text, EditPlan output, Evidence Verifier reports, and ApplyGateReadinessReport output remain planning diagnostics only and are not task-completion evidence.
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
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, or direct renderer IPC/Gateway integration
  - default-on AST behavior, automatic apply gate invocation, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport
  - executing lint, typecheck, tests, shell commands, diagnostics, or workspace scans from helper runtime behavior
  - treating preview diff, match count, candidate text, readonly scan result, ast-grep result, EditPlan output, Evidence Verifier report, apply gate readiness output, or approved_for_explicit_apply as task-completion evidence
featureFlags:
  - No new runtime flag is required because the helper is an explicit pure in-memory helper only.
  - Existing Evidence Verifier shadow and pilot flags remain unchanged; this phase consumes only caller-provided report values.
  - Any later patch apply, runtime consumer, active gate, TaskLoop/Gateway/Main/renderer route, provider transport, prompt/model-message insertion, persistence, service/listener/daemon behavior, or default-on behavior requires a fresh accepted task spec.
rollback:
  - Stop calling the helper and discard any in-memory apply gate readiness output.
  - Remove the helper, export, focused tests, task spec, and handoff/index updates without touching TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, AgentMap, Symbol, or Evidence Verifier runtime behavior.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-explicit-apply-gate-readiness.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-editplan-explicit-apply-gate-readiness.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - git diff --check
  - rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|workspaceEdit|applyPatch|ast-grep.*apply|rename|replaceBody|insertBefore|insertAfter|safeDelete" openclaw_runtime/src/runtime-core/ast-edit-plan-apply-gate-readiness.ts tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts harness/specs/tasks/phase-8-ast-editplan-explicit-apply-gate-readiness.md
  - rg -n "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|completion evidence|task-completion evidence" openclaw_runtime/src/runtime-core/ast-edit-plan-apply-gate-readiness.ts tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts harness/specs/tasks/phase-8-ast-editplan-explicit-apply-gate-readiness.md
acceptance:
  - Harness context and validation pass, or validation without --no-diff is blocked only by unrelated dirty tree state and --no-diff structural validation passes.
  - A runtime-core helper produces ApplyGateReadinessReport / ApplyGateDecision without executing commands or mutating workspace state.
  - Missing or invalid EditPlan input fails closed.
  - Missing explicit operator approval fails closed.
  - Evidence Verifier failure or missing report fails closed.
  - Source hash, preview diff hash, plan fingerprint, and match range drift fail closed.
  - Conflict diagnostics block readiness.
  - Non-ready phase 3 readiness report remains review-required or blocked.
  - Authority boundary drift fails closed.
  - Over-budget or unsupported operations fail closed.
  - Missing required verifier requirements fail closed.
  - Deterministic ordering and bounded output are covered by focused unit tests.
  - Runtime index records phase 4 status without widening authority.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 8 AST EditPlan Explicit Apply Gate Readiness

This phase implements only the corrected AST route explicit apply gate readiness layer:

```text
Evidence Verifier readiness
  -> explicit apply gate readiness report
  -> later separate controlled explicit apply pilot
```

It does not implement patch apply, workspace edit, symbol mutation, runtime integration, provider transport changes, prompt/model-message insertion, persistence, services, or default-on behavior. Apply gate readiness output is diagnostics/planning-only and cannot prove task completion.
