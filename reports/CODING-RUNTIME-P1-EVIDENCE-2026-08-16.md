# CODING-RUNTIME P1 Evidence (2026-08-16)

> Scope: Phase 1 of `docs/dev/coding-runtime-development-spec.md`.
> Product locks remain: `liveReady=false`, `productApproved=false`, `defaultOn=false`.
> `runtime.coding.uftk.enabled` remains `false` by default. This report is P1 gate
> evidence only; it is not a UFTK GA or canary claim.

## 0. Starting information

- Workspace: `D:\ClawX`
- HEAD: `734ec877e75682861103660fbdea2bd55253ece0`
- Branch: `main` (existing dirty/untracked WIP preserved; no reset/checkout performed)
- Baseline before P1 work:
  - `tests/unit/coding-runtime-contract.test.ts`: 8/8 PASS
  - runtime targeted baseline: 5 files / 72 tests PASS

## 1. Source-to-path map

| P1 deliverable | New/changed module | Reused existing implementation | Main caller / test |
|---|---|---|---|
| Atomic write IO | `openclaw_runtime/src/agents/coding-runtime/atomic-write.ts` | `sessions/tools/text-file-codec.ts`, `sessions/tools/edit-diff.ts` | `file-transaction-service.ts`; `atomic-write.test.ts` |
| Delete/move pre-image journal | `openclaw_runtime/src/agents/tools/write-journal.ts` | existing write-journal sidecar + rehydration | `snapshotBeforeDelete`, `snapshotBeforeMove`, `undoWriteJournalEntries`; `write-journal.test.ts` |
| File transaction engine | `openclaw_runtime/src/agents/coding-runtime/file-transaction-service.ts` | `write-journal.ts`, `apply-patch-preflight.ts`, `apply-patch-batch-lock.ts`, `atomic-write.ts` | `file-transaction-service.test.ts` |
| Rollback preview | `openclaw_runtime/src/agents/coding-runtime/rollback-preview.ts` | `write-journal.ts`, `sessions/tools/edit-diff.ts` (`generateUnifiedPatch` extended with deleted-file mode) | `rollback-preview.test.ts` |
| UFTK flag | `openclaw_runtime/src/context-engine/coding-runtime-flags.ts`, `runtime-flag-ack.ts`, `dcs-prod-flags-catalog.test.ts` | `shared/coding-runtime/types.ts` (`CODING_RUNTIME_FLAG_KEYS`) | `file-transaction-service.tool-integration.flag-matrix.test.ts` |
| Tool integration | `sessions/tools/write.ts`, `sessions/tools/edit.ts`, `apply-patch.ts`, `agent-tools.read.ts`, `agent-tools.ts` | existing tool schemas and DCS producer envelopes unchanged | flag-matrix test + existing write/edit/apply_patch/dcs tests |
| Observability | `context-engine/coding-observability.ts` | existing coding counter registry | tests assert `uftkPrepareCount` / `uftkCommitCount` / atomic counters / delete-move snapshot counter |
| Contract sync | `shared/coding-runtime/types.ts`, `schema.ts`, `README.md`, `MIGRATION.md`, `tests/unit/coding-runtime-contract.test.ts` | P0 TypeBox contract | contract test |

Second-journal check: no second journal, journal directory, run journal, or mutation authority was introduced.
The only journal remains `write-journal.ts` (`workspaceRoot/.openclaw/journal/<session>`).
No SQLite / JSONL audit storage was created (Phase 4).

## 2. Flag matrix (off/on)

| Path | off (`uftkEnabled=false`) | on (`uftkEnabled=true`) |
|---|---|---|
| Resolver | `isCodingUftkEnabled()` returns `false`; shared `DEFAULT_CODING_RUNTIME_FLAGS.uftkEnabled=false` | explicit config/override `true` only |
| `write` | legacy `WriteOperations` path; `uftkPrepareCount=0` | `prepare -> commit`; journal entry `kind=write`; `working_memory` envelope unchanged |
| injected `WriteOperations` | normal injected path | UFTK path is mandatory; fake injected `writeFile` is not called |
| `edit` | legacy edit path | UFTK final write; CRLF/BOM and `working_memory` preserved |
| `apply_patch` | legacy `applyPatch` + preflight journal | UFTK service; add/delete/move hunks journaled with `kind=apply_patch`; envelope preserved |
| Model-facing TypeBox schema | unchanged | unchanged; no new required or P1-visible parameter |

## 3. Rollback matrix

| Scenario | Result |
|---|---|
| write existing -> rollback | original bytes restored |
| write new file -> rollback | file removed |
| delete file -> rollback | file restored |
| move to new path -> rollback | source path/content restored |
| move over existing destination -> rollback | source restored and destination restored |
| apply_patch committed (update + delete) -> rollback | both pre-images restored |
| multi-mutation same `batchId` -> rollback | all files restored |
| apply_patch partial commit -> rollback success | disk restored, batch `rolled_back`, journal entries discarded |
| apply_patch partial commit + rollback failure | `recovery_required`, `recoveryRef` present, journal retained |
| rollback with missing snapshot | `recovery_required`, `recoveryRef` present, journal retained, no fake success |
| non-git directory | full rollback works (no git dependency) |
| `previewRollback` | unified diff; disk and journal unchanged |

## 4. Atomic write failure injection

- Success: content correct; no `.uftk-*.tmp` files remain.
- Rename-overwrite on this Windows host: existing target replaced atomically.
- Failure injection: rename file over an existing directory fails; target directory
  unchanged and temp file cleaned (`atomicWriteFailure` counter incremented).
- Encoding/line endings: UTF-8 BOM and CRLF restore tested; write-tool UTF-8 bytes
  stay verbatim when no line-ending restore is requested.

## 5. Performance baseline

Measurement: 40 operations, 500-line payload, local temp workspace, tsx benchmark.

| Path | off | on | delta | gate |
|---|---|---|---|---|
| write single file | 1.10 ms/op | 4.98 ms/op | +3.88 ms (+353%) | <50 ms absolute |
| edit single file | 1.95 ms/op | 5.94 ms/op | +3.99 ms (+205%) | <50 ms absolute |

Apply patch, ~1.07 MB / 42000 lines:
- legacy `applyPatch`: 75.7 ms
- UFTK service commit (prepare excluded): 9.9 ms
- No O(n^2) regression observed; prepare/apply remain linear line scans.

## 6. Commands and exit codes

| Command | Exit | Result |
|---|---|---|
| `pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1` | 0 | 8/8 PASS |
| `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts <all coding-runtime tests + write-journal + write + edit + apply_patch + dcs-producer> --maxWorkers=1` | 0 | 9 files / 105 tests PASS |
| `pnpm run typecheck:node` | 0 | PASS |
| `pnpm run typecheck:web` | 0 | PASS |
| `pnpm contract:check` | 0 | PASS |
| `pnpm run lint:bom` | 0 | PASS |
| scoped `pnpm exec eslint <changed .ts files>` | 0 | 0 errors / 0 warnings |
| `git diff --check -- <tracked changed files>` + untracked new-file scan | 0 | clean |
| `pnpm verseshell:test` | 0 | 11 root + 141 runtime + 11 MCP PASS |
| `pnpm --dir openclaw_runtime tsgo:core` | 2 | **pre-existing unrelated dirty WIP**: only `shared/verseshell/extraction.ts` + `facade.ts` errors; no P1 file in the error list |
| `pnpm --dir openclaw_runtime tsgo:core:test` | 2 | **pre-existing unrelated dirty WIP**: mission-control/openai-transport/governed-process/trajectory/provider-stream/extension-boundary errors; no P1 file in the error list |

## 7. Docs and handoff

- `docs/dev/coding-runtime-development-spec.md`: only Phase 1 checkboxes checked.
- `shared/coding-runtime/README.md`: P1 status, runtime files, `recoveryRef` and
  `listAudit` fail-closed invariants documented.
- `shared/coding-runtime/MIGRATION.md`: P1 sidecar fields and additive
  `recoveryRef` migration notes.
- Docs-sync declaration for `README.md` / `README.zh-CN.md` / `README.ja-JP.md`:
  **no update required** — P1 is default-off and has no user-visible behavior,
  flow, or interface change.
- Drafts (not applied; awaiting user confirmation):
  - Task Forest proposal: `reports/CODING-RUNTIME-P1-TASK-FOREST-PROPOSAL-DRAFT.md`
  - Handoff update: `docs/dev/handoffs/CODING-RUNTIME-P1-HANDOFF-DRAFT.md`

## 7.1 Close-out applied

- Task Forest proposal `TFP-coding-runtime-p1-review-needed-20260816` saved,
  validated, applied, and exported. Node: `TF-0070` (`review_needed`, 90%),
  child of `TF-0010`.
- `docs/dev/handoffs/LATEST.md` now leads with the Coding Runtime P1 handoff.
- Independent acceptance prompt: `reports/CODING-RUNTIME-P1-ACCEPTANCE-PROMPT.md`.
- `TF-0070` must stay `review_needed` until that prompt passes.

## 8. Residuals

- `tsgo:core` / `tsgo:core:test` remain blocked by pre-existing unrelated dirty
  worktree files (listed above). This P1 change does not add to those error lists.
- JSONL audit, SQLite index, cross-process file locks, shell side-effect audit,
  and git checkpoint remain Phase 2-5 work and are intentionally not implemented.
- `runtime.coding.uftk.enabled` remains `false`; no Settings UI or default flip
  was added.
