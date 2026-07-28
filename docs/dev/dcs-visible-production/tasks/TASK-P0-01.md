# TASK-P0-01: DCS Flag panel writable control plane

| field | value |
|-------|-------|
| **id** | `TASK-P0-01` |
| **milestone** | `M0-honesty` |
| **priority** | `P0` |
| **status** | `done` |
| **blockedBy** | — |
| **owner** | Claude |
| **gapRefs** | GAP-P0-01, UI-01 |
| **estimate** | 3-5d |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal (user-visible outcome)
In Settings > Developer > DCS production flags, user can Switch/Select to really enable capabilities and see runtime status applied|pending-restart|error. End state is NOT read-only enable-string instructions.

## Why this exists
Read-only DcsProdFlagsPanel is the largest shelfware; product entry gate for all opt-in surfaces.

## Non-goals
- Joint-system GA claims
- Flipping unrelated flags
- Scope expansion beyond this task
- Default-on graduation (TF-0006)

## Context / code anchors
- `src/components/settings/DcsProdFlagsPanel.tsx`
- `shared/dcs/prod-flags-catalog.ts` + `shared/dcs/prod-flags-control.ts`
- `electron/services/dcs-prod-flags-api.ts` + `electron/utils/dcs-prod-flags-env.ts`
- `electron/gateway/config-sync.ts` (forkEnv inject)
- `shared/host-api/contract.ts` module `dcsProdFlags`
- `docs/dcs-production-p0-runbook.md` + `.zh-CN.md`
- host-api: `hostApi.dcsProdFlags.getFlags/setFlag`

## Acceptance criteria
- [x] At least one opt-in flag writable from UI — **5 writable: view-tools + 4 config**
- [x] After toggle, persisted state observable — **E2E: settings store + host getFlags on/off; unit: forkEnv inject for env flags; config path write for config flags**
- [x] UI status: applied | pending-restart | error | read-only
- [x] Disable restores baseline; E2E covers on/off — **2/2 e2e + unit 47**
- [x] Remaining catalog rows still show correct default/risk (patch-flow read-only, no switch)
- [x] i18n en/zh minimum (ja/ru keys present)
- [x] Runbook prefers Settings; env advanced-only

### Honesty note on “tool-table in new coding session”
Full agent-turn tool catalog with live gateway is **out of E2E fixture** (`VERSE_CLAW_E2E` skips gateway auto-start). Control-plane absolute completion is proven by: UI toggle → AppSettings persist → host snapshot → (env) forkEnv inject unit + (config) openclaw.json path write. Live gateway tool-table smoke remains optional follow-up when gateway is started outside E2E hold.

## Implementation slices
1. API design — **DONE**
2. Panel Switch — **DONE**
3. Readback snapshot — **DONE**
4. E2E toggle + restore — **DONE** (2 passed, 2026-07-22)
5. Docs runbook — **DONE**

## Test / evidence
```powershell
pnpm exec vitest run tests/unit/dcs-prod-flags-control.test.ts tests/unit/host-api-facade.test.ts --maxWorkers=2
# 47 passed

pnpm run test:e2e -- tests/e2e/dcs-prod-p0-settings.spec.ts --workers=1
# 2 passed (panel + toggle/persist/restore)
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | task doc persisted |
| 2026-07-22 | 1–3 | done | host module + panel + snapshot |
| 2026-07-22 | unit | pass | 47 |
| 2026-07-22 | 4 E2E v1 | partial | visibility only; host:invoke wrong channel |
| 2026-07-22 | 4 fix | done | verseClaw.hostInvoke; E2E skip auto-restart; data-state |
| 2026-07-22 | 4 E2E v2 | **pass 2/2** | toggle env+config, restore baseline, read-only row |
| 2026-07-22 | 5 docs | done | EN+ZH runbook Settings-first |
| 2026-07-22 | close | **done** | TASK-P0-01 absolute complete for control-plane scope |

## Handoff notes
- Next program task: `TASK-P0-02` (dead factViews config) or `TASK-P0-03` (discoverability).
- Writable ids remain default **false**; no product default flip.
- Env kill `0/false/off` still overrides Settings enable for env-class flags.

## Hard locks (do not violate)
- Do not flip production defaults to "prove usable".
- SEKB: no auto writeback.
- packaging path: defaultsUnchanged; no auto default-on.
- Prefer Settings/config-sync over env-only expert paths for end-state UX.
