# TF-0405 P1 Evaluation

This directory retains the task-level receipt for TF-0405. The evidence is
agent-driven and covers only the task-level cache/poll takeover:

- Git status concurrency and cache-hit behavior: `tests/unit/git-api.test.ts`.
- Git write invalidation through the mutation adapter and direct commit.
- Renderer scheduler visibility, no-overlap, QoS and shed behavior:
  `tests/unit/resource-p1-schedulers.test.ts`.
- Typecheck, contract, Harness and repository-artifact gates recorded in
  `acceptance.json`.

The reusable probe is retained for provenance, but plain Node cannot execute the
Electron service graph because those modules use extensionless TypeScript
imports. No timing or spawn-count values are inferred from that failed probe.

TF-0398's five-minute spawn reduction target is **not** claimed here. It needs
a real Main-process spawn counter, which remains a TF-0421 prerequisite.
