---
id: phase-8-ast-editplan-evidence-verifier-readiness
title: Phase 8 AST EditPlan Evidence Verifier Readiness Bridge
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the corrected AST route phase 3 as a pure bounded bridge from EditPlan IR / ast-grep readonly candidate plans into Evidence Verifier readiness diagnostics and verifier input, preserving AST as structured code-edit planning only and preserving Evidence Verifier as non-gating in this phase.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-editplan-evidence-verifier-readiness.md
  - openclaw_runtime/src/runtime-core/ast-edit-plan-evidence-verifier-readiness.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts
  - tests/unit/runtime-ast-edit-plan-foundation.test.ts
  - tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts
  - tests/unit/runtime-evidence-verifier-contracts.test.ts
  - tests/unit/runtime-evidence-verifier-collectors.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-evidence-verifier-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-8-ast-editplan-evidence-verifier-readiness.md
  - openclaw_runtime/src/runtime-core/ast-edit-plan-evidence-verifier-readiness.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan.ts
  - openclaw_runtime/src/runtime-core/ast-grep-edit-plan-adapter.ts
  - openclaw_runtime/src/runtime-core/evidence-verifier.ts
  - openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts
  - tests/unit/runtime-ast-edit-plan-foundation.test.ts
  - tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts
  - tests/unit/runtime-evidence-verifier-contracts.test.ts
  - tests/unit/runtime-evidence-verifier-collectors.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-evidence-verifier-readiness/**
  - runtime-research/handoffs/phase-8-ast-editplan-astgrep-readonly-candidate-generation/README.md
  - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/**
  - runtime-research/handoffs/phase-5-evidence-verifier/**
  - runtime-research/agent-runtime-core-spec.md
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged when the bridge is not explicitly called.
  - The bridge accepts only an existing EditPlan IR and returns readiness diagnostics plus an optional bounded Evidence Verifier input.
  - Readiness output is deterministic, bounded, pure, in-memory, fail-closed, and non-authoritative.
  - The bridge maps EditPlan verifierRequirements explicitly: source_hashes_present, match_ranges_present, ordered_operations_present, no_conflict_diagnostics, preview_diff_available, and evidence_verifier_review.
  - eligible_after_verification remains descriptive only; it does not apply patches, mutate workspace files, mutate symbols, or prove task completion.
  - Preview diffs, readonly candidate text, match counts, ast-grep results, EditPlan output, and readiness reports remain planning diagnostics only and are not task-completion evidence.
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
  - default-on AST behavior, automatic bridge invocation, active Evidence Verifier completion gate, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport
  - executing lint, typecheck, tests, shell commands, diagnostics, or workspace scans from bridge runtime behavior
  - treating preview diff, match count, candidate text, readonly scan result, ast-grep result, EditPlan output, verifier-readiness input, verifier-readiness report, or eligible_after_verification as task-completion evidence
featureFlags:
  - No new runtime flag is required because the bridge is an explicit pure in-memory helper only.
  - Existing Evidence Verifier shadow and pilot flags remain unchanged; this phase does not enable or consume them as gates.
  - Any later runtime consumer, active verifier gate, apply gate, TaskLoop/Gateway/Main/renderer route, provider transport, prompt/model-message insertion, persistence, service/listener/daemon behavior, or default-on behavior requires a fresh accepted task spec.
rollback:
  - Stop calling the bridge and discard any in-memory readiness output.
  - Remove the bridge helper, export, focused tests, task spec, and handoff/index updates without touching TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, AgentMap, Symbol, or Evidence Verifier runtime behavior.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-evidence-verifier-readiness.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-editplan-evidence-verifier-readiness.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-foundation.test.ts tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - git diff --check
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|workspaceEdit|applyPatch|ast-grep.*apply|rename|replaceBody|insertBefore|insertAfter|safeDelete" openclaw_runtime/src/runtime-core/ast-edit-plan-evidence-verifier-readiness.ts tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts harness/specs/tasks/phase-8-ast-editplan-evidence-verifier-readiness.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|completion evidence|task-completion evidence|completed" openclaw_runtime/src/runtime-core/ast-edit-plan-evidence-verifier-readiness.ts tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts harness/specs/tasks/phase-8-ast-editplan-evidence-verifier-readiness.md docs/dev/runtime-research-boundaries.md
acceptance:
  - Harness context and validation pass, or validation without --no-diff is blocked only by unrelated dirty tree state and --no-diff structural validation passes.
  - A runtime-core helper converts valid EditPlan IR into Evidence Verifier readiness diagnostics and a bounded verifier input/report shape without executing verification commands or mutating workspace state.
  - Missing source hashes fail closed as insufficient readiness.
  - Conflict diagnostics block readiness.
  - Missing preview diff remains pending/review-required rather than eligible.
  - Drift/fingerprint mismatch diagnostics prevent readiness.
  - Invalid or non-EditPlan input fails closed.
  - Readonly candidate text, preview diff metadata, match count, ast-grep result, EditPlan output, and readiness output are explicitly not task-completion evidence.
  - Deterministic ordering and bounded output are covered by focused unit tests.
  - Runtime index records phase 3 status without widening authority.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 8 AST EditPlan Evidence Verifier Readiness Bridge

This phase implements only the corrected AST route readiness bridge:

```text
EditPlan candidate plan
  -> Evidence Verifier readiness diagnostics / bounded verifier input bridge
  -> non-authoritative report
```

It does not implement patch apply, workspace edit, symbol mutation, runtime integration, active Evidence Verifier completion gates, provider transport changes, prompt/model-message insertion, persistence, services, or default-on behavior. Readiness output is diagnostics/planning-only and cannot prove task completion.
