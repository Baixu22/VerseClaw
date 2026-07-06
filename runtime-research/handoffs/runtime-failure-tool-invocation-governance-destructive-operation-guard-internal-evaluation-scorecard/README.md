# Runtime Failure Tool Invocation Governance Destructive Operation Guard Internal Evaluation Scorecard

Status: internal_evaluation_scorecard_continue_with_separate_spec_not_production_ready.

## Scope

This handoff adds an offline 0-100 scorecard for the `destructive_operation_guard` line.

The scorecard combines:

- existing fixture/holdout evidence
- Phase D trigger and rollback checks
- boundary scan evidence
- sanitized local transcript metadata feedback

It does not connect to active runtime behavior, UI, Gateway, TaskLoop, provider transport, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, renderer code, or scripts.

## Current Result

Current local sanitized-feedback run:

- aggregate score: 93/100
- decision: `continue_with_separate_accepted_spec`
- real-data feedback: warning, 8/15
- production/default-on readiness: not approved

The local transcript scan observed one transcript and two parsed records, but no tool invocation or preflight candidate metadata. That is useful as parser feedback, but the real-data dimension remains a hardening target.
