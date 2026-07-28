# TASK-P0-03: Discoverability for hidden view tools

| field | value |
|-------|-------|
| **id** | `TASK-P0-03` |
| **milestone** | `M0-honesty` |
| **priority** | `P0` |
| **status** | `done` |
| **blockedBy** | — |
| **owner** | Claude |
| **gapRefs** | GAP-P0-03, T-04..T-07 |
| **estimate** | 1-2d |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal (user-visible outcome)
Users can discover that context_understand/impact/reuse/verify are disabled and enable them so tools enter the catalog (with FactService).

## Acceptance criteria
- [x] Visible hint when disabled (Settings banner), not silent absence
- [x] One-click enable wired to P0-01 `context-view-tools` toggle
- [x] Focus switch + detail copy naming the four tools
- [x] Enabled state banner + after-enable toast (new turn / gateway apply)
- [x] No production default flip
- [x] i18n en/zh (+ ja/ru keys)
- [x] E2E: banner disabled → enable → enabled → restore baseline

### Honesty note
E2E fixture still skips gateway auto-start; “tools appear in live agent catalog” is guaranteed by P0-01 env inject + runtime gate once gateway applies. UI proves discover + enable path; catalog membership remains env-gated `isDcsContextViewToolsEnabled`.

## Implementation
- `src/components/settings/DcsProdFlagsPanel.tsx` — `ViewToolsDiscoverBanner` + detail hint + enable CTA
- i18n `developer.dcsProdFlags.viewToolsDiscover.*`
- E2E case in `tests/e2e/dcs-prod-p0-settings.spec.ts`

## Test / evidence
```powershell
pnpm run test:e2e -- tests/e2e/dcs-prod-p0-settings.spec.ts --workers=1
# 3 passed (panel, toggle, discover banner)
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | |
| 2026-07-22 | banner+CTA | done | disabled/enabled states |
| 2026-07-22 | e2e | pass 3/3 | after switch helper race fix |
| 2026-07-22 | close | **done** | |

## Handoff notes
- Next: `TASK-P0-04` (BlockStore failure visible) or `TASK-P0-05` (shell vs core copy).
- Defaults remain off; enable still opt-in only.
