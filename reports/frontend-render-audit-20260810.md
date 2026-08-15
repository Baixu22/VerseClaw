# 前端渲染链路审计报告

**范围**：ClawX 渲染层组件使用情况、关键交互面（权限申请 / 询问澄清 / 计划展示 / 多 Agent 编排）是否真正到达渲染位置、侧边栏会话展示的调用链与边界。
**分支**：`codex/ui-polish` @ `2bce463c5`
**日期**：2026-08-10
**方法**：源码调用链追踪 + 11 个运行时探针（vitest + jsdom，真实挂载 `Chat` 页面与真实 store，非 mock 组件）。探针文件已在审计后删除，不留残留。

---

## 0. 结论摘要

| 交互面 | 是否到达渲染位置 | 判定 |
|---|---|---|
| 权限申请（host approval） | **是** — 但有失效窗口 | ⚠️ 通过（带缺陷 F5） |
| 询问 / 澄清（question-flow / option-list / preferences） | **仅 ```tool-ui 围栏路径可达；tool_call 路径不可达** | ❌ 不通过（F1） |
| 计划展示（update_plan / TodoWrite） | **是** — 但默认折叠 | ⚠️ 通过（带缺陷 F11） |
| 多 Agent 编排（team_orchestrate） | **是** | ✅ 通过 |
| 多 Agent 子会话（subagent 分支） | **是** | ✅ 通过 |
| 侧边栏会话展示 | **是** — 链路清晰，但有 3 处真实缺陷 | ⚠️ 通过（带缺陷 F2/F3/F7） |

**总体判定：不能验收通过。** 存在 1 个 P0（整类富卡片在运行段内不可达）、2 个 P1（嵌套工作组重命名/删除误伤父节点；待批准项在新一轮开始后静默消失）。组件"打架"（重复渲染）方面整体控制良好——`run-surface-promotion.ts` 的提升表是有效的单一职责机制——但存在 3 处同源双呈现需要确认意图。

---

## 1. 渲染调用链地图

### 1.1 会话主流程（一条链，无并行渲染器）

```
useChatStore(messages, runtimeRuns, streaming*)
  │
  ├─ deriveExecutionStreamState()            execution-projection.ts:194
  ├─ deriveNextUserMessageIndexes()          execution-projection.ts:240
  ├─ deriveRunSegmentMessageIndices()        execution-projection.ts:255
  │
  └─ deriveUserRunProjection()               execution-projection.ts:384
       ├─ deriveTaskSteps / deriveRuntimeTaskSteps   task-visualization.ts:404/507
       ├─ sanitizeGraphSteps(steps, promotedStepIds) execution-projection.ts:119
       ├─ promoteRunSurfaces()                       run-surface-promotion.ts:175
       │     ├─ projectCommandSurfaces()  → terminals
       │     ├─ projectGeneratedFileDiff() → diffs
       │     └─ readPlanSurface / readPlanSurfaceFromMessages → plan
       └─ deriveTeamOrchestrationViews()             team-orchestration-visualization.ts:364
                        │
                        ▼
             UserRunCard[]  ──────────────────►  Chat/index.tsx:2823 渲染循环
                                                    │
                    ┌───────────────────────────────┴──────────────────────────┐
                    ▼                                                          ▼
        <ChatMessage>  (index.tsx:2833)                       row.runCards.map (index.tsx:2851)
          ├ ThinkingReasoning        (554)                      └ <TurnSummaryCard>  (2873)
          ├ BranchPicker             (546)                          ├ PendingRunApprovals  (2885)
          ├ AssistantMarkdown        (634)                          ├ ToolUiPlanView       (2891)
          ├ AgentInteractionRenderer (643)  ◄── Tool UI 卡片总入口   ├ GeneratedFilesPanel   (2901)
          ├ ToolFallbackCard         (653)                          ├ RunMutationDiffs     (2914)
          ├ FileCard / ImagePreview  (677)                          ├ ExecutionGraphCard   (2916)
          └ AssistantHoverBar        (715)                          ├ RunTerminalSurfaces  (2924)
                                                                    └ TeamOrchestrationCard(2926)
```

**单一入口验证**：`AgentInteractionRenderer` 全仓库只有 1 处挂载（`ChatMessage.tsx:643`）；`Sidebar` 只有 1 处挂载（`MainLayout.tsx:63`）；`ExecutionGraphCard` / `TurnSummaryCard` / `PendingRunApprovals` 各只有 1 处。**没有多入口造成的组件打架。**

### 1.2 权限申请链路

```
hostApi.permissions.approvals({workspaceId, sessionKey, status:'pending'})
  └─ useRunApprovals()                 use-run-approvals.ts:33
       ├─ 触发信号：approval.updated 事件计数变化 / activeRunId 变化（微任务）  :91
       ├─ 兜底轮询：3s（run 活跃或已有待批项时）                              :100
       └─ selectPendingApprovals()      run-surfaces.ts:295
            └─ pendingApprovals ──► index.tsx:2860 (仅 latestRunKey)
                 └─ <PendingRunApprovals>  ──► <ApprovalCard>
                      └─ decideApproval → hostApi.permissions.decideApproval
```

同时 `approval.updated` 事件的图节点被 `promoteRunSurfaces` 加入 `promotedStepIds`（`run-surface-promotion.ts:204`），`sanitizeGraphSteps` 丢弃该行——**探针 P10 实测确认：审批卡片渲染，执行图不再出现死的 "Approval" 行**。这是设计正确且生效的。

### 1.3 侧边栏会话链路

```
useChatStore(sessions, sessionLabels, sessionLastActivity, runtimeRuns, activeRunId, sending, pendingFinal, runError)
useWorkspacesStore(profiles)
  │
  ├─ sidebarSessions = sessions.filter(排除未落地的 fresh current)   Sidebar.tsx:557
  ├─ buildLatestRuntimeRunBySession()                               session-buckets.ts:26
  ├─ buildSidebarSessionStatus()  → running/waiting/completed/error/aborted   Sidebar.tsx:161
  │     └─ runHasWaitingApproval()：从 approval.updated 反查"等待输入"态      Sidebar.tsx:153
  │
  ├─【时间视图】buildSidebarTimeSessions()      session-buckets.ts:115
  └─【工作组视图】buildSidebarWorkspaceSessionGroups()  session-buckets.ts:133
        └─ <SessionFolderTree>            Sidebar.tsx:1115
             └─ buildSidebarWorkspaceFolderGroups()   session-buckets.ts:200
                  ├─ groups.folders  → <FolderRow>（递归）
                  └─ groups.rootSessions → renderSessionWithMoveMenu
                       └─ renderSessionRow()  Sidebar.tsx:837 → <SessionRowMemo>
```

**去重边界**：会话归属由 `workspace.sessionStates / activeSessionKey / agentBindings` 三源合并成 `Set`（`session-buckets.ts:145-149`）后再映射，同一 key 在单个 workspace 内不会重复；`buildSidebarWorkspaceFolderGroups` 用 `assignments` 做二分（有归属→文件夹，无归属→root），**互斥且穷尽，同一会话不会同时出现在文件夹与 Ungrouped 中**。这一层边界是干净的。

---

## 2. 逐项核验结果（含实测证据）

| 探针 | 场景 | 结果 |
|---|---|---|
| P1 | `weather` tool_use 作为运行段内纯工具消息 | ❌ 卡片未渲染 |
| P2 | `weather` tool_use + 同消息带文本（运行段内） | ❌ 卡片未渲染 |
| P3 | `question_flow` tool_use（运行段内） | ❌ 卡片未渲染，`chat-tool-ui-interactions` 根节点都不存在 |
| P4 | `update_plan` 历史回放 → 计划卡片（默认态） | ❌ 折叠态下不在 DOM |
| P4b | 同上，展开 TurnSummary 后 | ✅ `chat-run-plan` 渲染，todo 文本正确 |
| P6b | `team_orchestrate` 工具结果 | ✅ `chat-team-orchestration-card` + `chat-team-node-n1` 渲染 |
| P7 | `sessions_spawn` + 子会话完成事件 | ✅ 执行图出现 `coder run` 分支节点 |
| P8 | ```` ```tool-ui ```` 围栏写在最终回复文本里 | ✅ 问题卡片渲染 |
| P9 | tool_use 挂在**最终回复消息**上 | ✅ 卡片渲染 |
| P10 | 待批准权限（workspace 已激活） | ✅ 审批卡片渲染，图内无重复行 |
| P11 | `command.output` → Terminal 卡片 | ✅ 渲染；`command.output` 图行已被提升丢弃 |
| P5 | 待批准权限（workspace 未激活） | ❌ 不渲染（`activeWorkspaceId` 为空时 `pendingApprovals` 恒为空） |

解析器层单测（独立于渲染）全部通过：
```
parseToolUiToolUses(['weather','question_flow','approval','option_list','bash','terminal'])
  → ["weather","question-flow","approval-card","option-list","terminal"]   ✅ bash 正确被过滤
promoteRunSurfaces(update_plan 历史消息) → {id:'p-1', todos:[Read code/completed, Write patch/in_progress]}  ✅
isPlanToolName: update_plan=true TodoWrite=true todo_write=true update-plan=true ExitPlanMode=false
```

**结论：解析层是健康的，断点全部在"解析结果 → DOM"这一段。**

---

## 3. 缺陷清单（按严重度排序）

### F1 · P0 · 运行段内的 tool_call 型 Tool UI 卡片整类不可达

**位置**：[src/pages/Chat/index.tsx:2484](src/pages/Chat/index.tsx:2484) ↔ [src/pages/Chat/ChatMessage.tsx:334](src/pages/Chat/ChatMessage.tsx:334)

`ChatMessage.tsx:334-347` 明确写了注释，声明 Tool UI 卡片「必须在运行段内存活」，并特意让 `toolUiInteractions` 绕开 `suppressToolCards`：

```ts
// Tool UI cards are NOT what `suppressToolCards` guards against ...
// so they must survive inside a run segment.
const cardTools = tools.filter((tool) => !isPlanToolName(tool.name));
return [...toolUiContent.interactions, ...parseToolUiToolUses(cardTools)];
```

但 `index.tsx:2484-2494` 在 `<ChatMessage>` **挂载之前**就把整行判为 `hidden`，两条分支都会命中携带 tool_use 的中间消息：

- 分支 2 `suppressAssistantText && !hasUserFacingImages` → 命中"文本 + tool_use"混合消息（其文本被折叠进执行图，整行随之隐藏）；
- 分支 3 `suppressToolCards && isToolOnlyAssistant` → 命中纯 tool_use 消息。

`index.tsx:2824` 的 `if (row.hidden) return null;` 让 `ChatMessage` 根本不渲染。

**影响**：`weather / question-flow / option-list / preferences-panel / table / chart / test-results / stack-trace / approval-card / terminal / code-diff / progress-tracker` 共 24 种 Tool UI 类型，只要模型以 **工具调用** 形式发出（而非在最终回复文本里写 ```` ```tool-ui ```` 围栏），在 run 内一律不显示。`parseToolUiToolUses` 与其注释在此场景下是死代码。

**尤其致命的是"询问"**：一个只发出 `question_flow` 工具调用、还没有最终回复的轮次（P3 场景），页面上**完全没有任何可交互卡片**——用户看不到 Agent 在问什么，run 卡死。

**修复方向**：`hidden` 的两条分支都必须加一个"该消息是否产出可渲染 Tool UI 交互"的豁免（等价于给 `hasUserFacingImages` 增加一个 `hasToolUiInteractions` 兄弟条件），并把该判定与 `ChatMessage` 内部的 `toolUiInteractions` 共用同一个纯函数，避免两侧再次漂移。

---

### F2 · P1 · 嵌套工作组的重命名/删除会误伤父文件夹

**位置**：[src/components/layout/SessionFolderTree.tsx:218](src/components/layout/SessionFolderTree.tsx:218)

`renderFolderNode`（:295）为**顶层**节点正确绑定了 `onRename={(name) => handleRenameFolder(node.folder.id, name)}`。但 `FolderRow` 递归渲染子节点时直接透传父级闭包：

```tsx
{node.children.map((child) => (
  <FolderRow
    node={child}
    onRename={onRename}    // ← 绑定的是父 folder.id
    onDelete={onDelete}    // ← 同上
  />
))}
```

**影响**：在二级及更深的工作组上点重命名 → 改的是父工作组的名字；点删除 → 删掉的是父工作组（连带其下全部子组和会话归属）。**数据破坏级缺陷**。

**修复**：`FolderRow` 应接收 `onRenameFolder(folderId, name)` / `onDeleteFolder(folderId)` 形式的按 id 派发回调，而不是已绑定的无参闭包。

---

### F3 · P1 · 已归入工作组的会话无法移出/改组

**位置**：[SessionFolderTree.tsx:217](src/components/layout/SessionFolderTree.tsx:217) vs [:390](src/components/layout/SessionFolderTree.tsx:390)

`renderSessionWithMoveMenu`（提供 `FolderInput` 移动菜单）只作用于 `groups.rootSessions`；文件夹内的会话走 `node.sessions.map((entry) => renderSessionRow(entry))`，**没有 leadingActions**。

**影响**：会话一旦被拖进工作组，侧边栏就没有任何 UI 能把它移出或换组——单向门。

---

### F4 · P1 · 待批准权限在新一轮开始后静默消失

**位置**：[src/components/tool-ui/run-surfaces.ts:306](src/components/tool-ui/run-surfaces.ts:306) + [use-run-approvals.ts:116](src/pages/Chat/use-run-approvals.ts:116) + [index.tsx:2860](src/pages/Chat/index.tsx:2860)

```ts
if (approval.runId) return approval.runId === input.activeRunId;
```

`useRunApprovals` 已经用 `lastKnownRunId` 处理了「run 报错导致 activeRunId 清空」的情况，但没有处理「用户直接发下一条消息」：新 run 一起，`activeRunId` 变为 `run-2`，`runId=run-1` 的待批准项被过滤掉，卡片消失。而 host 侧该 approval 仍然是 `pending`。

叠加 `index.tsx:2860` 的 `card.runKey === latestRunKey`——即使过滤放行，卡片也只会挂到最新一轮，而不是产生它的那一轮。

**影响**：用户永久失去对该权限请求的决策入口，只能去 workspace 侧板找（如果那边有的话）。

---

### F5 · P2 · 计划 / 多 Agent / 变更 diff 在已完成轮次默认不可见

**位置**：[index.tsx:2853](src/pages/Chat/index.tsx:2853) + [TurnSummaryCard.tsx:121](src/components/assistant-render/TurnSummaryCard.tsx:121)

```ts
const defaultExpanded = card.status === 'error' || card.status === 'aborted'
  || (card.active && card.streamingReplyText == null) || !card.hasVisibleReply;
```

正常完成且有回复的轮次 → `defaultExpanded = false`；`TurnSummaryCard` 在折叠时 **不渲染 children**（不是 CSS 隐藏，是真的不挂载）。

**影响**（P4/P4b 实测）：计划卡片、TeamOrchestrationCard、RunMutationDiffs、GeneratedFilesPanel、Terminal 卡片在历史轮次里全部要点一下才出现，且折叠标题只写「Worked for Ns」，没有任何"这里有一份计划/有 3 个子 Agent/改了 5 个文件"的提示。

**次生风险**：审批卡片也在这个折叠容器里。如果用户在 run 活跃期间手动折叠了某轮（override 存进 `runActivityExpandedOverrides`），随后到达的权限请求会被折叠在里面，**没有任何提示**。建议：待批准项存在时强制展开或在折叠头部渲染角标。

---

### F6 · P2 · 三个 assistant-render 组件在生产中不可达

**位置**：[src/components/assistant-render/model.ts:75-120](src/components/assistant-render/model.ts:75)

| 组件 | 数据源 | 生产端 producer |
|---|---|---|
| `ThinkingReasoning`（ChatMessage:554） | `meta.reasoning` / `meta.thinkingSummary` / `record.reasoningSummary` | **0 处** |
| `BranchPicker`（ChatMessage:546） | `meta.branches` / `meta.alternatives` | **0 处** |
| `ToolFallbackCard`（ChatMessage:653） | `meta.toolFallbacks` / `meta.tools` | **0 处** |

全仓库（`src` + `shared` + `electron` + `openclaw_runtime/src`）搜索这些字段，只有 `model.ts` 自身、`ChatMessage` 消费端，以及**手工注入 metadata 的测试**（`tests/unit/assistant-render-model.test.ts`、`tests/e2e/chat-assistant-rendering-visual.spec.ts`）。

**连带问题：模型真实的 thinking 内容无处呈现。** `extractThinking()`（message-utils.ts:333）全仓库只被当作**布尔谓词**使用（决定是否折叠/是否隐藏），从未渲染；`extractThinkingSegments()`（:354）**零消费者**。`sanitizeGraphSteps` 又主动丢弃 `kind === 'thinking'` 的图行（execution-projection.ts:121）。

即三条通路同时关闭：
- 消息气泡：`ThinkingReasoning` 数据源无 producer
- 执行图：thinking 行被 sanitize 掉（且两个 deriver 本来就从不产出该 kind → `TaskStep.kind === 'thinking'` 是死分支，`ExecutionGraphCard:27/120/165` 的相关代码不可达）
- 流式：`buildStreamingRenderMessage` 在有回复文本时剥离 thinking 块（execution-projection.ts:852）

**需要确认这是产品决策还是接线遗漏。** 如果是决策，应删除这三个组件与 `model.ts` 的对应分支；如果是遗漏，需要补 gateway → `metadata.reasoning` 的接线。

---

### F7 · P2 · 侧边栏会话列表在每个 runtime 事件上整体重渲染

**位置**：[Sidebar.tsx:494](src/components/layout/Sidebar.tsx:494) + [:622-715](src/components/layout/Sidebar.tsx:622) + [:837](src/components/layout/Sidebar.tsx:837)

1. selector 订阅了 `runtimeRuns`（:500）。每个 runtime 事件都会替换 `runtimeRuns` 对象引用 → `useShallow` 判不等 → Sidebar 重渲染。流式期间可达每秒数十次。
2. `handleStartRename`(:622) / `handleRenameSubmit`(:627) / `handleRenameCancel`(:640) / `handleRenameKeyDown`(:708) 都是**普通函数声明**，每次渲染新身份。
3. 这 4 个函数全在 `renderSessionRow` 的 `useCallback` 依赖数组里（:880-885）→ `renderSessionRow` 每次都是新身份。
4. `renderSessionRow` 作为 prop 传进 `SessionFolderTree`（已 `memo`）→ memo 失效 → 内部 `renderFolderNode` / `renderSessionWithMoveMenu` 的 `useCallback` 连锁失效 → 每个 `SessionRowMemo` 重渲染。

**影响**：`SessionRowMemo` 与 `SessionFolderTree` 的 `memo` 完全没有生效。会话数多时，聊天流式输出会拖累整个侧边栏。修复很轻：把 4 个 handler 包成 `useCallback`，并把 `runtimeRuns` 的订阅收窄为已派生的 `latestRuntimeRunBySession`（或只订阅状态摘要）。

---

### F8 · P3 · 同源双呈现（需确认意图，非明确 bug）

| # | 位置 | 现象 |
|---|---|---|
| a | index.tsx:2901 + :2914 | `GeneratedFilesPanel`（文件 chip）与 `RunMutationDiffs`（内联 diff）读同一份 `filesByRun`。同一个文件在同一张卡里出现两次：一次是 chip，一次是完整 diff。 |
| b | run-surface-promotion.ts 提升表 | 只有 `command.output` 被提升。产生它的 `tool.started`（如 `shell`）图行保留，其 `detail` 就是 `{"command":"echo hello"}`，与下方 Terminal 卡片的命令行重复。探针 P11 实测同一命令串在 DOM 中出现 4 次。提升表注释里写明"every other tool.* → kept"，属既定决策，但视觉上就是重复。 |
| c | ApprovalCard 双入口 | `PendingRunApprovals`（host 审批）与 `AgentInteractionRenderer case 'approval-card'`（模型自述）共用 `ApprovalCard`。当前因 F1 不会同时触发；**F1 一旦修好，如果运行时既注册 host approval 又发出 `approval` 工具调用，就会出现两张审批卡片**。修 F1 时必须同时加互斥。 |

---

### F9 · P3 · 孤儿组件（0 引用）

以下组件在 `src` 内无任何引用点，建议删除或补接线：

```
src/components/agent-browser/BoundaryChoiceDialog.tsx
src/components/chat/WorkModeSummaryPanel.tsx
src/components/common/StatusBadge.tsx
src/components/topics/TopicManager.tsx
src/components/topics/TopicSelector.tsx
src/components/assistant-ui/dot-matrix.tsx        ← 已被 orb-status 取代，仅剩自引用
src/pages/Chat/ComposerGitStrip.tsx               ← 本分支新增/改动文件，未接线
src/pages/Settings/SettingsDrawerRoute.tsx
```

另有 6 个 `tool-ui/*/_adapter.tsx` 与 `shared/action-buttons.tsx`、`shared/use-action-buttons.tsx` 无引用——若为 Tool UI 生成流水线的产物则属正常，需确认。

---

### F10 · P3 · ExecutionGraphCard 无空态守卫，渲染空壳

**位置**：[ExecutionGraphCard.tsx:124](src/pages/Chat/ExecutionGraphCard.tsx:124) + [index.tsx:2916](src/pages/Chat/index.tsx:2916)

组件没有 `if (steps.length === 0) return null`，而 index.tsx 无条件渲染它。探针 P5 实测：

```
emptyGraphRendered: true | stepRows: 0 | headerText: "executionGraph.agentRun"
```

**影响**：当一轮的所有图行都被提升走（纯计划轮、纯命令轮），展开 TurnSummary 后会看到一个只有「Main execution」标题、下面空无一物的分支图标行。对比 `RunTerminalSurfaces:11`、`RunMutationDiffs:5`、`PendingRunApprovals:20` 都有空态守卫——这里是唯一的漏网。

---

## 4. 做得好的部分（不要在修复中破坏）

1. **`run-surface-promotion.ts` 的提升表是有效的**。`runtimeCommandStepId / runtimeApprovalStepId`（task-visualization.ts:381-402）被声明为 step id 的唯一真源，提升侧复用同一函数，两边结构上不可能漂移。探针 P10/P11 实测：审批与命令输出都没有在图里留下重复行。这是全项目里防"组件打架"做得最扎实的一处，应作为其他重复面的范式。
2. **计划的双路径读取**（运行时事件 + 历史 `tool_use` 回放，run-surface-promotion.ts:124/155）复用同一个 `parseToolUiInteraction`，重载后不会丢卡片。
3. **侧边栏会话归属的三源合并 + 二分**（session-buckets.ts:145 / :210）互斥且穷尽，无重复行风险。
4. **`normalizeInteractionType`（agent-interactions.tsx:481）的别名表 + 形状回退**覆盖面很宽，解析层不是瓶颈。
5. **`TurnSummaryCard` 统一收纳**了 approvals / plan / files / diffs / graph / terminals / orchestration 七类面板，避免了它们各自往消息流里插卡——架构方向正确，问题只在默认折叠策略（F5）。

---

## 5. 建议修复顺序

| 顺序 | 缺陷 | 理由 |
|---|---|---|
| 1 | **F2** | 数据破坏（误删父工作组），且修复面极小 |
| 2 | **F1** | 整类交互面不可达；「询问」不可达会直接卡死 run |
| 3 | **F8c** | 与 F1 同批修，否则修好 F1 就会引入审批双卡 |
| 4 | **F4** | 权限决策入口丢失 |
| 5 | **F5** | 待批准时强制展开 + 折叠头补角标 |
| 6 | **F3 / F10 / F7** | 可用性与性能，独立可做 |
| 7 | **F6 / F9** | 需要产品决策：删组件 还是 补接线 |

**回归护栏建议**：F1 与 F8c 修好后，应把本次的 P1/P2/P3/P9/P10 五个探针场景固化为单测——现有 `chat-tool-card-suppression.test.tsx` 只验证了"不该出现的不出现"，缺少对称的"该出现的必须出现"，这正是 F1 长期潜伏未被发现的原因。
