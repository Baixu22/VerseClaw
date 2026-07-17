# Branch Reconciliation — 2026-07-17

## Scope

Compared against `main` at `836a8e2dd4a7fa5f4e10a0948316f1a8a1d251b8`.

## Decision

No listed branch is safe for direct merge. Delete local refs after recording this disposition. Do not delete remote refs in this pass.

| Branch | Tip date | Delta vs main | Decision | Reason |
|---|---:|---:|---|---|
| `backup/knowledge-ux-polish-pre-rebase-20260709` | 2026-07-07 | 12 commits / 2474 files / 651k insertions | discard | Backup snapshot; broad deletions/additions; merge-tree conflicts; no single bounded feature. |
| `codex/phase16-verify` | 2026-07-07 | 1 commit / 14 files | discard | Add/add conflicts in memory persistence and phase handoff; current main already contains later memory/DCS work. |
| `codex/runtime-intensity-v1` | 2026-07-06 | 3 commits / runtime conflicts | discard and replan | Core intensity runtime exists in current main; branch tests/docs target an obsolete base. |
| `codex/runtime-intensity-v1-pr-hygiene` | 2026-07-06 | 3 commits / 2439 files / 644k insertions | discard | Hygiene checkpoint contains unrelated historical snapshot and destructive drift. |
| `codex/runtime-token-savings-v2` | 2026-07-07 | 4 commits / runtime conflicts | discard and replan | Main contains evolved intensity/context-budget code; branch would reintroduce old docs/deletions and conflict with current runtime. |

## Preservation

- Tip SHAs are retained in Git reflogs and this record.
- Remote branches remain untouched.
- Any still-needed capability must be reimplemented as a new task from current `main`, with a new Phase task, tests, and evidence.

## Safety rule

Do not cherry-pick individual commits from these branches without a fresh task specification and a current-main regression test. Do not use merge conflict resolution as a substitute for feature revalidation.
