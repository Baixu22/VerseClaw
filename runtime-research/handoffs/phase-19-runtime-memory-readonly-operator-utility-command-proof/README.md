# Phase 19 Runtime Memory Readonly Operator Utility Command Proof

Phase 19 proves the Runtime Memory readonly operator/developer inspection utility is discoverable through an explicit local package command.

Accepted scope:

- `package.json` exposes `runtime:memory:inspect`.
- The package script is only `node openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`.
- The package script does not pass `--persist`, does not pass `--database`, and does not choose a database path.
- The utility remains readonly, default-off, and requires explicit `--persist` plus explicit `--database <path>` before SQLite can be opened.
- Disabled or missing inputs return bounded diagnostics without opening, creating, migrating, or writing SQLite state.
- Explicit existing Runtime Memory databases return sanitized episode summaries and statistics only.
- The existing built-runtime requirement remains: the utility imports `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`.

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
