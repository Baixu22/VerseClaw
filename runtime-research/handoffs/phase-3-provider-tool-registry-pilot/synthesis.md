# Phase 3 Synthesis: Provider and Tool Registry Pilot

## Inputs Reviewed

| Input | Status | Notes |
|---|---|---|
| `C:\Users\27933\.codex\RTK.md` | reviewed | Shell commands in this synthesis pass were run with `rtk` where process execution was needed. |
| `runtime-research/agent-runtime-index.md` | reviewed | Phase-2 status says registry cutover remains future and Phase 3 must add provider/tool registry pilot without default-on behavior changes. |
| `runtime-research/migration-execution-plan.md` | reviewed | Stage 4 allows registry work only as strangler migration with compatibility providers, feature flags, shadow metrics, and rollback. |
| `runtime-research/implementation-roadmap.md` | reviewed | Phase 3 scope is registry contracts, provider/tool normalization, policy metadata, and no renderer Gateway bypass. |
| `runtime-research/agent-runtime-core-spec.md` | reviewed | Used canonical vocabulary for context providers, tool providers, `ToolCallResult`, evidence, and state/shadow boundaries. |
| `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md` | reviewed | Phase 2 accepted runtime-core contracts and MCP/context/task-loop/evidence shadows as the foundation. |
| `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/README.md` | reviewed | Non-negotiable constraints: no second runtime service, no renderer direct IPC/Gateway HTTP, no default cutover. |
| `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/parallel-lanes.md` | reviewed | Lane scopes A-E used to classify implementation boundaries. |
| `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submission-template.md` | reviewed | All lane submissions include required headings and one valid status. |
| `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis-template.md` | reviewed | This file contains every required template section. |
| `harness/specs/tasks/phase-3-provider-tool-registry-pilot.md` | reviewed | Confirms required tests, forbidden patterns, flags, rollback, and acceptance criteria. |
| `submissions/lane-a-registry-contracts-and-flags.md` | reviewed | Accepted after code/test/boundary verification; registry contracts are default-off and runtime-owned. |
| `submissions/lane-b-context-provider-registry-pilot.md` | reviewed | Accepted after code/test verification; context providers are explicit shadow helpers, not live prompt cutover. |
| `submissions/lane-c-tool-provider-registry-pilot.md` | reviewed | Accepted after code/test/comms verification; MCP `callTool` legacy result remains authoritative. |
| `submissions/lane-d-taskloop-registry-shadow-integration.md` | reviewed | Accepted with one synthesis correction: its 4-file combined command does not cover new B/C registry tests; the separate 7-file synthesis run does. |
| `submissions/lane-e-harness-tests-boundary-docs.md` | reviewed | Accepted as validation lane; synthesis independently reran key validation commands. |

## Accepted / Needs Revision Lanes

| Lane | Status | Reason |
|---|---|---|
| lane-a-registry-contracts-and-flags | accepted | `openclaw_runtime/src/runtime-core/registries.ts` adds canonical registry contracts/flags with empty-by-default registries; `tests/unit/runtime-provider-tool-registry.test.ts` and expanded unit slice pass. |
| lane-b-context-provider-registry-pilot | accepted | `openclaw_runtime/src/context-engine/provider-registry.ts` wraps `LegacyContextEngine` and `LoopContextPack` as explicit, flag-gated shadow providers; prompt/message parity tests pass. |
| lane-c-tool-provider-registry-pilot | accepted | `electron/services/tool-provider-registry.ts` plus `electron/services/mcp-api.ts` emit `tool_provider.*` shadows behind `runtime.toolRegistry.shadow`; MCP shape parity, typecheck, and comms replay/compare pass. |
| lane-d-taskloop-registry-shadow-integration | accepted | `openclaw_runtime/src/agents/task-loop-controller.ts` consumes registry diagnostics only as `RuntimeTaskEvent` shadow metadata/evidence; focused TaskLoop tests prove final status/lifecycle/self-check/checkpoint authority unchanged. |
| lane-e-harness-tests-boundary-docs | accepted | Provides validation-only evidence; synthesis reran harness context/validate, expanded units, typecheck, boundary scans, comms replay/compare, and submission audit. |

No lane is `needs_revision` or `blocked`.

## Registry Surface Added

| Surface | Evidence | Accepted Boundary |
|---|---|---|
| Runtime registry contracts and validators | `openclaw_runtime/src/runtime-core/registries.ts`: `RuntimeContextProviderManifest`, `RuntimeToolProviderManifest`, `RuntimeContextProviderRegistry`, `ToolProviderRegistry`, `resolveRuntimeRegistryFeatureFlags`, `isolateRuntimeRegistryError`; exported by `openclaw_runtime/src/runtime-core/index.ts`; alias in `openclaw_runtime/src/runtime-core/registry.ts`. | Runtime-core contracts only; registries are empty unless callers explicitly pass providers. No service, daemon, or default live provider is added. |
| Registry config flags | `openclaw_runtime/src/config/types.openclaw.ts`, `zod-schema.ts`, `schema.labels.ts`, `schema.help.ts`; test `tests/unit/runtime-provider-tool-registry.test.ts`. | Optional/default-off config fields; absence resolves to all false. |
| Context compatibility providers | `openclaw_runtime/src/context-engine/provider-registry.ts`: `createLegacyContextEngineProvider`, `createLoopContextPackProvider`, `createContextProviderRegistryPilot`, `runContextProviderRegistryPilot`. | Explicit helper only; not imported by live context/task-loop paths. Requires `runtime.registryPilot.enabled` + `runtime.providerRegistry.shadow` + `runtime.contextProviders.registryPilot` to run. |
| MCP tool compatibility provider | `electron/services/tool-provider-registry.ts`: `MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST`, `createMcpToolProviderRegistryRequestShadow`, `createMcpToolProviderRegistryResultShadow`, `emitMcpToolProviderRegistryShadow`; integration in `electron/services/mcp-api.ts:createMcpApiWithContext().callTool`. | Existing Electron Main adapter shadow only; legacy `McpCallToolResult` remains return authority. |
| TaskLoop registry diagnostic shadow bridge | `openclaw_runtime/src/agents/task-loop-controller.ts`: `TaskLoopControllerDeps.runtimeRegistryDiagnostics`, `runtimeRegistryDiagnosticShadowEnabled`, `runtimeRegistryEvidenceRefsForShadow`, `emitTaskLoopLifecycleShadow`, `emitTaskLoopCheckpointShadow`. | Shadow `RuntimeTaskEvent` metadata/evidence only; no registry refs in self-check context, legacy lifecycle payload, returned final status, or persisted checkpoint authority. |

## Legacy Paths Wrapped

| Legacy Path | Registry / Adapter | Feature Flag | Parity Evidence |
|---|---|---|---|
| `openclaw_runtime/src/context-engine/legacy.ts:LegacyContextEngine.assemble` | `createLegacyContextEngineProvider()` emits shadow `ContextItem[]` and diagnostics. | `runtime.registryPilot.enabled` + `runtime.providerRegistry.shadow` + `runtime.contextProviders.registryPilot`; uses existing `runtime.contextProviders.shadow` internally for shadow extraction. | `tests/unit/context-provider-registry.test.ts` and `tests/unit/context-shadow-adapter.test.ts` pass; assertions cover message identity/order preservation. |
| `openclaw_runtime/src/agents/loop-context-pack.ts:buildLoopContextPack` / `formatLoopContextPackForPrompt` | `createLoopContextPackProvider()` compares baseline vs shadow pack/prompt/hash and emits diagnostics. | Same context registry flags above; uses existing `runtime.contextProviders.loopPackShadow` internally for shadow extraction. | `tests/unit/context-provider-registry.test.ts` asserts `promptTextUnchanged` and `packHashUnchanged`; `context-shadow-adapter` tests pass. |
| `electron/services/mcp-api.ts:createMcpApiWithContext().callTool` | `electron/services/tool-provider-registry.ts` wraps MCP request/result shadows and normalized `ToolCallResult` evidence. | `runtime.toolRegistry.shadow`; existing `runtime.toolProtocol.mcpShadow` remains independent. | `tests/unit/tool-provider-registry.test.ts` asserts identity/JSON/key-shape parity and flag-off no-op; `tests/unit/mcp-api.test.ts` passes; comms replay/compare pass. |
| `openclaw_runtime/src/agents/task-loop-controller.ts` lifecycle/checkpoint shadows | Optional `runtimeRegistryDiagnostics` dependency is filtered into shadow evidence only. | Existing `runtimeTaskEventLogShadow` or `runtimeCoreShadow` plus registry surface flags; `runtime.evidenceVerifier.shadow` remains independent. | `tests/unit/task-loop-controller.test.ts` passes, including flag-on/flag-off registry diagnostics tests. |

## Behavior Change Audit

| Focus | Result |
|---|---|
| No second runtime service | pass. Touched-file service scan only found existing `electron/services/mcp-api.ts:createServer` config CRUD method; no `listen`, HTTP/WS server, port, Gateway instance, or `verseshell-runtime` authority was introduced. |
| Runtime registry inside allowed paths | pass. Canonical registry/core code lives under `openclaw_runtime/**`; the MCP tool wrapper is in existing Electron Main adapter files (`electron/services/**`), which Phase 3 explicitly allowed. |
| Legacy behavior unchanged with flags off | pass. Expanded unit slice passed 7 files / 80 tests; flag-off tests cover registry flags, context provider pilot, tool registry shadows, and TaskLoop registry diagnostics. |
| Shadow/pilot flags for every lane | pass. Lane A is contracts/default-off flags; Lane B is strict triple-gated; Lane C is `runtime.toolRegistry.shadow`; Lane D requires TaskLoop shadow flag plus surface registry flags; Lane E is validation-only. |
| Renderer direct IPC / Gateway HTTP bypass | pass. Focused `src/pages` / `src/components` scan had no matches; broad scan matches were existing preload/Main/tests/i18n/rule-text/comment/url-helper cases, not Phase-3 renderer code. |
| UI changes have E2E | not applicable. No lane touched renderer UI or visible MCP catalog behavior; targeted Electron E2E was not required or run. |

## Feature Flags

| Flag | Default | Evidence | Rollback |
|---|---|---|---|
| `runtime.registryPilot.enabled` | false / absent means false | `RUNTIME_REGISTRY_FLAG_PATHS` and `DEFAULT_RUNTIME_REGISTRY_FEATURE_FLAGS` in `openclaw_runtime/src/runtime-core/registries.ts`; `tests/unit/runtime-provider-tool-registry.test.ts`. | Disable/omit the flag; context registry pilot does not run. |
| `runtime.providerRegistry.shadow` | false / absent means false | `resolveRuntimeRegistryFeatureFlags` in `registries.ts`; Lane B/D context gate tests. | Disable/omit the flag; provider diagnostics stay disabled. |
| `runtime.contextProviders.registryPilot` | false / absent means false | Config schema in `openclaw_runtime/src/config/zod-schema.ts`; context provider tests. | Disable/omit the flag; legacy context remains authoritative. |
| `runtime.toolRegistry.shadow` | false / absent means false | `isMcpToolProviderRegistryShadowEnabled` in `electron/services/tool-provider-registry.ts`; `tests/unit/tool-provider-registry.test.ts`. | Disable/omit the flag; no MCP registry shadow records are emitted. |
| `runtime.toolProtocol.mcpShadow` | existing Phase-2 shadow flag, independent | `electron/services/tool-protocol-shadow.ts`; `tests/unit/mcp-api.test.ts`. | Disable existing MCP protocol shadows; registry wrapper can also be disabled independently. |
| `runtime.contextProviders.shadow` / `runtime.contextProviders.loopPackShadow` | existing Phase-2 shadow flags, independent | `openclaw_runtime/src/context-engine/shadow-flags.ts`; `tests/unit/context-shadow-adapter.test.ts`. | Disable existing context shadow extraction; prompt/message legacy paths remain authoritative. |
| `runtimeTaskEventLogShadow` / `runtimeCoreShadow` | existing TaskLoop shadow flags, independent | `openclaw_runtime/src/agents/task-loop-controller.ts`; `tests/unit/task-loop-controller.test.ts`. | Disable TaskLoop shadow event emission; legacy lifecycle/checkpoint behavior remains. |
| `runtime.evidenceVerifier.shadow` | existing warning-only verifier flag, independent | Phase-2 accepted surface in `task-loop-controller.ts`; existing TaskLoop tests. | Disable verifier shadow reports; registry diagnostics are not a completion gate. |

## Test Evidence Matrix

| Command / Test | Result | Covers | Gaps |
|---|---|---|---|
| `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md` | pass | Harness read order for Phase-3 task/scenario/rules/layers. | None. |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | pass | Phase-3 task spec structural validation. | `--no-diff` only; no harness spec edits were made. |
| `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/context-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/task-loop-controller.test.ts` | pass, 7 files / 80 tests | Runtime contracts, registry contracts, context registry pilot, MCP registry pilot, existing MCP behavior, TaskLoop shadow integration, flag-off/parity coverage. | None. |
| `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | TypeScript check for Node/runtime surfaces touched by Phase 3. | Standard `rtk pnpm run typecheck:node` remains affected by known local pnpm shim issue reported in lanes. |
| `rtk rg -n 'window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789' src/pages src/components --glob '!**/*.md'` | pass by no matches (`rg` exit 1) | Renderer page/component direct IPC and Gateway endpoint audit. | None. |
| `rtk rg -n 'window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | reviewed/pass for Phase 3 | Broad boundary audit. | Existing matches are preload/Main/tests/i18n/rule text/comment/url-helper cases, not new renderer bypasses. |
| `rtk rg -n 'createServer|listen\\(|new WebSocketServer|WebSocketServer|http\\.createServer|net\\.createServer|127\\.0\\.0\\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/context-engine/provider-registry.ts electron/services/tool-provider-registry.ts electron/services/mcp-api.ts openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/task-loop-controller.test.ts` | reviewed/pass | No second runtime service in Phase-3 touched files. | One existing `electron/services/mcp-api.ts:createServer` config method is not a listener/service. |
| `rtk node scripts/comms/replay.mjs` | pass | Communication replay after Lane C touched `electron/services/mcp-api.ts`. | None. |
| `rtk node scripts/comms/compare.mjs` | pass | Communication baseline compare after Lane C touched `electron/services/mcp-api.ts`. | None. |
| Submission heading/status audit via `rtk python -c ...` | pass | All `lane-*.md` files include required sections and exactly one accepted status. | Structural audit only; synthesis performed independent code/test review. |
| Targeted Electron E2E | not-run | UI/user-visible validation. | Not applicable: no renderer UI or visible catalog behavior changed. |

## Contract / Naming Conflicts

| Conflict | Evidence | Required Resolution |
|---|---|---|
| `registries.ts` vs `registry.ts` naming | `openclaw_runtime/src/runtime-core/registries.ts` is canonical; `openclaw_runtime/src/runtime-core/registry.ts` only re-exports it. | Keep `registries.ts` as the source of truth; remove the alias later only if no imports need it. |
| Context registry gating differs from tool registry gating | Lane B/D context diagnostics require `runtime.registryPilot.enabled` + `runtime.providerRegistry.shadow` + `runtime.contextProviders.registryPilot`; Lane C tool diagnostics require only `runtime.toolRegistry.shadow`. | Decide whether `runtime.registryPilot.enabled` should become a master gate for tool registry shadows before expanding beyond MCP diagnostics. Not blocking for this pilot because all flags default off. |
| Approval waiting uses `policy_denied` diagnostic reason | `electron/services/tool-provider-registry.ts:resultDiagnostic` maps `permission/waiting` to `policy_denied`; tests assert approval remains adapter metadata. | Consider adding a more precise `policy_waiting` / `permission_waiting` reason before policy evaluator cutover. Do not change current approval behavior in Phase 3. |
| TaskLoop has a diagnostic consumer seam, not end-to-end B/C collector wiring | `TaskLoopControllerDeps.runtimeRegistryDiagnostics` accepts injected diagnostics; no shared collector currently connects real Lane B/C diagnostics into a task run. | Do not claim full end-to-end registry diagnostics flow yet. Next slice should add a runtime-owned collector behind flags. |
| Lane D submission overstates one combined command's coverage | Lane D's 4-file command omits `runtime-provider-tool-registry`, `context-provider-registry`, and `tool-provider-registry` tests. | Synthesis relies on the independent 7-file / 80-test expanded run for A-D combined acceptance. |
| Registry evidence ref naming | TaskLoop uses `runtime-registry:<surface>:<providerId>:<reason>` as shadow evidence refs. | Accepted for Phase 3 shadow evidence; keep out of persisted checkpoint authority until a later schema/cutover decision. |
| Existing `mcp-api.ts:createServer` service-scan false positive | Touched-file service scan finds `createServer` at `electron/services/mcp-api.ts:909`, which is MCP server configuration CRUD and calls `dispatchReload`, not a listener. | Keep documenting this false positive in future scans; still reject any real `listen`/HTTP/WS/Gateway service added for registries. |

## Ready For Next Phase?

Yes, for the next shadow migration slice.

Phase 3 is accepted as a provider/tool registry pilot because the registry surfaces are default-off, shadow-only, and reversible; legacy context prompts, MCP responses/approvals, and TaskLoop status/checkpoint authority remain unchanged under flags off. This does **not** authorize a default-on provider/tool registry cutover. The next work should remain a shadow/collector or broader adapter-coverage slice unless it adds explicit parity gates, rollout/rollback criteria, and tests.

## Required Fixes Before Next Phase

None blocking.

Carry-forward follow-ups:

1. Decide whether `runtime.registryPilot.enabled` should be a master gate for `runtime.toolRegistry.shadow`.
2. Add a runtime-owned registry diagnostic collector that wires real Lane B/C diagnostics into `TaskLoopControllerDeps.runtimeRegistryDiagnostics` without making TaskLoop the registry authority.
3. Add broader tool registry coverage for unsupported MCP content, thrown provider exceptions, and non-MCP built-in tools before any cutover.
4. Consider a more precise diagnostic reason for approval waiting instead of `policy_denied`.
5. Keep `verseshell-runtime` documented as a stdio terminal tool exception only; re-audit if its scope expands.

## agent-runtime-index.md Updates To Apply

```text
Provider/Tool Registry:
  code: openclaw_runtime/src/runtime-core/registries.ts; openclaw_runtime/src/runtime-core/registry.ts; openclaw_runtime/src/runtime-core/index.ts; openclaw_runtime/src/config/types.openclaw.ts; openclaw_runtime/src/config/zod-schema.ts; openclaw_runtime/src/context-engine/provider-registry.ts; electron/services/tool-provider-registry.ts; electron/services/mcp-api.ts; openclaw_runtime/src/agents/task-loop-controller.ts
  tests: tests/unit/runtime-provider-tool-registry.test.ts; tests/unit/context-provider-registry.test.ts; tests/unit/tool-provider-registry.test.ts; tests/unit/runtime-core-contracts.test.ts; tests/unit/context-shadow-adapter.test.ts; tests/unit/mcp-api.test.ts; tests/unit/task-loop-controller.test.ts
  status: accepted_phase_3_registry_pilot_shadow_only; no default registry cutover
  feature_flags: runtime.registryPilot.enabled; runtime.providerRegistry.shadow; runtime.contextProviders.registryPilot; runtime.toolRegistry.shadow; existing runtime.toolProtocol.mcpShadow; existing runtime.contextProviders.shadow/loopPackShadow; existing runtimeTaskEventLogShadow/runtimeCoreShadow
  rollback: disable registry and adapter shadow flags; legacy context/MCP/TaskLoop paths remain authoritative
  next: add registry diagnostic collector and broader tool-provider shadow coverage before any provider ordering or tool authority cutover
```
