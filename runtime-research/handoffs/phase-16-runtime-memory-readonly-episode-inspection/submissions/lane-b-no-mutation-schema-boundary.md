# Lane B: No-Mutation Schema Boundary

## Evidence

`inspectRuntimeMemorySanitizedEpisodes(options)` returns bounded skipped diagnostics for a missing database path, a missing database file, and a missing `runtime_memory_episodes` table. The missing database test asserts the SQLite file is not created. The missing table test creates only an unrelated table, runs inspection, then asserts `runtime_memory_episodes` and `runtime_memory_meta` still do not exist.

The enabled inspection test seeds a real Runtime Memory database through the existing persistence owner, records meta/count state, runs inspection with `limit: 1` through a read-only `DatabaseSync`, and compares state afterward. Meta timestamps, episode count, idempotency row count, fact count, and invalidation count remain unchanged; two persisted episodes remain two rows, proving no retention trim occurred despite a one-row inspection limit.

The helper never calls `migrate`, `ensureRuntimeMemoryPersistenceSchema`, `withWriteTransaction`, `appendEpisode`, `appendFact`, `invalidateFact`, or `trimRows`; the mutation functions are outside the helper's line range.

## Accepted Scope

Accepted explicit existing-database/table read-only inspection with no schema creation, meta update, idempotency write, retention trim, episode/fact/invalidation append, or mutation.

## Rejected Scope

Using `loadStore()` as strict no-mutation proof remains rejected because it currently uses a write transaction and schema/meta path. Missing DB/table auto-repair is also rejected.

## Validation

`tests/unit/runtime-memory-persistence.test.ts` passed. Node typecheck passed. The read-only helper scan was reviewed against `memory-persistence.ts` line ranges.

Status: accepted
