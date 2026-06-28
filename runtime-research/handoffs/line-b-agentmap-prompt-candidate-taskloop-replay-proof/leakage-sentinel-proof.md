# Leakage Sentinel Proof

Status: accepted

Sentinel:

```text
AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK
```

Proof requirements:

- sentinel may appear only in focused tests;
- default reviewer prompt output must not contain the sentinel;
- fail-closed candidate metadata must not contain the sentinel;
- lifecycle/checkpoint default payloads must not contain the sentinel;
- candidate text must not enter Gateway, model messages, provider transport, or default TaskLoop reviewer prompt surfaces.

Expected scan:

```text
rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
```

Expected result: matches only focused test files.

Current status is accepted. The scan matched only focused test files.
