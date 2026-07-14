# DCS W3 COMPLETE — D5 real toolEntries into tool_registry factory

**Date**: 2026-07-14  
**Window**: W3 (DCS wiring repair)  
**Commit message**: `feat(runtime): wire tool_registry entries from agent tools`

## Goal

When `runtime.contextBlock.tool-registry.enabled === true`, production `before_agent_start` must write a `tool_registry` Block built from the **actual** agent tool list for that attempt (not an empty/missing `toolEntries` path).

## production wiring status: partial

D5 closed for production callers of `toolEntries` on attempt + compact.  
SEKB production bridge (D4/W4) and real Electron E2E (D6/W5) remain open.  
Remaining debt: **D3 D4 D6 D7**.

## Production call sites (file:line)

### Mapper

| Piece | Location |
|-------|----------|
| `mapToolsToToolRegistryEntries` | `openclaw_runtime/src/context-engine/handlers/tool-registry-handler.ts:37` |
| Entry shape | `resourceId` = tool name; `kind` = `"toolset"`; `title` = label or humanized name; `purpose` = description/displaySummary + optional schema property summary; optional `category` from `risk` |

### Attempt / compact → factories

| Site | Location |
|------|----------|
| Attempt map | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2204` — `const toolEntries = mapToolsToToolRegistryEntries(effectiveTools)` |
| Attempt pass-through | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2217` — `toolEntries` into `buildEmbeddedExtensionFactories` |
| Compact map | `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts:1221` |
| Compact pass-through | `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts:1234` |

### Factory omission rules (unchanged + empty-safe)

| Rule | Location |
|------|----------|
| Flag gate | `extensions.ts` `isToolRegistryEnabled` + `buildEmbeddedExtensionFactories` tool-registry branch |
| Omit when no session / no sink / no entries / **empty array** | `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts:316-333` (`buildToolRegistryFactory`) |

Behavior:

- Uses post-normalize `effectiveTools` for this attempt/compact path.
- Flag default remains `false` — no always-on production leakage.
- Empty tools map to `[]`; factory is omitted (no throw, no sink write).
- Does not change CodeGraph, transport, host-api, or UI.

## Tests

| File | What it proves if removed |
|------|---------------------------|
| `tool-registry-handler.test.ts` (`mapToolsToToolRegistryEntries`) | Name/title/purpose/schema mapping; empty/null safe; dedupe/skip nameless |
| `extensions.tool-registry.test.ts` | flag off → no write; flag on + real mapped entries → sink gets `tool_registry` with those resourceIds; empty entries → omit factory; best-effort sink failure |

## Gate results (all exit 0)

| Gate | Command | Exit |
|------|---------|------|
| tool-registry handler unit | `node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/handlers/tool-registry-handler.test.ts` | **0** (1 file / 15 tests) |
| tool-registry extension unit | `node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/embedded-agent-runner/extensions.tool-registry.test.ts` | **0** (1 file / 8 tests) |
| DCS suite unit shard | vitest.unit.config.ts (13 files listed by `test:dcs`) | **0** (13 / 145) |
| DCS suite runtime-config shard | vitest.runtime-config.config.ts (4 files) | **0** (4 / 8) |
| DCS suite agents shard | vitest.agents.config.ts (9 files listed by `test:dcs`) | **0** (9 / 46) |
| DCS lint (type-aware) | `pnpm run lint:dcs` | **0** |
| Typecheck | `pnpm run typecheck` | **0** (node + web) |

Equivalent of `pnpm run test:dcs`: unit + runtime-config + agents all exit **0**.

## Flag-on write evidence

From `extensions.tool-registry.test.ts`:

- `mapToolsToToolRegistryEntries([{ name: "context_read", ... }, { name: "write", ... }])` → entries with those `resourceId`s.
- With `runtime.contextBlock.tool-registry.enabled === true` + sink + mapped entries, `before_agent_start` calls sink once with `block_type === "tool_registry"` and `full_content.entries` matching those resourceIds.
- With flag off and the same mapped entries, sink is not called.

## Out of scope (unchanged)

- D4 / W4: SEKB install + `trajectoryCapture` production path
- D6 / W5: real Windows Electron/Gateway E2E; flags still default false
- D3 / D7 / W6: fingerprint + dual-injection observability
- Settings / i18n / host-api / CodeGraph / DCS injection protocol redesign

## Remaining debt

| Id | Status after W3 |
|----|-----------------|
| D1 | **CLOSED** (W2) — context_* tools registered |
| D2 | **CLOSED** (W1) — phase producer + attempt deps |
| D3 | open — fingerprint |
| D4 | open — SEKB island / install |
| D5 | **CLOSED** — production attempt/compact pass real `toolEntries` |
| D6 | open — flags default false / real E2E |
| D7 | open — observability counters |

## Honest statement

production wiring status: partial (SEKB/E2E 仍开)
