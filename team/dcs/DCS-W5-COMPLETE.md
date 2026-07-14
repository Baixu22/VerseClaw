# DCS W5 COMPLETE - Windows production wiring E2E

**Date**: 2026-07-14
**Window**: W5 / D6
**Commit message**: `test(e2e): prove dcs production wiring on windows path`

## Result

Critical: **0**. Important: **0**.

production wiring status: **live-with-e2e**

The primary evidence is a real Windows Electron process using its Electron-owned
Gateway and the embedded coding-agent path. The QA OpenAI Responses provider is
deterministic only at the model boundary; the evidence path does not mock
`BlockStore`. DCS writes are observed directly in the source-runtime SQLite
store at `openclaw-source-state/state/openclaw.sqlite`.

## Product Path

`Windows Electron -> host:invoke Gateway control UI -> /v1/responses -> embedded
agent tool loop -> BlockStore SQLite`

The E2E fixture seeds an isolated home, user data directory, workspace, provider,
and test-only context-block configuration. It never enables a production default
or adds a Settings/UI control.

## Off / On Evidence

### Default off

- `runtime.contextBlock` contains no working-memory or tool-registry enablement;
  SEKB is explicitly false and `OPENCLAW_SEKB_ENABLED=0`.
- The real provider request exposes `context_read`, `context_search`, and
  `context_write` in the agent tool schemas.
- No active `working_memory`, `tool_registry`, or `task_state` Block with
  `presence.always_on === true` is present in SQLite.
- No `experience` Block is present.

Final helper metric:

| Case | Requests | Tools | Schema chars | UTF-8 bytes | CodeGraph count |
|---|---:|---:|---:|---:|---:|
| default-off | 1 | 32 | 41,573 | 41,577 | 0 |

### Test-only flags on

- `runtime.contextBlock.working-memory.enabled` and
  `runtime.contextBlock.tool-registry.enabled` are true only in the isolated
  E2E config. SEKB remains explicitly false and the environment sets it to `0`.
- The real `before_agent_start` path writes an observable `tool_registry` Block
  to SQLite.
- Real `context_write` first rejects `operation: delete`, then accepts a
  whitelisted implementer `replace` write. SQLite contains exactly one active
  `notes` Block with `source_system: agent-notes`,
  `mutability: agent_writable`, and `full_content: dcs-w5-note`.
- Real `context_read` and `context_search` are called through the agent loop.
  `context_search` returns the written marker. A subsequent read-only agent run
  leaves the saved notes rows byte-for-byte unchanged.
- No `experience` Block is present while SEKB is explicitly off.

Final helper metric:

| Case | Requests | Tools | Schema chars | UTF-8 bytes | CodeGraph count |
|---|---:|---:|---:|---:|---:|
| flags-on | 6 | 32 | 41,573 | 41,577 | 0 |

The helper records the CodeGraph count without adding a production metrics
framework. W5 does not enable CodeGraph, so its net count is zero.

## Test Implementation

| File | Evidence |
|---|---|
| `tests/e2e/dcs-production-wiring-w5.spec.ts` | Windows Electron/Gateway off/on cases, real tool calls, direct SQLite inspection, schema/tool metrics, and bounded Gateway-start recovery. |
| `openclaw_runtime/extensions/qa-lab/src/providers/mock-openai/server.ts` | Deterministic W5 model turns that use valid Responses SSE content-part, text, and function-call events; no DCS store mocking. |

The provider fixture now emits the complete Responses streaming shape required by
the actual `openai-transport-stream` parser. This repaired an E2E fixture
protocol bug that previously produced an incomplete terminal response; it did
not alter production DCS behavior.

## Final Gates

All commands were run serially from `C:\Users\27933\Desktop\clawx\ClawX`.

| Gate | Command | Exit | Key result |
|---|---|---:|---|
| Context tools unit | `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-tools.config.ts src/agents/tools/context-agent-tools.test.ts` | 0 | 1 file, 9 tests passed |
| DCS suite | `pnpm run test:dcs` | 0 | 14/152, 5/10, and 10/57 passed |
| Root typecheck | `pnpm run typecheck` | 0 | node and web projects passed |
| W5 E2E lint | `pnpm exec eslint tests/e2e/dcs-production-wiring-w5.spec.ts` | 0 | no errors |
| QA fixture lint | `pnpm --dir openclaw_runtime exec oxlint --type-aware --type-check --tsconfig=tsconfig.json --deny-warnings extensions/qa-lab/src/providers/mock-openai/server.ts` | 0 | no warnings/errors |
| DCS lint | `pnpm run lint:dcs` | 0 | type-aware DCS surface passed |
| Runtime build | `pnpm run build:runtime` | 0 | rebuilt source runtime `dist/entry.js` |
| Electron build | `pnpm run build:vite` | 0 | renderer, main, and preload built |
| W5 Windows E2E | `$env:VERSE_CLAW_E2E='1'; pnpm exec playwright test tests/e2e/dcs-production-wiring-w5.spec.ts --workers=1` | 0 | 2 passed in 5.9m |
| T3 CodeGraph regression | `$env:VERSE_CLAW_E2E='1'; pnpm exec playwright test tests/e2e/codegraph-plugin-tools-t3.spec.ts --workers=1` | 0 | 2 passed in 4.7m |

T3 final metrics retained the expected behavior:

- Default catalog/effective: 15 unique `codegraph_*` tools; `codegraph_decide`
  invoked successfully.
- Explicit `OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS=1`: zero effective CodeGraph tools.

## Remaining Debt

- **D3**: workspace authority fingerprint/invalidation remains open.
- **D7**: dual-injection observability counters remain open.
- This W5 evidence keeps SEKB explicitly off. An explicit-SEKB-on experience
  write is optional and is not covered by this Electron suite.
- The on-path store assertion uses `tool_registry` plus agent notes as the
  required observable DCS write. It does not separately force a
  `working_memory` or `task_state` Block in this scenario.
