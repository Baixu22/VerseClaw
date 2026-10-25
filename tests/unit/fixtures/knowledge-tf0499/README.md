# TF-0499 Knowledge / SEKB merge

- Task: `TF-0499` - merge SEKB into Knowledge as an engineering-principle type
- Actor: `codex` | Evidence driver: `agent`
- VerseGit scope: excluded
- Release boundary: no public release, GA, liveReady or productApproved claim

## What changed

| Area | Change |
|---|---|
| `openclaw_runtime/src/knowledge/sekb/distillation-tool.ts` | `ConfirmAndSaveOptions` gains `drivenBy` / `actor`; `created_by` no longer hardcoded to `human`; new `resolvePrincipleCreatedBy()` records `agent` for agent-driven confirms and stamps `metadata.drivenBy` / `metadata.actor` |
| `electron/services/knowledge-api.ts` | Host confirm path passes `drivenBy: 'agent'`, `actor: 'codex'`; ambient module types updated |
| `openclaw_runtime/src/knowledge/sekb/golden-path.ts` | Golden path records agent provenance instead of claiming a simulated human confirm |
| `shared/knowledge-lifecycle.ts` | One lifecycle vocabulary: `source -> draft -> proposal -> applied`, `runtime-lesson` source kind, `memory-candidate` explicitly outside knowledge |
| `tests/unit/knowledge-lifecycle-tf0499.test.ts` | Pins the vocabulary, the memory-candidate separation and the applied-evidence rule |

No second Knowledge review surface, route or queue was introduced. No product
default was flipped.

## Acceptance mapping

| Criterion | Status | Evidence |
|---|---|---|
| One Knowledge review surface | pass | `09-single-surface.txt` (1 nav entry, 0 SEKB routes) |
| SEKB candidate visible and applicable in Knowledge | pass | `02-sekb-identity.txt`; `shared/knowledge-lifecycle.ts` |
| Agent confirm never recorded as human; negative identity test | pass | `10-no-unconfirmed-writeback.txt`; `sekb.test.ts` identity test |
| Unconfirmed SEKB writeback = 0 | pass | `10-no-unconfirmed-writeback.txt`; `autoWriteback: false` |
| Model distinguishes source/draft/proposal/applied vs memory candidate | pass | `01-lifecycle-unit.txt` (4 tests) |

## Gates

All ten gates pass (`verification.json`): lifecycle unit, SEKB identity,
knowledge runtime, typecheck, lint, contract, no-BOM, diff check, single
surface, no-unconfirmed-writeback.

## Unverified boundary

- `resolvePrincipleCreatedBy` keeps legacy callers that pass no `drivenBy` on
  the historical `human` default (only automated paths are required to pass
  `agent`). Existing persisted rows are not migrated.
- The single-surface check is a static audit of routes and mounts, not a
  rendered-screenshot acceptance.
- Agent-driven only; no human evidence is claimed.
