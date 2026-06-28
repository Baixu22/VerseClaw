# Phase 20 Runtime Memory Readonly Operator Utility Packaging Proof

Phase 20 proves the Runtime Memory readonly operator/developer inspection utility remains discoverable and verifiable through explicit local package/build surfaces without becoming part of packaging, release, product runtime, or Gateway/UI behavior.

Accepted scope:

- `runtime:memory:inspect` remains an explicit local developer command.
- The package script remains exactly `node openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`.
- The package script does not pass `--persist`, does not pass `--database`, and does not choose a database path.
- `predev`, `dev`, `build`, `package`, and `release` do not invoke `runtime:memory:inspect` or `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`.
- Build/package flows may build `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`, but they do not execute the inspector utility.
- The utility remains readonly, default-off, and requires explicit `--persist` plus explicit `--database <path>` before SQLite can be opened.
- Explicit existing Runtime Memory databases return sanitized episode summaries and statistics only.

Rejected scope:

- Gateway routes, Electron IPC routes, renderer UI, shared host contract, host-api, or api-client routes.
- Provider ordering, provider registration, `RuntimeMemoryProvider` default enablement, TaskLoop memory reads, prompt/context injection, automatic facts, or runtime authority.
- Raw chat, transcript, jsonl, trace, prompt, payload, checkpoint, tool args/output, env, secret, raw row, or `record_json` output.
- Service/exporter/listener/daemon/server work.
- Package/build/dev/release lifecycle invocation of inspector or implicit persist/database enablement.

Final synthesis must end with exactly one of:

```text
Status: accepted
Status: needs_revision
Status: blocked
```
