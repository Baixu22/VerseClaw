---
id: phase-8-ast-editplan-controlled-explicit-apply-pilot
title: Phase 8 AST EditPlan Controlled Explicit Apply Pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the corrected AST route phase 5 as a strictly bounded controlled explicit apply pilot that accepts an existing EditPlan IR, Phase 4 ApplyGateReadinessReport, current fingerprints, explicit operator approval, and caller-owned explicit targets, while preserving default-off non-runtime AST behavior.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-editplan-controlled-explicit-apply-pilot.md
  - openclaw_runtime/src/runtime-core/ast-edit-plan-controlled-apply-pilot.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-ast-edit-plan-controlled-apply-pilot.test.ts
  - tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts
  - tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts
  - tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts
  - tests/unit/runtime-evidence-verifier-contracts.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-controlled-explicit-apply-pilot/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-8-ast-editplan-controlled-explicit-apply-pilot.md
  - openclaw_runtime/src/runtime-core/ast-edit-plan-controlled-apply-pilot.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan-apply-gate-readiness.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan-evidence-verifier-readiness.ts
  - openclaw_runtime/src/runtime-core/ast-edit-plan.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-ast-edit-plan-controlled-apply-pilot.test.ts
  - tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts
  - tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts
  - tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts
  - tests/unit/runtime-evidence-verifier-contracts.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-controlled-explicit-apply-pilot/**
  - runtime-research/handoffs/phase-8-ast-editplan-explicit-apply-gate-readiness/README.md
  - runtime-research/handoffs/phase-8-ast-editplan-evidence-verifier-readiness/README.md
  - runtime-research/handoffs/phase-8-ast-editplan-astgrep-readonly-candidate-generation/README.md
  - runtime-research/handoffs/phase-8-ast-editplan-ir-foundation/README.md
  - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/**
  - runtime-research/ast-grep/patch-flow.md
  - runtime-research/ast-grep/clawx-mapping.md
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged when the helper is not explicitly called.
  - The helper accepts only an existing EditPlan IR, Phase 4 ApplyGateReadinessReport, current source/preview/match fingerprints, explicit operator approval, caller-owned explicit targets, and bounded apply options.
  - The helper returns a ControlledApplyPilotReport with a ControlledApplyDecision of blocked, dry_run_ready, or applied.
  - dryRun true returns planned rewritten content hashes, per-file summaries, and diagnostics only; it does not write files.
  - dryRun false writes only to explicit caller-owned target file paths when every gate passes and allowWrite is true.
  - Only replace_range operations are supported; match_only and future unknown operations fail closed.
  - The helper applies operations in a deterministic descending range order per file and rejects overlapping ranges.
  - Source hash, preview diff hash, match range fingerprint, target content hash, match excerpt, operator approval scope, apply gate decision, conflict diagnostics, operation budget, authority boundary, and caller target presence are all rechecked before any write.
  - Write failure is reported as failed/blocked and cannot be masked as partial success.
  - Apply output remains pilot diagnostics only and is not task-completion evidence.
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
  - workspace scan, file discovery, default-on AST behavior, automatic apply invocation, or runtime route integration
  - TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, reviewer prompt insertion, or model-message insertion
  - rename, replaceBody, insertBefore, insertAfter, safeDelete, file creation, directory creation, file deletion, broad workspace edit, symbol mutation, or mutating planner behavior
  - executing formatter, lint, typecheck, tests, shell commands, diagnostics, workspace scans, ast-grep apply, or verifier runtime behavior from helper runtime behavior
  - persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport
  - treating preview diff, match count, candidate text, readonly scan result, ast-grep result, EditPlan output, Evidence Verifier report, ApplyGateReadinessReport output, ControlledApplyPilotReport output, dry_run_ready, or applied as task-completion evidence
featureFlags:
  - No new runtime flag is required because the helper is explicit-call only and has no runtime consumer.
  - Existing Evidence Verifier and apply gate readiness flags remain unchanged; this phase consumes only caller-provided report values.
  - Any later TaskLoop/Gateway/Main/renderer/host-api/api-client route, provider transport, prompt/model-message insertion, persistence, service/listener/daemon behavior, default-on behavior, or full internal replay requires a fresh accepted task spec.
rollback:
  - Stop calling the helper and discard any in-memory controlled apply pilot output.
  - Remove the helper, export, focused tests, task spec, and handoff/index updates without touching TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, AgentMap, Symbol, or Evidence Verifier runtime behavior.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-controlled-explicit-apply-pilot.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-editplan-controlled-explicit-apply-pilot.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-controlled-apply-pilot.test.ts tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - git diff --check
  - rg -n "mkdir|rm\\(|unlink|createWriteStream|workspaceEdit|applyPatch|ast-grep.*apply|rename|replaceBody|insertBefore|insertAfter|safeDelete" openclaw_runtime/src/runtime-core/ast-edit-plan-controlled-apply-pilot.ts tests/unit/runtime-ast-edit-plan-controlled-apply-pilot.test.ts harness/specs/tasks/phase-8-ast-editplan-controlled-explicit-apply-pilot.md
  - rg -n "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|completion evidence|task-completion evidence" openclaw_runtime/src/runtime-core/ast-edit-plan-controlled-apply-pilot.ts tests/unit/runtime-ast-edit-plan-controlled-apply-pilot.test.ts harness/specs/tasks/phase-8-ast-editplan-controlled-explicit-apply-pilot.md
acceptance:
  - Harness context and validation pass, or validation without --no-diff is blocked only by unrelated dirty tree state and --no-diff structural validation passes.
  - A runtime-core helper produces ControlledApplyPilotReport / ControlledApplyDecision without scanning workspaces or integrating runtime routes.
  - Missing or invalid EditPlan input fails closed.
  - Missing or invalid ApplyGateReadinessReport fails closed.
  - ApplyGateDecision other than approved_for_explicit_apply fails closed.
  - Missing explicit operator approval fails closed.
  - Operator approval scope drift fails closed.
  - Source hash, preview diff hash, match range, target content, and match excerpt drift fail closed.
  - Overlapping ranges fail closed.
  - match_only and unsupported operations fail closed.
  - Operation budget exhaustion fails closed.
  - Conflict diagnostics fail closed.
  - Authority boundary drift fails closed.
  - Missing caller-owned target fails closed.
  - dryRun false requires explicit allowWrite true.
  - Write failure reports blocked/failed and cannot masquerade as success.
  - Deterministic ordering, bounded output, dry-run approved path, applied approved path, and non-completion evidence markers are covered by focused unit tests.
  - Runtime index records phase 5 status without widening authority.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-8-ast-editplan-controlled-explicit-apply-pilot/README.md
    - runtime-research/agent-runtime-index.md
---

# Phase 8 AST EditPlan Controlled Explicit Apply Pilot

This phase implements only the corrected AST route controlled explicit apply pilot:

```text
explicit apply gate readiness
  -> controlled explicit apply pilot
  -> later separate full internal replay / boundary tightening
```

It can rewrite only caller-owned explicit targets after all fingerprints, approval scopes, and Phase 4 gate readiness are rechecked. It does not add runtime consumers, default behavior, TaskLoop/Gateway/Main/renderer/host-api/api-client routes, provider transport changes, prompt/model-message insertion, persistence, services, or task-completion evidence.
