# CODING Hardening Backlog (post-closeout)

**Updated**: 2026-07-15  
Only residuals after C4–C7 capability land.

| ID | Item | Priority | Status |
|---|---|---|---|
| C1-L | Live A/B + flag graduation | P1 | blocked on env (Goal C residual reaffirmed) |
| C3-F | Richer planner fileHints fill (no free-text invent) | P2 | partial on main |
| C4-H | Default `worktree.backend=git` after field soak | P2 | opt-in implemented |
| C4-P | pnpm hardlink worktree install | P3 | done (opt-in; default none) |
| C5-H | Default `symbolLease.mode=wal` after multi-process soak | P2 | opt-in implemented |
| C5-P | Make patch-flow a default orchestration path | P2 | residual keep-off (graduation pack) |
| C6-H | Assembler flip after live corpus | P1 | evidence only |
| C6-5 | L4 semantic eval embed adapter | P3 | deferred |
| C7-H | Experience shadow stable window → manual cutover | P2 | cutoverAllowed always false |
| DEL | Remove accidental parallel C0–C3 untracked copies before PR | P0 | operator cleanup if present |

## Implementation log (this round)

- C4-H git|inprocess backend on worktree-service (default inprocess)
- C5-H wal|memory symbol lease (default memory)
- C6-H long-chat curve evidence (no flip)
- C7-H experience-shadow-product helpers (shadow-safe)