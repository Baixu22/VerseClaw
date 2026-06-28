# Phase 10 Lane D: Rollback Docs Validation Synthesis Readiness

## Scope Confirmation

- Lane: `lane-d-rollback-docs-validation-synthesis-readiness`
- Output file: `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/submissions/lane-d-rollback-docs-validation-synthesis-readiness.md`
- Files reviewed: `AGENTS.md`; `C:\Users\27933\.codex\RTK.md`; `openclaw_runtime/AGENTS.md`; Phase 10 task spec; Phase 10 README, parallel lanes, and submission template; Phase 10 Lane A/B/C submissions; Phase 9 synthesis and task spec; harness context rules/layers for gateway communication, renderer/Main boundary, comms, docs sync, and runtime; focused Runtime Memory source/tests.
- Files changed: this submission only.
- Runtime behavior changed: no.
- TaskLoop/Gateway/provider ordering changed: no.
- Main/Gateway/host-api/api-client paths changed: no by this lane; current worktree contains pre-existing dirty Main/Gateway/host-api/shared/provider-adjacent files, so comms replay/compare were required and run.

## Executive Summary

Lane D accepts A-C as sufficient to enter Phase 10 synthesis, but only as planning and boundary evidence. It does not accept implemented runtime read/write integration, provider ordering cutover, default-on memory behavior, raw retention, unverified durable facts, service/exporter/database-service/listener work, or memory-derived runtime authority.

A-C each have exactly one final marker and all three classify as accepted. The synthesis should preserve the narrow acceptance: Lane A proves flag-off parity/no-open boundaries, Lane B defines a future sanitized read/write boundary without wiring it into runtime, and Lane C defines explicit optional provider hydration without default registration or ordering changes.

## A-C Submission Presence And Marker Audit

| Submission | Marker Count | Marker Result | Classification |
|---|---:|---|---|
| `lane-a-flag-off-runtime-wiring-parity.md` | 1 | accepted | accepted, planning/test evidence only |
| `lane-b-persistence-read-write-integration-boundary.md` | 1 | accepted | accepted, boundary definition only |
| `lane-c-provider-context-hydration-boundary.md` | 1 | accepted | accepted, boundary definition only |

Command:

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "Select-String -Path 'runtime-research\handoffs\phase-10-runtime-memory-persistence-integration\submissions\lane-*.md' -Pattern '^Status:'"
```

Result: exactly one marker in each A-C submission. Lane D intentionally avoids adding additional marker-shaped lines outside the final conclusion.

## Rejected Claim Audit

| Claim Surface | Result | Evidence |
|---|---|---|
| Runtime read/write integration | rejected as implemented behavior | No persistence owner imports in TaskLoop/Gateway/Electron/renderer/shared/default registry scan. Lane B defines only future boundaries through `createRuntimeMemoryPersistenceStore(...)`. |
| Provider ordering cutover | rejected | `openclaw_runtime/src/context-engine/provider-registry.ts:253-258` still builds legacy provider, loop context pack, then explicit extras. Focused registry tests passed. |
| Default-on behavior | rejected | `openclaw_runtime/src/runtime-core/memory-context.ts:129-133` keeps runtime memory flags, including `persist`, default false. |
| Raw retention | rejected | Production `memory-persistence.ts` raw-retention scan had no matches; broader raw scan matches are sanitizer denylist/redaction code in `memory-context.ts` and negative tests. |
| Unverified durable facts | rejected | `memory-context.ts:570-582` requires accepted durable fact shape, finite accepted time, and promotion evidence; persistence stores non-durable candidates as `record_kind = "candidate"` with null promotion in `memory-persistence.ts:765-782`. |
| Service/exporter/database-service/listener | rejected | Focused source/test service-exporter scan returned no matches. Submission docs contain the words only as rejected-boundary text. |
| Runtime authority | rejected | `memory-context-provider.ts:65-66` keeps provider default-off/shadow-only, and provider metadata marks no completion/verifier/security/retry/tool/runtime authority. |

## Validation Evidence

| Command | Result | Covers | Gap |
|---|---|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 read order and required rules/layers | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 spec validity | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 prerequisite validity | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/context-provider-registry.test.ts` | pass, 6 files / 37 tests | Runtime Memory contracts, store, proposal shadow, provider, persistence, and provider registry | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node typecheck | none |
| Renderer boundary scan over `src/pages src/components` | pass/no matches | No direct renderer IPC, Gateway HTTP, localhost Gateway, or direct WebSocket bypass | `rg` exit 1 means no matches |
| Raw-retention scan over focused Runtime Memory source/tests | pass/reviewed | No raw persistence write path | Matches are sanitizer denylist/redaction code or negative test fixtures/assertions |
| Service/exporter/database-service/listener scan over focused source/tests | pass/no matches | No service, exporter, database-service, listener, HTTP/WebSocket, OTLP, Temporal, or Express surface | `rg` exit 1 means no matches |
| Persistence scan over focused source/config/tests | pass/reviewed | Intended Phase 9 persistence owner/config gate/tests only | Config help wording needs update before operator-facing persistence |
| Runtime-authority import scan over TaskLoop/Gateway/Electron/renderer/shared/default registry | pass/no matches | No runtime read/write integration, default provider registration, or runtime authority wiring | `rg` exit 1 means no matches |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe scripts/comms/replay.mjs` | pass | Required because current dirty worktree includes communication-adjacent files | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe scripts/comms/compare.mjs` | pass | Communication regression compare | none |

## Source Evidence Highlights

| Surface | Evidence | Result |
|---|---|---|
| Disabled persistence no-open/no-read/no-write | `memory-persistence.ts:342-445` checks `persistEnabled()` before migration/write/load transaction paths; `tests/unit/runtime-memory-persistence.test.ts:33-37` injects a throwing opener for disabled persistence. | pass |
| Local owner/schema | `memory-persistence.ts:42-43` names `openclaw_runtime.runtime-core.memory-persistence`; schema and SQLite use remain inside that owner. | pass |
| Sanitized load path | `memory-persistence.ts:409-427` hydrates a fresh `RuntimeMemoryStore` by replaying parsed episode/fact/invalidation records through store APIs. | pass as boundary only |
| Sanitized write path | `memory-persistence.ts:358-407` accepts only episode/fact/invalidation inputs, sanitizes before transaction, and rejects invalid/raw input. | pass as boundary only |
| Current-valid exclusion | `memory-context.ts:900-925`, `memory-context.ts:1176-1195`, and `memory-store.ts:503-510` exclude expired, invalidated, candidate, rejected, and unpromoted records by default. | pass |
| Provider optional/no-authority | `memory-context-provider.ts:65-66`, `memory-context-provider.ts:104-113`, and metadata paths keep the provider default-off, shadow-only, readonly, budgeted, and non-authoritative. | pass |
| Provider ordering | `provider-registry.ts:253-258` keeps default providers ordered before explicit extras; `tests/unit/context-provider-registry.test.ts:157-162` covers disabled memory persistence/provider ordering. | pass |

## Docs And Config Help

Phase 10 makes runtime memory persistence more concrete by defining future read/write and provider hydration boundaries, but it still does not add operator-facing runtime persistence behavior. No README translation update is required for Lane D itself.

However, synthesis must carry a docs/config-help requirement forward before any operator-facing persistence flow or runtime wiring is accepted. Current config wording is stale: `openclaw_runtime/src/config/types.openclaw.ts:159-160` and `openclaw_runtime/src/config/schema.help.ts:2011-2012` still describe `runtime.memory.persist` as reserved/future Phase 9 validation and say setting it does not write files or databases, while Phase 9 accepted a standalone default-off local SQLite persistence owner. That wording is acceptable only while runtime integration remains non-operator-facing; it must be refreshed before user/operator-facing persistence, runtime writes, runtime reads, or docs claiming usable persistence.

## Design Conflicts And Synthesis Notes

| Conflict / Gap | Evidence | Required Synthesis Treatment |
|---|---|---|
| A-C are accepted but could be overread as cutover approval. | Lane B/C define future integration/hydration boundaries; scans show no runtime wiring. | Synthesis must state that runtime read/write integration is not accepted as implemented behavior. |
| Config help is stale relative to Phase 9 foundation. | `schema.help.ts:2011-2012` and `types.openclaw.ts:159-160`. | Mark docs/config help update required before operator-facing persistence or runtime wiring. |
| Current worktree has many unrelated dirty communication-adjacent files. | `git status --short` includes Electron Main, Gateway, shared host contracts, host-api, and provider/runtime files. | Comms replay/compare passed; do not attribute unrelated dirty files to Lane D. |
| `rtk` is not on PATH in this shell. | Bare `rtk` failed; direct `C:\Users\27933\.cherrystudio\bin\rtk.exe` worked. | Continue using the direct RTK binary unless PATH is repaired. |

## Synthesis Readiness

Phase 10 is ready for synthesis with a narrow accepted boundary. Synthesis may classify A, B, C, and D as accepted only if it preserves these limits:

- no runtime read/write integration is accepted as implemented behavior;
- no provider ordering cutover, default-on behavior, raw retention, unverified durable facts, service/exporter/database-service/listener, or runtime authority is accepted;
- docs/config help updates are required before any operator-facing persistence or runtime wiring claim;
- future implementation still needs explicit synthesis acceptance with flag-off no-open/no-read/no-write proof.

```text
Status: accepted
```
