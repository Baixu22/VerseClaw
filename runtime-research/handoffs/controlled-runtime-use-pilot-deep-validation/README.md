# Controlled Runtime-Use Pilot Deep Validation

Status: accepted_registry_pilot_ast_current_pilot_needs_revision

## Purpose

This package validates the remaining readiness gaps before choosing the next direction. It compares:

- AST explicit readonly candidate generation.
- Registry controlled diagnostic consumption.

The goal is to determine which direction is more stable, more likely to create positive operator value, and less likely to slow the system or increase runtime cost.

## Hypotheses

| Direction | Hypothesis | Risk |
|---|---|---|
| Registry diagnostic consumer | Higher stability and lower runtime cost because it consumes already-produced diagnostics and summarizes bounded evidence. | Lower direct code-editing value; diagnostics must prove operator usefulness. |
| AST readonly candidate generation | Higher direct code-change planning value when rules are narrow and explicit. | Higher cost and false-positive risk as scanned source volume grows; still cannot apply or prove task completion. |
| Parallel pilot | Useful only if both lines stay independent and default-off. | Coupling the lines would create confusing authority and cost surfaces. |

## Test Surface

Executable proof lives in `tests/unit/runtime-controlled-runtime-use-deep-validation.test.ts`.

The suite checks:

- default-off behavior for both pilots;
- AST narrow-rule candidate value;
- AST cost/failure behavior under larger source volume;
- AST fail-closed behavior for invalid, overbroad, invalid target, and gated-off inputs;
- Registry bounded aggregate diagnostic value;
- Registry low-cost summary behavior;
- Registry provider ordering and legacy authority stability.

## Acceptance Criteria

- Default-off behavior is unchanged for both directions.
- AST must fail closed for invalid, ambiguous, oversized, and gated-off cases.
- Registry must summarize mixed diagnostic outcomes without changing provider order or authority.
- Registry collection should stay low-cost on representative diagnostic batches.
- AST scan cost must remain bounded, but any larger source-volume case that exceeds match limits should be treated as review-required rather than positive readiness.

## Acceptance Decision

Registry is accepted as the next controlled pilot direction.

AST is not accepted as a current usable pilot direction. The readonly helper remains useful research/runtime-core infrastructure, but the pilot route must be revised before any implementation slice proceeds.

Disposition:

- Abandon broad AST pilot or any parallel pilot that treats AST as equally ready.
- Preserve AST readonly helper and existing boundary tests.
- Optimize only as a later narrow-rule evaluation track with strict budgets, explicit target lists, human review, and measured false-positive/review-cost results.
- Continue forbidding apply, workspace edit, symbol mutation, completion evidence, TaskLoop/Gateway/provider transport authority, and default-on behavior.
