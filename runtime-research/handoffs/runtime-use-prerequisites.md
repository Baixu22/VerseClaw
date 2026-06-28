# Runtime Use Prerequisites

Status: accepted_runtime_use_prerequisites_complete

Controlled Runtime-Use Readiness Status: accepted_controlled_runtime_use_readiness

## Accepted Prerequisite Surfaces

- AST Patch Planner readonly scan MVP: `openclaw_runtime/src/runtime-core/ast-patch-planner.ts` exposes explicit runtime-core helpers for TypeScript/TSX rule validation, explicit in-memory target scanning, ordered match evidence, bounded diagnostics, optional preview diff text/hash, and checkpoint/resume drift diagnostics.
- Provider/Tool Registry diagnostic collector MVP: `openclaw_runtime/src/runtime-core/registries.ts` exposes a bounded runtime-owned collector for context/tool/generic diagnostics; `electron/services/tool-provider-registry.ts` and `electron/services/mcp-api.ts` preserve legacy behavior while emitting diagnostics; `openclaw_runtime/src/agents/task-loop-controller.ts` accepts only injected diagnostics for shadow metadata/evidence.

## Allowed Now

- Call AST readonly scan helpers only with explicit TS/TSX target file objects and in-memory content.
- Use AST preview diffs only when `runtime.astPatchPlanner.previewDiff` is explicitly enabled; preview text/hash is diagnostic material only.
- Collect registry diagnostics only through explicit caller-owned inputs and default-off collector flags.
- Attach registry diagnostics to TaskLoop only as shadow metadata/evidence refs when existing surface shadow flags and `runtime.registryDiagnostics.collector` are explicitly enabled.

## Still Forbidden

- AST patch apply, workspace edit, file write, symbol mutation, rename, replace body, insert before/after, safe delete, TaskLoop/Gateway/Main/renderer/host-api/api-client integration, provider transport/order changes, prompt/model-message insertion, services/listeners/daemons, persistence, default-on behavior, or treating preview diffs as completion evidence.
- Registry provider ordering cutover, default provider registration, automatic provider enablement, active tool authority, TaskLoop decision authority, reviewer prompt/model-message/Gateway/provider payload changes, MCP response shape changes, approval/retry/error semantic changes, diagnostic persistence outside explicit in-memory/test-owned sinks, renderer IPC/Gateway bypass, services/listeners/daemons, external databases, or default-on registry behavior.

## Feature Flags

- `runtime.astPatchPlanner.readonlyScan`: default false by omission.
- `runtime.astPatchPlanner.previewDiff`: default false by omission.
- `runtime.registryDiagnostics.collector`: default false by omission.
- Existing registry shadow flags remain default false by omission: `runtime.registryPilot.enabled`, `runtime.providerRegistry.shadow`, `runtime.contextProviders.registryPilot`, and `runtime.toolRegistry.shadow`.

No feature flag enables AST patch apply in the accepted prerequisite surface.

## Validation Results

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-contracts.test.ts tests/unit/runtime-ast-patch-planner-rule-validation.test.ts tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts tests/unit/runtime-ast-patch-planner-resume-drift.test.ts`: pass, 4 files / 16 tests.
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts`: pass, 5 files / 100 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts`: pass, 1 file / 7 tests; hardening sentinel covers AST exports/source, Registry exports/collector/TaskLoop gates, and renderer bypass boundaries.
- `pnpm --config.verify-deps-before-run=false run typecheck`: pass.
- `pnpm --config.verify-deps-before-run=false run comms:replay`: pass.
- `pnpm --config.verify-deps-before-run=false run comms:compare`: pass.
- `rg -n "AST Patch Planner|astPatchPlanner|Provider/Tool Registry|registryDiagnostics|runtime-use readiness|diagnostic consumer|controlled runtime" README.md README.zh-CN.md README.ja-JP.md`: no matches; no README update required.

The shared worktree contains many unrelated pre-existing dirty files, including files outside both task specs. This limits full diff-aware harness validation in-place, but does not change the MVP correctness result above.

## Boundary Scan Summary

- AST mutation/apply/write scan: matches are forbidden text in specs/handoff docs only. Narrow production scan of `openclaw_runtime/src/runtime-core/ast-patch-planner.ts` returned no mutation/apply/write helpers.
- AST runtime authority scan: implementation matches are only accepted `noTaskLoopInvocation` / `noGatewayIntegration` authority metadata. Remaining matches are forbidden text in specs/handoffs. No TaskLoop/Gateway/Main/renderer/host-api/api-client route or completion authority was found.
- Registry authority/persistence scan: broad matches are forbidden text in specs/handoffs, parity tests, pre-existing MCP API terminology, and unrelated TaskLoop Runtime Memory sqlite/persist tests. Narrow production scan returned no provider ordering/default-registration/default-on/tool-authority/TaskLoop-authority/Gateway/provider-transport/diagnostic-persistence/service/listener/new-transport matches.
- Renderer bypass scan: no matches in `src/pages` or `src/components`.

## Boundary Hardening Added

- Added `tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts` as an executable sentinel for the next usable-state path.
- AST sentinels assert exported runtime-core names stay readonly/candidate-generation only, production source contains no apply/write/workspace/symbol mutation/TaskLoop/Gateway/transport API, and disabled scans cannot emit candidate completion evidence.
- Registry sentinels assert exported runtime-core names stay diagnostics-only, collector output stays default-off/bounded/caller-owned, TaskLoop diagnostic shadowing still requires `runtime.registryDiagnostics.collector` plus every explicit surface shadow flag, and renderer pages/components do not bypass host-api/Gateway ownership.

## Controlled Runtime-Use Readiness Decision

Final status: accepted_controlled_runtime_use_readiness

- AST controlled runtime-use readiness is accepted only for explicit readonly planner candidate generation. Candidate output remains diagnostic/planning material and may not apply patches, write files, mutate symbols, invoke TaskLoop, alter Gateway/Main/renderer/host-api/api-client/provider transport, change prompts/model messages, persist state, start services/listeners/daemons, or prove task completion.
- Registry controlled diagnostic consumer readiness is accepted only for explicit bounded caller-owned diagnostics. Diagnostics may attach only as shadow metadata/evidence under the existing explicit collector/shadow gates and may not change provider ordering, default provider registration, tool authority, TaskLoop authority, reviewer prompts, model messages, Gateway/provider transport, MCP response shape, approval/retry/error semantics, persistence, services/listeners/daemons, or default runtime behavior.

## Docs Sync

`README.md`, `README.zh-CN.md`, and `README.ja-JP.md` were reviewed by prior lane evidence and this prerequisite audit. No user-facing README update is required because both surfaces remain internal, default-off, explicit, readonly/diagnostics-only, and do not change product behavior or flows.

## Rollback

- AST: omit `runtime.astPatchPlanner.readonlyScan` and `runtime.astPatchPlanner.previewDiff`, stop calling readonly planner helpers, or remove optional planner exports. No persisted cleanup is required.
- Registry: omit `runtime.registryDiagnostics.collector` and existing registry shadow flags, drop injected diagnostics, and keep legacy context/MCP/TaskLoop paths authoritative. No persisted cleanup is required.

## Next Allowed Runtime-Use Slice

- AST: a controlled explicit-call readonly planner candidate generation pilot may be specified next, still no apply, workspace edit, symbol mutation, TaskLoop/Gateway/Main/renderer integration, provider transport, prompt/model-message insertion, persistence, service/listener/daemon, completion authority, or default-on behavior.
- Registry: a controlled diagnostic consumer pilot may be specified next, still explicit/default-off, diagnostics-only, bounded, caller-owned, and still no provider ordering, default provider registration, tool authority, TaskLoop authority, prompt/model-message/Gateway/provider transport change, persistence, service/listener/daemon, or default cutover.
