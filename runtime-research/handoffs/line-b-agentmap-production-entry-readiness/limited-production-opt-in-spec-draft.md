# Limited Production Opt-in Spec Draft

This is a draft for the limited production opt-in operation after production-entry readiness acceptance. It is not default-on and not default cutover.

## Scope

- Internal allowlist only.
- Explicit per-session opt-in only.
- Maximum 50 sessions before review.
- Maximum 14 days before renewal.
- Manual approval required for each wave.
- No production opt-in UI.
- No default provider registration.
- No automatic AgentMapResult discovery/build/cache/reuse.

## Entry Criteria

- `synthesis.md` is `Status: accepted_for_limited_production_opt_in`.
- All hard gates pass.
- All veto gates pass.
- Score is at least 95/100.
- Rollback drill is 100 percent pass.
- Harness context/validate, focused tests, typecheck, and scans pass or have clean overlay proof.
- Comms replay/compare is run if communication paths are touched, otherwise skipped reason is explicit.

## Exit Criteria

- Completion of the approved sample window, or
- any veto trigger, or
- operator decision to stop, or
- missing required evidence.

Default-on/default cutover requires a future independent task spec, synthesis, validation, scorecard, and operator approval.
