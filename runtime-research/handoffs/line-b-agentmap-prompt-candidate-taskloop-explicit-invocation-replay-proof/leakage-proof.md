# Leakage Proof

## Sentinel

Sentinel literal:

```text
AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK
```

The sentinel is intentionally used only in focused tests to prove fail-closed and default payload boundaries.

## Assertions

- Default and fail-closed reviewer prompts do not contain the sentinel.
- Candidate metadata serialized in fail-closed payloads does not contain the sentinel.
- TaskLoop lifecycle events do not contain the sentinel.
- TaskLoop checkpoint payloads do not contain the sentinel.
- Runtime shadow report payloads do not contain candidate text.
- The sentinel is absent from production `openclaw_runtime/src`, `electron`, `src`, and `shared` implementation paths.

## Result

Leakage proof passes. Candidate text appears only in the explicit named pilot reviewer prompt when all gates are enabled, explicit invocation is requested, and a valid explicit `AgentMapResult` is supplied.
