# Runtime Failure Tool Invocation Governance Destructive Operation Guard Holdout Regression Expansion

Status: holdout_regression_expanded_not_readiness_review.

## Scope

This Phase E handoff expands false-block holdout/regression coverage for the Phase D default-off `destructive_operation_guard` preflight pilot.

The phase is tests/docs only. It does not change runtime implementation, TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint/lifecycle state, Electron services, renderer behavior, or scripts.

## Holdout Categories

The focused holdout test covers:

- expected edit
- expected deletion
- normal completed repair
- completed test repair
- sanitized/inconclusive touched path
- legitimate fixture mutation
- slow test command
- known dev-server-like long-running metadata

Expected deletion is the sharpest regression guard: it may include deleted touched-path metadata and Phase 5 future block metadata, but it remains non-blocking when `wrong_file_edit` and `unnecessary_edit` are passing.

## Pilot Invariants

The Phase D pilot remains:

- default-off
- owned only by mutation-capable tool invocation preflight
- driven only by explicit sanitized preflight candidate metadata
- unable to block on deleted touched-path metadata alone
- unable to block on slow command metadata alone
- unable to block on known dev-server-like metadata alone
- reversible by disabling or omitting `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`

## Stop Line

This phase records holdout results only. It does not start Phase F readiness review and does not promote the pilot to production/default-on behavior.
