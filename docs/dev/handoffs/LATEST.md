# FP-P4-08 handoff (2026-07-29)

## Current state

- Completed: `FP-P4-08` multi-platform and PR dependency-graph expansion decision.
- Verdicts: GitLab `shrink`; Gitee `stop`; stacked PR dependency DAG `shrink`; Merge Queue/Train `shrink`.
- No verdict is `continue`, so no adapter implementation or Task Forest proposal was created or applied.
- Next selected task: `FP-P4-05` unified C1 gate corpus. Keep the next session limited to that task.

## Decision evidence

- Human-readable decision: `artifacts/first-product-preview/FP-P4-08/decision.md`.
- Machine-readable source: `artifacts/first-product-preview/FP-P4-08/decision.json`.
- Every surface records demand, API fit, permission model, maintenance cost, security boundary, rationale, and objective review triggers.
- Human GitLab, Gitee, stacked-PR, and Queue/Train runs are all 0. No real provider credential or remote effect was used.
- The frozen MergeBeacon source proves candidate mechanics only: commit `14a17c7ecb821af4bdb645d5f492e7cf72bcd293`, tree `95fddba4593a879352a59de157db92c63afa819f`.

## Hard decisions

- GitLab remains a research-only read-first candidate until a named demand owner, target repository, sandbox, least-privilege PAT plan, and bounded read spike exist.
- Gitee has no active backlog. Reconsider only after named demand and a credential route that proves query tokens cannot reach generic URLs, logs, traces, errors, telemetry, or support bundles.
- A future DAG must preserve repository identity, cycle, truncated, and blocking-parent semantics. Incomplete graphs fail closed and grant no branch or PR mutation authority.
- Queue/Train may only become read-only status. Enqueue, dequeue, reorder, retry, approve, and merge remain forbidden.

## Validation

- Task spec: `harness/specs/tasks/remote-forge-expansion-decision.md`.
- Hard rule: `harness/specs/rules/remote-forge-expansion-boundary.md`.
- Focused evidence validator: `tests/unit/remote-forge-expansion-decision.test.ts`.
- Formal Harness `rules + fast + comms`: pass; lint 0 errors, node/web typecheck pass, root tests 6,443 passed, runtime tests 314 passed, comms replay/compare pass.
- README.md, README.zh-CN.md, and README.ja-JP.md were reviewed and do not need changes because product behavior, architecture, interfaces, and supported-provider claims did not change.

## Frozen boundaries

- Keep `liveReady=false`, `productApproved=false`, `defaultOn=false`, and Agent merge OFF.
- Do not implement GitLab, Gitee, DAG, or Queue/Train under `FP-P4-08`.
- Any future adapter requires a separate Task Forest proposal and explicit confirmation before apply.
- Do not start `FP-P4-03` or `FP-P4-04`; do not unblock `TF-0006`, `TF-0011`, or `TF-0014`.
- Fixture and engineering evidence is not human demand, live-provider value, clean-VM evidence, product approval, default-on readiness, or GA evidence.

## Local Git state

- Pre-consolidation backup remains at commit `92fd612bb` on branch `codex/p4-preconsolidation-backup`, worktree `C:\Users\27933\Desktop\clawx\ClawX-preconsolidation-backup`.
- Do not push or create a PR without new explicit authorization.
- `.agent-workbench/task-forest/` remains unchanged because there is no implementation-level continue verdict.
