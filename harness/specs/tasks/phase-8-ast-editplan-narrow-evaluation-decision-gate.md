---
id: phase-8-ast-editplan-narrow-evaluation-decision-gate
title: Phase 8 AST EditPlan Narrow-Evaluation Decision Gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close P7 as an AST narrow-evaluation decision gate after narrowed P6, without expanding AST runtime behavior, product surfaces, workspace mutation, or task-completion authority.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-editplan-narrow-evaluation-decision-gate.md
  - tests/unit/runtime-ast-edit-plan-narrow-evaluation-decision-gate.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-narrow-evaluation-decision-gate/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-8-ast-editplan-narrow-evaluation-decision-gate.md
  - tests/unit/runtime-ast-edit-plan-narrow-evaluation-decision-gate.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-narrow-evaluation-decision-gate/**
  - runtime-research/handoffs/phase-8-ast-editplan-narrow-rule-replay-proof/**
  - runtime-research/handoffs/controlled-runtime-use-pilot-deep-validation/**
  - runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - P7 chooses exactly one final AST line state from keep_readonly_infrastructure_only, run_later_narrow_evaluation, or pause_ast_investment.
  - P7 records the selected decision as run_later_narrow_evaluation.
  - P7 preserves existing readonly/proof infrastructure and the accepted Registry controlled diagnostic consumer as the current controlled pilot direction.
  - P7 does not authorize current AST runtime pilot use, production readiness, default-on behavior, integration, persistence, workspace scanning, broad apply, symbol mutation, or task-completion evidence.
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
  - current usable AST runtime pilot, runtime readiness claims, production readiness claims, default-on approval, TaskLoop approval, Gateway approval, provider transport approval, workspace apply approval, or completion-evidence approval
  - TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, reviewer prompt insertion, model-message insertion, or runtime route integration
  - persistence, cache, database, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, workspace scan, repository-wide AST scan, broad workspace apply, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete, or patch apply outside controlled test-owned temporary targets
  - treating AST output, preview diff, apply result, replay proof, decision report, dry_run_ready, or applied as task-completion evidence
featureFlags:
  - No new runtime flag is required because P7 adds no runtime consumer.
  - Existing AST helpers remain explicit-call only.
  - Any later narrow evaluation requires a fresh accepted task spec with fixed allowlists, bounded source volume, false-positive measurement, review-time measurement, and cost-envelope proof.
rollback:
  - Remove the P7 task spec, P7 handoff docs, focused sentinel unit test, and runtime index update.
  - Existing AST helper behavior remains unchanged because this phase adds no production runtime code.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-narrow-evaluation-decision-gate.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-editplan-narrow-evaluation-decision-gate.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts tests/unit/runtime-ast-edit-plan-controlled-apply-pilot.test.ts tests/unit/runtime-ast-edit-plan-narrow-rule-replay-proof.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - git diff --check
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
acceptance:
  - Harness context and validation pass, or validation without --no-diff is blocked only by unrelated dirty tree state and --no-diff structural validation passes.
  - The P7 synthesis status is accepted_phase_8_ast_editplan_narrow_evaluation_decision_gate.
  - The P7 final decision is exactly run_later_narrow_evaluation.
  - P7 lists exactly the three allowed final AST line states: keep_readonly_infrastructure_only, run_later_narrow_evaluation, and pause_ast_investment.
  - P7 rejects current runtime pilot use, production readiness, default-on behavior, TaskLoop/Gateway/provider/prompt integration, workspace scan, broad workspace edit, symbol mutation, and task-completion evidence.
  - P7 says any later narrow evaluation must use a fresh accepted spec.
  - P7 keeps Registry as the current accepted controlled pilot direction.
  - No production runtime code, UI, Gateway, Main, renderer, host-api, api-client, provider transport, prompt/model-message, persistence, service, listener, daemon, or default-on behavior is added.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 8 AST EditPlan Narrow-Evaluation Decision Gate

P7 is a decision and closure gate for the AST line after narrowed P6. It chooses a final AST line state without adding runtime behavior.

Expected final wording:

```text
Status: accepted_phase_8_ast_editplan_narrow_evaluation_decision_gate
Decision: run_later_narrow_evaluation
```

Meaning: AST remains useful as explicit readonly/proof infrastructure. Future work may only be a separate narrow evaluation track with fixed allowlists, bounded source volume, false-positive measurement, review-time measurement, and cost-envelope proof. No runtime-use expansion is approved.
