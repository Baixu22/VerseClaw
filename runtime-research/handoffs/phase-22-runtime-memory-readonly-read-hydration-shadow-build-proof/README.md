# Phase 22 Runtime Memory Readonly Read Hydration Shadow Build Proof

Phase 22 proves built-output availability for the Phase 21 readonly read-hydration shadow helper.

Accepted scope:

- Add `scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only`.
- Build only `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js`.
- Keep the flag developer/research-only and absent from package lifecycle scripts.
- Keep the helper default-off, explicit opt-in, readonly, diagnostics-only, and non-authoritative.
- Keep package/build scripts from passing `--database`, `--read-shadow`, or implicit persist/readShadow flags.

Rejected scope:

- Gateway, Electron IPC, renderer UI, host-api/api-client/shared contracts.
- Provider registry, provider ordering, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/model/context injection, automatic fact extraction or promotion.
- Helper execution during build/package/dev/release.
- SQLite open/create/read/write/migrate/database selection during build proof.
- Raw retention, `record_json`, raw transcript/chat/jsonl/trace/prompt/payload/tool/env/secret/checkpoint data.
- Service/exporter/database-service/listener/daemon/server work or runtime authority.
