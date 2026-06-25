# lane-d-taskloop-registry-shadow-integration: TaskLoop consumes registry diagnostics as shadow evidence only

## Scope Confirmation

- Lane: `lane-d-taskloop-registry-shadow-integration`
- Output file: `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-d-taskloop-registry-shadow-integration.md`
- Lane-owned file only: yes
- Implementation paths touched: `openclaw_runtime/src/agents/task-loop-controller.ts`
- Test paths touched: `tests/unit/task-loop-controller.test.ts`
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md` — pass
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts` — pass, 45 tests
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` — pass, 66 tests
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` — pass
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` — pass
  - `rtk pnpm run typecheck:node` — not usable in this shell because pnpm shim could not find `"node"`; direct Node tsc command above passed
  - Boundary scans listed under `Tests And Harness Evidence`
- Required reading completed: `runtime-research/agent-runtime-index.md`; `runtime-research/migration-execution-plan.md`; `runtime-research/implementation-roadmap.md`; `runtime-research/agent-runtime-core-spec.md`; `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md`; Phase-3 `README.md`, `parallel-lanes.md`, `submission-template.md`; `harness/specs/tasks/phase-3-provider-tool-registry-pilot.md`; `C:\Users\27933\.codex\RTK.md`.

## Executive Summary

- Added a TaskLoop-only registry diagnostics bridge that accepts `RuntimeRegistryDiagnostic[]` through `TaskLoopControllerDeps.runtimeRegistryDiagnostics`.
- Registry diagnostics are converted into RuntimeTaskEvent shadow metadata and evidence refs only when TaskLoop shadow emission is already enabled and the relevant registry flags are enabled.
- Context diagnostics follow Lane B's strict gate: `runtime.registryPilot.enabled` + `runtime.providerRegistry.shadow` + `runtime.contextProviders.registryPilot`.
- Tool diagnostics follow Lane C's gate: `runtime.toolRegistry.shadow`.
- Lifecycle shadow events now include `payload.metadata.registryDiagnostics` and registry evidence refs; checkpoint shadow events include registry evidence refs and registry diagnostics in shadow trace attributes.
- Legacy lifecycle event payloads, TaskLoop final status, self-check context/decision, and persisted checkpoint payloads remain unchanged.
- Registry fallback reasons are represented as `runtime-registry:<surface>:<providerId>:<reason>` evidence refs with `legacyDecisionUnaffected` and `finalTaskStatusUnaffected` metadata.
- `runtimeTaskEventLogShadow` / `runtimeCoreShadow`, registry flags, and `runtime.evidenceVerifier.shadow` remain independent; registry diagnostics do not enable event emission by themselves and do not require evidence verifier shadow.
- Focused TaskLoop tests, combined Phase-3 runtime unit slice, harness validation, and direct Node typecheck passed.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| TaskLoop accepts registry diagnostics without adding a service or renderer path. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `TaskLoopRuntimeRegistryDiagnosticsProvider` lines 84-87; `TaskLoopControllerDeps.runtimeRegistryDiagnostics` line 281 | Optional dependency only; no daemon/transport introduced. |
| Registry diagnostics attach only after registry flags are enabled. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `runtimeRegistryDiagnosticShadowEnabled` lines 1055-1068; `resolveRuntimeRegistryFeatureFlags` use lines 1792-1798 | Context gate mirrors Lane B; tool gate mirrors Lane C. |
| Registry fallback reason becomes shadow evidence, not final failure. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `registryDiagnosticShadowEvidenceRef` lines 1079-1101; `runtimeRegistryEvidenceRefsForShadow` lines 1128-1137 | Evidence ref includes `runtime-registry:<surface>:<providerId>:<reason>`, `legacyDecisionUnaffected`, and `finalTaskStatusUnaffected`. |
| Lifecycle RuntimeTaskEvent shadows carry registry metadata/evidence only in shadow payload. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `emitTaskLoopLifecycleShadow` lines 1367-1413 | Legacy `TaskLoopLifecycleEvent` is built in `emit` before shadow emission; registry metadata is not added to `event`. |
| Checkpoint shadow events carry registry evidence without mutating checkpoint authority. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `emitTaskLoopCheckpointShadow` lines 1417-1454; `recordTaskLoopCheckpoint` lines 1458-1528 | Registry refs are added to shadow event evidence only, not `checkpoint.evidenceRefs` or writer metadata. |
| Flag-on test proves complete status, lifecycle payload, self-check context, and checkpoint payload stay legacy. | test | `tests/unit/task-loop-controller.test.ts` | `attaches registry diagnostics to TaskLoop shadow events without changing legacy decisions` lines 794-906 | Asserts status complete, no registry in self-check context/lifecycle/checkpoint JSON, and registry evidence in shadow events. |
| Flag-off test proves no registry diagnostics attach even with RuntimeTaskEvent shadow enabled. | test | `tests/unit/task-loop-controller.test.ts` | `does not attach registry diagnostics when registry flags are off` lines 908-941 | Asserts shadows still emit but no registry evidence/metadata appears. |
| Required focused test command passed. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts` | 1 file / 45 tests passed | Required Lane D command. |
| Combined Phase-3 runtime unit slice passed. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` | 4 files / 66 tests passed | Covers registry contracts, context/tool pilots, and TaskLoop shadow integration. |
| Harness spec is structurally valid. | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | pass | Spec validation evidence for Phase 3. |
| Node typecheck passed for touched runtime/TestScript surface. | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Used direct Node because `rtk pnpm run typecheck:node` failed on the local pnpm shim. |
| Lane files do not introduce renderer direct IPC/Gateway calls. | missing-after-search | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts` | no matches, `rg` exit 1 | No lane-file boundary matches. |
| Lane files do not introduce a second runtime service/listener. | missing-after-search | `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|18789' openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts` | no matches, `rg` exit 1 | No service, port, HTTP, WS, or listener additions. |
| Full renderer/Main boundary scan was reviewed. | command | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | reviewed; matches are pre-existing preload/Main/tests/i18n/rule text, not Lane D files | No Lane D renderer/API transport changes. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/agents/task-loop-controller.ts` imports `resolveRuntimeRegistryFeatureFlags` and registry diagnostic types from the canonical runtime-core registry contracts.
- Added `TaskLoopRuntimeRegistryDiagnosticsProvider` and optional `TaskLoopControllerDeps.runtimeRegistryDiagnostics` for adapters/tests to supply registry diagnostics without changing TaskLoop runtime authority.
- Extended the existing TaskLoop shadow WeakMap with `runtimeRegistryFlags` and an optional diagnostics provider.
- Added helpers to filter diagnostics by surface flags, normalize diagnostics into shadow metadata, and synthesize/dedupe registry evidence refs.
- `emitTaskLoopLifecycleShadow` appends registry metadata/evidence only to `RuntimeTaskEvent` shadows.
- `emitTaskLoopCheckpointShadow` appends registry evidence to the shadow event and registry diagnostics to shadow trace attributes, while leaving `RuntimeResumeCheckpoint` unchanged.

Tests:

- Added `registryFallbackDiagnostics()` fixture in `tests/unit/task-loop-controller.test.ts`.
- Added flag-on TaskLoop test proving registry fallback diagnostics appear in completed/checkpoint shadow events while final status, lifecycle, self-check input, and checkpoint writer payload remain unchanged.
- Added flag-off TaskLoop test proving registry diagnostics do not attach when registry flags are disabled, even if `runtimeTaskEventLogShadow` is enabled.

Feature flags:

- TaskLoop shadow event emission still requires `runtimeTaskEventLogShadow` or `runtimeCoreShadow`.
- Registry context diagnostics require `runtime.registryPilot.enabled`, `runtime.providerRegistry.shadow`, and `runtime.contextProviders.registryPilot`.
- Registry tool diagnostics require `runtime.toolRegistry.shadow`.
- `runtime.evidenceVerifier.shadow` is not required for registry diagnostics and remains independent.

Harness/spec changes:

- No harness spec files changed in Lane D.

## Registry Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| TaskLoop diagnostics input | `TaskLoopControllerDeps.runtimeRegistryDiagnostics?: RuntimeRegistryDiagnostic[] | (() => RuntimeRegistryDiagnostic[])` | shadow-only dependency injection; no active registry execution | registry surface flags plus existing TaskLoop shadow flag | `openclaw_runtime/src/agents/task-loop-controller.ts:84-87`, `:281`, `:1792-1798` |
| Context registry diagnostic | `RuntimeRegistryDiagnostic.surface === "context"` | metadata/evidence refs on TaskLoop `RuntimeTaskEvent` only | `runtime.registryPilot.enabled` + `runtime.providerRegistry.shadow` + `runtime.contextProviders.registryPilot` | `runtimeRegistryDiagnosticShadowEnabled` lines 1055-1068; test lines 810-816 and 866-896 |
| Tool registry diagnostic | `RuntimeRegistryDiagnostic.surface === "tool"` | metadata/evidence refs on TaskLoop `RuntimeTaskEvent` only | `runtime.toolRegistry.shadow` | `runtimeRegistryDiagnosticShadowEnabled` lines 1065-1067 |
| Registry fallback evidence | synthetic `EvidenceRef` plus original diagnostic refs with registry metadata | shadow-only / final status unaffected | same surface flags | `registryDiagnosticShadowEvidenceRef` lines 1079-1101; `runtimeRegistryEvidenceRefsForShadow` lines 1128-1137 |
| Lifecycle shadow event | `emitTaskLoopLifecycleShadow(record, deps, lifecycleEvent)` | `RuntimeTaskEvent` shadow only; no legacy lifecycle mutation | existing `runtimeTaskEventLogShadow` / `runtimeCoreShadow` plus registry flags | `openclaw_runtime/src/agents/task-loop-controller.ts:1367-1413` |
| Checkpoint shadow event | `emitTaskLoopCheckpointShadow(record, deps, checkpoint, reviewNeededItems)` | shadow event evidence only; persisted checkpoint remains authoritative legacy payload | existing `runtimeTaskEventLogShadow` / `runtimeCoreShadow` plus registry flags | `openclaw_runtime/src/agents/task-loop-controller.ts:1417-1454`; test lines 848-905 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop final status/result | Registry fallback diagnostics do not affect `record.status`, `record.phase`, `finalSummary`, or returned result. | Flag-on test asserts `{ status: 'complete', phase: 'complete' }` at `tests/unit/task-loop-controller.test.ts:834`; focused Vitest command passed. | Low; helpers are only called inside shadow builders. |
| Legacy lifecycle callback | `deps.lifecycle` receives the same `TaskLoopLifecycleEvent` shape; registry metadata is not attached to that object. | Flag-on test asserts lifecycle final event and `.not.toHaveProperty('registryDiagnostics')` at `tests/unit/task-loop-controller.test.ts:841-846`. | Low; registry metadata is added after `deps.lifecycle?.(event)` inside shadow builder path. |
| Self-check decision authority | Self-check receives the existing TaskLoop context pack built from legacy evidence; registry evidence is not fed into `contextPack` or self-check gating. | Flag-on test inspects self-check input and asserts no `runtime-registry:` content at `tests/unit/task-loop-controller.test.ts:836-840`. | Low; registry diagnostics are not written into `record.evidenceRefs`. |
| Checkpoint writer authority | Persisted checkpoint and writer input keep legacy evidence refs/metadata; registry evidence is only in shadow RuntimeTaskEvent evidence. | Flag-on test asserts checkpoint JSON contains no `runtime-registry:` and no checkpoint metadata registry field at `tests/unit/task-loop-controller.test.ts:848-864`, while shadow checkpoint has registry evidence at lines 898-905. | Medium; future adapters must not move registry refs into `record.evidenceRefs` without explicit cutover. |
| Evidence verifier shadow | Warning-only evidence verifier report remains separately gated by `runtime.evidenceVerifier.shadow`; registry diagnostics do not require or create it. | Flag-on test leaves evidence verifier flag off and asserts `result.evidenceVerifierReport` is undefined at `tests/unit/task-loop-controller.test.ts:834-835`. | Low; existing verifier functions unchanged. |
| Flag-off registry behavior | With registry flags disabled, RuntimeTaskEvent shadows can still emit but contain no registry metadata/evidence. | Flag-off test at `tests/unit/task-loop-controller.test.ts:908-941`; focused Vitest command passed. | Low; default `resolveRuntimeRegistryFeatureFlags` values are false. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Required Phase-3 context command | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md` | pass | Required task-spec context/read order. | None. |
| Focused Lane D TaskLoop tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts` | pass; 1 file / 45 tests | Required Lane D command; flag-on/off registry shadow tests plus existing TaskLoop lifecycle/checkpoint/verifier tests. | None. |
| Combined Phase-3 runtime unit slice | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` | pass; 4 files / 66 tests | Registry contracts, context provider pilot, MCP tool shadows, TaskLoop integration. | None. |
| Harness spec validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-3-provider-tool-registry-pilot.md --no-diff` | pass | Phase-3 task spec structural validation. | Used `--no-diff` because Lane D did not edit harness specs. |
| Node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | TypeScript coverage for Node/runtime surfaces touched by Lane D. | `rtk pnpm run typecheck:node` failed due local pnpm shim issue; direct Node tsc passed. |
| Full direct IPC/Gateway boundary scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | reviewed/pass for Lane D | Confirms no Lane D files in matches; matches are pre-existing preload/Main/test/i18n/rule-text paths. | Full repo has known legacy/test matches unrelated to Lane D. |
| Lane-file direct IPC/Gateway scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts` | pass by no matches (`rg` exit 1) | Ensures Lane D files add no renderer direct IPC/Gateway refs. | None. |
| Lane-file second-runtime scan | `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|18789' openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts` | pass by no matches (`rg` exit 1) | Ensures no service/port/listener added by Lane D. | None. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass | Lane-file service scan found no `createServer`, `listen`, WS server, HTTP server, net server, or `18789` matches in `openclaw_runtime/src/agents/task-loop-controller.ts` / `tests/unit/task-loop-controller.test.ts`. |
| No renderer direct IPC | pass | Lane D touched no renderer files; lane-file IPC scan has no matches. Full scan matches are pre-existing preload/Main/tests/i18n/rule text, not Lane D code. |
| No renderer direct Gateway HTTP/WS | pass | Lane D touched no renderer files; lane-file Gateway scan has no matches. Full scan reviewed and no Lane D files appear. |
| Feature flags default safe | pass | `runtimeRegistryDiagnosticShadowEnabled` requires explicit registry flags; flag-off test proves no registry metadata/evidence attaches by default. |
| Flag-off parity covered | pass | Existing flag-off TaskLoop test still passes; new registry flag-off test passes; combined Phase-3 unit slice passes. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| No shared runtime registry diagnostic aggregator exists yet between Lane B/C and TaskLoop. | Lane D adds `TaskLoopControllerDeps.runtimeRegistryDiagnostics` as an injection seam; tests provide diagnostics directly. | TaskLoop should consume diagnostics emitted by provider/tool registry pilots without becoming registry authority. | Next slice should add a small runtime-owned collector/adapter that passes Lane B/C diagnostics into TaskLoop deps, still behind flags. |
| Context and tool registry flag semantics differ by lane. | Lane B requires all three context flags; Lane C uses `runtime.toolRegistry.shadow`; Lane D mirrors these surface gates. | Registry pilot should be predictable and reversible. | Synthesis/maintainer should decide whether `runtime.registryPilot.enabled` is a master gate for tools too. Until then, preserving lane-specific gates minimizes behavior drift. |
| Checkpoint shadow can carry registry diagnostics in trace attributes, but checkpoint payload itself cannot without mutating checkpoint authority. | `emitTaskLoopCheckpointShadow` adds registry evidence refs to the shadow event and diagnostics to `traceContext.attributes`, not to `payload.checkpoint`. | Attach diagnostics/evidence to TaskLoop shadow events while preserving checkpoint authority. | Keep this shape for Phase 3; a later event-log schema could add an explicit diagnostic payload field if accepted. |

## Status

Choose exactly one:

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Runtime registry diagnostic collector wiring for TaskLoop
New code path: runtime-owned collector/adapter that accumulates ContextProviderRegistry and ToolProviderRegistry diagnostics per TaskLoop run and passes them through TaskLoopControllerDeps.runtimeRegistryDiagnostics
Legacy path wrapped: existing LoopContextPack/LegacyContextEngine and MCP callTool compatibility registry pilots
Shadow / pilot boundary: registry diagnostics remain RuntimeTaskEvent shadow metadata/evidence only; no prompt/tool/status/checkpoint authority change
Feature flag: runtimeTaskEventLogShadow or runtimeCoreShadow plus runtime.registryPilot.enabled/runtime.providerRegistry.shadow/runtime.contextProviders.registryPilot for context and runtime.toolRegistry.shadow for tools
Tests: extend tests/unit/task-loop-controller.test.ts or add an integration unit proving real Lane B/C diagnostics reach TaskLoop shadows without changing lifecycle/checkpoint payloads
Harness: rerun phase-3-provider-tool-registry-pilot validate and combined Phase-3 unit slice
Rollback: disable registry flags or stop passing runtimeRegistryDiagnostics; legacy TaskLoop behavior remains authoritative
Done when: diagnostics from actual context/tool registry pilot records appear in TaskLoop shadows with no registry refs in self-check context, legacy lifecycle events, or persisted checkpoints
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should `runtime.registryPilot.enabled` become a master gate for `runtime.toolRegistry.shadow` diagnostics? | Lane C currently uses only `runtime.toolRegistry.shadow`, while Lane B requires the global pilot/provider flags too. | maintainer/synthesis owner | no |
| Where should cross-surface registry diagnostics be accumulated for a TaskLoop run? | A collector is needed to connect Lane B/C diagnostics to the Lane D injection seam without making TaskLoop the registry authority. | maintainer/agent | no |
| Should checkpoint RuntimeTaskEvent payload gain a first-class diagnostics field in a later schema? | Current Phase 3 preserves checkpoint authority by keeping diagnostics outside `payload.checkpoint`; future event-log consumers may prefer a typed diagnostic field. | maintainer/synthesis owner | no |

## Handoff Notes

- Lane D did not start or configure any runtime service, daemon, HTTP server, WebSocket server, Gateway instance, renderer IPC route, or renderer Gateway transport.
- `verseshell-runtime` remains outside this lane and is not used as provider/tool registry authority.
- Registry diagnostics are intentionally not written into `record.evidenceRefs`, self-check context packs, legacy lifecycle events, or persisted checkpoints.
- The new `runtimeRegistryDiagnostics` deps seam is only a consumer shape; synthesis should not claim end-to-end Lane B/C-to-TaskLoop wiring until a later slice wires a collector.
- Direct `pnpm` typecheck remains affected by the local pnpm shim (`"node"` not found); direct Node tsc passed and mirrors the Phase-2 documented workaround.
