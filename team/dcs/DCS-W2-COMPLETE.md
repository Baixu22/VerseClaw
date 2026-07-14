# DCS W2 COMPLETE — D1 context_read / context_search / context_write agent tools

**Date**: 2026-07-14  
**Window**: W2 (DCS wiring repair)  
**Commit message**: `feat(runtime): register dcs context agent tools`

## Goal

Stop instructing agents to call non-existent tools. Implement and register real agent-callable tools that wrap existing context-engine library functions, and keep `CHILD_CONTEXT_READ_INSTRUCTION` only because the tool truly exists on the production coding path.

## production wiring status: tools-live

D1 closed: `context_read` / `context_search` / `context_write` materialize on the embedded coding tool assembly when attempt/compact supplies BlockStore + sink + session id.  
Broader DCS path remains incomplete for later windows (toolEntries, SEKB install, E2E, flags default false, fingerprint). Remaining debt: **D3 D4 D5 D6 D7** (D1 closed here; D2 closed by W1).

## Tool registration (file:line)

### Library + agent wrappers

| Piece | Location |
|-------|----------|
| `readContext` library | `openclaw_runtime/src/context-engine/tools/context-read-tool.ts:85` |
| Supported block types | `openclaw_runtime/src/context-engine/tools/context-read-tool.ts:11` (`task_state`, `tool_registry`, …) |
| Tool name constants | `openclaw_runtime/src/agents/tools/context-agent-tools.ts:32-34` |
| `createContextReadTool` | `openclaw_runtime/src/agents/tools/context-agent-tools.ts:130` |
| `createContextSearchTool` | `openclaw_runtime/src/agents/tools/context-agent-tools.ts:162` |
| `createContextWriteTool` | `openclaw_runtime/src/agents/tools/context-agent-tools.ts:197` (ANTI-7 whitelist + `write_origin: "context_write"` via `writeContext`) |
| `createDcsContextAgentTools` | `openclaw_runtime/src/agents/tools/context-agent-tools.ts:267` |

### Production catalog / assembly

| Piece | Location |
|-------|----------|
| Catalog entries (coding profile) | `openclaw_runtime/src/agents/tool-catalog.ts:155` `context_read`, `:163` `context_search`, `:171` `context_write` |
| Coding tools options + push | `openclaw_runtime/src/agents/agent-tools.ts:549-553` options; `:834-843` `createDcsContextAgentTools` → `base.push` |
| Attempt hoist + inject | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:1233` `resolveEmbeddedDcsExtensionDeps`; `:1284-1285` `dcsBlockStore` / `dcsContextBlockSink` into `createOpenClawCodingTools` |
| Compact hoist + inject | `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts:852`; `:871-872` |
| Store type includes queryByEntity | `openclaw_runtime/src/agents/embedded-agent-runner/dcs-extension-deps.ts:15` |
| Child instruction (now accurate) | `openclaw_runtime/src/context-engine/handlers/task-loop-handler.ts:131` `CHILD_CONTEXT_READ_INSTRUCTION` |

### Design notes

- Tools return `null` / are omitted when `sessionId` or `blockStore` (and sink for write) are missing — no global mutable registry hacks.
- Default write role is `implementer` when unset so coding runs can write notes under ANTI-7.
- Flags remain default `false`; registration is dep-gated, not flag-gated.
- Authorization stays inside `BlockStore.query` (session + direct-parent rules); tools do not bypass.

## Production catalog builder evidence

Unit/integration test calls the real `createOpenClawCodingTools` builder (not a mocked catalog):

- With `dcsBlockStore` + `dcsContextBlockSink` + session id and `tools.profile: "full"`, tool names include `context_read`, `context_search`, `context_write`.
- Without DCS deps, those three names are absent.
- `CHILD_CONTEXT_READ_INSTRUCTION` contains `context_read` and matches a name produced by `createDcsContextAgentTools`.

Test file: `openclaw_runtime/src/agents/tools/context-agent-tools.test.ts` (9 tests).

## Tests added

| File | What it proves if removed |
|------|---------------------------|
| `openclaw_runtime/src/context-engine/tools/context-read-tool.test.ts` | Session-scoped `readContext` + category filter + unsupported type reject |
| `openclaw_runtime/src/agents/tools/context-agent-tools.test.ts` | Schema/happy path for three tools; auth omit/reject; real catalog registration; child instruction names a real tool |

`package.json` `test:dcs` / `lint:dcs` include the new files + `agent-tools.ts` + `tool-catalog.ts`.

## Gate results (all exit 0)

| Gate | Command | Exit |
|------|---------|------|
| context-read unit | `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/tools/context-read-tool.test.ts` | **0** (1 file / 6 tests) |
| agent tools unit | `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-tools.config.ts src/agents/tools/context-agent-tools.test.ts` | **0** (1 file / 9 tests) |
| DCS suite | `pnpm run test:dcs` | **0** (unit 13/142 + runtime-config 4/8 + agents 9/43) |
| DCS lint (type-aware) | `pnpm run lint:dcs` | **0** |
| Typecheck | `pnpm run typecheck` | **0** (node + web) |

## Out of scope (unchanged)

- D5 / W3: real `toolEntries` fill
- D4 / W4: SEKB production install / trajectoryCapture
- D6 / W5: Electron E2E; flags still default false
- D3 / D7 / W6: fingerprint + dual-injection observability
- Settings / i18n / host-api / CodeGraph / DCS injection protocol

## Remaining debt

| Id | Status after W2 |
|----|-----------------|
| D1 | **CLOSED** — tools registered on coding path when deps present |
| D2 | **CLOSED** (W1) — phase producer + attempt deps |
| D3 | open — fingerprint |
| D4 | open — SEKB island / install |
| D5 | open — empty toolEntries |
| D6 | open — flags default false / real E2E |
| D7 | open — observability counters |
