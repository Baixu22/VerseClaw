# Line B AgentMap Prompt Candidate Runtime Shadow Replay Proof Synthesis

Status: accepted

## Decision

The AgentMap prompt candidate runtime shadow replay proof is accepted as a diagnostics-only stability proof for the already accepted runtime shadow pilot.

This is not prompt cutover approval. AgentMap remains default-off, readonly, explicit-input only, opt-in/shadow-only, diagnostics-only, and non-authoritative. Default-on AgentMap behavior is not allowed. Default prompt assembly, TaskLoop reviewer prompts, Gateway requests, provider transport, model-message assembly, provider ordering, direct discovery tools, runtime decisions, and disk persistence remain authoritative and unchanged.

## Boundary

The accepted proof adds `tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts`. It exercises the existing pure runtime shadow adapter and existing TaskLoop diagnostic hook only.

The proof covers repeated pure adapter runs with identical explicit `AgentMapResult` input, budget variants, prompt-present exclusion replay, disabled TaskLoop states, TaskLoop reviewer-context parity, and default provider-ordering parity. It does not add production behavior, default provider registration, provider ordering changes, automatic AgentMap discovery, disk persistence, mutation/apply/edit surfaces, new services, Gateway/provider transport changes, or candidate text insertion into any prompt/model path.

Repeated adapter runs were compared for stable status, content hash, token estimate, content length, included symbol count, included file count, prompt-present exclusion count, diagnostic codes, authority flags, and metadata authority markers. TaskLoop reports require both `runtime.agentMap.promptAssemblyExperiment === true` and `runtime.agentMap.promptCandidateRuntimeShadow === true` plus an explicit valid `AgentMapResult`. Missing or invalid AgentMap input produces no TaskLoop report.

## Validation

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-replay-proof.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```

Results:

- Harness context passed and produced the replay proof reading list.
- Harness validate passed: spec valid.
- Existing focused AgentMap/config/TaskLoop regression run passed: 6 files, 89 tests.
- New replay proof focused test passed: 1 file, 5 tests.
- Typecheck passed for node and web projects.

## Boundary Scans

```text
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" <agentmap-replay-proof-touched-files>
rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-replay-proof-touched-files>
rg -n "model messages|provider transport|Gateway request|system prompt|user prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt" <agentmap-replay-proof-touched-files>
rg -n "writeFile|appendFile|mkdir|rm\(|unlink|createWriteStream|fs\.promises|localStorage|indexedDB|electron-store|sqlite|postgres|mysql|redis" <agentmap-replay-proof-touched-files>
```

Results:

- AgentMap runtime/Gateway/Electron/renderer/shared scan returned no matches for the exact requested pattern in the requested path set.
- Renderer IPC/Gateway bypass scan returned no matches.
- Touched-file service/listener/daemon/database scan matched only task spec and handoff boundary text.
- Touched-file mutation/apply/edit scan matched only task spec and handoff boundary text.
- Touched-file prompt/model/Gateway transport scan matched task spec/handoff boundary text and the new test's intentional `formatTaskLoopContextPackForReviewer` parity assertion.
- Touched-file disk persistence scan matched only task spec and handoff scan text.
- Implementation-only scan over `tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts` returned no service/listener/database, mutation/apply/edit, or persistence matches; prompt-adjacent matches were the intentional reviewer-context formatter import/call/test title proving candidate text absence.
- README docs-sync scan over `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` found no AgentMap runtime flag references, so translation README updates are not required.

Comms replay/compare were skipped because this proof touched only harness docs, handoff docs, the runtime index, and a unit test. It did not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, gateway events, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.
