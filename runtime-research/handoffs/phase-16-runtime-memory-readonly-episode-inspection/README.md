# Phase 16 Runtime Memory Readonly Episode Inspection

Phase 16 tightens Phase 15 from "sanitized episode inspection through `loadStore().listEpisodes()`" to a strict operator/developer readonly inspection boundary.

Accepted work may add a Runtime Memory internal helper such as `inspectRuntimeMemorySanitizedEpisodes(options)` only if it stays default-off, requires `runtime.memory.persist === true`, requires explicit database options, reads only existing episode columns, and never migrates schema, creates tables, writes meta/idempotency rows, trims rows, appends records, hydrates providers, calls TaskLoop, or changes Gateway/UI/provider behavior.

Rejected work remains: TaskLoop memory reads, prompt/context injection, provider ordering or default provider registration, Gateway/Electron/renderer/shared host contract cutover, automatic fact extraction/promotion, raw retention, services/exporters/listeners, and memory-derived runtime authority.

Final synthesis must end with exactly one of:

```text
Status: accepted
Status: needs_revision
Status: blocked
```
