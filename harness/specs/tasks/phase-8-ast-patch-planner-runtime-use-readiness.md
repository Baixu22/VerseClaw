---
id: phase-8-ast-patch-planner-runtime-use-readiness
title: Phase 8 AST Patch Planner Runtime-Use Readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Validate whether the accepted AST Patch Planner readonly scan MVP is ready for the next controlled runtime-use slice: explicit readonly planner candidate generation only, with no apply, mutation, TaskLoop invocation, Gateway/Main/renderer route, or completion authority.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md
  - harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md
  - runtime-research/handoffs/runtime-use-prerequisites.md
  - runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md
  - harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md
  - runtime-research/handoffs/runtime-use-prerequisites.md
  - runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/ast-patch-planner.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-ast-patch-planner-contracts.test.ts
  - tests/unit/runtime-ast-patch-planner-rule-validation.test.ts
  - tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts
  - tests/unit/runtime-ast-patch-planner-resume-drift.test.ts
  - tests/fixtures/ast-patch-planner/**
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - AST planner runtime-use readiness is limited to explicit caller-owned readonly candidate generation.
  - Candidate output may include rule validation, ordered match evidence, bounded diagnostics, preview diff text/hash when explicitly enabled, and checkpoint/resume drift metadata.
  - Candidate output remains diagnostic/planning material only and cannot apply patches, edit workspaces, mutate symbols, invoke TaskLoop automatically, alter Gateway/Main/renderer/host-api/api-client paths, or prove task completion.
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
  - patch apply, file write, workspace edit, symbol mutation, rename, replace body, insert before/after, safe delete, or any AST mutation authority
  - TaskLoop automatic AST invocation, TaskLoop decision authority, TaskLoop completion authority, reviewer prompt insertion, model-message insertion, or checkpoint/lifecycle authority changes
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, or default provider registration integration
  - default-on AST planner behavior, automatic planner invocation, persistence, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, or external database
  - treating preview diffs, match counts, candidate text, or planner diagnostics as verifier evidence for completed code edits
featureFlags:
  - runtime.astPatchPlanner.readonlyScan remains default false by omission.
  - runtime.astPatchPlanner.previewDiff remains default false by omission.
  - No feature flag may enable patch apply, workspace edit, symbol mutation, TaskLoop invocation, Gateway/Main/renderer route, provider transport, prompt insertion, completion authority, or default-on behavior.
rollback:
  - Omit runtime.astPatchPlanner.readonlyScan and runtime.astPatchPlanner.previewDiff.
  - Stop calling readonly planner helpers.
  - Remove candidate-generation docs/spec references without affecting AgentMap, Symbol, registry, verifier, trace, memory, TaskLoop, Gateway, Main, renderer, host-api, or api-client paths.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md --no-diff
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-contracts.test.ts tests/unit/runtime-ast-patch-planner-rule-validation.test.ts tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts tests/unit/runtime-ast-patch-planner-resume-drift.test.ts
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - pnpm --config.verify-deps-before-run=false run comms:replay
  - pnpm --config.verify-deps-before-run=false run comms:compare
  - rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|workspaceEdit|applyPatch|ast-grep.*apply|rename|replaceBody|insertBefore|insertAfter|safeDelete" openclaw_runtime/src/runtime-core/ast-patch-planner.ts tests/unit/runtime-ast-patch-planner*.test.ts harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md docs/dev/runtime-research-boundaries.md
  - rg -n "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/ast-patch-planner.ts tests/unit/runtime-ast-patch-planner*.test.ts harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md docs/dev/runtime-research-boundaries.md
  - rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
acceptance:
  - The prerequisite status is confirmed as accepted_runtime_use_prerequisites_complete.
  - The Phase 8 readonly scan synthesis remains Status: accepted.
  - The runtime index points to the accepted readonly surface and does not claim apply, workspace edit, TaskLoop/Gateway/Main/renderer integration, prompt/model-message insertion, provider transport, completion authority, persistence, service/listener/daemon, or default-on behavior.
  - Harness context and structural validation pass for this readiness spec and the predecessor readonly-scan spec.
  - Focused AST planner tests pass.
  - Controlled runtime-use boundary sentinels pass and prove no AST mutation/apply/write export, source API, transport bypass, TaskLoop/Gateway invocation, or completion-authority drift.
  - Typecheck and comms replay/compare pass.
  - Boundary scans have no unclassified forbidden implementation matches.
  - The readiness doc records a final status of accepted_controlled_runtime_use_readiness or needs_revision with command and boundary evidence.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 8 AST Patch Planner Runtime-Use Readiness

This spec validates the next allowed AST slice after the accepted readonly scan MVP. It only permits explicit readonly planner candidate generation and does not authorize apply, workspace edit, symbol mutation, runtime authority, TaskLoop/Gateway/Main/renderer integration, provider transport, prompt/model-message insertion, persistence, services, or default-on behavior.
