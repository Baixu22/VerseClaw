# Phase 18 Runtime Memory Readonly Operator Utility Build Proof

Phase 18 proves the explicit local operator/developer utility `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs` works against built OpenClaw runtime output.

Accepted scope:

- Explicit local utility invocation only.
- Built-runtime module proof for `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`.
- Readonly sanitized episode summaries and bounded statistics only.
- Requires explicit `--persist` and explicit `--database <path>` before SQLite can be opened.
- Missing persist flag, missing database path, missing database file, or missing `runtime_memory_episodes` table returns bounded diagnostics without creating files, tables, or rows.
- JSON and text utility output must remain sanitized.

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
