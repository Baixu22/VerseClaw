# Phase 3 Provider Tool Registry Diagnostic Collector Synthesis

Status: accepted

## Decision

Accepted as a shadow-only diagnostic collector MVP. The implementation adds a runtime-owned bounded collector contract/helper, expands tool-provider diagnostic taxonomy, and gates TaskLoop registry shadow attachment behind explicit injected diagnostics plus `runtime.registryDiagnostics.collector`. It does not approve provider ordering cutover, default provider registration, active tool authority, TaskLoop authority, prompt/model/Gateway/provider transport changes, persistence, services, listeners, or default-on registry behavior.

## Accepted / Needs Revision Lanes

| Lane | Status | Reason |
|---|---|---|
| lane-a-collector-contracts-and-flags | accepted | `openclaw_runtime/src/runtime-core/registries.ts` adds collector input/output, bounded merge helper, diagnostic taxonomy, and default-off flag resolution; strict config schema/type/help/label entries accept explicit `runtime.registryDiagnostics.collector`. |
| lane-b-context-provider-diagnostics-collector | accepted | Existing context provider diagnostics from `runContextProviderRegistryPilot()` feed the collector only through explicit helper input; prompt/message/provider-ordering parity tests pass. |
| lane-c-tool-provider-diagnostics-expansion | accepted | `electron/services/tool-provider-registry.ts` normalizes unsupported MCP content, provider exceptions, denied/waiting/cancelled-like outcomes, and error categories; built-in Git host-tool shape uses only the existing `clawx-git` adapter seam. |
| lane-d-taskloop-shadow-diagnostics-bridge | accepted | `TaskLoopControllerDeps.runtimeRegistryDiagnostics` remains the only TaskLoop input; TaskLoop shadow attachment now also requires `runtime.registryDiagnostics.collector`, preserving final status, self-check, lifecycle, and checkpoint authority. |
| lane-e-validation-comms-synthesis | accepted | Focused units, typecheck, comms replay/compare, structural harness validation, and boundary scans pass; no-diffless harness validation is blocked by unrelated pre-existing dirty files. |

No lane is `needs_revision` or `blocked`.

## Collector Surface Added

| Surface | Evidence | Accepted Boundary |
|---|---|---|
| Runtime diagnostic collector | `openclaw_runtime/src/runtime-core/registries.ts`: `RuntimeRegistryDiagnosticCollectorInput`, `RuntimeRegistryDiagnosticCollectorOutput`, `collectRuntimeRegistryDiagnostics`, `runtime.registryDiagnostics.collector`. | Bounded caller-owned diagnostics only; disabled by omission; no persistence or default registry behavior. |
| Context diagnostics collector input | `tests/unit/context-provider-registry.test.ts` uses `runContextProviderRegistryPilot().diagnostics` as collector input. | Existing context providers remain explicit/shadow-only; prompt text and message arrays stay authoritative. |
| Tool diagnostic taxonomy | `electron/services/tool-provider-registry.ts` classifies `unsupported_content`, `provider_exception`, `policy_waiting`, `policy_denied`, `tool_cancelled`, `tool_error`, and `runtime_unavailable`. | Legacy MCP response shape and approvals stay authoritative. |
| Built-in host tool diagnostic shape | `tests/unit/mcp-api.test.ts` proves `clawx-git` emits a `builtin-host-tool-compat` diagnostic through the existing adapter. | No new non-MCP transport, no new visible tools, no tool authority cutover. |
| TaskLoop collector gate | `openclaw_runtime/src/agents/task-loop-controller.ts:runtimeRegistryDiagnosticShadowEnabled`. | Explicit injected diagnostics only; `runtime.registryDiagnostics.collector` required before shadow metadata/evidence emits. |

## Behavior Change Audit

| Focus | Result |
|---|---|
| No provider ordering/default registration/default-on cutover | pass. No provider is registered by default; all flags resolve false by omission. |
| Legacy context prompt/message parity | pass. Existing context-provider tests plus collector test pass. |
| Legacy MCP response/approval semantics | pass. Tool-provider and MCP tests preserve object identity/key shape and approval waiting metadata. |
| TaskLoop authority | pass. Tests assert final status, self-check input, lifecycle payload, and checkpoint authority remain unchanged. |
| Renderer IPC/Gateway bypass | pass. `rg` scan of `src/pages` and `src/components` returned no matches. |
| Second service/listener/database | pass. Prod touched-file service/listener scan returned no matches. |
| Docs sync | pass/not required. README multilingual search reviewed; this is an internal shadow diagnostic collector with no user-visible flow change. |

## Validation Results

| Command / Test | Result | Notes |
|---|---|---|
| `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md` | pass | Run before implementation and rerun after. |
| `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md --no-diff` | pass | Structural validation passed. |
| `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md` | blocked by workspace state | Fails because many unrelated pre-existing dirty files are outside task touchedAreas. |
| `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` | pass, 5 files / 100 tests | Collector, context/tool diagnostics, MCP shape, TaskLoop bridge. |
| `pnpm --config.verify-deps-before-run=false run typecheck` | pass | Node and web typecheck. |
| `pnpm --config.verify-deps-before-run=false run comms:replay` | pass | Plain `pnpm run comms:replay` first hit pnpm dependency verification ignored-builds gate. |
| `pnpm --config.verify-deps-before-run=false run comms:compare` | pass | Comms compare completed. |
| Renderer direct IPC/Gateway scan | pass by no matches | `rg` exit 1 for pages/components scan. |
| Prod touched-file service/listener scan | pass by no matches | `rg` exit 1 for prod touched files. |

## Contract / Naming Conflicts

| Conflict | Evidence | Resolution |
|---|---|---|
| Task spec did not initially name config schema paths | Collector flag needs strict schema/type/help/label parity. | Keep schema parity in this slice; future task specs should list config files when adding flags. |
| `policy_waiting` replaces earlier waiting-as-denied diagnostic taxonomy | Tool-provider tests now assert waiting status/reason. | Accepted for diagnostic precision; approval behavior itself is unchanged. |
| No-diffless harness validation failed | Dirty workspace includes many unrelated files outside this task. | Record as validation gap; rerun on a clean task diff before merge. |

## Ready For Next Phase?

Yes, for another shadow-only integration slice. This collector MVP is accepted because every new surface is default-off or explicit, bounded, and diagnostics-only. It does not authorize a provider/tool registry cutover.

## Carry-Forward Follow-Ups

1. Rerun `harness validate` without `--no-diff` in a clean task-owned diff.
2. Consider making TaskLoop accept `RuntimeRegistryDiagnosticCollectorOutput` directly to enforce bounded collector output at the injection seam.
3. Decide whether `runtime.registryDiagnostics.collector` should become the master gate for every future registry diagnostic consumer.
4. Add more non-MCP built-in diagnostic shapes only after a safe existing adapter seam is proven.

## agent-runtime-index.md Updates To Apply

```text
Provider/Tool Registry:
  code: openclaw_runtime/src/runtime-core/registries.ts; openclaw_runtime/src/config/types.openclaw.ts; openclaw_runtime/src/config/zod-schema.ts; openclaw_runtime/src/context-engine/provider-registry.ts; electron/services/tool-provider-registry.ts; electron/services/mcp-api.ts; openclaw_runtime/src/agents/task-loop-controller.ts
  tests: tests/unit/runtime-provider-tool-registry.test.ts; tests/unit/context-provider-registry.test.ts; tests/unit/tool-provider-registry.test.ts; tests/unit/mcp-api.test.ts; tests/unit/task-loop-controller.test.ts
  status: accepted_phase_3_provider_tool_registry_diagnostic_collector_shadow_only; no default registry cutover
  feature_flags: runtime.registryDiagnostics.collector; runtime.registryPilot.enabled; runtime.providerRegistry.shadow; runtime.contextProviders.registryPilot; runtime.toolRegistry.shadow
  rollback: omit registry collector and registry shadow flags; drop injected diagnostics; legacy context/MCP/TaskLoop paths remain authoritative
  next: clean-diff harness validate and consider direct collector-output TaskLoop injection seam
```
