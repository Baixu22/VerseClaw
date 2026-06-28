# Controlled Runtime-Use Pilot Readiness Synthesis

Status: accepted_controlled_pilot_ready

## Overall Status

accepted_controlled_pilot_ready

## Recommended Route

- Registry proceeds first as a controlled diagnostic consumer base.
- AST proceeds as explicit readonly candidate generation.
- The two lines can run in parallel only when they remain independent, non-authoritative, diagnostics/planning-only, and default-off.
- Provider ordering cutover, AST apply, workspace edit, TaskLoop authority, Gateway/provider transport changes, and default-on/default cutover remain forbidden.

## Evidence Baseline

| Evidence | State | Source |
|---|---|---|
| Runtime-use prerequisites | `accepted_runtime_use_prerequisites_complete` | `runtime-research/handoffs/runtime-use-prerequisites.md` |
| Controlled readiness | `accepted_controlled_runtime_use_readiness` | `runtime-research/handoffs/runtime-use-prerequisites.md` |
| AST synthesis | `Status: accepted` | `runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/synthesis.md` |
| Registry synthesis | `Status: accepted` | `runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/synthesis.md` |
| Runtime index | No expanded AST or Registry authority found in relevant entries | `runtime-research/agent-runtime-index.md` |

## Quantitative Scorecard

- AST pilot: 94/100.
- Registry pilot: 95/100.
- Parallel pilot: 94/100.
- Hard vetoes override these scores.

## AST Pilot Scope

Explicit readonly candidate generation from caller-owned in-memory TS/TSX target files only. Preview diffs are optional diagnostics and are not completion evidence. No apply, write, workspace edit, symbol mutation, TaskLoop/Gateway/Main/renderer/host-api/api-client/provider transport, prompt/model-message, persistence, services, or default-on behavior is authorized.

## Registry Pilot Scope

Explicit controlled diagnostic consumer output from caller-owned in-memory collector diagnostics only. Diagnostics can be bounded shadow metadata/evidence but cannot become provider ordering, tool, TaskLoop, prompt, completion, Gateway, transport, persistence, or default authority.

## Validation Mechanism

See `validation-plan.md`. Required validation includes harness context/validate for both pilot specs, focused AST and Registry unit suites, controlled readiness sentinels, pilot readiness doc sentinels, typecheck, comms replay/compare, boundary scans, and multilingual README review.

## Veto Gates

See `veto-gates.md`. Any default-on behavior, provider ordering drift, leakage, fail-closed rate below 100 percent, renderer bypass, AST mutation/apply/write surface, TaskLoop/Gateway/provider transport authority drift, rollback failure, or missing validation without a blocked reason forces `needs_revision` or `blocked_by_unrelated_dirty_worktree`.

## Boundary Scan Summary

All required production-path boundary scans passed. See `boundary-scan-summary.md`.

## Files Changed

- `harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md`
- `harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md`
- `runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot/README.md`
- `runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot/validation-plan.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot/README.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot/validation-plan.md`
- `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/README.md`
- `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/sample-matrix.md`
- `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/scorecard.md`
- `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/veto-gates.md`
- `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/validation-plan.md`
- `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/boundary-scan-summary.md`
- `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/synthesis.md`
- `tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts`
- `runtime-research/agent-runtime-index.md`

## Commands Run

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md`: pass.
- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md --no-diff`: pass.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts`: pass, 2 files / 12 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-contracts.test.ts tests/unit/runtime-ast-patch-planner-rule-validation.test.ts tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts tests/unit/runtime-ast-patch-planner-resume-drift.test.ts`: pass, 4 files / 16 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts`: pass, 5 files / 100 tests.
- `pnpm --config.verify-deps-before-run=false run typecheck`: pass.
- `pnpm --config.verify-deps-before-run=false run comms:replay`: pass.
- `pnpm --config.verify-deps-before-run=false run comms:compare`: pass.
- AST mutation/apply/write production scan: pass, no matches.
- AST runtime authority production scan: pass, only accepted `noTaskLoopInvocation` / `noGatewayIntegration` metadata matched.
- Registry authority/persistence production scan: pass, no matches.
- Renderer IPC/Gateway bypass scan: pass, no matches.
- Service/listener/database production scan: pass, no matches.
- `rg -n "AST Patch Planner|astPatchPlanner|controlled runtime-use|controlled pilot|diagnostic consumer|registryDiagnostics|Provider/Tool Registry|runtime-use readiness|candidate generation" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md`: no matches; no README update required.
- `git diff --check -- <new controlled-pilot files>`: pass.

## Remaining Forbidden Surfaces

The following remain forbidden after this package:

- AST patch apply, file write, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete.
- TaskLoop automatic AST invocation and TaskLoop decision/completion/checkpoint/lifecycle authority changes.
- Gateway/Main/renderer/host-api/api-client AST routes.
- Provider ordering cutover, default provider registration, automatic provider enablement, active provider/tool authority.
- Reviewer prompt/model-message/Gateway payload/provider transport changes.
- MCP response shape or approval/retry/error semantic changes.
- Diagnostic persistence outside explicit in-memory/test-owned sinks.
- Service/listener/daemon/WebSocket server/local HTTP server/second Gateway/second runtime/external database.
- Renderer direct IPC or direct Gateway HTTP/WebSocket.
- Default-on behavior.

## Next Allowed Implementation Slice

Either independent pilot may proceed through its accepted task spec only:

- AST: explicit readonly candidate-generation pilot using caller-owned in-memory TypeScript/TSX targets, with no apply/write/mutation/runtime authority.
- Registry: controlled diagnostic consumer pilot using caller-owned bounded in-memory collector output, with no provider ordering/tool/TaskLoop/prompt/transport authority.

Parallel execution remains allowed only while both lines stay independent, non-authoritative, reversible, and default-off by omission.
