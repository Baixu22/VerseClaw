# Phase 21 Runtime Memory Readonly Read Hydration Shadow Pilot

Phase 21 proves a new readonly Runtime Memory read-hydration shadow helper, not a runtime cutover.

Accepted scope:

- Add `hydrateRuntimeMemoryShadowContext(...)` / `readRuntimeMemoryHydrationShadow(...)` as a narrow runtime-core diagnostics helper.
- Keep the helper default-off by both `runtime.memory.persist` and helper-level `readShadow`.
- Require an explicit existing database path before any SQLite open.
- Return only bounded sanitized episode summaries and sanitized fact projections.
- Include diagnostics-only, readonly, no-prompt-injection, no-provider-ordering, no-runtime-authority, and no-durable-fact-authority markers.

Rejected scope:

- Gateway, Electron IPC, renderer UI, host-api/api-client/shared contracts.
- Provider registry, provider ordering, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/model/context injection, automatic fact extraction or promotion.
- Raw row output, `record_json`, raw transcript/chat/jsonl/trace/prompt/payload/tool/env/secret/checkpoint data.
- Service/exporter/database-service/listener/daemon/server work.
- Package/build/dev/release lifecycle invocation of the helper.
