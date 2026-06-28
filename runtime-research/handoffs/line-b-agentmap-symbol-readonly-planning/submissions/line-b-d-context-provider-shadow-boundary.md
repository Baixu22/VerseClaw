# line-b-d-context-provider-shadow-boundary: explicit AgentMap/Symbol context provider shadow

## Scope Confirmation

- Lane: Line B Phase 4 / Lane D context provider shadow boundary.
- Runtime code touched:
  - `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`
  - `openclaw_runtime/src/context-engine/symbol-context-provider.ts`
  - `openclaw_runtime/src/context-engine/provider-registry.ts`
- Tests touched:
  - `tests/unit/runtime-agent-map-context-provider.test.ts`
  - `tests/unit/runtime-symbol-context-provider.test.ts`
  - `tests/unit/context-provider-registry.test.ts`
- Documentation touched:
  - `runtime-research/agent-runtime-index.md`
  - this submission file

## Required Reading

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md`
- `runtime-research/agent-runtime-index.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/README.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/development-phases.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/window-prompts.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-b-context-provider-registry-pilot.md`
- `openclaw_runtime/src/runtime-core/registries.ts`
- `openclaw_runtime/src/context-engine/provider-registry.ts`
- `tests/unit/context-provider-registry.test.ts`
- Existing readonly result-shape files/tests: `openclaw_runtime/src/runtime-core/agent-map.ts`, `openclaw_runtime/src/runtime-core/symbols.ts`, `tests/unit/runtime-agent-map-contracts.test.ts`, `tests/unit/runtime-symbol-tool-contracts.test.ts`, `tests/unit/runtime-symbol-tool-readonly.test.ts`

Tooling note: `rtk` was not on PATH in this workspace. Direct `node`/`rg` commands were used after the attempted `rtk` invocation failed.

## Implementation Summary

- Added `createAgentMapContextProvider()` as an explicit shadow-only `RuntimeContextProvider` factory. It accepts an already-produced readonly `AgentMapResult` through options or query metadata and maps it to `symbol`/`summary` `ContextItem`s plus diagnostics/evidence.
- Added `createSymbolContextProvider()` as an explicit shadow-only `RuntimeContextProvider` factory. It accepts readonly symbol overviews/fallbacks/diagnostics and maps overviews to `symbol` `ContextItem`s while preserving structured fallback diagnostics.
- Extended `runContextProviderRegistryPilot()` with optional `extraProviders`, `extraProviderQueries`, and `extraProviderExtras`. No-arg `createContextProviderRegistryPilot()` ordering remains `legacy-context-engine`, then `loop-context-pack`.
- Added isolated provider execution in the registry pilot. Provider throws or invalid result shapes become `provider_error` diagnostics with `providerFailureIsolated: true`.

## Boundary Evidence

| Claim | Evidence |
|---|---|
| Flag-off emits no AgentMap/Symbol provider output | `tests/unit/context-provider-registry.test.ts` checks injected providers are not executed when registry flags are disabled. |
| Flag-on emits shadow diagnostics/evidence only | `tests/unit/runtime-agent-map-context-provider.test.ts`, `tests/unit/runtime-symbol-context-provider.test.ts`, and `tests/unit/context-provider-registry.test.ts` assert `shadowOnly`, `legacyAuthoritative`, `noPromptAuthority`, `noToolAuthority`, and `noRuntimeAuthority` metadata. |
| Default provider ordering unchanged | Existing no-extra registry test still expects only `legacy-context-engine`, then `loop-context-pack`; injected providers append only through explicit test/helper input. |
| Provider failure isolated | `tests/unit/context-provider-registry.test.ts` injects a throwing provider and receives an `error` provider result plus `provider_error` diagnostic instead of a thrown failure. |
| No TaskLoop/Gateway/chat/model prompt consumption | No TaskLoop, Gateway, renderer, Main, host-api, api-client, or prompt assembly files were changed. |
| No Symbol mutation or AST patch behavior | New Symbol provider only consumes readonly overview/fallback shapes and exposes no rename/workspace edit/apply surface. |

## Validation

- `node harness/src/cli.mjs context --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md` passed and returned the expected read order.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/context-provider-registry.test.ts` passed: 3 files / 14 tests.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-symbol-tool-contracts.test.ts tests/unit/runtime-symbol-tool-readonly.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/context-provider-registry.test.ts` passed: 6 files / 26 tests.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md` passed.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md` passed.
- Renderer IPC/Gateway bypass scan over `src/pages src/components` returned no matches.
- Service/listener/daemon/database scan over touched runtime/test files returned no matches.
- Symbol/AST mutation scan over new provider/test files returned no matches.

Typecheck note: a direct touched-slice `tsc --noEmit` probe fanned through `runtime-core/index.ts` into unrelated pre-existing syntax errors in `openclaw_runtime/src/auto-reply/reply/get-reply-directives.ts` and `openclaw_runtime/src/auto-reply/reply/get-reply.ts`, so it was not usable as proof for this lane.

## Docs Sync

No README translation updates are required because this is not a user-visible UI, CLI, host-api, Gateway, or runtime prompt behavior change. `runtime-research/agent-runtime-index.md` was updated with the new AgentMap/Symbol provider pointers and no-cutover status.

Status: accepted
