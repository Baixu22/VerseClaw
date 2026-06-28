# Replay Results

Status: pass.

Expected metrics:

| Metric | Required | Observed |
|---|---:|---:|
| Corpus cases | at least 100 | 154 |
| Pass count | 100 percent | 154/154 |
| Fail-closed invalid/missing/gated-off | 100 percent | 100 percent |
| Rollback pass | 100 percent | 100 percent |
| Leakage count | 0 | 0 |
| Provider ordering drift | 0 | 0 |
| Default reviewer prompt byte drift | 0 | 0 |
| Candidate persistence | 0 | 0 |
| Authority escalation | 0 | 0 |

Focused validation command:

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-default-on-deep-validation.test.ts tests/unit/runtime-agent-map-production-entry-readiness.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/task-loop-controller.test.ts
```

Result: pass, 4 files / 76 tests.
