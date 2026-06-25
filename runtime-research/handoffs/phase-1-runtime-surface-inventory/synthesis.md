# Phase 1 Synthesis: Runtime Surface Inventory

## Inputs Reviewed

| Lane | Submission File | Status | Notes |
|---|---|---|---|
| lane-a-task-loop-state | `submissions/lane-a-task-loop-state.md` | accepted | Contains all required template headings, Evidence Table, command evidence, and a clear shadow `RuntimeTaskEvent` seam. No inter-lane conflict found. |
| lane-b-context-agentmap | `submissions/lane-b-context-agentmap.md` | accepted | Contains all required template headings and Evidence Table. Strong evidence for absent named AgentMap/provider implementation and current direct context sources. |
| lane-c-tool-invocation | `submissions/lane-c-tool-invocation.md` | accepted | Contains all required template headings and Evidence Table. Strong evidence for host-api boundary, MCP/Gateway tool-like surfaces, and missing `ToolCallRequest` / `ToolCallResult`. |
| lane-d-evidence-verifier | `submissions/lane-d-evidence-verifier.md` | accepted | Contains all required template headings and Evidence Table. Current task-loop/mission gates are well evidenced, but must not be treated as the target standalone verifier. |
| lane-e-trace-event-memory | `submissions/lane-e-trace-event-memory.md` | accepted | Contains all required template headings and Evidence Table. Strong evidence for transcript, trajectory, observability, long-task checkpoint, Task Ledger, and Role Memory seams. |
| lane-f-harness-safety | `submissions/lane-f-harness-safety.md` | accepted | Contains all required template headings and Evidence Table. Correctly identifies missing runtime-core task specs and current comms/harness gates. |

Audit notes:

- Template compliance was mechanically checked with `rtk node -e ...`: all six lane files include every `submission-template.md` first-level section and an Evidence Table.
- Suspicious wording scan found no unsupported "凭印象/可能/大概" conclusions. Matches for `unknown`, `needs`, and `intentionally absent` were either code type names, future gaps, or explicit design needs.
- The repository worktree is broadly dirty and `runtime-research/` is untracked, so git status cannot prove each parallel lane only edited its own file. Within the handoff scope, each lane's own notes claim research-only edits, and no conflicting edits to `synthesis.md` existed before this file.
- No lane-to-lane factual contradiction blocks synthesis. The strongest shared design conflict is consistent across lanes: current ClawX has several useful projections/gates/buffers, but not the target canonical runtime contract, event log, provider registry, tool protocol, verifier, or temporal memory layer.
- No lane is marked `needs_revision`. Caveats are carried forward below instead of promoted into facts where evidence was explicitly missing.

## Current-vs-Target Gap Table

| Target Artifact | Current Paths | Gaps | First Migration Seam | Risk |
|---|---|---|---|---|
| AgentMap | No named implementation found by lane B search. Adjacent surfaces: `openclaw_runtime/src/agents/sessions/tools/read.ts`, `grep.ts`, `find.ts`, `ls.ts`; `electron/services/files-api.ts`; `electron/services/git-api.ts`; `openclaw_runtime/src/agents/loop-context-pack.ts`. | Current code understanding starts from direct file/search/diff tools and bounded packs, not a ranked symbol graph with token-budgeted render. | Shadow AgentMap over direct read/grep/find/ls and current diff/knowledge sources; compare ranked files/symbols against legacy context reads. | Medium: early ranking misses can silently drop important files unless shadow-only and fixture-backed. |
| Runtime Context Provider | `openclaw_runtime/src/context-engine/types.ts`, `legacy.ts`, `registry.ts`; `electron/services/chat-api.ts` knowledge injection; `electron/services/sessions-api.ts` transcript/recovery context; project rules/topics/terminal/web-preview surfaces. | `ContextEngine` exists, but no provider-labeled `ContextItem[]` registry with source evidence, dedupe, and budgeted assembly. | Add shadow provider adapters for knowledge context first, then git diff / transcript / rules / LoopContextPack. | Medium: Main-owned context sources and runtime-owned model assembly must avoid a second parallel abstraction. |
| Symbol Tool Layer | No named `SymbolProvider` / symbol tool implementation found by lane B search. Adjacent code-reading surfaces are direct runtime read/grep/find/ls tools and Main file/diff APIs. | No overview/find/references/diagnostics layer, no symbol checkpoint relocation, no LSP unavailable structured fallback. | Defer until AgentMap shadow has fixtures; add readonly TypeScript/TSX symbol provider task spec before implementation. | Medium: implementing symbol tools before context contracts would create another unregistered context/tool path. |
| Tool Invocation Protocol | `electron/services/mcp-api.ts`, `electron/services/gateway-api.ts`, `electron/services/git-api.ts`, `electron/services/files-api.ts`, `electron/services/terminal-api.ts`, `electron/services/permissions-api.ts`, `src/lib/host-api.ts`. | Divergent result shapes (`McpCallToolResult`, Git result, file `{ ok }`, terminal result, raw `gateway.rpc` unknown); no `ToolCallRequest` / `ToolCallResult`, timing, evidence, or idempotency. | Shadow normalizer around `mcp.callTool`, then Gateway RPC and built-in `clawx-git` compatibility provider. | Medium-high: approval/pending/denied/cancelled taxonomy is unresolved. |
| Workflow Checkpoint Engine | `openclaw_runtime/src/agents/task-loop-controller.ts`; `mission-control/controller.ts`; `clawgraph/runtime.ts`; `openclaw_runtime/src/agents/long-task-control/store.ts`; `electron/services/sessions-api.ts`; `electron/services/task-ledger-service.ts`; transcript/trajectory readers. | Live state is split across renderer flags, runtime maps, task-specific checkpoints, transcripts, trajectory sidecars, and Task Ledger projection. No canonical append-only `RuntimeTaskEvent` reducer/replay. | Stage 1 contract plus shadow reducer over TaskLoop lifecycle/checkpoints; later expand to chat/Mission/ClawGraph. | High: status mapping and side-effect idempotency must be solved before default-on resume. |
| Evidence Verifier | `openclaw_runtime/src/agents/task-loop-controller.ts:evaluateEvidenceGate`; `task-loop-self-check.ts`; `mission-control/controller.ts:gateMissionReviewerCompletion`; harness reports; Git diff; Doctor; diagnostics; Observability; Chat turn ledger. | Strong local gates exist, but no standalone verifier artifact with normalized file/test/tool/trace evidence and target failed/blocked/completed taxonomy. | Warning-only shadow verifier report beside task-loop evidence gate. | Medium-high: legacy `repair/blocked` semantics conflict with target `failed` vs external-dependency `blocked`. |
| Trace Context Provider | `shared/types/observability.ts`; `openclaw_runtime/src/observability/trace-recorder.ts`, `trace-buffer.ts`; `electron/services/observability-service.ts`, `observability-index.ts`, `observability-graph.ts`, `observability-trajectory.ts`; diagnostic trace context. | Trace/span/event schemas exist, but buffers are in-memory; durable index is sanitized/derived; no budgeted provider output, source refs, span links, or resume link. | Readonly provider over sanitized trace index/graph/diagnostics after contract layer; keep event log canonical for replay. | Medium: privacy/redaction and external traceparent trust need explicit policy. |
| Runtime Memory Provider | `openclaw_runtime/src/memory/memory-store.ts`; `openclaw_runtime/src/memory-host-sdk/events.ts`; transcript JSONL; Task Ledger evidence refs. | Role Memory has governed cards/proposals/audit and `episode`, but no Graphiti-style `valid_at` / `invalid_at` temporal fact edges. | Episode-only readonly adapter from event-derived records; verified facts wait for Evidence Verifier. | Medium: mixing role memory cards with runtime facts can create unverified long-term memory. |
| AST Patch Planner | No runtime-core AST planner or ast-grep harness spec found in lane F. Adjacent surfaces: Git diff/fileDiff evidence and direct file/tool patch-capable workflows. | No readonly structured scan, rule validation, preview diff, overlap rejection, or resume drift handling under runtime contract. | Do not start in next three slices; add targeted task spec before Stage 9. | High if started early; depends on AgentMap, Symbol Tool Layer, and Evidence Verifier. |

## Legacy Callsite List

| Legacy Callsite | Lane | Replacement Target | Keep / Wrap / Remove Later |
|---|---|---|---|
| `src/stores/chat.ts:sendMessage` optimistic `sending` / `activeRunId` / `pendingFinal` | A | Workflow Checkpoint Engine | Keep now; later wrap with normalized event projection. |
| `shared/chat-runtime-events.ts:ChatRuntimeEvent` | A, E | Workflow Checkpoint Engine | Keep now; wrap into shadow `RuntimeTaskEvent`. |
| `openclaw_runtime/src/agents/task-loop-controller.ts:taskLoopRuns` / `runTaskLoop` | A, D | Workflow Checkpoint Engine / Evidence Verifier | Wrap first; remove process-memory authority only after replay parity. |
| `openclaw_runtime/src/agents/mission-control/controller.ts:resumeMission` and mission statuses | A, D | Workflow Checkpoint Engine / Evidence Verifier | Keep; adapt after TaskLoop mapping is proven. |
| `openclaw_runtime/src/agents/clawgraph/runtime.ts:runs` / event list | A, D | Workflow Checkpoint Engine | Keep; wrap later as workflow event source. |
| `openclaw_runtime/src/agents/long-task-control/store.ts:recordLongTaskCheckpoint` | A, E | Workflow Checkpoint Engine | Wrap as checkpoint compatibility source. |
| `electron/services/sessions-api.ts` transcript/handoff/recovery context | A, B, E | Runtime Context Provider / Runtime Memory Provider / Checkpoint Engine | Keep; treat as read-only compatibility evidence. |
| `electron/services/observability-trajectory.ts` trajectory sidecar reader | A, E | Trace Context Provider / Checkpoint Engine | Keep; wrap as trace/evidence hydration source. |
| `electron/services/chat-api.ts:applyKnowledgeMetadata`, `readSelectedKnowledgeReferences`, `applyKnowledgeReadCitations` | B | Runtime Context Provider | Wrap first as shadow `ContextItem[]`; keep prompt text byte-stable. |
| `src/pages/Chat/ChatInput.tsx:routeKnowledgeForMessage` and `electron/services/knowledge-api.ts` router | B | Runtime Context Provider | Keep; shadow source diagnostics. |
| `src/components/agents/SubagentRunnerPanel.tsx:readCurrentDiff` and `electron/services/git-api.ts:diff/fileDiff` | B, D | Runtime Context Provider / Evidence Verifier | Keep; shadow as `current_diff` provider and file evidence. |
| Runtime `read` / `grep` / `find` / `ls` tools under `openclaw_runtime/src/agents/sessions/tools` | B | AgentMap / Symbol Tool Layer | Keep; add shadow comparison before changing tool behavior. |
| `openclaw_runtime/src/context-engine/legacy.ts:LegacyContextEngine.assemble` | B | Runtime Context Provider | Keep as rollback; providers feed it only after shadow parity. |
| `electron/services/mcp-api.ts:createMcpApiWithContext().callTool` | C | Tool Invocation Protocol | Wrap first with shadow `ToolCallRequest` / `ToolCallResult`. |
| `electron/services/mcp-api.ts:VERSE_CLAW_GIT_MCP_TOOLS` and `callClawxGitTool` | C | ToolProviderRegistry / Tool Invocation Protocol | Keep; convert to compatibility provider manifest later. |
| `electron/services/gateway-api.ts:createGatewayApi().rpc` | C | Tool Invocation Protocol / ToolProviderRegistry | Keep; wrap tool-like RPCs after MCP adapter. |
| `electron/services/git-api.ts:withGitOperation` | C, D | Tool Invocation Protocol / Evidence Verifier | Keep; normalize result/evidence later. |
| `electron/services/files-api.ts:writeText` | C | Tool Invocation Protocol | Keep; normalize file-write result later. |
| `electron/services/terminal-api.ts:createTerminalApi().run` | C | Tool Invocation Protocol / Trace Context Provider | Keep; normalize command result later. |
| `electron/services/permissions-api.ts` approval lifecycle | C | Tool Invocation Protocol permission evaluator | Keep; decide pending/denied/cancelled mapping. |
| `openclaw_runtime/src/agents/task-loop-controller.ts:evaluateEvidenceGate` | D | Evidence Verifier | Wrap first; do not replace until verifier taxonomy is proven. |
| `openclaw_runtime/src/agents/task-loop-self-check.ts:runTaskLoopSelfCheck` | D | Evidence Verifier | Keep; attach shadow verifier metadata only. |
| `openclaw_runtime/src/agents/mission-control/controller.ts:gateMissionReviewerCompletion` | D | Evidence Verifier | Keep; consolidate after standalone verifier exists. |
| `harness/src/runner.mjs:runStep` | D, F | Evidence Verifier / Harness safety | Keep; later capture output summaries in a harness slice. |
| `electron/services/observability-index.ts` sanitized `trace-index.jsonl` | E | Trace Context Provider | Keep; readonly provider source, not canonical event log. |
| `electron/services/task-ledger-service.ts` JSONL projection | A, E | Workflow Checkpoint Engine / Evidence Verifier | Keep as projection/evidence, not execution truth. |
| `openclaw_runtime/src/memory/memory-store.ts` Role Memory store | E | Runtime Memory Provider | Keep; expose episode-only adapter before fact edges. |

## First Three Implementation Slices

1. Slice: Contract Layer Without Behavior Change

   Evidence: Lanes A/C/D/E agree target implementation types are absent (`RuntimeTaskEvent`, `ToolCallRequest`, `ToolCallResult`, standalone verifier/report). Current seams are TaskLoop lifecycle/checkpoints, `mcp.callTool`, chat knowledge injection, observability/index, and Task Ledger projection.

   Legacy path wrapped: `openclaw_runtime/src/agents/task-loop-controller.ts` lifecycle/evidence fields, `openclaw_runtime/src/agents/long-task-control/store.ts` checkpoints, `electron/services/mcp-api.ts:createMcpApiWithContext().callTool`, and `electron/services/chat-api.ts` knowledge context assembly.

   New path / adapter: Add runtime contract types for `RuntimeTaskEvent`, `ContextItem`, `ToolCallRequest`, `ToolCallResult`, `EvidenceRef`, and `Checkpoint`, plus test-only or shadow adapters named around `runtimeContractAdapters`.

   Feature flag or shadow mode: `runtimeContractAdapters` default off; individual shadow flags can be `runtimeTaskEventLogShadow`, `runtime.toolProtocol.mcpShadow`, and `runtime.contextProviders.knowledgeShadow`.

   Tests: A new harness task spec first (`harness/specs/tasks/runtime-contract-layer-spike.md`); unit fixtures for contract type serialization/mapping; existing `tests/unit/mcp-api.test.ts`, `tests/unit/chat-knowledge-scope.test.ts`, `tests/unit/task-loop-controller.test.ts`, and gateway/host boundary tests must remain behavior-stable.

   Rollback: Disable flags and stop emitting shadow objects; legacy TaskLoop, MCP, chat knowledge, and checkpoint behavior remain authoritative.

   Done when: Contracts compile, shadow adapters can produce typed event/context/tool/evidence/checkpoint records from current legacy data, no model-facing prompt/tool response changes occur, and harness context/validate for the new spec passes.

2. Slice: AgentMap Shadow Mode

   Evidence: Lane B found no named AgentMap/RepoMap/PageRank/provider implementation, while direct read/grep/find/ls, file preview, git diff, knowledge context, transcript, and LoopContextPack paths are active. Migration plan Stage 2 requires shadow comparison before changing agent decisions.

   Legacy path wrapped: Runtime `openclaw_runtime/src/agents/sessions/tools/read.ts`, `grep.ts`, `find.ts`, `ls.ts`; Main `electron/services/git-api.ts:diff/fileDiff`; chat knowledge context from `electron/services/chat-api.ts`; optional transcript/recovery context from `electron/services/sessions-api.ts`.

   New path / adapter: Add an AgentMap shadow module that extracts TypeScript/TSX symbol tags, ranks active/mentioned files and identifiers, estimates tokens, and records included file/symbol evidence without feeding model decisions.

   Feature flag or shadow mode: `runtime.agentMap.shadow` default off or diagnostics-only; legacy context continues to feed tasks.

   Tests: New AgentMap task spec; fixtures for active file boost, mentioned identifier boost, no duplicate prompt files, deterministic token-budget shrink, and comparison against observed legacy direct reads/searches.

   Rollback: Disable `runtime.agentMap.shadow`; keep fixture output for tuning but leave all direct tools/context paths unchanged.

   Done when: Shadow AgentMap output is deterministic on fixtures, records missed/extra legacy files, stays within token-budget tolerance, and no runtime behavior changes with the flag off or on.

3. Slice: Tool/Context Adapter Seam

   Evidence: Lane C shows divergent tool result shapes and absent `ToolCallResult`; lane B shows hidden prompt context and no provider-labeled `ContextItem`; lane D shows verifier needs normalized tool/context evidence. This slice should connect the first two adapter families without making a registry cutover.

   Legacy path wrapped: `electron/services/mcp-api.ts:createMcpApiWithContext().callTool` for tools and `electron/services/chat-api.ts` knowledge injection for context. Secondary candidates are `electron/services/gateway-api.ts:rpc` and `openclaw_runtime/src/context-engine/legacy.ts`, but they should wait until MCP/knowledge parity passes.

   New path / adapter: Main-side compatibility adapters that emit `ToolCallRequest` / `ToolCallResult` shadow records and `ContextItem[]` shadow records, with source ids, truncation metadata, approval ids, timing, legacy result refs, and evidence refs.

   Feature flag or shadow mode: `runtime.toolProtocol.mcpShadow` and `runtime.contextProviders.knowledgeShadow`; no provider ordering changes yet.

   Tests: Extend `tests/unit/mcp-api.test.ts` for success/error/blocked mapping while preserving legacy return shape; extend `tests/unit/chat-knowledge-scope.test.ts` for context item parity and byte-stable `chat.send` payload; add a small verifier fixture consuming these shadow refs as warning-only evidence.

   Rollback: Disable both flags; current `McpCallToolResult` and hidden prompt assembly remain the only active behavior.

   Done when: MCP calls and knowledge context can be represented as normalized shadow records with no renderer API changes, no prompt/tool response changes, and tests prove behavior stability.

## Required Harness Or Spec Updates

| Area | Required Spec / Rule | Reason |
|---|---|---|
| Stage 1 contract layer | Add `harness/specs/tasks/runtime-contract-layer-spike.md`. | Lane F found no runtime-core task spec for `RuntimeTaskEvent`, `ContextItem`, `ToolCallRequest`, `ToolCallResult`, `EvidenceRef`, or `Checkpoint`; implementation must start spec-first. |
| AgentMap shadow | Add `harness/specs/tasks/agentmap-shadow-mvp.md`. | No current AgentMap spec exists; fixtures must cover ranking, token budget, active/mentioned files, and legacy comparison. |
| Tool/context adapter seam | Add or extend a runtime provider/tool registry task spec, likely `harness/specs/tasks/runtime-provider-tool-adapter-shadow.md`. | Existing comms specs guard transport boundaries but not normalized `ToolCallResult` / `ContextItem` semantics. |
| Backend communication | Reuse `harness/specs/scenarios/gateway-backend-communication.md` for any renderer/Main/Gateway/OpenClaw path touched. | AGENTS and lane F require this for host-api/api-client/Gateway/OpenClaw communication work. |
| Comms regression | Run `pnpm run comms:replay` and `pnpm run comms:compare` when slices touch Gateway events, host-api/api-client, runtime send/receive, or fallback. | Required by AGENTS and existing `comms-regression` rule. |
| Evidence verifier | Add `harness/specs/tasks/runtime-evidence-verifier-shadow.md` before Stage 6. | Current task-loop/mission gates are partial; need standalone taxonomy fixtures for file/test/tool/trace evidence and failed vs blocked. |
| Event log/checkpoint | Add `harness/specs/tasks/runtime-event-log-checkpoint-shadow.md` before Stage 5. | Current long-task checkpoints and Task Ledger projections do not prove append-only replay or side-effect idempotency. |
| Trace provider | Add `harness/specs/tasks/runtime-trace-context-provider.md` before Stage 7. | Observability UI/workbench specs do not cover budgeted provider output, source refs, span links, or traceparent sanitization. |
| Runtime memory | Add `harness/specs/tasks/runtime-memory-provider-episodes.md` before Stage 8. | Role Memory specs do not cover event-derived episodes, `valid_at` / `invalid_at`, or verifier-approved facts. |
| AST planner | Add `harness/specs/tasks/ast-patch-planner-pilot.md` before Stage 9. | Lane F found no ast-grep/AST Patch Planner spec; this must wait behind AgentMap, Symbol, and Verifier. |
| Harness rule integrity | Add `harness/specs/rules/i18n-coverage.md` or remove/repair task references; consider validator check for unresolved `requiredRules`. | Lane F found task references to `i18n-coverage` with no rule file while validation still passes. |
| Windows command reliability | Document or fix `node harness/src/cli.mjs ...` fallback when `pnpm harness ...` fails under `rtk`. | Lane F found direct Node harness commands worked while pnpm shim commands failed in this shell. |

## Decisions Needed

| Decision | Options | Recommended | Owner |
|---|---|---|---|
| Runtime contract package location | Place contracts in `shared/`, `openclaw_runtime/src/`, or a runtime-core package consumed by both Main and runtime. | Put pure serializable contracts in a shared runtime-core location, with Main/runtime adapters local to their owning layer. | maintainer |
| Event log persistence owner | OpenClaw SQLite, Electron Main store, or transcript/trajectory sidecars. | Use OpenClaw-owned SQLite for canonical event/checkpoint state; keep transcript/trajectory as compatibility artifacts. | maintainer |
| Status mapping for `aborted` / `cancelled` | Map legacy `aborted` to target `cancelled`, keep compatibility reason, or add `aborted` to target. | Target `cancelled` plus compatibility reason `aborted` in shadow records. | maintainer |
| Approval pending taxonomy | Map `approvalRequired` to denied/error, represent as waiting permission event, or extend `ToolCallResult`. | Represent pending approval as a task event / waiting state; only final denial becomes non-success tool result. | maintainer |
| Blocked vs failed taxonomy | Preserve legacy `blocked` for repeated repair/budget, or enforce external-dependency-only blocked immediately. | In shadow reports, emit target taxonomy while preserving legacy behavior until verifier cutover. | maintainer |
| Trace provider source | Use sanitized `trace-index.jsonl` first, or wait for canonical event log. | Use sanitized index for readonly shadow summaries; canonical replay remains future event log. | maintainer |
| Hard-delete retention | Fully purge future event log/trace/memory records, tombstone, or redact. | Decide before persistent event/memory rollout; current transcript/trajectory delete semantics are insufficient for new stores. | user/maintainer |
| Runtime memory seed | Seed from Role Memory `episode` cards, from task event log episodes only, or both with source labels. | Start with event-derived episodes only; expose Role Memory as separate evidence-backed source until verifier-approved facts exist. | maintainer |
| Context provider orchestration | Providers feed existing `ContextEngine`, or `ContextEngine` is replaced by provider registry. | Providers should feed/compose through existing `ContextEngine` first so legacy remains rollback. | maintainer |
| Harness scenario shape | Put runtime-core migration under `gateway-backend-communication`, or create a new runtime-core scenario. | Keep `gateway-backend-communication` for boundary-touching slices; add runtime-core task specs for semantic fixtures. | maintainer |

## Index Updates To Apply

Do not edit `runtime-research/agent-runtime-index.md` until maintainers accept this synthesis. Suggested precise replacements for `Last Known Pointers`:

```text
AgentMap:
  code: no named implementation found; legacy/direct context paths include openclaw_runtime/src/agents/sessions/tools/read.ts, grep.ts, find.ts, ls.ts; electron/services/files-api.ts; electron/services/git-api.ts; openclaw_runtime/src/agents/loop-context-pack.ts
  tests: missing AgentMap fixtures; adjacent tests include tests/unit/loop-context-pack.test.ts and tests/unit/git-api.test.ts

Runtime Context Provider:
  code: openclaw_runtime/src/context-engine/types.ts; openclaw_runtime/src/context-engine/legacy.ts; openclaw_runtime/src/context-engine/registry.ts; electron/services/chat-api.ts; electron/services/sessions-api.ts; electron/services/project-rules-api.ts
  tests: tests/unit/chat-knowledge-scope.test.ts; tests/unit/knowledge-api.test.ts; tests/unit/context-window.test.ts; tests/unit/project-rules-api.test.ts

Symbol Tool Layer:
  code: no named SymbolProvider/Symbol Tool Layer implementation found; adjacent direct code-reading tools live under openclaw_runtime/src/agents/sessions/tools/
  tests: missing symbol overview/find/references/diagnostics fixtures

Tool Invocation Protocol:
  code: electron/services/mcp-api.ts; electron/services/gateway-api.ts; electron/services/git-api.ts; electron/services/files-api.ts; electron/services/terminal-api.ts; electron/services/permissions-api.ts; src/lib/host-api.ts; shared/types/mcp.ts
  tests: tests/unit/mcp-api.test.ts; tests/unit/gateway-permissions-api.test.ts; tests/unit/files-permissions-api.test.ts; tests/unit/terminal-api.test.ts; tests/unit/host-invoke.test.ts

Workflow Checkpoint Engine:
  code: openclaw_runtime/src/agents/task-loop-controller.ts; openclaw_runtime/src/agents/mission-control/controller.ts; openclaw_runtime/src/agents/clawgraph/runtime.ts; openclaw_runtime/src/agents/long-task-control/store.ts; electron/services/sessions-api.ts; electron/services/task-ledger-service.ts; electron/services/observability-trajectory.ts
  tests: tests/unit/task-loop-controller.test.ts; tests/unit/mission-control-loop.test.ts; tests/unit/long-task-control.test.ts; tests/unit/clawgraph-runtime.test.ts; tests/e2e/chat-long-task-control.spec.ts

Evidence Verifier:
  code: openclaw_runtime/src/agents/task-loop-controller.ts:evaluateEvidenceGate; openclaw_runtime/src/agents/task-loop-self-check.ts; openclaw_runtime/src/agents/mission-control/controller.ts:gateMissionReviewerCompletion; harness/src/runner.mjs; harness/src/cli.mjs; electron/services/git-api.ts; electron/utils/openclaw-doctor.ts; electron/services/diagnostics-api.ts; electron/services/observability-api.ts; src/stores/chat/turn-ledger-recorder.ts
  tests: tests/unit/task-loop-controller.test.ts; tests/unit/mission-reviewer.test.ts; tests/unit/mission-control-loop.test.ts; tests/integration/loop-stability-check.test.ts; tests/unit/openclaw-doctor.test.ts; tests/unit/observability-service.test.ts

Trace Context Provider:
  code: shared/types/observability.ts; openclaw_runtime/src/observability/trace-recorder.ts; openclaw_runtime/src/observability/trace-buffer.ts; electron/services/observability-service.ts; electron/services/observability-index.ts; electron/services/observability-graph.ts; electron/services/observability-trajectory.ts; openclaw_runtime/src/infra/diagnostic-trace-context.ts
  tests: tests/unit/observability-mvp.test.ts; tests/unit/observability-trace-buffer.test.ts; tests/unit/observability-service.test.ts; tests/unit/observability-index.test.ts; tests/unit/observability-graph.test.ts; tests/e2e/observability-trace-graph.spec.ts

Runtime Memory Provider:
  code: openclaw_runtime/src/memory/memory-store.ts; openclaw_runtime/src/memory/types.ts; openclaw_runtime/src/memory-host-sdk/events.ts; electron/services/sessions-api.ts; electron/services/task-ledger-service.ts
  tests: tests/unit/role-memory-v2.test.ts; tests/unit/role-orchestration-methods.test.ts; tests/e2e/role-memory-panel.spec.ts

AST Patch Planner:
  code: no named runtime AST Patch Planner implementation found in this phase; adjacent diff/evidence surfaces include electron/services/git-api.ts and direct runtime file tools
  tests: missing ast-grep/readonly scan/preview diff/range drift fixtures
```

Additional index note to add near `Migration Tracking` when Stage 1 starts:

```text
Stage: Stage 1 Contract Layer Without Behavior Change
Current legacy paths: TaskLoop lifecycle/checkpoints; MCP callTool; chat knowledge injection; transcript/trajectory/observability evidence sources
New paths: runtime contract types plus shadow adapters only
Feature flag: runtimeContractAdapters, runtimeTaskEventLogShadow, runtime.toolProtocol.mcpShadow, runtime.contextProviders.knowledgeShadow
Shadow metrics: event/status parity, tool result normalization parity, context item source/cap parity
Tests: runtime-contract-layer-spike harness spec, MCP adapter tests, chat knowledge parity tests, TaskLoop shadow reducer fixtures
Rollback: disable shadow flags; legacy paths remain authoritative
Status: planned
Next decision: contract package location and event log persistence owner
```
