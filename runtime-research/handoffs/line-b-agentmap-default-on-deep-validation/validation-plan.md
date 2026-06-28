# Validation Plan

Scope: default-on proposal readiness only. Default-on/default cutover remain forbidden.

Validation steps:

1. Confirm prior production-entry package is `accepted_for_limited_production_opt_in`.
2. Add focused deep-validation tests covering a replay corpus of at least 100 cases.
3. Prove default-off legacy parity, fail-closed behavior, rollback gates, leakage count, provider ordering, non-persistence, and authority boundaries.
4. Run harness context/validate, focused Vitest, typecheck, and required scans.
5. Keep final status below `ready_for_default_on_proposal` unless every gate passes and score is at least 95.

Communication-path commands `comms:replay` and `comms:compare` are required only if this task touches Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, or fallback behavior.
