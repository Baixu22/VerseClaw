# TASK-P0-05: Product copy: shell vs core

| field | value |
|-------|-------|
| **id** | `TASK-P0-05` |
| **milestone** | `M0-honesty` |
| **priority** | `P0` |
| **status** | `done` |
| **blockedBy** | — |
| **owner** | Claude |
| **gapRefs** | GAP-P0-05, M-05, G-D1 |
| **estimate** | 0.5-1d |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal (user-visible outcome)
UI/docs distinguish CVK navigation shell vs DCS working memory vs VToken packing.

## Acceptance criteria
- [x] Settings copy revised for DCS / VToken + new Context layers explainer
- [x] i18n en/zh (ja/ru keys present)
- [x] cross-link gap doc §9.1
- [x] E2E asserts explainer + layer role labels (3/3 suite green)

## Implementation
- `src/components/settings/ContextLayersExplainer.tsx` (new)
- Settings developer stack: Explainer → DCS → VToken → Agent Dev
- DCS/VToken panels show layer-role line
- i18n `developer.contextLayers.*` + revised DCS/VToken descriptions
- Gap doc notes TASK-P0-05

## Copy table (EN summary)

| Layer | Role | Not |
|-------|------|-----|
| CVK | Default navigation shell / tool-routing metadata | Working memory or “engine remembered everything” |
| DCS | Opt-in BlockStore memory, context_* tools | CVK shell; VT packing |
| VToken | ## Working Context source packing | DCS BlockStore replacement |

## Test / evidence
```powershell
pnpm run test:e2e -- tests/e2e/dcs-prod-p0-settings.spec.ts --workers=1
# 3 passed
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | |
| 2026-07-22 | copy+UI | done | explainer + i18n |
| 2026-07-22 | e2e | pass 3/3 | layers visible |
| 2026-07-22 | close | **done** | |

## Handoff notes
- Next: `TASK-P0-06` (retire/hide dead surfaces + doc sweep).
- No default flag flips.
