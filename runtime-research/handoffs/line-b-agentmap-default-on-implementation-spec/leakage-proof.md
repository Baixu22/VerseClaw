# Leakage Proof

Status: pass.

## Claim

Candidate text does not enter default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, checkpoint payloads, lifecycle payloads, provider ordering, or runtime decisions.

## Evidence

- Readiness corpus leakage count: 0.
- Runtime shadow reports store hashes, lengths, counts, status, and bounded diagnostics rather than candidate content.
- TaskLoop tests keep AgentMap sentinel text out of reviewer prompts, lifecycle events, checkpoints, and runtime shadow report JSON.
- Implementation-spec focused test uses `AGENTMAP_IMPLEMENTATION_SPEC_SENTINEL_DO_NOT_LEAK` to verify fail-closed and telemetry-like payloads do not retain raw candidate text.

## Decision

Leakage proof is sufficient for implementation-spec acceptance. Future runtime execution must repeat sentinel scans after code changes.
