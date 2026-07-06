# Phase 8 AST EditPlan Narrow-Evaluation Decision Gate

Status: accepted_phase_8_ast_editplan_narrow_evaluation_decision_gate

Decision: run_later_narrow_evaluation

## Scope

P7 closes the narrowed AST evaluation line after P6. It is a decision gate only: docs, task spec, runtime index update, and sentinel test coverage. It adds no runtime behavior.

The accepted route remains:

```text
AgentMap/Symbol scope
  -> AST candidate plan
  -> Evidence Verifier readiness
  -> explicit apply gate
  -> controlled explicit apply pilot / proof-only replay
```

## Decision

Allowed final AST line states:

- keep_readonly_infrastructure_only
- run_later_narrow_evaluation
- pause_ast_investment

Final AST line state: run_later_narrow_evaluation.

This means P6 proved that ten fixed narrow-rule replay samples can pass, but deep validation still blocks AST as the current runtime pilot direction. AST remains useful as explicit readonly/proof infrastructure. Future work may only be a separate narrow evaluation track.

## Preserved Infrastructure

- Existing readonly AST helper.
- Existing ast-grep readonly adapter.
- Existing EditPlan IR.
- Existing Evidence Verifier readiness bridge.
- Existing explicit apply gate readiness helper.
- Existing controlled explicit apply pilot.
- Existing P6 narrow-rule replay proof.
- No new production runtime behavior.

## Rejected Outcomes

- Current usable AST runtime pilot: rejected.
- Production readiness: rejected.
- Default-on behavior: rejected.
- TaskLoop-Gateway-provider-prompt integration: rejected.
- TaskLoop/Gateway/Main/renderer/host-api/api-client integration: rejected.
- Provider transport or provider ordering changes: rejected.
- Prompt/model-message insertion: rejected.
- Persistence/cache/database/service/listener/daemon behavior: rejected.
- Workspace scan: not authorized.
- Broad workspace edit: not authorized.
- Symbol mutation: not authorized.
- Patch apply outside controlled test-owned temporary targets: not authorized.
- Task-completion evidence: not authorized.

AST output, preview diff, apply result, replay proof, decision report, dry-run result, or applied result cannot be treated as evidence that a user task is complete.

## Later Narrow Evaluation Entry

Any later narrow evaluation must use a fresh accepted task spec.

That future track must stay separate from runtime use and prove:

- fixed target-file allowlists;
- bounded source volume;
- false-positive measurement;
- review-time measurement;
- cost-envelope proof;
- fail-closed behavior for broad, ambiguous, over-budget, or invalid inputs.

## Current Pilot Direction

Registry controlled diagnostic consumer remains the current accepted controlled pilot direction.

AST does not proceed as a parallel current pilot. P7 allows only a later, narrower AST evaluation track under a new accepted spec.

## Validation

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-narrow-evaluation-decision-gate.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-editplan-narrow-evaluation-decision-gate.md`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-narrow-evaluation-decision-gate.test.ts`
- `pnpm --config.verify-deps-before-run=false run typecheck`
- `git diff --check`
