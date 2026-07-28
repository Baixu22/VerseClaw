# TASK-P2-01: TF-0006 four evidence files

| field | value |
|-------|-------|
| **id** | `TASK-P2-01` |
| **milestone** | `M2-default-candidate` |
| **priority** | `P2` |
| **status** | `blocked` |
| **blockedBy** | human-corpus + live-ab + soak + product-approval |
| **owner** | TBD |
| **gapRefs** | GAP-P2-01, TF-0006 |
| **estimate** | 3-6w calendar |
| **lastUpdated** | 2026-07-22 |

## Goal (user-visible outcome)
Produce four evidence files enabling liveReady/productApproved discussion (same PR must NOT flip defaults).

## Why this exists
Part of dcs-visible-production: visible features must be production-usable, not shelfware.

## Non-goals
- Joint-system GA claims
- Flipping unrelated flags
- Scope expansion beyond this task

## Context / code anchors
- `docs/dev/tf0006-evidence-upgrade-unblock.md`
- `artifacts/tf0006-evidence-upgrade/status.json`

## Acceptance criteria
- [ ] corpus-manifest.json real corpus
- [ ] live-ab-report.json human
- [ ] soak-report.json
- [ ] product-approval.json named scope
- [ ] status.json unblocked only via process
- [ ] honesty locks remain true until approval

## Implementation slices (one PR / one session each)
1. corpus plan
2. collect + manifest
3. live A/B
4. soak
5. approval meeting + product-approval.json
6. update status (no default flip)

## Test / evidence commands
```powershell
# fill when implementing
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | task doc persisted; implementation not started |
| 2026-07-22 | gate | blocked | P1 deps met; cannot forge live corpus/product-approval; wait humans |
| 2026-07-25 | corpus | draft | real non-synthetic corpus collected (1 OpenClaw session jsonl 785B/114 chars + 301 repo git commits since 2026-06-01, 4.3M insertions); manifest at operator-pack/drafts/corpus-manifest.DRAFT.json (live=true, satisfiesTf0006RealCorpus=false); actualScale 114/64000 chars — 99.82% short of 64K-class, no synthetic padding; collect-real-corpus.mjs re-runnable; validate-drafts.mjs OK; official path remains absent, status.json still blocked |

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

## Operator pack (no unblock)

- Path: `artifacts/tf0006-evidence-upgrade/operator-pack/`
- Forms + DRAFT templates + `validate-drafts.mjs`
- Does **not** set status=done or productApproved

| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | operator-pack | ready | human fill forms; still blocked |
