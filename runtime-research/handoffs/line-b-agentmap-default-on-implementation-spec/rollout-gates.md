# Future Rollout Gates

Status: future-only gates.

## Gate 0: Implementation Spec Accepted

This package must remain `Status: accepted_line_b_agentmap_default_on_implementation_spec_gap_closure_default_on_still_forbidden` with score at least 95 and no vetoes.

## Gate 1: Fresh Execution Task

Default-on implementation execution must start from a new accepted task spec. This package does not execute implementation.

## Gate 2: Default-Off Parity

Omitted gates, disabled gates, invalid input, malformed input, missing input, exhausted budget, and prompt-present exclusions must restore legacy reviewer prompt byte parity.

## Gate 3: Telemetry Privacy

Telemetry must be default-off, diagnostics-only, raw-text-free, and no-persistence-by-default.

## Gate 4: Boundary Proof

Provider ordering, persistence, renderer/Main/Gateway/API boundaries, services/listeners/databases/servers, mutation/apply/edit surfaces, checkpoint surfaces, lifecycle surfaces, and authority surfaces must remain unchanged.

## Gate 5: Operator Readiness

Operators must have a bounded aggregate report, rollback instructions, and veto criteria before any production rollout.

## Gate 6: Separate Cutover Approval

Default cutover requires a later explicit cutover task. Passing implementation execution is not cutover approval.
