# TASK-P2-02: Per-surface default-on graduation

| field | value |
|-------|-------|
| **id** | `TASK-P2-02` |
| **milestone** | `M2-default-candidate` |
| **priority** | `P2` |
| **status** | `backlog` |
| **blockedBy** | TASK-P2-01 |
| **owner** | TBD |
| **gapRefs** | GAP-P2-02 |
| **estimate** | per flag 0.5-1w |
| **lastUpdated** | 2026-07-22 |

## Goal (user-visible outcome)
Graduate surfaces one-by-one to default-on with matrix updates and one-line rollback each.

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
- [ ] ordered graduation list executed
- [ ] each flag independent PR + evidence links
- [ ] matrix + catalog updated
- [ ] no joint one-shot flip

## Implementation slices (one PR / one session each)
1. graduation playbook template
2. flag #1 canary default
3. flag #2...
4. rollback drill record

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
