# A3 completion admission evidence

- driven_by: agent; actor: codex/autonomy-a3
- Contract: `harness/specs/tasks/autonomy-task-completion.md`
- Typed route: `hostApi.taskLedger.submitCompletion`; ledger event type remains `status_changed`.
- Completion is admitted only when task, candidate digest, generation, verifier digest, and applied effect digest all match.
- `verification-receipt.json`: commands, exits, counts, acceptance mapping, negatives, cleanup, and unmeasured boundaries.
- `completion-admission-matrix.json`: positive/negative decision matrix.
- No production default, product lock, release verdict, or human evidence changes.
