# Context Folding Real-Task Eval

<!-- driven_by: agent; actor: codex/context-folding-rlm -->

Run `cfr-20261103-final` is the TF-0695 acceptance evidence for the copied real Python task. The checked-in fixture stayed unchanged, and the raw disposable workspace is at `D:/tmp/context-folding-real-task-cfr-20261103-final`.

## Result

| Gate | Evidence | Result |
|---|---|---|
| Initial red state | `baseline-red.log` | exit 1; 4 ran, 1 failed at `test_repeated_completion_is_idempotent` |
| Baseline task tests | `baseline-tests.log` | exit 0; 4 passed, 0 failed, 0 skipped |
| Expand-only task tests | `expand-only-tests.log` | exit 0; 4 passed, 0 failed, 0 skipped |
| Folded-child task tests | `folded-child-tests.log` | exit 0; 4 passed, 0 failed, 0 skipped |
| Oracle | `oracle.log` | exit 0: PASS |
| Required evidence refs | distinct source + test child handles | 2/2 resolved; 100% |
| Scope / stale refs | `run-result.json` | 0 / 0 |
| Raw child transcript | projected child result | 0 chars; not injected |
| Recursive depth | folded result | 1 |
| Parent context reduction | 81,943 -> 154 chars | 99.8% |
| Local token proxy | 20,486 -> 1,201 | 0.059x |
| Local latency | 148 -> 155 ms | 1.047x |
| Cost | no live provider | `costUsd: null` |

The baseline/expand-only runs use the same frozen task state after the real code fix is established; this measures context strategy on one correctly fixed task rather than conflating the pairing with a second code edit. Token values are explicit `ceil(chars/4)` local estimates, not provider billing. No live-model semantic-quality claim is made.

## Files

- `run-result.json`: `ContextFoldingEvalResult/v1` manifest with context events, usage, evidence and unresolved claims.
- `patch.diff`: the actual source fix applied only in the disposable copy.
- `baseline-red.log`, `baseline-tests.log`, `expand-only-tests.log`, `folded-child-tests.log`: preserved process output.
- `oracle.log`: output from the final deterministic oracle invocation.
- `SHA256SUMS`: integrity list for every evidence file except itself.

Reproduce with:

```powershell
$env:TEMP='D:\tmp'; $env:TMP='D:\tmp'; $env:CF_EVAL_RUN_ID='cfr-20261103-final'
node .\openclaw_runtime\node_modules\tsx\dist\cli.mjs .\scripts\context-folding-real-task-eval.mjs
python -B .\harness\specs\fixtures\context-folding-rlm\oracle\verify.py --workspace D:\tmp\context-folding-real-task-cfr-20261103-final --result .\harness\specs\fixtures\context-folding-rlm\eval\run-result.json
```

## Boundary

This is agent-driven local fixture execution. It is not human evidence, live-provider quality, production release approval, or a claim that a live child model chose the same fix. The code fix and tests are real; the fold and expansion events come from the shipped TypeScript functions over the copied fixture.

## Provenance and credential scan

- driven_by: agent
- actor: codex/context-folding-rlm
- fixture tree digest: `sha256:01bf03ca823ad3953c211654eeb6c8fe37064e52546e661a0c51e835515cf08c` (unchanged before/after run)
- credential scan scope: eval runner, curated eval directory, and oracle verifier
- credential scan checks: private key, AWS access key, GitHub token, OpenAI-style key, Slack token, assigned secret; 0 hits
- `SHA256SUMS` verifies every listed evidence file; every digest matched on final readback
