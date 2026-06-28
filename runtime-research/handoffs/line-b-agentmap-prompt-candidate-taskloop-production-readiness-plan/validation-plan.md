# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```

## Boundary Scans

```text
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan
rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan
rg -n "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover|production-ready|default-on" harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan
rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md runtime-research/handoffs/line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|production readiness|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

## Comms Decision

Run:

```text
pnpm --config.verify-deps-before-run=false run comms:replay
pnpm --config.verify-deps-before-run=false run comms:compare
```

only if the task touches Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, or fallback behavior.

This readiness-plan phase touches only harness specs, handoff documentation, and the runtime index. The expected comms decision is skip with reason: no communication path, renderer, Main, Gateway, provider transport, channel, or fallback implementation changed.

## Acceptance Validation

The synthesis may be accepted only after:

- prerequisite status checks pass;
- required artifacts exist;
- required commands pass or blocked failures are classified;
- boundary scans show no implementation expansion beyond expected docs/spec prose;
- scorecard is at least 95;
- no veto gate fires.
