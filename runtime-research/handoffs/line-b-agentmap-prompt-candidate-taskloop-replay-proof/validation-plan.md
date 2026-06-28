# Validation Plan

Status: accepted

Required commands:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```

Required boundary scans:

```text
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|promptCandidateControlledCutoverPilot|promptCandidateTaskLoopExplicitInvocationPilot|runtime\\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
rg -n "AGENTMAP_CANDIDATE_SENTINEL_DO_NOT_LEAK" openclaw_runtime/src electron src shared tests
rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" <touched-files>
rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <touched-files>
rg -n "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt|prompt cutover|candidate cutover|production-ready|default-on" <touched-files>
rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|fs\\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <touched-files>
rg -n "AgentMap|agentMap|promptCandidateRuntimeShadow|promptAssemblyExperiment|prompt candidate|cutover|TaskLoop explicit invocation|Replay Proof|default-on" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Comms replay/compare is required only if this phase touches Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, or fallback paths.

## Results

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
```

Live-worktree result: failed because broad pre-existing dirty/untracked files outside this task's touched areas are present.

Scoped clean-overlay result: passed in temp validation dir `C:\Users\27933\AppData\Local\Temp\agentmap-taskloop-replay-proof-clean-83aabf0dae5f4f329733928353fb76e9` after cloning the current repository, setting `origin/main` to that baseline `HEAD`, and overlaying only this phase's task spec, handoff files, and runtime index update.

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md --no-diff
```

Result: passed.

```text
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-agent-map-prompt-candidate-controlled-cutover-pilot.test.ts tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
```

Result: passed. 9 files, 113 tests.

```text
pnpm --config.verify-deps-before-run=false run typecheck
```

Result: passed.

Boundary scans: passed. Broad AgentMap flag scan returned no matches; renderer direct IPC/Gateway/WebSocket scan returned no matches; sentinel scan matched only focused tests; README translation scan returned no matches. Touched-file scans matched only expected proof/spec forbidden-boundary prose and validation command text.

Comms replay/compare skipped: this phase touched only harness specs and handoff documentation. It did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.
