# Telemetry Privacy Boundary

Status: pass.

## Forbidden Raw Data

Telemetry must not include:

- raw candidate text;
- raw prompt;
- model message;
- provider payload;
- Gateway payload;
- checkpoint body;
- lifecycle raw text;
- tool output;
- secret;
- auth header;
- trace raw body.

## Allowed Data

Telemetry may include:

- `leakage_count`;
- `provider_ordering_drift`;
- `reviewer_prompt_byte_drift`;
- `fail_closed_count`;
- `rollback_success_count`;
- `persistence_count`;
- `authority_escalation_count`;
- booleans for gate states and parity states;
- SHA-256 hashes;
- string lengths;
- token estimates;
- bounded diagnostic codes.

## Proof

The implementation-spec focused test constructs a sentinel AgentMap result, converts the runtime shadow report into a telemetry-like payload using only counters, booleans, hashes, lengths, and bounded diagnostic codes, and asserts that the payload contains none of the sentinel or forbidden raw payload strings.

Result: telemetry privacy proof passes for the spec package. Production telemetry wiring remains a future execution task and must repeat this proof.
