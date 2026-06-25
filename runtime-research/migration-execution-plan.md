# Agent Runtime Migration Execution Plan

这份计划专门回答“如何按阶段迁移实现，最终替代现有不成熟方案”。它建立在 `implementation-roadmap.md` 之上，但更强调旧方案替换、兼容层、切流门槛和退场标准。

## Migration Goal

目标不是把外部项目代码搬进来，而是用 ClawX 自己的 runtime core 替代当前不成熟的工作方式：

- 用 `AgentMap` 替代粗粒度、重复、无预算的上下文搜集。
- 用 `Symbol Tool Layer` 替代只按文件/字符串操作代码。
- 用 `Runtime Context Provider` 替代散落的上下文入口。
- 用 `Tool Invocation Protocol` 替代不统一的工具返回和错误处理。
- 用 `Workflow Checkpoint Engine` 替代不可恢复的长任务循环。
- 用 `Evidence Verifier` 替代“模型说完成就是完成”。
- 用 `Trace Context Provider` 替代缺少 runtime 行为证据的诊断方式。
- 用 `Runtime Memory Provider` 替代裸聊天记录式记忆。
- 用 `AST Patch Planner` 替代高风险字符串 patch。

## Migration Strategy

采用 strangler migration，不做 big bang rewrite。

```text
Inventory
  -> New contracts beside old paths
  -> Adapters wrap old behavior
  -> Shadow mode compare
  -> Feature-flagged pilot
  -> Default new path
  -> Legacy path removal
```

每个迁移阶段必须满足：

- 有旧路径兼容或回滚方式。
- 有 shadow metrics 或测试证据。
- 有明确替换范围，不扩大到 UI/模型封装等非核心问题。
- 更新 `agent-runtime-index.md` 的状态、代码路径、测试路径。

## Stage 0: Inventory and Baseline

Purpose: 先确认当前“不成熟方案”到底分布在哪里，避免凭印象迁移。

Replace Target Categories:

- ad hoc context collection
- direct file read / grep as primary code understanding
- untyped tool results
- tool errors thrown through task loop
- no event log or weak resume
- completion without evidence gate
- memory stored as conversation text only

Deliverables:

- current runtime surface map
- legacy callsite list
- baseline behavior fixtures
- migration feature flag list
- first harness task spec candidates

Gate:

- 每个 target category 至少有当前代码入口或确认不存在。
- `agent-runtime-index.md` 的 `Last Known Pointers` 不再是 `pending_inventory`，至少填入第一批路径。

Recommended First Command Set:

```powershell
rtk rg -n "context|provider|tool|invoke|checkpoint|resume|trace|evidence|verifier|grep|readFile|host-api|api-client|gateway" src electron shared harness tests
rtk rg -n "window\\.electron\\.ipcRenderer\\.invoke|fetch\\('http://127\\.0\\.0\\.1:18789|gateway:httpProxy|hostapi:fetch" src electron shared
rtk rg -n "completed|blocked|failed|verifying|resume|checkpoint|trajectory|jsonl" src electron shared tests
```

## Stage 1: Contract Layer Without Behavior Change

Purpose: 先建立新 runtime contract，但底层仍可调用旧实现。

Build:

- `RuntimeTaskEvent`
- `ContextItem`
- `ToolCallRequest`
- `ToolCallResult`
- `EvidenceRef`
- `Checkpoint`
- adapter wrappers for existing context/tool flows

Migration Mode:

- New contract wraps old paths.
- No user-visible behavior change.
- Dual-write minimal task/tool events where safe.

Gate:

- Existing workflows still pass current tests.
- Tool errors can be represented as structured `ToolCallResult.error`.
- Context output can carry source evidence even if source is legacy.

Replaces:

- untyped tool return values
- invisible runtime state transitions

Rollback:

- Disable adapters and call legacy paths directly.

## Stage 2: AgentMap Shadow Mode

Purpose: 引入上下文压缩，但先不直接影响 agent 决策。

Build:

- TypeScript/TSX symbol tags.
- Aider-inspired ranking.
- token-budgeted render.
- evidence: included files/symbols/token estimate.

Migration Mode:

- Legacy context continues feeding task.
- AgentMap runs in shadow and logs comparison evidence.
- Compare selected files/symbols against legacy reads/searches.

Gate:

- AgentMap output is deterministic on fixtures.
- Token budget stays within tolerance.
- Shadow comparison shows no critical missed active/mentioned files.

Replaces:

- repeated broad file reads
- repo-wide grep as first context move

Rollback:

- Keep AgentMap disabled as provider; retain fixture data for tuning.

## Stage 3: Symbol Tool Layer Readonly Cutover

Purpose: 代码理解从 file/string level 切到 symbol level。

Build:

- `getSymbolsOverview`
- `findSymbol`
- `findReferences`
- diagnostics wrapper
- symbol checkpoint relocation

Migration Mode:

- For supported TypeScript/TSX paths, prefer symbol tools.
- Fallback to legacy file/grep when symbol provider is unavailable.
- Log fallback reason as evidence.

Gate:

- Cross-file references fixture passes.
- LSP unavailable returns structured error, not task crash.
- Symbol checkpoint can detect drift.

Replaces:

- direct read-whole-file for symbol lookup
- grep-only reference discovery

Rollback:

- Per-language fallback to legacy read/search.

## Stage 4: Provider and Tool Registry Cutover

Purpose: 上下文和工具统一从 registry 进入 runtime。

Build:

- `RuntimeContextProviderRegistry`
- `ToolProviderRegistry`
- provider manifests
- policy evaluator: allow / ask / deny
- MCP/built-in/Gateway result normalization

Migration Mode:

- Legacy context/tool functions are registered as compatibility providers/tools.
- New AgentMap/Symbol providers are first-class providers.
- Feature flag controls provider ordering.

Gate:

- Unknown provider cannot break defaults.
- Tool success/error/denied/cancelled are normalized.
- Renderer does not add new direct IPC/Gateway calls.

Replaces:

- scattered provider construction
- direct tool invocation without policy/evidence

Rollback:

- Switch provider ordering back to legacy compatibility providers.

## Stage 5: Event Log and Checkpoint Default-On

Purpose: 让 runtime 能恢复，而不是靠当前进程活着。

Build:

- append-only event log
- state reducer
- checkpoint serializer
- idempotency key for tool calls
- continue-as-new compaction

Migration Mode:

- Dual-write legacy transcript/session data and new event log.
- New resume reads event log first, legacy resume remains fallback.
- Side-effect tool results are reused by idempotency key.

Gate:

- Resume tests cover waiting/running/verifying/completed.
- Replayed state matches live state for fixtures.
- Resume never repeats completed mutating tool calls.

Replaces:

- process-memory state
- incomplete resume based only on transcript text

Rollback:

- Read legacy transcript/session data while retaining event log for diagnostics.

## Stage 6: Evidence Verifier as Completion Gate

Purpose: 新 runtime 默认不允许无证据完成。

Build:

- evidence collector
- file/test/tool/trace evidence refs
- verifier decision model
- failure/blocking taxonomy

Migration Mode:

- Start as warning-only: model can complete, verifier records missing evidence.
- Move to blocking mode for code-editing tasks.
- Later expand to broader runtime tasks.

Gate:

- Patch without test/diagnostic evidence is not marked completed for code tasks.
- Open tool errors prevent completion.
- Blocked requires explicit external dependency.

Replaces:

- final-message-only completion
- ambiguous failed/blocked/completed states

Rollback:

- Warning-only verifier while preserving evidence reports.

## Stage 7: Trace Context Provider

Purpose: 让 agent 能读 runtime/tool/test 行为证据。

Build:

- local span schema
- trace id/span id propagation
- task/tool/test span recording
- trace summary provider
- source refs

Migration Mode:

- Trace recording starts behind local-only flag.
- Trace provider is readonly context source.
- Do not expose full trace dump to prompt.

Gate:

- Parent/child spans queryable.
- Error spans rank first.
- Trace summary respects token budget.
- External traceparent sanitized or re-rooted.

Replaces:

- uncorrelated logs
- no runtime behavior context during debugging

Rollback:

- Disable trace provider while keeping event log.

## Stage 8: Runtime Memory Provider

Purpose: 长期知识从聊天记录升级为时序事实和证据。

Build:

- episodic records from task/tool/test events
- temporal fact edges
- valid_at / invalid_at
- source evidence refs

Migration Mode:

- Start with event-derived episodes only.
- Human or verifier-approved facts only.
- LLM extraction remains suggestion until verified.

Gate:

- Current-valid query excludes invalidated facts.
- Fact traces to source episode/evidence.
- Duplicate episode writes are idempotent.

Replaces:

- raw conversation memory as primary long-term memory

Rollback:

- Disable fact provider; keep episodic event records.

## Stage 9: AST Patch Planner Pilot

Purpose: 在上下文、符号、证据都成熟后，再迁移高风险 patch 能力。

Build:

- TypeScript pattern/fix readonly scan
- rule validation
- preview diff
- conflict/range drift detection
- apply after verifier-ready plan

Migration Mode:

- Only pilot on narrow rule templates.
- Human confirmation for broad matches.
- Symbol edits remain preferred for precise rename/body operations.

Gate:

- Invalid rules rejected.
- Overlapping ranges rejected.
- Resume detects range drift.
- Apply requires preview diff and evidence plan.

Replaces:

- high-risk string patch for structural edits

Rollback:

- Keep planner in readonly preview mode.

## Stage 10: Legacy Removal

Purpose: 新方案默认稳定后，清理旧路径，降低维护成本。

Removal Candidates:

- context gathering paths bypassing provider registry
- tool calls bypassing `ToolCallResult`
- code understanding flows that grep/read before AgentMap/Symbol provider
- completion paths without verifier decision
- resume paths ignoring event log
- memory reads without evidence/source

Removal Gate:

- New path default-on for at least one release cycle or equivalent internal soak.
- No open critical regressions.
- E2E/unit/harness coverage exists for migrated workflows.
- Docs and agent index point to new paths only.

Rollback:

- Legacy removal should happen after feature flags and adapters have proven unnecessary; rollback is git-level revert, not runtime flag.

## Dependency Order

```text
Inventory
  -> Contract Layer
  -> AgentMap Shadow
  -> Symbol Readonly
  -> Provider/Tool Registry
  -> Event Log + Checkpoint
  -> Evidence Verifier
  -> Trace Provider
  -> Runtime Memory
  -> AST Patch Planner
  -> Legacy Removal
```

Important dependency notes:

- `Evidence Verifier` depends on `ToolCallResult` and event/evidence refs.
- `Trace Context Provider` depends on event/span recording.
- `Runtime Memory Provider` should not store unverified facts before verifier exists.
- `AST Patch Planner` should wait for AgentMap, Symbol Tool Layer, and Evidence Verifier.

## Migration Tracking Template

Use this block in `agent-runtime-index.md` or a project task spec when a stage starts:

```text
Stage:
Owner agent/thread:
Current legacy paths:
New paths:
Feature flag:
Shadow metrics:
Tests:
Rollback:
Status:
Next decision:
```

## Immediate Next Three Slices

1. Runtime Surface Inventory
   - Fill `agent-runtime-index.md` `Last Known Pointers`.
   - Produce current-vs-target gap table.

2. Contract Layer Spike
   - Define TypeScript types for context/tool/evidence/task events.
   - Wrap one existing readonly tool and one context source.

3. AgentMap Shadow MVP
   - Build TypeScript/TSX fixture.
   - Generate ranked map without changing agent behavior.
   - Compare against legacy context reads.
