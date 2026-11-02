# Context Folding / RLM Real Task Fixture

This fixture prepares an agent-driven real task for the `context-folding-rlm` worktree.

## Files

- `real-task.v1.json`: frozen prompt, flow assertions, oracle command and pre-registered eval thresholds.
- `real-workspace/`: a small Python repository with a real task-board idempotency bug and intentionally noisy legacy material.
- `oracle/verify.py`: deterministic checker for workspace tests plus the agent-produced `ContextFoldingEvalResult/v1` manifest.

## Run policy

1. Copy `real-workspace` to `D:/tmp/context-folding-real-task-<runId>`.
2. Never edit the checked-in fixture in place.
3. Run the baseline first; it must be red at `test_repeated_completion_is_idempotent`.
4. Run baseline, expand-only and folded-child against the same copied task.
5. The agent writes a result manifest with context events, evidence refs, usage and per-mode tests.
6. Run the oracle against the copied workspace and result manifest.
7. Retain raw runs under `D:/tmp` and curated final evidence under a tracked implementation path; the raw run is not a source of truth.

## Boundary

This is an agent-driven realistic task, not human traffic. It does not claim production release approval, live-provider quality when no live provider was used, or a second durable task truth. The checked-in workspace is a fixture; the implementation and acceptance must use a disposable copy.

## Initial red state

The fixture intentionally fails one test:

```text
python -m unittest discover -s tests -v
```

The expected final state is exit 0 with four passing tests and zero skips.
