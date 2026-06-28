# Line B AgentMap Prompt Candidate Runtime Shadow Pilot Synthesis

Status: accepted

## Decision

The AgentMap prompt candidate runtime shadow pilot is accepted as an explicit opt-in, default-off diagnostic path only.

This is not prompt cutover approval. AgentMap remains default-off, readonly, opt-in/shadow-only, and non-authoritative. Default-on AgentMap behavior is not allowed. Default prompt assembly, TaskLoop reviewer prompts, Gateway requests, provider transport, model-message assembly, provider ordering, direct discovery tools, and runtime decisions remain authoritative and unchanged.

## Boundary

The accepted implementation adds `openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts`, a pure adapter that accepts explicit `AgentMapResult` input plus explicit runtime/TaskLoop metadata and returns a diagnostics-only report. The adapter requires both `runtime.agentMap.promptAssemblyExperiment === true` and `runtime.agentMap.promptCandidateRuntimeShadow === true`.

The report records candidate status, caller budget, token estimate, content hash, content length, included symbol/file counts, prompt-present exclusion counts, diagnostics, evidence refs, and non-authority flags. It does not expose candidate text as a report field and marks `candidateTextStored: false` and `candidateTextInsertedIntoPrompt: false`.

TaskLoop integration is limited to an explicit dependency-provided `AgentMapResult`. It does not discover AgentMap, register a provider, change `createContextProviderRegistryPilot()` ordering, alter reviewer context, mutate prompts, call Gateway, alter model messages, or change TaskLoop decisions. If flags are omitted or the explicit result is absent/invalid, no TaskLoop report is attached.

Config schema updates are accepted for `runtime.agentMap.promptCandidateRuntimeShadow?: boolean` only. The flag is default-off by omission, strict, and separate from `runtime.agentMap.provider`. Cutover-like unknown keys remain rejected.

## Validation

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-runtime-shadow-pilot.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/task-loop-controller.test.ts
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```

Results:

- Harness context passed and produced the expected runtime shadow pilot reading list.
- Harness validate passed: spec valid.
- Required AgentMap/config/TaskLoop regression run passed: 5 files, 84 tests.
- New runtime shadow focused test passed: 1 file, 3 tests.
- Touched focused run also passed: 3 files, 66 tests.
- Typecheck passed for node and web projects.

## Boundary Scans

```text
rg -n "agent-map-readonly-shadow|promptAssemblyExperiment|promptCandidateRuntimeShadow|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" <agentmap-runtime-shadow-touched-files>
rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-runtime-shadow-touched-files>
rg -n "model messages|provider transport|Gateway request|system prompt|reviewer prompt|formatTaskLoopContextPackForReviewer|runAgentPrompt" <agentmap-runtime-shadow-touched-files>
```

Results:

- AgentMap runtime/Gateway/Electron/renderer/shared scan returned no matches for default registration, runtime flag plumbing outside the intended runtime-core/config/test surfaces, or provider-ordering cutover.
- Renderer IPC/Gateway bypass scan returned no matches.
- Narrow implementation service/listener/daemon/database scan over the new helper, TaskLoop call site, runtime-core export, config types, and schema returned no matches.
- Broad touched-file service scan matched only pre-existing config help text for gateway listeners, SQLite memory/QMD settings, and older TaskLoop memory tests.
- Narrow implementation mutation/apply/edit scan returned no matches.
- Broad touched-file mutation scan matched only pre-existing `tools.exec.applyPatch.*` config help/labels.
- Narrow implementation prompt/model/Gateway transport scan returned no matches.
- Broad prompt-adjacent scan matched config help text and the TaskLoop test's explicit `formatTaskLoopContextPackForReviewer` parity assertion; the test proves double opt-in does not add AgentMap candidate text to reviewer context.
- README docs-sync scan over `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` found no AgentMap/runtime flag references, so translation README updates are not required.

Comms replay/compare were not run because this change does not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, gateway events, channel delivery, or fallback behavior.
