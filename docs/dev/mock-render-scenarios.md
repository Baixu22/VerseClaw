# Mock 渲染场景清单

浏览器无 Electron 环境下的渲染层走查底稿。启动：

```bash
pnpm dev:mock
```

打开 `http://localhost:5273/?mock=1&script=<scenario>`，在输入框发送任意消息即触发脚本。
实现：[src/lib/mock-run-script.ts](../../src/lib/mock-run-script.ts)（run 脚本）+ [src/lib/mock-host-bridge.ts](../../src/lib/mock-host-bridge.ts)（host fixture）。

设计原则：**每个场景压一条审计发现的断裂路径**，而不是演示能跑通的路。`toolui` 与 `toolcall` 互为对照组——同一批卡片分别走围栏与工具调用两条通路，任何一边断裂都能被对照发现。

> **恢复记录**：这套 mock 框架（run 脚本 926 行 + host bridge 768 行）曾在 merge `28a9528b3` 的冲突解决中被整体丢弃，`mock-host-bridge.ts` 退化成 272 行 stub（`sessions.list` 返回 `[]`、transcript 为空），本文档描述的场景全部不可达。已从 `f95cc15d9` 恢复并扩展。

## 打开即可见（无需发消息）

`chat.history` 默认播种 **5 组已完成对话**，因此两个常驻界面在首屏就能走查：

- **左侧提问导航条**（≥3 条提问才出现）——5 条横条对应 5 次提问；hover 变长并弹出提问开头，点击平滑跳转，滚动时当前条加亮。
- **处理过程折叠框**——第 4 轮带 thinking + 工具调用，第 5 轮是**纯思考零工具**（推理模型的常见形态，过去这种回合根本没有卡片）。两者都默认折叠，标题行带「N 段思考」角标。

`?seed=0` 关闭播种，回到空态/欢迎水印。

## 场景表

| `script=` | 触发后预期看到 | 锁定的审计发现 |
|---|---|---|
| `full`（默认） | 计划卡 → Terminal 卡 → 权限审批（可批可拒）→ 内联 diff → 含全量 Tool UI 围栏的最终回复；处理过程折叠框内带推理（来自**真实 thinking 块**） | 综合冒烟；F6 历史路径 |
| `deepseek` | **14 段推理**交错 4 个处理步骤（read → grep → 失败的测试命令），最后是分节总结正文 | 折叠框的验收场景：推理量压过答案时，提示词与答案之间只剩一行。**注意下方已知边界——脚本 run 目前跑不到最后的总结** |
| `toolui` | 最终回复文本内的 ```` ```tool-ui ```` 围栏渲染出全部 24 种卡片 | F1 的围栏通路（审计中本来就通的一侧） |
| `toolcall` | weather / table / chart 三张卡片以 **tool_use 工具调用**形式逐个出现，随后最终回复 | **F1** —— 修复前这条通路整类不可达 |
| `ask` | 只出现一张「要发布到哪个环境？」问题卡，**没有最终回复，run 保持 running**；卡片可选择、可提交 | **F1 最严重症状**：修复前 run 卡死且用户看不到问题 |
| `planonly` | 折叠头出现「3 步计划」角标；展开后只有计划卡，**没有空的执行图壳** | **F10** 空执行图守卫 + **F5** 内容角标 |
| `approval` | run 中途抛出权限审批并**等待决策**，批/拒后 run 继续 | 审批交互闭环 |
| `carryover` | 第 1 轮抛出审批且**不解决**、run 正常结束；发送第 2 轮消息后**审批卡片仍然可见、可决策** | **F4** 跨轮存活 + 无活动卡时的独立兜底面 |
| `thinking` | 流式期间出现实时推理面板（thinking.delta 驱动）；结束后折叠为摘要，刷新/重载后仍在（历史 thinking 块驱动） | **F6** 双通路（live + history） |
| `abort` | run 空转 20s，点 Stop 后 turn 状态 settle 为「Stopped」而非「Completed」 | 中止生命周期 |
| `rail` | 会话状态栏三个条件区同时有真实数据：`todo_write` 计划、子 agent 扇出、终端命令 | 状态栏的 show-when-real 规则 |

> ⚠️ `rail` 目前在 mock 下看不到会话状态栏：状态栏（`.codex-session-activity-rail`）要求 `sessionActivity.snapshot` 返回快照，而 `mock-host-bridge.ts` 没有实现这个 host 调用。计划来自 run 事件、可以正常出现，但没有快照就整条栏不渲染。两个层（被动 inline / 主动 overlay）的验收目前落在 `tests/unit/chat-session-status-rail.test.tsx`，几何与两层色阶可以在任意 mock 页面里对 `.codex-session-activity-rail` 取计算样式验证。补上快照 fixture 后这一行才成立。

## 侧边栏 fixture（所有场景共用）

- 工作区 `mock-workspace` 下 **7 个会话**、**三层嵌套工作组**（渲染修复 → 审计回归 → 深层用例）+ 平级「发布准备」，另有两条 fork 关系驱动 lineage 线。
- 会话分组走查点：
  - **拖拽成组**：把一个会话拖到另一个会话行上 → 自动建组并把两条都归入；拖到**已归组**会话上 → 并入那个组（不产生第二层嵌套）；
  - **移除分组**：会话行 hover 出现移动按钮 → 菜单里选「无工作线」移出，或直接删组（组内会话退回未归线区域，不会消失）；
  - **重命名**：重命名「深层用例」→ 父级「审计回归」「渲染修复」名字**不得变**（F2）；删除「深层用例」→ 父级**不得消失**；
  - **引导线**：组内成员左侧竖轨 + 每行横向连接线，hover 整条加亮；
  - folder 变更为**真实内存改写**——刷新前的所有操作在 UI 上立即可见。

## 附加参数

| 参数 | 作用 |
|---|---|
| `&slowStartup=<ms>` | 拖慢首次 `chat.history`，用于检查启动骨架屏 |
| `&seed=0` | 不播种历史，回到空态/欢迎水印 |
| `&mock=0` | 退出 mock 模式（清除粘滞标记） |

`mock=1` / `script=` / `seed=` 会**粘滞到 localStorage**：浏览器自动化工具重载时只会回到 server origin、应用自身的 setup 重定向也会重写 URL，两者都会静默丢掉 query，导致走查中途掉进 /setup 或悄悄换回默认场景。

## 已知边界

- **`?script=` 的脚本 run 目前跑不到最后一条回复**（恢复后新发现，未修）。症状：思考流正常渲染，随后脚本静默中止 —— 卡片停在 `running`、`思考中…` 不消失、`assistant.delta` 与 `run.ended` 都没落到 store，回复行始终不出现。定位到脚本里的 `if (stopped()) return` 提前返回（`ctx.isAborted()` 变真），即有别处调了 `gateway.rpc('chat.abort')`；这条早退路径**不发 `run.ended`**，所以 run 永远挂着。影响所有 `script=` 场景，与具体场景无关。
  修的方向：先查谁在 run 中途触发 abort，再让早退路径也发一次 `run.ended`（`emitMockAbort` 已有这个形状）。
  **在此之前，走查请依赖首屏播种的历史**（见上方「打开即可见」）—— 那条路径走的是真实 `chat.history`，与产线一致，两个新界面都能完整验收。
- Mock 只允许发 `shared/chat-runtime-events.ts` 声明过的事件类型；`seq` 纪律见 `mock-run-script.ts` 内注释（漏 `seq` 会被 gateway 去重吞掉第二个同态事件）。`command.output` 还必须带 `itemId` 与 `phase: 'end'`，否则被提升出来的终端面一直是 running。
- 涉及真实主机能力（文件系统、git、终端）的验证仍归 Electron e2e，mock 不模拟。
- 页面模块态（transcript、pendingApproval、`runSeq`）随刷新清空；`carryover` 的两轮必须在**同一次页面会话**内完成。反过来说，**同一页面里连发两轮会污染 run 序号**（第二轮会被 store 的 stale-runId 守卫丢掉），走查脚本场景前先刷新。
- 不合成帧的无头浏览器里 CSS 过渡与 `scrollIntoView({behavior:'smooth'})` 不会推进，布局尺寸也可能冻结——导航条的 hover 变长、点击滚动这类行为改用 `tests/unit/chat-message-nav-rail.test.tsx` 验收。
