# Leakage Proof

Status: pass.

Claim: AgentMap candidate text does not enter default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, checkpoint payloads, lifecycle payloads, provider ordering, or runtime decisions.

Evidence:

- Runtime shadow reports use hashes, lengths, counts, booleans, and bounded diagnostics.
- Focused tests use `AGENTMAP_COMPONENT_BOUNDARY_SENTINEL_DO_NOT_LEAK` and keep it out of fail-closed payloads and telemetry-like reports.
- The only allowed insertion path is the explicit named pilot surface, not default runtime behavior.

Count: `leakage_count = 0`.
