# Leakage Proof

Sentinels:

- `AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK`
- `AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK`

## Required Non-leak Surfaces

| Surface | Result | Evidence |
|---|---|---|
| Default reviewer prompt | pass | Fail-closed tests assert legacy prompt bytes and no sentinel. |
| Model messages | pass | No code path inserts candidate text into model messages. |
| Gateway/provider transport | pass | Metadata marks no Gateway/provider cutover; scans required. |
| Lifecycle payload | pass | TaskLoop tests assert lifecycle event JSON omits candidate sentinel. |
| Checkpoint payload | pass | TaskLoop tests assert checkpoint JSON omits candidate sentinel. |
| Runtime shadow text fields | pass | Shadow report stores hash/length/counts only; production-entry sentinel test asserts no text retention. |
| Explicit named pilot surface | allowed only when all gates and explicit invocation/result pass | `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`. |

## Evidence

Existing tests cover `AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK`. `tests/unit/runtime-agent-map-production-entry-readiness.test.ts` adds `AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK` coverage for fail-closed TaskLoop pilot payloads and runtime shadow reports.

Leakage count: 0.
