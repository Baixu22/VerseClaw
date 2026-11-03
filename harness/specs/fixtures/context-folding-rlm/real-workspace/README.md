# Context Folding Real Task Workspace

This directory is a frozen, deliberately small Python workspace used for an agent-driven real task. It is not a production module and must not be edited in place during evaluation.

## Task

Fix the task-board transition bug so that completing an already-completed task is idempotent: no second revision and no duplicate completion event.

Run:

```text
python -m unittest discover -s tests -v
```

## Context

The repository includes large legacy notes and logs. They are intentionally noisy, include stale claims, and must not override source/tests. Prefer exact source and test evidence. The current test suite starts red; the expected final state has all tests green.

## Evaluation

Copy this workspace to `D:/tmp/context-folding-real-task-<runId>` before running the task. Keep the original fixture unchanged and write evidence outside the fixture.
