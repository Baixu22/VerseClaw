# TASK-P2-05: C4/C5 default hardening (on demand)

| field | value |
|-------|-------|
| **id** | `TASK-P2-05` |
| **milestone** | `M2-default-candidate` |
| **priority** | `P2` |
| **status** | `deferred` |
| **blockedBy** | product-pain |
| **owner** | TBD |
| **gapRefs** | GAP-P2-05 |
| **estimate** | TBD |
| **lastUpdated** | 2026-07-22 |

## Goal (user-visible outcome)
Only if real concurrency pain: evaluate git worktree / WAL defaults; else stay safe defaults without UI implying isolation is default-on.

## Why this exists
Part of dcs-visible-production: visible features must be production-usable, not shelfware.

## Non-goals
- Joint-system GA claims
- Flipping unrelated flags
- Scope expansion beyond this task

## Context / code anchors
- See gap doc section 2-4
- `openclaw_runtime/src/context-engine/`
- `shared/dcs/prod-flags-catalog.ts`

## Acceptance criteria
- [ ] pain record
- [ ] if proceed: Windows soak + evidence
- [ ] else remain deferred with honest UI

## Implementation slices (one PR / one session each)
1. confirm pain
2. evidence plan or formal deferral reason

## Test / evidence commands
```powershell
# fill when implementing
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | task doc persisted; implementation not started |

## Handoff notes (for next agent)
- Read `../STATUS.md` first; only implement slices marked next.
- Keep this file updated; keep STATUS.md metadata-only.
- Link commits/PRs here when they exist.

## Hard locks (do not violate)
- Do not flip production defaults to "prove usable".
- SEKB: no auto writeback / cutoverAllowed stays false unless separate product policy change.
- Browser private network default deny.
- packaging path: defaultsUnchanged; no auto default-on.
- Prefer Settings/config-sync over env-only expert paths for end-state UX.
