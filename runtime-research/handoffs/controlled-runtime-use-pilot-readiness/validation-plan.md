# Validation Mechanism

## Harness

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md --no-diff
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md --no-diff
```

## Focused Tests

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-contracts.test.ts tests/unit/runtime-ast-patch-planner-rule-validation.test.ts tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts tests/unit/runtime-ast-patch-planner-resume-drift.test.ts
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run comms:replay
pnpm --config.verify-deps-before-run=false run comms:compare
```

## Boundary Scans

| Scan | Command family | Classification rule |
|---|---|---|
| AST mutation/apply/write scan | `writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|workspaceEdit|applyPatch|ast-grep.*apply|rename|replaceBody|insertBefore|insertAfter|safeDelete` | Implementation matches must be zero; docs/spec matches are guardrails only. |
| AST runtime authority scan | `TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(` | Implementation matches must be zero except accepted authority metadata in tests/docs. |
| Registry authority/persistence scan | `provider ordering|default provider|default-on|prompt cutover|model messages|Gateway request|provider transport|TaskLoop authority|tool authority|sqlite|postgres|mysql|redis` | Implementation matches must be zero; docs/spec guardrails must be classified. |
| Renderer IPC/Gateway bypass scan | `window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(` | Renderer pages/components matches must be zero. |
| Service/listener/database scan | `createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(` | Implementation matches must be zero for touched pilot surfaces. |

## README Review

Review `README.md`, `README.zh-CN.md`, `README.ja-JP.md`, and `README.ru-RU.md`. Because this package is internal docs/spec/tests only and adds no user-visible behavior, no README update is expected unless review finds an existing claim that must be corrected.
