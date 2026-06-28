# Leakage Proof

Sentinels:

- `AGENTMAP_DEFAULT_ON_DEEP_VALIDATION_CANDIDATE_SENTINEL_DO_NOT_LEAK`
- `AGENTMAP_PRODUCTION_ENTRY_SENTINEL_DO_NOT_LEAK`
- `AGENTMAP_DEFAULT_ON_SENTINEL_DO_NOT_LEAK`

Required non-leak surfaces:

| Surface | Requirement |
|---|---|
| Default reviewer prompt | Sentinel absent when default-off or fail-closed. |
| Default TaskLoop reviewer prompt | Byte-identical legacy output in all non-explicit-pilot cases. |
| Model messages | No candidate insertion path. |
| Gateway/provider transport | No candidate insertion path. |
| Lifecycle/checkpoint payloads | No candidate text in default/fail-closed payloads. |
| Runtime shadow | Hash/length diagnostics only; no candidate text retention. |
| Explicit pilot surface | Allowed only under all gates plus explicit invocation plus valid AgentMapResult. |

Leakage count target: 0.
