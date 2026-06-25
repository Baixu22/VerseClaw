# Parallel Research Lanes

每个窗口选择一个 lane。所有 lane 可并行执行，输出到 `submissions/<lane-id>.md`。

## Lane A: Task Loop And Runtime State

LANE_ID: `lane-a-task-loop-state`

LANE_TITLE: Task loop, lifecycle, status, cancellation, resume hooks

LANE_SCOPE:

- 查找当前任务创建、运行、等待、完成、失败、阻塞、取消的状态来源。
- 查找 task loop、conversation/session lifecycle、runtime process lifecycle。
- 查找 resume/checkpoint/transcript/trajectory/session jsonl 相关实现。
- 标注哪些状态来自 renderer，哪些来自 Main/Gateway/OpenClaw runtime。

Suggested Searches:

```powershell
rtk rg -n "created|planning|running|waiting|verifying|completed|failed|blocked|cancel|resume|checkpoint|trajectory|session|jsonl|conversation" src electron shared tests
rtk rg -n "task loop|task_loop|Mission|ClawGraph|runtime|conversation" src electron shared harness tests
```

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-1-runtime-surface-inventory/submissions/lane-a-task-loop-state.md
```

## Lane B: Context Assembly And AgentMap Replacement Surface

LANE_ID: `lane-b-context-agentmap`

LANE_TITLE: Context collection, file reads, search, AgentMap replacement seams

LANE_SCOPE:

- 查找当前上下文来源：当前文件、选中文本、diff、terminal、project files、搜索结果、transcript。
- 查找直接 grep/readFile/read directory 的路径。
- 查找 token budget 或上下文压缩相关逻辑。
- 标注哪些路径未来应由 AgentMap / Runtime Context Provider 替代。

Suggested Searches:

```powershell
rtk rg -n "context|Context|selectedCode|currentFile|readFile|readDirectory|grep|search|ripgrep|token|budget|truncate|repo map|repomap" src electron shared tests
rtk rg -n "provider|ContextProvider|context provider|rules|diff|terminal|problems" src electron shared tests
```

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-1-runtime-surface-inventory/submissions/lane-b-context-agentmap.md
```

## Lane C: Tool Invocation And Permission Boundary

LANE_ID: `lane-c-tool-invocation`

LANE_TITLE: Tool registration, invocation, permissions, host-api/Gateway boundary

LANE_SCOPE:

- 查找工具注册、工具 schema、工具执行、工具结果处理。
- 查找权限确认、policy、approval、deny、cancel。
- 查找 renderer 是否直接调用 IPC 或 Gateway HTTP。
- 标注未来 `ToolCallRequest` / `ToolCallResult` adapter 应包住哪些入口。

Suggested Searches:

```powershell
rtk rg -n "tool|Tool|invoke|schema|permission|approval|policy|deny|cancel|host-api|api-client|gateway|MCP|mcp" src electron shared tests
rtk rg -n "window\\.electron\\.ipcRenderer\\.invoke|fetch\\('http://127\\.0\\.0\\.1:18789|gateway:httpProxy|hostapi:fetch" src electron shared tests
```

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-1-runtime-surface-inventory/submissions/lane-c-tool-invocation.md
```

## Lane D: Evidence, Tests, Diagnostics, And Completion Gate

LANE_ID: `lane-d-evidence-verifier`

LANE_TITLE: Evidence, tests, diagnostics, completion criteria

LANE_SCOPE:

- 查找当前如何判断任务完成、失败、阻塞。
- 查找测试运行、diagnostics、lint/typecheck/e2e 调用路径。
- 查找 file diff、changed files、tool output 是否被记录为 evidence。
- 标注 Evidence Verifier 可先接入哪些证据。

Suggested Searches:

```powershell
rtk rg -n "verify|verifier|evidence|test|diagnostic|lint|typecheck|e2e|diff|changedFiles|complete|completed|failed|blocked" src electron shared tests harness
rtk rg -n "Run Doctor|doctor|diagnostics|problems|playwright|vitest|eslint|tsc" src electron shared tests harness
```

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-1-runtime-surface-inventory/submissions/lane-d-evidence-verifier.md
```

## Lane E: Trace, Event Log, Metrics, And Memory

LANE_ID: `lane-e-trace-event-memory`

LANE_TITLE: Runtime events, trace-like data, token/cost metrics, memory/history

LANE_SCOPE:

- 查找当前事件流、日志、metrics、token usage、cost history。
- 查找 transcript/session storage、delete/reset/history behavior。
- 查找是否已有 trace/span/request id/source mapping。
- 标注 Trace Context Provider、Runtime Memory Provider、Checkpoint Engine 的共同数据源。

Suggested Searches:

```powershell
rtk rg -n "event|Event|trace|span|metrics|token|cost|usage|history|transcript|jsonl|memory|store|electron-store|session" src electron shared tests harness
rtk rg -n "OPENCLAW|trajectory|deleted|reset|usage_to_metrics|accumulated" src electron shared tests harness
```

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-1-runtime-surface-inventory/submissions/lane-e-trace-event-memory.md
```

## Lane F: Harness, Specs, And Migration Safety Gates

LANE_ID: `lane-f-harness-safety`

LANE_TITLE: Harness specs, project rules, safety gates, migration validation

LANE_SCOPE:

- 查找 `harness/specs/**` 中和 runtime、communication、AI coding、tools、events 相关规则。
- 查找现有 scripts/test commands 对应哪些迁移阶段。
- 标注每个迁移阶段需要新增或复用的 harness spec。
- 汇总 AGENTS/README 中会影响实现阶段的硬规则。

Suggested Searches:

```powershell
rtk rg -n "runtime|communication|gateway|host-api|api-client|tool|event|context|checkpoint|resume|verifier|evidence|trace" harness AGENTS.md README.md package.json
rtk rg -n "harness context|harness validate|harness run|comms:replay|comms:compare|test:e2e|typecheck|lint" harness AGENTS.md README.md package.json
```

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-1-runtime-surface-inventory/submissions/lane-f-harness-safety.md
```
