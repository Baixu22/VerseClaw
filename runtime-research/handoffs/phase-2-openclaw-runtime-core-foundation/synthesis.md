# Phase 2 Synthesis: OpenClaw Runtime Core Foundation

## Inputs Reviewed

| Input | Status | Notes |
|---|---|---|
| `C:\Users\27933\.codex\RTK.md` | reviewed | Commands were RTK-prefixed; direct Node commands were used when the pnpm shim could not find `node`. |
| `runtime-research/agent-runtime-index.md` | reviewed | Updated separately after this synthesis with Phase-2 pointers/status. |
| `runtime-research/migration-execution-plan.md` | reviewed | Phase 2 must remain contract/shadow-adapter only with legacy behavior preservation. |
| `runtime-research/implementation-roadmap.md` | reviewed | Runtime core first; UI changes require E2E. |
| `runtime-research/agent-runtime-core-spec.md` | reviewed | Used as target contract vocabulary for task events, context, tools, evidence, checkpoints. |
| `runtime-research/handoffs/phase-1-runtime-surface-inventory/synthesis.md` | reviewed | Baseline gaps are now addressed for the Stage-1 contract/shadow foundation. |
| Phase-2 `README.md` / `submission-template.md` | reviewed | All six canonical submissions follow required headings and evidence table columns. |
| `submissions/lane-a-runtime-core-contracts.md` | accepted | Canonical runtime-core contracts landed under `openclaw_runtime/src/runtime-core/**`. |
| `submissions/lane-b-taskloop-event-shadow.md` | accepted | TaskLoop lifecycle/checkpoint shadows are gated and sink failures are non-fatal. |
| `submissions/lane-c-tool-protocol-shadow.md` | accepted | MCP tool-call shadows use canonical runtime-core contracts; full MCP tests pass. |
| `submissions/lane-d-context-shadow-adapter.md` | accepted | LoopContextPack and LegacyContextEngine emit `ContextItem[]` shadows without prompt/message changes. |
| `submissions/lane-e-evidence-verifier-shadow.md` | accepted | Evidence verifier report is warning-only and flag-gated. |
| `submissions/lane-f-harness-and-test-wiring.md` | accepted | Harness/unit/build/E2E/boundary checks recorded; `verseshell-runtime` documented as terminal tool exception. |

## Accepted / Needs Revision Lanes

| Lane | Status | Acceptance Summary |
|---|---|---|
| `lane-a-runtime-core-contracts` | accepted | Defines canonical `RuntimeTaskEvent`, `ContextItem`, `ToolCallRequest`, `ToolCallResult`, `EvidenceRef`, and `Checkpoint` in `openclaw_runtime/src/runtime-core/**`; tests pass. |
| `lane-b-taskloop-event-shadow` | accepted | Emits TaskLoop `RuntimeTaskEvent` lifecycle/checkpoint shadows only behind `runtimeTaskEventLogShadow` / `runtimeCoreShadow`; legacy statuses remain unchanged. |
| `lane-c-tool-protocol-shadow` | accepted | MCP `callTool` emits feature-flagged shadow `ToolCallRequest` / `ToolCallResult` records while preserving legacy return shape; full MCP tests pass. |
| `lane-d-context-shadow-adapter` | accepted | `LoopContextPack` and `LegacyContextEngine` can emit shadow `ContextItem[]` without changing prompt text or message identity. |
| `lane-e-evidence-verifier-shadow` | accepted | Warning-only evidence verifier report is gated by `runtime.evidenceVerifier.shadow` and records `legacyDecisionUnaffected: true`. |
| `lane-f-harness-and-test-wiring` | accepted | Required focused unit tests, full MCP tests, combined Phase-2 unit slice, build, targeted E2E, harness validation, and boundary scan are recorded. |

No lane remains `needs_revision` for Phase-2 readiness.

## Runtime Core Surface Added

| Surface | Evidence |
|---|---|
| Runtime-core package path | `openclaw_runtime/src/runtime-core/index.ts` exports `types`, `evidence`, and `events`. |
| Task state/status contracts | `openclaw_runtime/src/runtime-core/types.ts:RUNTIME_TASK_STATUSES`; `LEGACY_RUNTIME_TASK_STATUS_MAP`. |
| `ContextItem` | `openclaw_runtime/src/runtime-core/types.ts:ContextItem`. |
| `ToolCallRequest` / `ToolCallResult` | `openclaw_runtime/src/runtime-core/types.ts:ToolCallRequest`, `ToolCallResult`; result statuses `success/error/denied/cancelled`. |
| `EvidenceRef` / `Checkpoint` | `openclaw_runtime/src/runtime-core/evidence.ts:EvidenceRef`, `Checkpoint`. |
| `RuntimeTaskEvent` | `openclaw_runtime/src/runtime-core/events.ts:RuntimeTaskEvent`, `isRuntimeTaskEvent`, `serializeRuntimeTaskEvent`, `parseRuntimeTaskEvent`. |
| Tests | `tests/unit/runtime-core-contracts.test.ts`; included by root `vitest.config.ts` via `tests/unit/**/*`. |

## Legacy Paths Wrapped

| Legacy Path | Wrapped? | Evidence / Boundary |
|---|---|---|
| `electron/services/mcp-api.ts:createMcpApiWithContext().callTool` | yes | Emits request/result/error shadows via `electron/services/tool-protocol-shadow.ts` only when `runtime.toolProtocol.mcpShadow` is true; focused and full MCP tests pass. |
| `openclaw_runtime/src/agents/task-loop-controller.ts` lifecycle/checkpoint | yes | Emits `RuntimeTaskEvent` shadows through optional sink only when `runtimeTaskEventLogShadow` or `runtimeCoreShadow` is true; sink failures are swallowed. |
| `openclaw_runtime/src/agents/loop-context-pack.ts` | yes | Adds optional `contextItems` only with `runtime.contextProviders.shadow` or `runtime.contextProviders.loopPackShadow`; prompt formatter remains unchanged. |
| `openclaw_runtime/src/context-engine/legacy.ts:LegacyContextEngine.assemble` | yes | Returns original `messages` and adds `contextItems` only when context shadow flag is true. |
| TaskLoop evidence gate projection | yes | Emits warning-only `TaskLoopEvidenceVerifierShadowReport` only when `runtime.evidenceVerifier.shadow` is true; active legacy gate remains separate. |

## Behavior Change Audit

| Focus | Result |
|---|---|
| No second runtime service | Passed for Phase-2 core. No new ClawX runtime orchestration service is accepted. `verseshell-runtime` is explicitly documented as the user-configured default terminal tool / stdio JSON-RPC adapter exception, not as Phase-2 runtime-core authority. If it later owns task orchestration, event-log authority, provider registry, or Gateway replacement behavior, it must be re-audited. |
| Runtime Core inside `openclaw_runtime` | Passed. Canonical contracts live in `openclaw_runtime/src/runtime-core/**`; adapters import these contracts. |
| Only contract/shadow, old behavior unchanged | Passed for accepted surfaces. MCP/context/taskloop/evidence verifier additions are flag-gated or contract-only; focused flag-off/parity tests pass. |
| Feature flag or shadow mode per lane | Passed. Tool: `runtime.toolProtocol.mcpShadow`; context: `runtime.contextProviders.shadow` / `loopPackShadow`; TaskLoop event: `runtimeTaskEventLogShadow` / `runtimeCoreShadow`; evidence: `runtime.evidenceVerifier.shadow`; contracts: no flag because no behavior. |
| Renderer direct IPC / Gateway HTTP bypass | Passed by static scan. Matches were rule text, preload/Main, comments, or tests; no new renderer page/component direct IPC or Gateway HTTP bypass was found. |
| UI changed and E2E | Passed. TaskLoop panel UI coverage exists and `tests/e2e/task-loop-panel.spec.ts` passed after direct Vite/Electron build. |
| Flag-off behavior unchanged | Passed for focused surfaces: MCP shadow flag-off test, context shadow flag-off tests, TaskLoop shadow/report flag-off tests. |

## Feature Flags

| Flag | Implemented? | Evidence | Validation |
|---|---|---|---|
| `runtime.toolProtocol.mcpShadow` | yes | `electron/services/tool-protocol-shadow.ts` | `tests/unit/mcp-api.test.ts -t shadow` and full MCP tests pass. |
| `runtime.contextProviders.shadow` | yes | `openclaw_runtime/src/context-engine/shadow-flags.ts`, `legacy.ts`, `loop-context-pack.ts` | `tests/unit/context-shadow-adapter.test.ts` in focused run. |
| `runtime.contextProviders.loopPackShadow` | yes | `shadow-flags.ts`, `loop-context-pack.ts` | `tests/unit/context-shadow-adapter.test.ts` in focused run. |
| `agents.defaults.taskLoop.runtimeTaskEventLogShadow` | yes | `openclaw_runtime/src/agents/task-loop-controller.ts` | `tests/unit/task-loop-controller.test.ts` in focused run. |
| `agents.defaults.taskLoop.runtimeCoreShadow` | yes | `openclaw_runtime/src/agents/task-loop-controller.ts` | `tests/unit/task-loop-controller.test.ts` in focused run. |
| `runtime.evidenceVerifier.shadow` | yes | `openclaw_runtime/src/agents/task-loop-controller.ts` | `tests/unit/task-loop-controller.test.ts` in focused run. |

## Test Evidence Matrix

| Check | Result | Covers | Notes |
|---|---|---|---|
| Submission compliance script | pass | All six lane files have required headings, Evidence Table columns, and exactly one valid Status. | Run with RTK Python one-liner. |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-contract-layer-spike.md --no-diff` | pass | Runtime contract spec structure. | `--no-diff` structural check. |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/lane-c-tool-protocol-shadow.md --no-diff` | pass | MCP shadow spec structure. | `--no-diff` structural check. |
| `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | pass, 3 files / 52 tests | Contract, context, TaskLoop event/evidence shadows. | Focused runtime foundation slice. |
| `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts -t shadow` | pass, 5 tests / 7 skipped | MCP shadow-specific behavior. | Focused lane-c shadow slice. |
| `rtk node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts` | pass, 1 file / 12 tests | MCP registry, built-in Git tools, shadows. | Removes prior stale MCP blocker. |
| `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts` | pass, 4 files / 64 tests | Combined Phase-2 unit slice. | Main readiness unit gate. |
| Renderer boundary `rg` scan | reviewed/pass | Direct IPC/Gateway bypass scan. | No new renderer page/component bypass found. |
| `rtk node --max-old-space-size=6144 ./node_modules/vite/bin/vite.js build` | pass | Frontend + Electron build for E2E. | Used direct Node because `rtk pnpm run build:vite` failed in this shell. |
| `rtk node ./node_modules/@playwright/test/cli.js test tests/e2e/task-loop-panel.spec.ts` | pass, 1 test | UI validation for TaskLoop panel changes. | Targeted Electron E2E. |

## Contract Conflicts

| Conflict | Status | Resolution |
|---|---|---|
| Duplicate same-name `ToolCallRequest` / `ToolCallResult` contracts | resolved for Phase 2 | MCP shadow adapter imports runtime-core contracts; no duplicate shared MCP shadow contract is accepted. |
| `complete/error` legacy TaskLoop names vs `completed/failed` runtime names | accepted mapping | `runtimeTaskStatusForTaskLoop` maps legacy names into canonical RuntimeTaskEvent status; legacy TaskLoop status remains unchanged. |
| `blocked/waiting` MCP bridge states vs canonical ToolCallResult status | accepted adapter metadata | Bridge state is kept in `shadow` metadata/`structuredData`; canonical result status remains `success/error/denied/cancelled`. |
| `verseshell-runtime` second-runtime false positive | documented exception | Treated as user-configured stdio terminal tool adapter, not Phase-2 runtime-core orchestration service. |
| Visible `clawx-codegraph` MCP catalog blocker | resolved/stale | Exact search over `electron/services/mcp-api.ts` and `tests/unit/mcp-api.test.ts` has no `clawx-codegraph` matches; full MCP tests pass. |

## Ready For Next Phase?

Yes.

Phase 2 is ready for Phase 3, with the following boundary:

- Phase 3 may build on the canonical contracts and accepted shadow adapters.
- Phase 3 must still follow strangler migration: no default-on provider/tool registry cutover without feature flags, fallback, and parity tests.
- `verseshell-runtime` remains a terminal tool exception only; it must not be treated as a second runtime-core authority.

## Required Fixes Before Phase 3

None blocking.

Carry-forward follow-ups:

1. Fix or document the RTK + pnpm shim issue (`rtk pnpm run build:vite` failed with `node` not recognized; direct Node build passed).
2. Add broader non-MCP tool-protocol shadow coverage before registry cutover.
3. Add a dedicated runtime provider/tool adapter harness spec before changing provider ordering.
4. Re-audit `verseshell-runtime` if its scope expands beyond terminal tool execution.

## agent-runtime-index.md Updates To Apply

Apply/update these pointers in `runtime-research/agent-runtime-index.md`:

```text
runtime_code_implementation: in_progress_phase_2_ready

Runtime Core Contracts:
  code: openclaw_runtime/src/runtime-core/types.ts; openclaw_runtime/src/runtime-core/evidence.ts; openclaw_runtime/src/runtime-core/events.ts; openclaw_runtime/src/runtime-core/index.ts
  tests: tests/unit/runtime-core-contracts.test.ts
  status: accepted; canonical contract foundation for Phase 3

Tool Invocation Protocol:
  code: electron/services/tool-protocol-shadow.ts; electron/services/mcp-api.ts
  tests: tests/unit/mcp-api.test.ts
  status: accepted for MCP shadow adapter; broader registry cutover remains future

Runtime Context Provider:
  code: openclaw_runtime/src/context-engine/types.ts; openclaw_runtime/src/context-engine/legacy.ts; openclaw_runtime/src/context-engine/shadow-flags.ts; openclaw_runtime/src/agents/loop-context-pack.ts
  tests: tests/unit/context-shadow-adapter.test.ts; tests/unit/loop-context-pack.test.ts
  status: accepted for shadow ContextItem adapters; provider ordering cutover remains future

Workflow Checkpoint Engine:
  code: openclaw_runtime/src/agents/task-loop-controller.ts; openclaw_runtime/src/agents/long-task-control/store.ts; openclaw_runtime/src/agents/long-task-control/task-ledger.ts
  tests: tests/unit/task-loop-controller.test.ts
  status: accepted for RuntimeTaskEvent lifecycle/checkpoint shadows; append-only event log remains future

Evidence Verifier:
  code: openclaw_runtime/src/agents/task-loop-controller.ts
  tests: tests/unit/task-loop-controller.test.ts
  status: accepted for warning-only evidence verifier shadow; blocking verifier remains future

Terminal Tool Exception:
  code: openclaw_runtime/src/agents/verseshell-runtime.ts; verseshell-runtime/src/server.rs
  tests: not part of Phase-2 runtime-core acceptance
  status: documented exception; user-configured stdio terminal tool, not a second runtime-core service
```
