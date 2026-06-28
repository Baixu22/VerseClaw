# Lane A: Readonly Inspection Contract

## Evidence

Phase 15's inspection proof used `loadStore().listEpisodes()`, but current `RuntimeMemoryPersistenceStore.loadStore()` enters `withWriteTransaction()`, calls `ensureRuntimeMemoryPersistenceSchema()`, and replays facts/invalidations into a store. That remains sanitized, but it is not strict operator read-only inspection.

Phase 16 adds `inspectRuntimeMemorySanitizedEpisodes(options)` in `openclaw_runtime/src/runtime-core/memory-persistence.ts`. The helper checks `runtime.memory.persist` before database path checks or SQLite open, requires an explicit database path, opens through a read-only database hook, checks only `runtime_memory_episodes`, and returns episode summaries/statistics without calling the persistence class.

The helper is defined before `RuntimeMemoryPersistenceStore`; scan evidence shows `inspectRuntimeMemorySanitizedEpisodes` starts at `memory-persistence.ts:400`, while `RuntimeMemoryPersistenceStore` starts at `:480`. The write/mutation paths are later: `migrate()` at `:508`, `withWriteTransaction()` at `:611`, schema ensure at `:622`, and `trimRows()` at `:1307`.

Focused tests in `tests/unit/runtime-memory-persistence.test.ts` prove false/omitted `runtime.memory.persist` returns skipped `flag_disabled` and the injected `openReadOnlyDatabase` is never called.

## Accepted Scope

Accepted only a Runtime Memory internal readonly episode inspection helper and tests proving disabled no-open/no-read/no-write behavior.

## Rejected Scope

No TaskLoop memory read, provider hydration, Gateway/UI route, default provider registration, provider ordering, fact writes, invalidations, schema migration, write transaction, or runtime authority is accepted.

## Validation

`harness context` and `harness validate` for Phase 16 passed. Focused `runtime-memory-persistence.test.ts` passed, and the full required Runtime Memory/TaskLoop Vitest set passed with 9 files / 118 tests.

Status: accepted
