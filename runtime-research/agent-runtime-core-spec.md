# Agent Runtime Core Spec

本规范从本地源码沉淀而来，目标不是搬运外部项目，而是形成 ClawX 自己的 runtime 核心：更快决策、更准上下文、更稳工具调用、更可恢复执行。

## Evidence Sources

- Aider RepoMap: `C:\Users\27933\Desktop\verseshell\aider-main\aider\repomap.py`
- Serena symbol tools: `C:\Users\27933\Desktop\verseshell\serena-main\src\serena\symbol.py`
- Continue providers/tools: `C:\Users\27933\Desktop\verseshell\continue-main\core`
- OpenTelemetry trace docs: `C:\Users\27933\Desktop\verseshell\opentelemetry.io-main\content\en\docs\concepts`
- Temporal Python SDK: `C:\Users\27933\Desktop\verseshell\Temporal_Python\temporalio`
- ast-grep rules/scan: `C:\Users\27933\Desktop\verseshell\ast-grep-main\crates`
- Graphiti core: `C:\Users\27933\Desktop\verseshell\graphiti-main\graphiti_core`
- OpenHands app-server event/conversation layer: `C:\Users\27933\Desktop\verseshell\OpenHands-main\openhands\app_server`

## 1. Runtime Contract

ClawX runtime exposes one task contract:

```text
RuntimeTaskRequest:
  taskId
  goal
  workspace
  activeFiles
  constraints
  permissions
  tokenBudget
  traceContext
  resumeFrom?

RuntimeTaskEvent:
  eventId
  taskId
  kind
  timestamp
  payload
  traceContext
  evidenceRefs

RuntimeTaskResult:
  status: completed | failed | blocked | cancelled
  summary
  changedFiles
  evidence
  checkpoint
```

Errors are typed, not free text only:

```text
RuntimeError:
  type: model | tool | permission | budget | context | verifier | runtime
  message
  retryable
  evidenceRefs
```

## 2. Context Assembly

Context is assembled by providers, then ranked and budgeted.

```text
RuntimeContextProvider:
  id
  description
  inputSchema
  outputKinds
  dependsOnIndexing
  permission
  getContext(query, extras) -> ContextItem[]
```

Required first providers:

- `AgentMapProvider`: Aider-inspired repo map, PageRank over symbol references, token budget fit.
- `SymbolProvider`: Serena-inspired overview/find/references/diagnostics.
- `RuntimeTraceContextProvider`: OpenTelemetry-inspired trace/span summary, query keys, and source refs.
- `RuntimeMemoryProvider`: Graphiti-inspired episode/fact lookup.

Assembly order:

```text
collect user mentions
  -> ask AgentMap for ranked files/symbols
  -> expand precise symbols via SymbolProvider
  -> add recent task events/checkpoints
  -> add trace/memory only when relevant
  -> deduplicate by source id/range
  -> fit token budget
  -> emit context evidence
```

Every context item must carry source evidence: file/range, symbol id, trace id/span id, episode id, or event id.

## 3. Tool Invocation Protocol

Tools use one normalized protocol regardless of built-in, MCP, Gateway, host-api, or external provider.

```text
ToolCallRequest:
  callId
  taskId
  toolName
  args
  permissionContext
  retryPolicy
  idempotencyKey
  traceContext

ToolCallResult:
  callId
  status: success | error | denied | cancelled
  contextItems
  structuredData
  error?
  startedAt
  finishedAt
  evidence
```

Execution flow:

```text
validate schema
  -> preprocess args
  -> evaluate permission
  -> create tool span
  -> execute
  -> normalize output
  -> persist event/result
  -> return structured result
```

Readonly tools may retry with exponential backoff. Mutating tools require explicit idempotency before retry.

## 4. State Machine

ClawX task state:

```text
created
  -> planning
  -> assembling_context
  -> running
  -> waiting_permission | waiting_tool | waiting_external
  -> applying_changes
  -> verifying
  -> completed | failed | blocked | cancelled
```

Startup/setup state is separate:

```text
working
  -> waiting_for_workspace
  -> preparing_repository
  -> setting_up_skills
  -> starting_runtime
  -> ready | error
```

Do not merge setup state with task execution state; OpenHands shows these are different operational concerns.

## 5. Checkpoint / Resume

Runtime writes an append-only event log. Reducers rebuild task state from events; resume never depends on in-memory objects.

Checkpoint contains:

```text
Checkpoint:
  checkpointId
  taskId
  state
  openObligations
  contextSummary
  toolResults
  fileHashes
  evidenceRefs
  schemaVersion
```

Resume rules:

- Rebuild state from event log first.
- Do not re-execute completed side-effect tool calls; reuse stored `ToolCallResult`.
- Re-run readonly context assembly when source files changed.
- For symbol checkpoints, re-locate by file + namePath + range; if drifted, return to planning.
- For long histories, create continue-as-new run with compressed state and open obligations.

## 6. Verifier / Evidence

Completion requires evidence, not just a final assistant message.

Evidence kinds:

- file evidence: path, hash, diff, symbol range.
- test evidence: command, exit code, output summary, timestamp.
- trace evidence: trace id, span id, status, events.
- tool evidence: tool call id, result status, structured data.
- human evidence: explicit confirmation or permission grant.

Verifier flow:

```text
collect required evidence
  -> check no open obligations
  -> check tool errors handled
  -> run tests/diagnostics when applicable
  -> replay event log for consistency
  -> decide completed | failed | blocked
```

`blocked` is only valid when required external input/state is missing and runtime cannot make meaningful progress. Ordinary test failure is `failed` until repaired or explicitly accepted.

## 7. Tests / Fixtures

Minimum test suite for ClawX runtime core:

- AgentMap fixture: active file reference and mentioned identifier affect ranking.
- Symbol fixture: find symbol, references, rename, diagnostics across renderer/main/shared files.
- Tool protocol fixture: success/error/denied/cancelled and MCP unsupported output.
- State reducer fixture: event log restores waiting/running/verifying/completed.
- Resume fixture: side-effect tool result is not duplicated.
- Continue-as-new fixture: long event log compresses while preserving obligations.
- Verifier fixture: patch evidence + test evidence required before completed.
- Trace fixture: parent/child span and resume span link.
- AST patch fixture: readonly scan, diff preview, range drift on resume.
- Temporal memory fixture: current valid fact excludes invalidated fact.

## First Implementation Order

1. `AgentMap`: TypeScript/TSX symbol tags, PageRank ranking, token-budgeted render.
2. `Symbol Tool Layer`: overview/find/references/diagnostics through LSP/Serena-style wrapper.
3. `RuntimeContextProviderRegistry` and `ToolProviderRegistry`: Continue-style provider/tool abstraction.
4. `RuntimeEventLog` and state reducer: OpenHands event service + Temporal replay idea.
5. `EvidenceVerifier`: file/test/tool/trace evidence gate.
6. `RuntimeTraceContextProvider`: OpenTelemetry span model over ClawX task/tool events.
7. `RuntimeMemoryProvider`: Graphiti-style episodes/facts with valid_at/invalid_at.
8. `AST Patch Planner`: ast-grep pattern/fix scan and preview before apply.

## Final Core Artifacts

The research converges into these ClawX-owned artifacts:

- `AgentMap`
- `Runtime Context Provider`
- `Symbol Tool Layer`
- `Workflow Checkpoint Engine`
- `Evidence Verifier`
- `Trace Context Provider`
- `AST Patch Planner`

## Non-Goals

- Do not import Temporal service.
- Do not clone Continue UI/VSCode binding.
- Do not store chat logs as memory without entity/fact/evidence modeling.
- Do not build a full custom language analyzer before using LSP/symbol providers.
- Do not let agent-generated AST rules apply without readonly scan and verifier evidence.
