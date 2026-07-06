# Phase 8 AST EditPlan Narrow-Evaluation Decision Gate Synthesis

Status: accepted_phase_8_ast_editplan_narrow_evaluation_decision_gate

Decision: run_later_narrow_evaluation

## Summary

P7 is accepted as a decision and closure gate for AST after narrowed P6. It does not add runtime code, runtime consumers, product surfaces, workspace mutation, or task-completion authority.

P6 proved ten fixed narrow-rule replay samples across readonly candidate generation, EditPlan IR, Evidence Verifier readiness, explicit apply gate readiness, controlled dry-run, and controlled test-owned temporary apply. That proof is useful, but it does not overturn the deep-validation result: AST is not the current usable runtime pilot direction.

## Allowed Final AST Line States

- keep_readonly_infrastructure_only
- run_later_narrow_evaluation
- pause_ast_investment

Selected final AST line state: run_later_narrow_evaluation.

## Meaning

AST remains useful as explicit readonly/proof infrastructure. Future work may only be a separate narrow evaluation track with fixed allowlists, bounded source volume, false-positive measurement, review-time measurement, and cost-envelope proof.

No runtime-use expansion is approved.

## Explicit Rejections

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

AST output, preview diff, apply result, replay proof, decision report, dry-run result, and applied result remain non-authoritative diagnostics/proof artifacts. They cannot prove that a task is complete.

## Preserved Surface

- Existing readonly AST helper.
- Existing ast-grep readonly adapter.
- Existing EditPlan IR.
- Existing Evidence Verifier readiness bridge.
- Existing explicit apply gate readiness helper.
- Existing controlled explicit apply pilot.
- Existing P6 narrow-rule replay proof.
- No new production runtime behavior.

## Required Future Entry Gate

Any later narrow evaluation must use a fresh accepted task spec.

That spec must keep the track separate from TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, prompts, model messages, persistence, services, listeners, daemons, workspace scan, broad workspace edits, symbol mutation, and task-completion evidence.

## Pilot Direction

Registry controlled diagnostic consumer remains the current accepted controlled pilot direction.

AST remains a structured code-edit planning layer only.
