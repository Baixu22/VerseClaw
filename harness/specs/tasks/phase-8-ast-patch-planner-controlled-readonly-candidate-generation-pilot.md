---
id: phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot
title: Phase 8 AST Patch Planner Controlled Readonly Candidate Generation Pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define the next AST Patch Planner pilot as explicit readonly candidate generation only, using caller-owned in-memory TypeScript/TSX targets and accepted readonly scan helpers while preserving no apply, no workspace edit, no TaskLoop/Gateway/Main/renderer route, no provider transport change, and no completion authority.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md
  - runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot/**
  - runtime-research/handoffs/controlled-runtime-use-pilot-readiness/**
  - tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md
  - runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot/**
  - runtime-research/handoffs/controlled-runtime-use-pilot-readiness/**
  - tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/ast-patch-planner.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-ast-patch-planner-contracts.test.ts
  - tests/unit/runtime-ast-patch-planner-rule-validation.test.ts
  - tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts
  - tests/unit/runtime-ast-patch-planner-resume-drift.test.ts
expectedUserBehavior:
  - Default runtime behavior remains unchanged when AST pilot calls are absent or flags are omitted.
  - Candidate generation is explicit-call only and requires caller-owned in-memory target file content.
  - Candidate output may include rule validation, ordered match evidence, bounded diagnostics, optional preview diff text/hash when explicitly enabled, and checkpoint/resume drift metadata.
  - Candidate output remains diagnostics/planning material and cannot prove task completion.
  - This AST pilot does not require registry diagnostics and does not authorize registry behavior.
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
  - AST patch apply, workspace edit, file write, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete, or mutating planner behavior
  - TaskLoop automatic AST invocation, TaskLoop decision authority, TaskLoop completion authority, checkpoint authority, lifecycle authority, reviewer prompt insertion, or model-message insertion
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, or default provider registration integration
  - default-on AST planner behavior, automatic planner invocation, persistence, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport
  - treating preview diff text, preview diff hash, match count, candidate text, or planner diagnostics as verifier evidence for completed edits
featureFlags:
  - runtime.astPatchPlanner.readonlyScan remains default false by omission and must be explicitly enabled by a caller-owned test or pilot harness.
  - runtime.astPatchPlanner.previewDiff remains default false by omission and may only emit diagnostic preview material.
  - Any future pilot-specific gate must be internal, explicit, disabled by default, reversible, and unable to enable apply, workspace edit, symbol mutation, TaskLoop invocation, Gateway/Main/renderer route, provider transport, prompt insertion, completion authority, persistence, service/listener/daemon behavior, or default-on behavior.
rollback:
  - Omit runtime.astPatchPlanner.readonlyScan and runtime.astPatchPlanner.previewDiff.
  - Stop calling readonly planner helpers and discard any in-memory candidate output.
  - Remove pilot docs/spec references without touching registry, AgentMap, Symbol, verifier, trace, memory, TaskLoop, Gateway, Main, renderer, host-api, or api-client paths.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md --no-diff
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md --no-diff
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-contracts.test.ts tests/unit/runtime-ast-patch-planner-rule-validation.test.ts tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts tests/unit/runtime-ast-patch-planner-resume-drift.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - pnpm --config.verify-deps-before-run=false run comms:replay
  - pnpm --config.verify-deps-before-run=false run comms:compare
  - rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|workspaceEdit|applyPatch|ast-grep.*apply|rename|replaceBody|insertBefore|insertAfter|safeDelete" openclaw_runtime/src/runtime-core/ast-patch-planner.ts tests/unit/runtime-ast-patch-planner*.test.ts tests/unit/runtime-controlled-runtime-use-*.test.ts harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot runtime-research/handoffs/controlled-runtime-use-pilot-readiness
  - rg -n "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/ast-patch-planner.ts tests/unit/runtime-ast-patch-planner*.test.ts tests/unit/runtime-controlled-runtime-use-*.test.ts harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot runtime-research/handoffs/controlled-runtime-use-pilot-readiness
  - rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
acceptance:
  - Prerequisite status is confirmed as accepted_runtime_use_prerequisites_complete.
  - Controlled readiness status is confirmed as accepted_controlled_runtime_use_readiness.
  - Phase 8 readonly scan synthesis remains Status: accepted.
  - The runtime index records the accepted readonly surface and does not widen authority.
  - The sample matrix includes AST success, no-match, invalid rule, overbroad pattern, unbound metavariable, overlapping range, resume drift, preview-diff-disabled, budget/limit, gated-off, renderer bypass, and runtime-authority sentinels.
  - The quantitative scorecard assigns AST pilot scores across usable value 25, current evidence strength 20, boundary safety 20, verification quantifiability 15, dependency maturity 10, and rollback/reversibility 10.
  - Hard veto gates block any default-on behavior, provider ordering drift, leakage, fail-closed rate below 100 percent, renderer bypass, AST mutation/apply/write surface, TaskLoop/Gateway/provider transport authority drift, rollback failure, or missing required validation without a blocked reason.
  - Harness context and structural validation pass for this pilot spec and predecessor AST specs.
  - Focused AST planner tests, controlled readiness boundary sentinels, pilot readiness doc sentinels, typecheck, comms replay, comms compare, and boundary scans pass or are recorded with a blocked reason.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot/README.md
    - runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot/validation-plan.md
    - runtime-research/handoffs/controlled-runtime-use-pilot-readiness/sample-matrix.md
    - runtime-research/handoffs/controlled-runtime-use-pilot-readiness/scorecard.md
    - runtime-research/handoffs/controlled-runtime-use-pilot-readiness/veto-gates.md
    - runtime-research/handoffs/controlled-runtime-use-pilot-readiness/synthesis.md
---

# Phase 8 AST Patch Planner Controlled Readonly Candidate Generation Pilot

This spec is independent from the registry pilot. It only defines explicit readonly AST candidate generation and does not authorize apply, mutation, TaskLoop/Gateway/Main/renderer integration, provider transport, prompt/model-message changes, persistence, services, or default-on behavior.
