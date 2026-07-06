# Operator Runbook

Status: accepted for future execution.

## Before Future Execution

1. Confirm this package is `Status: accepted_line_b_agentmap_default_on_implementation_spec_gap_closure_default_on_still_forbidden`.
2. Confirm default-on allowed is no, default cutover allowed is no, and production-ready is no for this package.
3. Confirm the future execution task has its own accepted task spec.
4. Confirm default-off parity, leakage, persistence, provider ordering, authority, and telemetry privacy tests are selected.
5. Confirm comms replay/compare is selected if communication paths are touched.

## During Future Execution

Monitor bounded counters only:

- `leakage_count`
- `provider_ordering_drift`
- `reviewer_prompt_byte_drift`
- `fail_closed_count`
- `rollback_success_count`
- `persistence_count`
- `authority_escalation_count`

Do not collect raw candidate text, raw prompts, model messages, provider payloads, Gateway payloads, checkpoint bodies, lifecycle raw text, tool outputs, secrets, auth headers, or trace raw bodies.

## Rollback

Close any AgentMap prompt-candidate gate. Legacy reviewer prompt byte parity must be restored with no cleanup because no candidate/shadow/replay output is persisted.

## Incident Response

If any veto fires:

1. Close all AgentMap prompt-candidate gates.
2. Stop the future execution task.
3. Preserve bounded diagnostics and hashes only.
4. Record the failing gate in the synthesis.
5. Do not approve default cutover.
6. Do not declare production-ready status.
