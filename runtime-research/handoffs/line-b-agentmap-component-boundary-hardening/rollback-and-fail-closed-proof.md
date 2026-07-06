# Rollback And Fail-Closed Proof

Status: pass.

Rollback gate closure remains 100 percent. Closing any AgentMap prompt-candidate gate restores legacy reviewer prompt bytes.

Fail-closed cases remain 100 percent:

- omitted config
- malformed config
- gated-off config
- explicit invocation omitted
- missing AgentMapResult
- malformed AgentMapResult
- prompt-present file exclusion
- candidate budget exhaustion

Counts:

- `default_off_legacy_parity = 100%`
- `fail_closed = 100%`
- `rollback_gate_closure = 100%`
- `default_reviewer_prompt_byte_drift = 0`

Decision: rollback is sufficient for a development pause boundary. It is not approval for default-on.
