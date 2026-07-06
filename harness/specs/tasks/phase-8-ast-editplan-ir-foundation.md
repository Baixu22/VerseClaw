---
id: phase-8-ast-editplan-ir-foundation
title: Phase 8 AST EditPlan IR Foundation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define the first corrected AST route implementation slice as an EditPlan IR contract and readonly scan conversion layer, while keeping the existing TypeScript/TSX matcher prototype-only and preserving no apply, no workspace edit, no TaskLoop/Gateway/provider/prompt/default-on behavior.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-editplan-ir-foundation.md
  - openclaw_runtime/src/runtime-core/ast-edit-plan.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-ast-edit-plan-foundation.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-ir-foundation/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-8-ast-editplan-ir-foundation.md
  - openclaw_runtime/src/runtime-core/ast-edit-plan.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-ast-edit-plan-foundation.test.ts
  - tests/unit/runtime-ast-patch-planner-*.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-ir-foundation/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - AST remains explicit, readonly, diagnostics/planning-only, and non-authoritative.
  - EditPlan IR describes candidate patch plans, verifier requirements, preview metadata, and apply eligibility without applying patches.
  - The current TypeScript/TSX text matcher remains a prototype/fallback safety skeleton, not the corrected production AST engine.
  - Phase 1 maps readonly scan results and future adapter outputs into EditPlan IR only.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - docs-sync
forbiddenPatterns:
  - adding patch apply, file write, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete, service/listener/daemon, Gateway/Main/renderer/host-api/api-client route, provider transport, provider ordering, prompt/model-message insertion, persistence/cache/database, or default-on behavior
  - treating preview diffs, match counts, candidate text, readonly scan results, or EditPlan output as task-completion evidence
  - describing the current TypeScript/TSX text matcher prototype as the corrected production AST engine
  - introducing a real ast-grep adapter in this phase
featureFlags:
  - Existing runtime.astPatchPlanner.readonlyScan and runtime.astPatchPlanner.previewDiff remain default false by omission.
  - This phase adds no runtime feature flag and cannot enable apply behavior.
rollback:
  - Remove the EditPlan IR module, export, focused tests, task spec, and handoff/index updates.
  - Existing readonly AST helper and route-correction tests remain valid because no runtime behavior is changed.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-ir-foundation.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-editplan-ir-foundation.md --no-diff
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-foundation.test.ts tests/unit/runtime-ast-patch-planner-route-correction.test.ts tests/unit/runtime-ast-patch-planner-contracts.test.ts tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts tests/unit/runtime-ast-patch-planner-resume-drift.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
acceptance:
  - Runtime-core defines EditPlan IR fields for schemaVersion, planId, engineId, source/mode, sourceScope, targetFiles, sourceHashes, match evidence including AST kind/range/excerpt hash, ordered edit operations, conflict diagnostics, preview diff metadata, verifier requirements, applyEligibility, authority boundary, and evidenceRefs.
  - A conversion helper maps scanAstPatchPlannerReadonly results into EditPlan IR without changing scan behavior.
  - applyEligibility is descriptive only and supports ineligible, review_required, and eligible_after_verification.
  - Conversion can represent unfixable rules, disabled preview diff, and overlap/review_required diagnostics.
  - The route-correction sentinel still passes.
  - Agent runtime index records this Phase 1 foundation without widening authority.
  - Boundary scans show no unexplained apply/write/workspace edit/symbol mutation/runtime integration authority.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/README.md
    - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/short-term-foundation.md
    - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/next-phase-prompt.md
    - runtime-research/ast-grep/rule-structure.md
    - runtime-research/ast-grep/patch-flow.md
    - runtime-research/ast-grep/clawx-mapping.md
    - runtime-research/agent-runtime-index.md
---

# Phase 8 AST EditPlan IR Foundation

This phase implements only the first corrected AST route foundation:

```text
AST readonly scan result / future adapters -> EditPlan IR
```

It preserves the full corrected route positioning:

```text
AgentMap/Symbol scope -> AST candidate plan -> Evidence Verifier -> explicit apply gate
```

The output is a structured planning contract. It is not apply authority, runtime authority, completion evidence, or a production ast-grep adapter.
