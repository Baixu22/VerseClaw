# Phase 17 Runtime Memory Readonly Operator Inspection Surface

Phase 17 adds a minimal operator/developer-only inspection surface over the Phase 16 helper `inspectRuntimeMemorySanitizedEpisodes(options)`.

Accepted scope:

- Explicit helper/script invocation only.
- Readonly sanitized episode summaries and bounded statistics only.
- Requires explicit `runtime.memory.persist === true` and explicit database path before SQLite can be opened.
- Missing persist flag, missing database path, missing database file, or missing `runtime_memory_episodes` table returns bounded diagnostics without creating files, tables, or rows.

Rejected scope:

- Gateway, Electron IPC, renderer UI, shared host contract, host-api, or api-client route.
- Provider ordering, provider registration, `RuntimeMemoryProvider` default enablement, TaskLoop memory reads, prompt/context injection, automatic facts, or runtime authority.
- Raw chat, transcript, jsonl, trace, prompt, payload, checkpoint, tool args/output, env, secret, raw row, or `record_json` output.
- Service/exporter/listener/daemon/server work.

Final synthesis must end with exactly one of:

```text
Status: accepted
Status: needs_revision
Status: blocked
```
