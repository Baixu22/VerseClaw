# Line B AgentMap Runtime-Use Readiness Synthesis

Status: accepted

## Decision

AgentMap can enter the next phase, `prompt assembly experiment`, after this readiness phase.

This is not prompt cutover approval. AgentMap must remain default-off, readonly, opt-in/shadow-only, and non-authoritative. Default-on AgentMap behavior is not allowed. Any default prompt assembly, TaskLoop, Gateway, provider-ordering, read/grep/find/ls replacement, or runtime-authoritative use still requires a fresh accepted cutover spec and synthesis.

Runtime behavior change: none for default runtime behavior. The accepted work adds hardened readonly AgentMap helpers, an explicit discardable cache, real fixture evidence, structured diagnostics, and an opt-in shadow provider gate, but AgentMap is not registered by default and is not consumed by TaskLoop, Gateway, model messages, or default prompt assembly.

## Prerequisite Gate

All required lane submissions exist under `runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/` and each contains exactly one accepted status line:

| Lane | Submission | Status lines | Result |
|---|---|---:|---|
| A | `lane-a-agentmap-real-repo-hardening.md` | 1 | `Status: accepted` |
| B | `lane-b-agentmap-cache-performance-budget.md` | 1 | `Status: accepted` |
| C | `lane-c-agentmap-fixtures-quality-audit.md` | 1 | `Status: accepted` |
| D | `lane-d-agentmap-shadow-runtime-collection.md` | 1 | `Status: accepted` |
| E | `lane-e-agentmap-opt-in-provider-readiness.md` | 1 | `Status: accepted` |

Command evidence:

```text
rg -n "^Status:\s*(accepted|needs_revision|blocked)\b|^Status:" runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions
PowerShell status-count check over submissions/*.md
```

## Evidence Review

Hardening evidence is accepted. `openclaw_runtime/src/runtime-core/agent-map.ts` defines bounded `AgentMapInputLimits`, default ignored directories, structured `AgentMapDiagnostic` values, and pre-extraction filtering for ignored directories, unsupported extensions, oversized files, binary-looking content, generated files, and max-file overflow. Parse and extraction failures return `parse_failure` diagnostics for the affected file while other files continue. `tests/unit/runtime-agent-map-hardening.test.ts` covers these boundaries.

Cache and budget evidence is accepted. `openclaw_runtime/src/runtime-core/agent-map-cache.ts` implements a caller-owned in-memory cache with `readonly: true`, `discardable: true`, bounded entries, defensive cloning, and keys based on normalized path, language, content length, and `fnv1a-32` content hash. `buildBudgetedAgentMapResult()` still reruns ranking, budget fitting, and rendering for the current request and token budget. `tests/unit/runtime-agent-map-cache.test.ts` and `tests/unit/runtime-agent-map-budget.test.ts` cover deterministic cache hits, content invalidation, ranking parity, monotonic budget lowering, and complete symbol blocks.

Fixture evidence is accepted. `tests/fixtures/agent-map/clawx-like-workspace/` covers a renderer composer, host-api wrapper, Electron IPC handler, runtime-core helper, shared chat types, and cross-file references. `tests/unit/runtime-agent-map-quality.test.ts` and `tests/unit/runtime-agent-map-renderer.test.ts` prove exact mentioned-symbol ranking, active-file references, prompt-present exclusion, path-neighbor ordering, evidence refs, and stable snapshot output in `tests/fixtures/agent-map/expected/clawx-like-diagnostic-map.txt`.

Shadow and opt-in evidence is accepted. `openclaw_runtime/src/context-engine/agent-map-context-provider.ts` declares `enabledByDefault: false`, `shadowOnly: true`, and metadata for `readonlyAgentMap`, `legacyAuthoritative`, `noPromptAuthority`, `noToolAuthority`, and `noRuntimeAuthority`. The provider returns `flag_disabled` without calling `getResult` unless `runtime.agentMap.provider === true`. Provider failures are isolated as structured diagnostics. `openclaw_runtime/src/context-engine/provider-registry.ts` keeps `createContextProviderRegistryPilot()` ordered as legacy context engine, loop context pack, then explicit extra providers. `tests/unit/runtime-agent-map-context-provider.test.ts`, `tests/unit/context-provider-registry.test.ts`, and `tests/unit/runtime-feature-config-schema.test.ts` cover these claims.

Config evidence is accepted. `runtime.agentMap.provider` is strict and default-off by omission in `openclaw_runtime/src/config/types.openclaw.ts` and `openclaw_runtime/src/config/zod-schema.ts`; prompt-cutover-like unknown keys are rejected. Help and label entries document that the flag is explicit-provider-only and does not change default prompts or discovery tools.

## Verification

Passed:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-hardening.test.ts tests/unit/runtime-agent-map-cache.test.ts tests/unit/runtime-agent-map-quality.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-feature-config-schema.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
```

Focused Vitest result: 10 files passed, 46 tests passed. Typecheck passed for both node and web projects.

`rtk` was requested by local RTK guidance but was not available in the current PowerShell PATH, so validation used local `pnpm` directly with the repository's documented `--config.verify-deps-before-run=false` gate workaround.

## Boundary Scans

TaskLoop/Gateway/provider-ordering/prompt cutover:

```text
rg -n "agent-map-readonly-shadow|createAgentMapContextProvider|runtime\.agentMap" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src shared
```

No matches. A broader `AgentMap|agentMap` scan found only unrelated `byAgentMap` cost-usage aggregation variable names in `openclaw_runtime/src/gateway/server-methods/usage.ts`.

Renderer direct IPC/Gateway bypass:

```text
rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components
```

No matches.

Service/listener/daemon/database:

```text
rg -n "createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(" <agentmap-runtime-use-source-tests-fixtures-without-schema-help-labels>
```

No matches. A wider scan including `schema.help.ts`/`schema.labels.ts` found existing unrelated help text for gateway listener, SQLite memory configuration, and mcporter daemon configuration; those are not AgentMap runtime-use surfaces.

AST patch apply / symbol edit apply / workspace edit:

```text
rg -n "rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply" <agentmap-runtime-use-source-tests-fixtures-without-schema-help-labels>
```

No matches. A wider scan including `schema.help.ts`/`schema.labels.ts` found existing unrelated `tools.exec.applyPatch.*` configuration labels/help only.

Provider ordering source check:

```text
rg -n "createContextProviderRegistryPilot\(|createLegacyContextEngineProvider\(|createLoopContextPackProvider\(|extraProviders" openclaw_runtime/src/context-engine/provider-registry.ts tests/unit/context-provider-registry.test.ts
```

The implementation constructs default providers in this order: `legacy-context-engine`, `loop-context-pack`, then `...extraProviders`. Tests assert default registry ordering, explicit AgentMap injection only, and explicit AgentMap output only with `runtime.agentMap.provider: true`.

Comms replay/compare were not run because this readiness synthesis and the accepted AgentMap lane work do not touch gateway events, runtime send/receive, channel delivery, host-api/api-client, renderer/Main transport, or fallback behavior.

## Next Phase Boundary

The next phase may start a `prompt assembly experiment` only as a fresh, explicit, default-off experiment. It must not make AgentMap default-on, must not consume AgentMap as authoritative prompt/runtime/tool context by default, and must not replace direct discovery tools. Default prompt assembly cutover remains blocked until a later cutover spec and synthesis accept the required evidence.
