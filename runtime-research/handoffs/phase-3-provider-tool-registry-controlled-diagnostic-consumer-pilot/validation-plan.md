# Registry Pilot Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md --no-diff
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-readiness.md --no-diff
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-3-provider-tool-registry-diagnostic-collector.md --no-diff
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run comms:replay
pnpm --config.verify-deps-before-run=false run comms:compare
```

## Boundary Scans

```text
rg -n "provider ordering|default provider|default-on|prompt cutover|model messages|Gateway request|formatTaskLoopContextPackForReviewer|runAgentPrompt|provider transport|TaskLoop authority|tool authority" openclaw_runtime/src/runtime-core/registries.ts openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts electron/services/tool-provider-registry.ts electron/services/mcp-api.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-controlled-runtime-use-*.test.ts harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot runtime-research/handoffs/controlled-runtime-use-pilot-readiness
rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" openclaw_runtime/src/runtime-core/registries.ts openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts electron/services/tool-provider-registry.ts electron/services/mcp-api.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/context-provider-registry.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/mcp-api.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-controlled-runtime-use-*.test.ts harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md runtime-research/handoffs/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot runtime-research/handoffs/controlled-runtime-use-pilot-readiness
rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
```

## Pass Criteria

- Every forbidden implementation match is zero.
- Guardrail text in docs/specs is classified as documentation only.
- The fail-closed target is 100 percent across registry matrix cases.
- If validation is blocked by unrelated dirty worktree state, the blocked reason must be recorded and structural `--no-diff` validation must still pass.
