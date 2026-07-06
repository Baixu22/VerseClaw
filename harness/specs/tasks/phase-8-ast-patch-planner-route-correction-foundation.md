---
id: phase-8-ast-patch-planner-route-correction-foundation
title: Phase 8 AST Patch Planner Route Correction Foundation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Re-anchor the AST line as a structured code-edit planning layer, not a runtime intelligence or optimization layer, and define the short-term foundation for EditPlan IR plus a real ast-grep adapter while preserving the current readonly/default-off safety boundary.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-patch-planner-route-correction-foundation.md
  - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/**
  - runtime-research/ast-grep/clawx-mapping.md
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-ast-patch-planner-route-correction.test.ts
touchedAreas:
  - harness/specs/tasks/phase-8-ast-patch-planner-route-correction-foundation.md
  - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/**
  - runtime-research/ast-grep/clawx-mapping.md
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-ast-patch-planner-route-correction.test.ts
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - AST remains explicit, readonly, diagnostics/planning-only, and non-authoritative.
  - The current TypeScript/TSX helper is documented as a prototype/fallback safety skeleton, not the corrected production engine.
  - The next implementation direction is EditPlan IR plus a real ast-grep adapter, fed by AgentMap/Symbol scope and verified by Evidence Verifier before any future apply gate.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - docs-sync
forbiddenPatterns:
  - describing AST as runtime intelligence, runtime optimization, runtime authority, TaskLoop authority, prompt/model-message authority, provider transport authority, or default-on behavior
  - treating preview diffs, match counts, candidate text, or route-correction docs as task-completion evidence
  - adding patch apply, file write, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete, service/listener/daemon, Gateway/Main/renderer/host-api/api-client route, provider transport, persistence, or external database behavior
featureFlags:
  - Existing runtime.astPatchPlanner.readonlyScan and runtime.astPatchPlanner.previewDiff remain default false by omission.
  - This route-correction foundation adds no new runtime flag and cannot enable apply behavior.
rollback:
  - Remove the route-correction docs/spec/test.
  - Existing readonly AST helper and tests remain valid because no runtime behavior is changed.
requiredTests:
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-route-correction.test.ts tests/unit/runtime-ast-patch-planner-contracts.test.ts tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts
acceptance:
  - The route-correction handoff states that AST is a structured code-edit planning layer, not a runtime intelligence or optimization layer.
  - The short-term implementation goal is documented as EditPlan IR plus a real ast-grep adapter, with the current TypeScript/TSX helper retained only as prototype/fallback safety skeleton.
  - The corrected pipeline is AgentMap/Symbol scope -> AST candidate plan -> Evidence Verifier -> explicit apply gate.
  - Agent runtime index points future AST work at route correction and blocks runtime authority expansion.
  - A unit sentinel fails if the route docs drift back toward runtime optimization, completion evidence, default-on, or apply authority claims.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/README.md
    - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/short-term-foundation.md
    - runtime-research/ast-grep/clawx-mapping.md
    - runtime-research/agent-runtime-index.md
---

# Phase 8 AST Patch Planner Route Correction Foundation

This spec does not approve new runtime behavior. It creates the short-term foundation for correcting the AST line: AST belongs to structured code-edit planning, after AgentMap/Symbol scope selection and before Evidence Verifier/apply gates.
