# Lane A Read Hydration Contract

Verdict: accepted

Evidence:

- `hydrateRuntimeMemoryShadowContext(...)` and alias `readRuntimeMemoryHydrationShadow(...)` are added as a runtime-core helper.
- The helper requires `runtime.memory.persist === true`, helper-level `readShadow === true`, and an explicit existing database path before opening SQLite.
- Loaded output contains bounded sanitized `episodes`, bounded sanitized `facts`, `stats`, `diagnostics`, and authority boundary markers.
- The helper returns `status: "skipped" | "loaded" | "error"` and never returns a prompt/context/model/provider payload.

Rejected:

- No default runtime config cutover, TaskLoop read, provider ordering, or prompt injection is accepted.

Status: accepted
