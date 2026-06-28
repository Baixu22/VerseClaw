# Lane D AgentMap Shadow Runtime Collection

## Scope

Packaged hardened AgentMap results behind the existing explicit shadow context provider. The provider remains opt-in only and does not enter default prompt assembly, TaskLoop, Gateway, or default provider registry ordering.

## Preconditions

- `runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/lane-a-agentmap-real-repo-hardening.md` exists and reports `Status: accepted`.
- `runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/lane-b-agentmap-cache-performance-budget.md` exists and reports `Status: accepted`.
- `runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/lane-c-agentmap-fixtures-quality-audit.md` exists and reports `Status: accepted`.

## Implementation Evidence

- `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`
  - Keeps `enabledByDefault: false`, `shadowOnly: true`, and legacy-authoritative metadata.
  - Accepts hardened `AgentMapResult` values through existing explicit inputs: options, `getResult`, or `metadata.agentMapResult`.
  - Converts `AgentMapResult.diagnostics` into `RuntimeRegistryDiagnostic` entries with `readonlyAgentMap`, `shadowOnly`, `legacyAuthoritative`, `noPromptAuthority`, `noToolAuthority`, and `noRuntimeAuthority` metadata.
  - Emits each AgentMap diagnostic as an `evidence` context item, so hardened output remains diagnostics/context shadow material only.
  - Isolates provider collection failures as `provider_error` diagnostics with `providerFailureIsolated` and `legacyBehaviorUnaffected`; no exception is allowed to alter legacy providers.
- `openclaw_runtime/src/context-engine/provider-registry.ts`
  - Default `createContextProviderRegistryPilot()` ordering remains unchanged: legacy context engine, then loop context pack, then explicitly supplied extra providers.
  - AgentMap is not registered by default.

## Test Evidence

- `tests/unit/runtime-agent-map-context-provider.test.ts`
  - Verifies manifest default-off/shadow-only behavior.
  - Verifies explicit metadata injection of a hardened AgentMap result with diagnostics.
  - Verifies diagnostics are exposed only as registry diagnostics and shadow `evidence` context items.
  - Verifies provider collection failure returns structured diagnostics and no context output.
  - Verifies no-result fallback remains isolated.
- `tests/unit/context-provider-registry.test.ts`
  - Verifies flags-off returns no context/provider output and does not execute explicit AgentMap/Symbol providers.
  - Verifies AgentMap runs only when explicitly injected through `extraProviders`.
  - Verifies legacy and loop providers stay successful when explicit AgentMap collection fails.
  - Verifies default registry ordering remains legacy context engine followed by loop context pack.

## Verification

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`
  - Passed and produced the expected reading list.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`
  - Passed: spec valid.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/context-provider-registry.test.ts`
  - Passed: 2 files, 15 tests.
- `pnpm --config.verify-deps-before-run=false run typecheck`
  - Passed: node and web typecheck.
- `rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" openclaw_runtime/src/context-engine/agent-map-context-provider.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/context-provider-registry.test.ts`
  - No matches.
- `rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" openclaw_runtime/src/context-engine/agent-map-context-provider.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/context-provider-registry.test.ts`
  - No matches.
- TaskLoop/Gateway/prompt cutover review:
  - No TaskLoop, Gateway, model prompt assembly, provider transport, service, listener, daemon, database, or direct discovery tool path was changed.

## Boundary Notes

- No default AgentMap registration was added.
- No provider ordering change was made.
- No prompt assembly, TaskLoop, Gateway, host-api, api-client, renderer, or model-message path was touched.
- No read/grep/find/ls replacement or discouragement was added.
- Docs-sync review: this is internal default-off shadow runtime-readiness plumbing with no user-facing behavior, flow, or interface change, so README translation updates are not required.
- Comms replay/compare were not required because no Main/Gateway/host-api/api-client/provider transport path was touched.

Status: accepted
