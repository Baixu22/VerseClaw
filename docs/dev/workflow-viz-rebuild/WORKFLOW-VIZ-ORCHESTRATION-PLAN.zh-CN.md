# 工作流可视化重建：调研结论与迁移编排（WV 程序）

- 日期：2026-08-14
- 状态：编排完成，待派单
- 调研输入：deepseek-harness（`C:\Users\27933\Desktop\deepseek-harness-master`，下称 dsh）全栈解剖 + ClawX 可视化链路逐环核验（全部证据带文件行号，开工前可复核）
- 任务前缀：`WV-`（Workflow Viz），批次 `B0`（止血）→ `B1`（事实源）→ `B2`（装配层）→ `B3`（展示层）

---

## 1. 调研结论

### 1.1 失效判定：双病灶

"工作流可视化失效"不是单组件故障，是**浅层可见性设计 + 深层数据底座**两层问题叠加：

**浅层（让活着的可视化"看起来失效"）：**

| # | 事实 | 证据锚点 |
|---|---|---|
| S1 | Chat 内联执行图链路是活的且设计讲究：`ChatRuntimeEvent → deriveRuntimeTaskSteps → ExecutionGraphCard` 文字执行树 + 升级表（one event, one renderer：命令→Terminal 卡、补丁→CodeDiff、计划→PlanView，升级后图内去重） | `src/pages/Chat/ExecutionGraphCard.tsx`、`src/pages/Chat/run-surface-promotion.ts`（文件头注释即设计文档） |
| S2 | **正常完成的 run 整卡默认折叠**：`defaultExpanded` 仅在 error/aborted/无可见回复时为真；运行中一旦流式输出正文也收起 | `src/pages/Chat/index.tsx:3106` |
| S3 | ExecutionGraphCard 细节还有第二层默认收起 | `src/pages/Chat/ExecutionGraphCard.tsx:23`（`useState(false)`） |
| S4 | Observability 页入口整个藏在 `devModeUnlocked &&` 内，普通用户不可见；路由 `/observability` 本身无守卫可直达 | `src/components/layout/Sidebar.tsx:1400`、`src/App.tsx:136` |

**深层（Observability 页打开也是空的/残缺的）：**

| # | 事实 | 证据锚点 |
|---|---|---|
| D1 | 普通会话主路径 **零 trace 生产**：`storeRuntimeTrace` 调用者仅有 orchestrator-run-observed / role-orchestration / mission-control / security-shadow 等编排类路径；`embedded-agent-runner` 目录 grep 无任何命中 | `openclaw_runtime/src/agents/orchestrator-run-observed.ts:416,801`、`openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:648` |
| D2 | trace 两级都是**内存缓存**：运行时侧上限 100、注释自认"MVP 不落盘、网关重启清零"；electron 侧上限 200 + 运行中 trace 30 分钟龄期淘汰 | `openclaw_runtime/src/observability/trace-buffer.ts`（`MAX_TRACES=100`）、`electron/services/observability-service.ts:11-13`（`MAX_TRACES=200`） |
| D3 | 兜底靠**事后扫盘反推**：从 transcript/轨迹文件合成 trace，上限 40 会话文件 / 2MB / 300 事件每 trace，与文件命名和目录布局强耦合 | `electron/services/observability-trajectory-index.ts` |
| D4 | **全链路静默吞错**：`ingestRuntimeTraces` 与 IPC fetcher 均为空 `catch {}`，失效无诊断信号 | `electron/services/observability-api.ts`（best-effort 注释）、`electron/main/ipc-handlers.ts:261` |
| D5 | 活动面板另一套账：`session-activity` 用**壁钟时间戳 last-wins** 排序，事件缺 ts 就 `Date.now()` 兜底；8 通道 payload 松散摸字段，无 seq / 无回放 / 无持久化 | `src/stores/session-activity.ts:43-54` |

**已有资产（不需要发明的东西）：**
- `openclaw_runtime/src/trajectory/`（runtime.ts/types.ts/export.ts/cleanup.ts）：带 `traceSchema: "openclaw-trajectory"` 的落盘轨迹事件写入器——**事实源坯子现成**。
- task-loop 已有 DCS phase producer（`task-loop-controller.dcs-phase-producer.test.ts` 在测）。
- 展示皮层不差：`AgentTraceGraph` / `TraceWaterfall` / 泳道三模式 + `TraceNodeDrawer` + scorecard；Chat 侧 ExecutionGraphCard + 升级表。
- 渲染栈兼容：ClawX = React 19 + Vite + react-virtuoso；dsh = React 18 + CSS Modules + @tanstack/react-virtual。组件逻辑无框架鸿沟，样式需一层 token 映射。
- 近期变更提示：`32a8849a3` 动过 observability trace 淘汰逻辑，开工前先读该提交。

### 1.2 能力对比（dsh vs ClawX）

| 维度 | dsh | ClawX 现状 |
|---|---|---|
| 事实源 | 单一 seq 事件日志，turn/step 结构事件切层级，可整段回放 | 三条旁路（IPC 生命周期事件 / 内存 trace buffer / 事后扫盘）互不相干 |
| 排序一致性 | seq 单调 + 水位线（asOfSeq） | 壁钟 ts last-wins + `Date.now()` 兜底 |
| 服务端投影 | 纯折叠单元（init/apply/view + stateVersion 失效）+ 持久缓存 + 冷读階梯，写入 fail-soft | 无投影层；快照 RPC 拉内存 buffer |
| 断线恢复 | 双流重连 + live-gap 修复 + 尾页补拉 | 无（重启即丢） |
| 客户端装配 | ConversationAssembler：NodeDefinition(match/start/update) 状态机、turn/step 定位、replace/prepend/append 三摄入路径、发布节奏节流 | 每 store 手写 reducer 摸字段 |
| 多视图同源 | chat 与 trajectory 是同一装配结果的两个视图目标 | 各面板各自拉数 |
| 展示内容 | 7 类记录账本（逐条 token 五项、TTFT/吞吐、调用时刻工具 schema、seq 跳转）+ 三泳道时间线四投影 + workflow 相位面板 | trace 图/树/泳道 + 活动面板 + plan/progress 工具 UI（皮好数据断） |
| 扩展方式 | NodeDefinition + slots 按 key 注册，O(D) 热路径纪律 | 加事件类型要改多处 reducer |
| 失败表现 | pending context（start 未加载不猜）、gap repair | 静默空白 |

### 1.3 dsh 必吸收机制（按迁移价值排序）

1. **事件族纪律**（批1 的规范基础）：稳定业务 id + start/update 生命周期角色；携带状态的事件带**变更后全量值**（对消费方 last-wins）；禁止"猜最近未完成的 context"。
2. **turn/step 结构事件**：`turn/start·end`、`step/start·end` 把日志切成层级，一切定位、时间线轮次边界、workflow 中断推导都从它来。
3. **装配引擎**：match/start/update 状态机 + 三摄入路径 + `publication`（immediate/animation-frame/none）节流 + O(D) 热路径（新事件对每 Definition 各 match 一次，命中后 context 常数时间查找，禁止扫窗口）。
4. **多视图目标**：同一装配结果注册多个 view target，各自增量构建快照（replace 全量 / apply upserts）。
5. **中断态结构推导**：workflow 成员状态由 turn/step 关闭事件推导（`locationClosed`），不需要心跳。
6. **可选后置**：服务端投影单元 + 持久缓存冷读階梯（ClawX 单机 Electron 场景收益小于 dsh 的 web 多端场景，批1 先做"日志 + 订阅"，投影缓存视性能需要再引入）。

参考文件（实现者按需查阅，勿整包搬运）：
- 装配契约：`packages/client/runtime/src/client/contract/conversation.ts`
- 扩展食谱（含六条验证清单）：`docs/cookbook/adding-a-conversation-node.zh.md`
- 投影机制：`docs/subsystems/session-projection.zh.md`
- 轨迹组件族：`packages/client/ui-trajectory/src/client/`（trajectory-record.ts=记录契约、timeline.ts=三泳道四投影模型）
- workflow 面板：`packages/client/ui-workflow-run/src/client/workflow-definition.ts`
- 连接层：`packages/client/connection/src/client/connection.ts`

---

## 2. 目标态架构

```
openclaw_runtime（运行中同步写）
  └─ 轨迹事件日志（openclaw-trajectory v2：seq 单调 + run/turn/step/tool start-end 对 + 稳定 id + 全量值）
       ├─ 网关：observability.readFrom(seq) 尾页拉取 + subscribe 按 seq 推送（断线补页）
       │    └─ electron 转发 → 渲染端
       └─ 落盘（现有 trajectory 目录，重启可回放）

渲染端装配引擎（单一消费层）
  └─ NodeDefinition 注册表（match/start/update + turn/step 定位 + 节流）
       ├─ 视图目标 chat：ExecutionGraphCard / 升级卡（现有，改喂装配结果）
       ├─ 视图目标 trajectory：账本 + 三泳道时间线（新增）
       ├─ 视图目标 workflow：相位面板（新增）
       ├─ 视图目标 trace-graph：现有 AgentTraceGraph / TraceWaterfall（改喂装配结果）
       └─ 视图目标 activity：session-activity 面板（改喂装配结果，删手写 reducer）
```

原则：**可视化 = 轨迹日志的投影**。日志在，任何视图可重建；新视图 = 新 NodeDefinition + 新 target，不再加旁路。

---

## 3. 迁移编排（任务卡）

### 批0 · 止血（渲染端小改，无依赖，可立即派单，预估合计 1 人日）

**WV-B0-01 运行卡折叠策略修正**
- 改动面：`src/pages/Chat/index.tsx`（defaultExpanded 逻辑）、`src/pages/Chat/ExecutionGraphCard.tsx`、设置 store。
- 内容：新增"运行完成后保持活动卡展开"用户设置（默认开，消除失效观感）；`runActivityExpandedOverrides` 已有会话级覆盖机制，叠加全局偏好；ExecutionGraphCard 细节展开状态随卡记忆（不再每次挂载 `useState(false)` 归零）。
- 验收：正常完成 run 后执行树默认可见（设置开）；error/aborted/待审批语义不回归（审批置顶展开的现有规则保留）；相关单测通过。
- 风险：无。纯渲染端。

**WV-B0-02 Observability 入口去门控 + 空态诊断化**
- 改动面：`src/components/layout/Sidebar.tsx:1400`、`electron/services/observability-api.ts`、`src/pages/Observability/`。
- 内容：入口移出 `devModeUnlocked`（或换独立开关默认开）；`ingestRuntimeTraces`/fetcher 的空 `catch {}` 改为逐数据源健康登记（`sourceHealth: {runtime|index|trajectory: ok|empty|error(原因)}`）随 snapshot 返回；页面空态显示各数据源状态与原因，不再纯空白。
- 验收：无数据时页面能说出"为什么空"（三源状态可见）；有数据行为不变。
- 风险：无。不改数据语义。

**WV-B0-03 现状测试基线（批1 安全网）**
- 改动面：`tests/unit/`（新增）。
- 内容：先读 `32a8849a3` 提交；给 observability ingest→index→graph 链路建最小回归测试（内存 buffer 合并、扫盘合成、trace 查询分页）；固化当前行为作为批1 改造对照。
- 验收：新测试在改造前全绿；作为批1 的回归对照基线。
- 依据：修缮批次"先加测试网"传统（RUNTIME-CODING-REPAIR-PLAN 批0 同法）。

### 批1 · 事实源扶正（openclaw_runtime + electron，核心批次）

**WV-B1-01 轨迹事件 schema 契约化（后续一切的地基）**
- 改动面：`openclaw_runtime/src/trajectory/types.ts`（演进为 v2）、新增 zod schema 与类型导出。
- 内容：以现有 `openclaw-trajectory` 为基础定义：`run/start·end`、`turn/start·end`、`step/start·end`、`tool/start·update·end` 事件对；每事件带单调 `seq`、稳定业务 id（toolCallId/runId/loopRunId）、`schemaVersion`；执行**三铁律**——① 稳定 id（消费方绝不猜归属）② 全量值（带状态事件带完整后像）③ 可回放（按 seq 升序重放必得确定态）。
- 验收：schema 单测（含回放确定性用例）；与现有 v1 文件的兼容读取声明（读侧识别版本）。
- 禁区：不动 DCS context-engine 文件（`lint:dcs` 清单内文件一律不碰）。

**WV-B1-02 主路径产写结构事件**（依赖 B1-01）
- 改动面：`openclaw_runtime/src/agents/embedded-agent-runner/`、`openclaw_runtime/src/agents/task-loop-controller.ts` 挂钩点、`openclaw_runtime/src/trajectory/runtime.ts`。
- 内容：普通会话运行中**同步**写 v2 结构事件：run/turn 边界从 runner 生命周期、step 从模型调用循环、tool 从 sessions/tools 执行钩子；task-loop 现有 phase producer 事件并入同一日志（不另开旁路）。
- 验收：跑一个真实普通会话（非编排路径），轨迹文件含完整 run→turn→step→tool 链，seq 单调无空洞；回放重建与实时观察一致；task-loop phase 事件出现在同一日志。**在 clean detached worktree 复测**。
- 协调：触碰 task-loop-controller 需对照 DCS phase producer 现有测试（`task-loop-controller.dcs-phase-producer.test.ts` 必须保持绿）。

**WV-B1-03 网关订阅/补拉接口**（依赖 B1-01，可与 B1-02 并行）
- 改动面：`openclaw_runtime/src/gateway/server-methods/`（新增方法）、gateway 事件推送通道。
- 内容：`observability.readFrom({sessionKey, fromSeq})` 尾页拉取 + `observability.subscribe` 按 seq 实时推送；断线重连后客户端凭最后 seq 补页（gap repair 的最小实现）；保留旧 `observability.traces` RPC 过渡期兼容。
- 验收：单测覆盖"订阅中断→重连→补页无缝"；推送帧带 seq；旧 RPC 行为不变。

**WV-B1-04 electron 供数改造**（依赖 B1-02 + B1-03）
- 改动面：`electron/main/ipc-handlers.ts`、`electron/services/observability-api.ts`、`electron/services/observability-trajectory-index.ts`。
- 内容：主进程从"定时拉内存快照 + 扫盘合成"改为"订阅事件流 + 按需 readFrom"；事后扫盘（trajectory-index）降级为 v1 历史文件的迁移期兜底并标记 deprecated；B0-02 的 sourceHealth 语义随之更新。
- 验收：B0-03 测试基线全绿（行为等价或明确记录的改进）；重启 electron 后历史会话轨迹仍可完整展示（从日志重建，不再依赖内存 buffer）。

### 批2 · 装配层移植（渲染端，依赖 B1-01 schema；B2-01 可用 fixture 先行开工）

**WV-B2-01 装配引擎核心**
- 改动面：新增 `src/lib/trajectory-assembler/`（或同级命名）。
- 内容：移植 dsh 简化版：NodeDefinition(match/start/update) 注册表 + turn/step 定位 + replace/prepend/append 三摄入路径 + publication 节流（immediate/animation-frame）+ 多视图目标快照构建（replace/apply upserts）。**不搬 Cordis**：用轻量注册表替代插件系统与 declaration-merging 全套；对照 `docs/cookbook/adding-a-conversation-node.zh.md` 的引擎语义。
- 验收：dsh 食谱六条验证全部落为单测——① replace 终态正确 ② 只有 update 的窗口保持 pending、prepend 补 start 后与全量 replace 等价 ③ 历史+实时 append 与全量回放等价 ④ prepend 不替换未变化的 keyed node ⑤ animation-frame 每帧最多发布一次 ⑥ renderer 只消费 node.data。
- 纪律：热路径 O(D)——新事件仅逐 Definition match 一次，禁止遍历窗口/全部 context/已渲染节点。

**WV-B2-02 现有 store 并轨**（依赖 B2-01 + B1-04）
- 改动面：`src/stores/session-activity.ts`、`src/stores/observability.ts`。
- 内容：两 store 改为装配结果消费者；删两套手写 reducer 的字段摸探；壁钟 last-wins → seq 排序；`Date.now()` 兜底删除。
- 验收：活动面板与 Observability 页在真实会话下行为等价或改进；session-activity 现有 mock 场景（`?mock=1`）迁移为装配层 fixture 注入，功能保留。

**WV-B2-03（并入各卡）**：装配层测试不单列，B2-01/02 验收即含。

### 批3 · 展示层升级（依赖 B2-01 + B1 数据在场；三卡可并行）

**WV-B3-01 轨迹账本视图**
- 内容：新增 trajectory 视图目标：7 类记录行（system/user/context/compacted/message/tool/subtool）、每行 #序号/kind/单行摘要/时长/错误态、详情抽屉（完整输入输出/思考/调用时刻工具 schema/源块）、逐消息 token 五项账目（input/cacheRead/cacheWrite/output/think）、TTFT 与解码吞吐、`sourceSeq` 跳转；react-virtuoso 虚拟化。
- 对照：`ui-trajectory/src/client/trajectory-record.ts`（记录契约逐字段对照）、`TrajectoryTable.tsx`。

**WV-B3-02 三泳道时间线**
- 内容：泳道 0=system/user/context、1=助手消息、2=工具/子工具；四投影模式（sequence/duration/time/actual）；轮次边界竖线；错误 span 标红；刷选区间与账本联动过滤。
- 对照：`ui-trajectory/src/client/timeline.ts`（`deriveTrajectoryTimeline` 模型可近乎直译）。

**WV-B3-03 workflow 相位面板 + 现有视图接轨**
- 内容：phase→member（子会话链接+状态）面板，中断态由 turn/step 关闭结构推导（对照 `workflow-definition.ts` 的 `locationClosed`，不加心跳）；`AgentTraceGraph`/`TraceWaterfall` 改注册为同源装配结果的视图目标（数据换源，皮不动）。
- 样式：全批统一做一层 dsh `--dsw-alias-*` → ClawX 主题变量映射表，禁止散落硬编码色值。

### 依赖图与并行度

```
B0-01  B0-02  B0-03        ← 三卡互独立，立即可派
                │
B1-01 ──┬─ B1-02 ──┐
        └─ B1-03 ──┴─ B1-04
B1-01 ──── B2-01（fixture 先行，不等 B1-02/03/04）
B1-04 + B2-01 ── B2-02
B2-01 + B1 数据 ── B3-01 ∥ B3-02 ∥ B3-03
```

关键路径：B1-01 → B1-02 → B1-04 → B2-02。B0 全部与关键路径无关，先行止血。

---

## 4. 全局纪律（每张卡的隐含验收项)

1. **DCS 禁区**：`lint:dcs` 清单内的 context-engine / DCS 相关文件一律不改；触碰 task-loop-controller 时 DCS phase producer 测试必须保持绿。
2. **clean-worktree 验证铁律**：所有"测试绿/门禁绿"结论须在 clean detached worktree 复测；回归判定与父提交在同一 worktree 对比（主树长期脏）。
3. **禁止 `git checkout <path>` 回滚工作树改动**（主树脏，会毁掉未提交内容）。
4. **事件三铁律**（批1 起全程有效）：稳定业务 id / 全量值 / 按 seq 可回放；热路径 O(D) 不扫窗口。
5. **门禁基线**：tsgo:prod 存量 266 错误为预存基线，新改动文件零新增错误；渲染端改动跑 `typecheck:web` + 相关 vitest；渲染行为改动对照 verify:render 既有约定。
6. **不搬清单**：Cordis 插件系统、declaration-merging 类型表、i18n 三件套流程、dsh 服务端投影缓存（后置候补）——只吸收机制语义，不引入其包结构。

## 5. 与在途程序的协调

- **R 系列（真实修复程序）**：第 1 波 CI/进程兜底在途。WV-B0 纯渲染端无交集；WV-B1 触碰 gateway/server-methods 前确认 R 系列当波是否有同文件在改，有则排队。
- **FP（首产品受控预览）**：WV-B0-01/02 直接改善预览观感，可并入 FP 的可见性验收叙事；批2/3 属产品能力增强，不阻塞 FP 门禁。
- **task-forest**：本程序建议注册为一棵全局任务树（WV 根 + 四批子节点），派单时同步。
