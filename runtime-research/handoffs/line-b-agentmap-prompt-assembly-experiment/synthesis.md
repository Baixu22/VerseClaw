# Line B AgentMap Prompt Assembly Experiment Synthesis

Status: accepted

## Decision

The AgentMap prompt assembly experiment is accepted as an explicit opt-in, default-off evaluation helper only.

This is not prompt cutover approval. AgentMap remains default-off, readonly, opt-in/shadow-only, and non-authoritative. Default-on AgentMap behavior is not allowed. Default prompt assembly, TaskLoop, Gateway, provider transport, model-message assembly, provider ordering, and direct discovery tools remain authoritative and unchanged.

## Boundary

The accepted implementation adds `openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts`, a pure helper that takes explicit `AgentMapResult` input and returns candidate text plus metadata. The helper checks `runtime.agentMap.promptAssemblyExperiment === true`; when omitted or false it returns `disabled` with no content. It does not register a provider, call TaskLoop, call Gateway, alter model messages, or feed candidate text into any default prompt path.

The candidate is bounded by caller token budget and includes only complete AgentMap symbol blocks. Prompt-present files are excluded again at experiment assembly time, even if the supplied `AgentMapResult` includes them. Candidate metadata carries `experimental`, `readonlyAgentMap`, `defaultOff`, `noPromptCutover`, `noPromptAuthority`, `noToolAuthority`, `noRuntimeAuthority`, and `legacyPromptAuthoritative`.

Config schema updates are accepted for `runtime.agentMap.promptAssemblyExperiment?: boolean` only. The flag is default-off by omission, strict, and separate from `runtime.agentMap.provider`. Unknown cutover-like keys such as `promptCutover` and `defaultOn` remain rejected.

## Validation

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-assembly-experiment.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-assembly-experiment.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-feature-config-schema.test.ts
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-hardening.test.ts tests/unit/runtime-agent-map-cache.test.ts tests/unit/runtime-agent-map-quality.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```

Results:

- Harness context passed and produced the expected prompt assembly experiment reading list.
- Harness validate passed: spec valid.
- Focused helper/config run passed: 2 files, 10 tests.
- Required AgentMap regression run plus new experiment test passed: 11 files, 50 tests.
- Typecheck passed for node and web projects.

## Boundary Scans

TaskLoop/Gateway/provider-ordering/prompt cutover:

```text
rg -n "agent-map-readonly-shadow|createAgentMapContextProvider|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
```

No matches.

Renderer direct IPC/Gateway bypass:

```text
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
```

No matches.

Service/listener/daemon/database scan over touched files found only policy/spec text and pre-existing unrelated config help strings for gateway listener, SQLite memory configuration, and mcporter daemon configuration. A narrow implementation scan over the new helper, runtime-core export, config schema/types, and focused tests returned no matches:

```text
rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts openclaw_runtime/src/runtime-core/index.ts openclaw_runtime/src/config/types.openclaw.ts openclaw_runtime/src/config/zod-schema.ts tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-feature-config-schema.test.ts
```

Mutation/apply/edit scan over touched files found only policy/spec text and pre-existing unrelated `tools.exec.applyPatch.*` config help/labels. A narrow implementation scan over the new helper, runtime-core export, config schema/types, and focused tests returned no matches:

```text
rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts openclaw_runtime/src/runtime-core/index.ts openclaw_runtime/src/config/types.openclaw.ts openclaw_runtime/src/config/zod-schema.ts tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts tests/unit/runtime-feature-config-schema.test.ts
```

Prompt-adjacent implementation scan:

```text
rg -n "TaskLoop|Gateway|provider transport|model messages|buildAgentMessageFromConversationEntries|buildAgentSystemPrompt|formatLoopContextPackForPrompt|createContextProviderRegistryPilot" openclaw_runtime/src/runtime-core/agent-map-prompt-assembly-experiment.ts tests/unit/runtime-agent-map-prompt-assembly-experiment.test.ts openclaw_runtime/src/runtime-core/index.ts
```

No matches.

README docs-sync scan:

```text
rg -n "AgentMap|runtime\.agentMap|Runtime AgentMap|prompt assembly" README.md README.zh-CN.md README.ja-JP.md
```

No matches, so README translation updates are not required. This is an internal default-off runtime-core experiment helper/config flag with no user-visible UI, CLI, Gateway, host-api, renderer, default prompt, or provider-ordering behavior change.

Comms replay/compare were not run because this change does not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, gateway events, channel delivery, or fallback behavior.

`rtk` was requested by local RTK guidance but was not available in the current PowerShell PATH, so validation used local `pnpm` directly with the repository's documented `--config.verify-deps-before-run=false` workaround.
