# Persistence Retention Review

## Required Boundary

Candidate, shadow, and replay output must not persist through:

- localStorage,
- indexedDB,
- electron-store,
- SQLite/Postgres/MySQL/Redis,
- JSON/JSONL/TXT sidecars,
- queues,
- `fs` writes,
- `createWriteStream`,
- automatic discovery/build/cache/reuse.

## Current Evidence

The implementation-readiness corpus asserts `candidate.persisted === false` for every case. The runtime shadow proof asserts `candidateTextStored === false` and `candidateTextInsertedIntoPrompt === false`, with only hash/length retained in the report.

## Required Scan

The synthesis must record the persistence API scan over the new task spec, handoff directory, and focused implementation-readiness test.
