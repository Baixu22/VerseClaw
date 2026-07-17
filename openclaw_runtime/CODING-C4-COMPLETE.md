# CODING C4 COMPLETE (C4-H)

**Date**: 2026-07-15
**Completion class**: **`done (hard)`** — C4-H production-hardened git worktree lifecycle (opt-in)
**Defaults**: isolation **shared**, backend **inprocess** (unchanged)

## Hardening landed

- Path normalize + traversal reject
- Merge/cleanup exclusive lock with stale recovery
- Cleanup retries
- Windows long-path aware roots
- Real git worktree create/merge/cleanup acceptance

## Red lines

- Do **not** flip isolation default to worktree
- Do **not** flip worktree.backend default to git
- C4-P pnpm hardlink install remains residual

## Evidence

- `artifacts/coding-c4/acceptance.json`
- `openclaw_runtime/src/agents/worktree-service.test.ts`