---
id: session-derivation-ui-design
title: 会话家族与生命周期交互设计依据
type: guide
---

# 会话家族与生命周期交互设计

2026-11-02 设计合同，2026-11-08 实现入口更新。主任务为 `tasks/session-derivation-ui.md`，硬约束为 `rules/session-derivation-ui-contract.md`。聚合验证见 `tasks/session-task-chain-acceptance.md`，操作 owner 见 `docs/dev/session-lifecycle-control-matrix.md`。以下“已核实的起点”保留设计时事实，当前结果以候选绑定的验收报告为准。

## 已核实的起点

| 位置 | 当前事实 | 设计影响 |
| --- | --- | --- |
| `src/components/layout/SessionFolderTree.tsx`、`docs/dev/session-workstreams-design.md` | 项目内单层工作线、全局时间平铺；生产未调用 lineage helper | 工作线是整理方式，血缘是关系；时间视图继续平铺，项目内按需展开家族 |
| `src/components/layout/session-buckets.ts` | `threadSessionsByLineage` 只在测试调用，将多代压成一级，并对循环防丢行 | 优先复用和扩展，不能把 helper 存在说成界面已完成 |
| `shared/chat/types.ts`、`src/stores/chat/session-actions.ts` | ChatSession 与列表映射没有保留 `spawnedBy` | 先补齐字段流，不在页面猜 worker 来源 |
| `shared/types/session-derivation.ts`、`session.activitySnapshot` | 已有 fork/handoff/spawn 的只读逐跳来源与缺失/循环/深度上限状态 | 共用分类和诊断，不新建血缘数据库或全量快照轮询 |
| `src/pages/Chat/index.tsx`、`ChatMessage.tsx` | 下拉派生会话、普通 Fork 与用户消息 Fork 已存在 | 消费同一关系投影；新问题入口扩展现有 Fork，而非另造派生协议 |
| `openclaw_runtime/src/auto-reply/reply/session-fork.runtime.ts` | 用户消息 fork 的有效 leaf 是最近 assistant 祖先；非法 leaf 不降级 tip | 预览文案说明“此提问之前的上下文”，不承诺复制该用户消息 |
| `ad77bf57c`、`handleCreateHandoffSession` | 2026-10-10 有意改为创建后首轮发送；旧 MVP 规格及 E2E 标题仍写不发送，断言要求发送 | 保留现行首轮语义，明确按钮“创建并发送”，更新过期契约，补发送失败恢复；不凭旧标题回滚功能 |
| `shared/types/session-delegation.ts` | accepted-not-completed 不表示结果完成 | admission、run、report、task 接纳、parent 续接各自展示，不能一个绿勾代替全链 |
| `electron/services/sessions-api.ts#createHandoff`、`sessions.lifecycle.ts` | 当前 Handoff 只写 Task Ledger 来源；既有 `sessions.create` 支持 `parentSessionKey`，但此路径没有调用 | U3 必须沿现有 runtime owner 建立持久来源后再激活/发送，不能让 UI 从 Ledger 补一套旁路树 |
| `SessionCreateHandoffPayload`、`runtime-send-actions.ts` | 创建请求无稳定操作标识；普通发送每次生成新 idempotency key，组件 busy 状态不跨重启 | U3 补最小持久操作状态，创建响应丢失和首发未知均先对账，复用 child 与发送标识 |
| `classifyDerivation`、`gateway/session-utils.ts` | 当前 parent 字段先于 spawnedBy 分类；Gateway 的 worker row 可同时携带两者 | U1 在共享 classifier 修正优先级并覆盖双字段 fixture，页面不能另写一套分类 |
| `WorkspaceAgentsPanel.tsx`、`SessionActivityPanel.tsx` | 已有 worker roster、transcript、派发/状态入口 | 增量接齐，不建第二个 Agent 控制台 |

SessionKey 是稳定逻辑会话，sessionId 是 generation，run 是执行尝试，leaf 是 transcript 边界。compact/reset/restore 等事件可以改变 generation 或上下文，不因此产生父子会话。

### 进入实施前必须接齐的三个前置条件

1. **U1 关系分类**：有效 fork 事实优先，其次真实 `spawnedBy`，最后仅有 `parentSessionKey` 的 Handoff；字段相互冲突时显示诊断，不猜父级。共享 `classifyDerivation` 与其他 stage 消费者一起回归。至少覆盖 worker row 同时有 parent/spawnedBy 的情况，不仅测试人为互斥字段。
2. **U3 Handoff 来源**：由 Main 通过既有 `sessions.create` 或等价 runtime owner 写入带 `parentSessionKey` 的真实 child，再更新工作区和首发。Task Ledger 保留任务与深度记录；它不能成为侧栏血缘权威。runtime 写入失败不激活假 child；部分成功保留同一操作并可恢复。历史只有 Ledger 来源的数据暂不伪装成普通 root，也不私自批量迁移，显示来源未接齐；需要迁移时另列范围和验收。
3. **U3 创建与首发恢复**：沿既有 Main/workspace/session 持久层保留最小记录：稳定创建操作标识、源 key/generation、已确认草稿或其一致性标识、child key、首发 idempotency key 及 pending/sent/failed/unknown 阶段。不另建通用操作平台或关系 store。重进页面/进程重启后先读既有 runtime/run/transcript/receipt 对账，再恢复同 child；同一逻辑发送重试复用原 key，不再次创建。草稿修改属于新的明确发送意图，不能拿旧 key 发送不同 payload。若现有 runtime 不能跨重启确认某次未知发送，保持 unknown 并提供核实入口，不能承诺 exactly-once 或盲目重发。

## 官方参考材料与适用范围

通过 VerseSearch → AnySearch 的 search/extract 核对。参考资料随产品变更；以下观察日期为 2026-11-02，不是 ClawX 已通过的对照验收。DeepSeek 子代理使用请求的 `ccs-workbuddy/deepseek-v4.1-flash` 路由执行只读复核；路由名不等同于已独立证明供应商 snapshot。独立分析与本地代码交叉核实后才进入本合同。

| 官方资料 | 可核实模式 | 在 ClawX 中借鉴 | 不可推断 |
| --- | --- | --- | --- |
| [Codex Worktrees](https://developers.openai.com/codex/app/worktrees) | 一个项目中的多个独立 chat 可在不同 worktree 中工作；Handoff 移动同一个 chat 与代码所在 checkout | 显示上下文位置与工作区归属，避免切换后迷失 | Codex Handoff 不是 ClawX 创建续接子会话；不能照抄术语含义 |
| [Codex Subagents](https://developers.openai.com/codex/subagents) | 父线程按明确请求委派专门 agent，并汇总结果；子线程可检查 | 主会话保留协调视角，详情按需打开 | 资料没有规定 ClawX 应有何种侧栏缩进、worker 留存和删除策略 |
| [Codex CLI slash commands](https://developers.openai.com/codex/cli/slash-commands) | `/fork` 复制当前本地对话并继续独立探索 | Fork 与环境迁移分开命名和解释 | CLI 行为不证明桌面任意消息级 Fork 或父子树 |
| [Claude Projects](https://support.claude.com/en/articles/9517075-what-are-projects) | 当前版项目集中聊天历史和知识；并行 thread 的新版仅在文档所述 beta 范围 | 项目容器和单段聊天上下文分开，按任务发现相关会话 | 不能把 beta 写成所有 Claude Desktop 用户的默认 UI |
| [Claude Cowork Dispatch](https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork) | 文档描述持续协调线程、具体工作 session 可打开、完成/需批准时提示；可用性受 beta 限制 | 安静的协调面、可进入详情的结果与等待状态 | 不沿用它的云执行、通知或会话持久化保证 |

“高级克制”是本项目设计选择：中性灰阶连续表面、轻分隔、清楚留白、单个主操作、渐进展示。官方资料不提供 ClawX 的像素约束；尺寸和 token 以下述仓库现有样式为准。未用第三方截图推断隐藏交互。ChatGPT release-notes 页面抽取失败，故不作为本合同的产品行为依据。

## 信息结构和低保真草图

项目内会话区（默认只有会话；用户展开才出现后代）。这是设计草图，不是已运行截图：

```text
项目 / 当前工作线                       [工作线计数]
  ▾  主会话标题                  3      ○      [Pin ⋯]
       分支实验                  ↳      ◉      [Pin ⋯]
       续接排障                  ⇢      ○      [Pin ⋯]
       测试检查                  Agent  ◉      [Pin ⋯]

会话头部  项目  /  当前会话       来源：主会话  ›  [关系]
正文      当前会话 transcript
消息操作  ……  [在新会话中提问]
输入区    草稿或明确的新会话建议；只呈现一个主操作
```

- 会话行沿用 30px 高度及当前字重、圆角、状态 orb。左侧 disclosure 占固定窄列，标题不得压到右侧 Pin/⋯ 或状态。类型用一个现有 14–16px 图标和 tooltip；普通列表不增加 key、时间、角色等多行副标题。
- 家族只在现有项目/工作线内投影，最多额外缩进一层，缩进建议 12–16px，最终以宽窄窗口无碰撞为门槛。深层 C 在 A 的家族中显示时，详情仍显示 B→C 的真实来源。
- 根行只在有可见后代时显示 disclosure 与数量；计数区可汇总“2 运行 / 1 等待”，hover 不遮住状态。无需给每个孩子做卡片、树线或彩色标签。
- 时间排序继续每个会话一行。跨分组父项、被归档或未加载的父项不用于重新归组；可读来源用链接，真正缺失用“来源不可用”，两者不能混同。
- 选中后代只展开必要路径；后台新子会话到达显示数量/未读，不抢当前输入焦点、不自动切换、不把正在 hover 的行搬走。返回来源恢复原草稿与可恢复阅读位置。
- 大家族按需展开或渐进呈现，禁止首屏为每行加载 transcript 或单独轮询 activitySnapshot；扩展前复用已有列表预算与性能基线。

## 可见状态和动效

| 情况 | 最小显示 | 操作与恢复 |
| --- | --- | --- |
| 用户提交创建中 | 原按钮 busy，禁止重复提交 | 不先插入假成功子项；确认 owner 返回 child 后选择它 |
| Fork 已创建 | 新会话来源条，question draft | 不发送；焦点进入草稿。失败留在原会话，保留问题 |
| Handoff 预览 | 可编辑交接包、缺少来源的 warning | 单一主按钮“创建并发送”；取消不创建 |
| Handoff 首轮发送中/失败/未知 | 精确到新 child 的交付状态 | 失败保留草稿；未知先核实既有 run/receipt，再允许重试，禁止重复创建 |
| Spawn 已接收 | 中性“已接收” | 有真实 child key 才可打开；尚未有 key 显示等待，不造 placeholder session |
| 运行/等待/失败/已停止/已完成 | 现有 orb + 可访问状态文本 | 颜色仅表达状态；父级汇总不改变自己的状态；完成由真实事件决定 |
| 结果报告/父会话续接 | 活动中的来源→目标与对应 receipt | “报告已送达”不等于任务接纳或父会话已继续 |
| parent-missing/cycle/bound-exceeded | 来源不可用/循环/链已截断 | 不消失、不伪装 root，显示已有可访问部分 |

所有按需浮层复用现有 modal/popover/sheet；960×800 下用单视图或覆盖层，1280×800 可沿现有右侧 workspace panel，不强制三栏。颜色/opacity/必要 transform 120–180ms；不做新增弹簧、放大、发光连线或持续闪烁；reduced-motion 保留可理解的静态状态。Overlay 不 transform 背景树。Light/Dark 均用同一 token 体系。

## 会话内“需要新会话”的策略

1. 消息 hover 和键盘菜单复用现有 Fork 入口。选“在新会话中提问”后打开一个紧凑预览，展示源标题、分叉边界和可编辑问题；默认可带入所选原问题，不能覆盖源 composer 的其他草稿。
2. 明确说明“保留此问题之前的上下文”。提交时校验 entryId、active run、Gateway 和 runtime 已有上下文上限；没有 assistant ancestor 则拒绝，不偷偷整段 Fork 或 Handoff。
3. 创建成功后切到子会话，恢复问题草稿并聚焦；不自动发送。取消无副作用；重复点击只允许一次创建；失败保留输入。
4. 模型回复中提出“建议新开会话”只形成建议。用户选中建议后仍进入相同预览与确认；若没有既有结构化 action payload，先使用现有明确菜单，不新增正则解析普通回复的隐式执行器。
5. 恢复场景优先沿已有 continuity recommendation 展示 Handoff；该流程使用“预览→创建并发送”且保持明确。用户仍能选择可用 Fork，UI 不静默互换策略。

## 生命周期与控制覆盖矩阵

每阶段实现时补充实际 owner/action 与旅程结果；此表是范围合同，不能视为已接线。

| 动作或事件 | 承载界面 | 约束/负例 | 对应阶段 |
| --- | --- | --- | --- |
| 新建/切换/重开 | 既有侧栏、Chat 头、composer | 每会话草稿隔离；新会话日期/工作区不串 | U1/U2/U6 |
| Fork / 消息 Fork | 会话菜单、消息预览、来源条 | 真实 cut point、忙态禁用、失败无假 child | U3 |
| Handoff | 既有交接预览 | 明确创建并发送；来源告警、深度拒绝、发送恢复 | U3 |
| Spawn/委派 | 既有 Team/Agents/Activity | admission 与 completed 分开，权限/隔离沿已有 owner | U4 |
| send/steer/报告/续接/yield | 同一活动/worker 详情 | 只暴露现有 host 支持动作，显示源/目标/回执；未知、过期、拒绝可见 | U4 |
| Stop / 协调器暂停继续 | 既有运行/协调入口 | 不拿 Delete 当 Stop，不给模型专用 yield 新造写通道 | U5 |
| compact/range/checkpoint restore/reset | 既有上下文/恢复入口与活动 | 解释 generation/上下文变化，不制造子会话；默认关闭能力继续关闭 | U5 |
| archive/undo/restore/delete | 既有 ⋯、归档页、确认 | 保留真正 owner 的衍生数据清理；不新增子会话级联删除，幸存子项仍能访问 | U5 |
| Gateway 重连/晚到结果 | 现有状态与失败反馈 | 同 key 不同 generation 不能串结果，未知不画成功 | U1/U4/U5/U6 |

## 实施节点与验收

| 阶段 | 交付与写集 | 必须由当前候选证明 |
| --- | --- | --- |
| U1 补齐单一关系读模型 | ChatSession、session-actions、现有 lineage helper/类型及测试；消费现有 activity derivation，修正共享 classifier | 多子会话、多代、缺失/循环/截断、跨分组；parent+spawnedBy 不误判 Handoff；不添 writer、不造 root、不做 N+1；contract/typecheck 与聚焦单测 |
| U2 会话家族导航 | SessionFolderTree/Sidebar/Chat header、现有 CSS/i18n、Electron E2E | 按需展开、时间平铺、来源/后代双向导航、键盘、草稿和焦点隔离，Pin/⋯ 规则保持 |
| U3 Fork 与续接交互 | ChatMessage/Chat/composer/workspace-session、现有 Main createHandoff/持久层与 Host 契约的必要扩展、四语、已有 fork/handoff specs 与 E2E | 消息边界准确；Fork 问题不发送；Handoff 持久来源和创建/发送标识接齐；响应丢失、首发未知、重复提交与进程重启恢复同 child；旧规格/测试标题同步 |
| U4 Spawn 与跨会话传递 | 既有 Agents/Team/Activity、相关 host facade（仅有事实证明必需时）与 E2E | admission→运行→报告→父续接分别有 owner receipts；child transcript 可开，权限/后端不可用、generation mismatch 负例 |
| U5 生命周期控制 | 现有 stop/pause/archive/restore/delete/compact/checkpoint 入口与 E2E | 目标/范围/禁用理由正确；取消不执行、晚到结果不串、保留 owner 屏障与清理、无隐式孩子级联 |
| U6 整链自动验收 | 聚焦新增 E2E + 原有回归、精选 agent 证据、README 四语、契约同步 | Light/Dark×1280/960、collapsed/keyboard/reduced-motion；2/20/100 后代 fixture 无丢行/遮挡，记录延迟/RPC/重渲染，不自造性能通过线；host mock 与实际 Gateway 接线证据分开 |

复用 `chat-session-fork/handoff/derived`、`long-session-delegation-admission/completion-continuation/coordination`、`sidebar-session-folders-archive`、`chat-checkpoints`、`chat-session-compact-range` 等当前测试；UI 新交互同阶段补 Electron E2E。通信改动跑 contract + comms replay/compare；最终跑 uncached typecheck、i18n、build 和对应全链旅程。每阶段先建窄 task spec 再 context/validate；不改测试断言去迎合错误 UI。

新规划与 TF-0640（会话治理）、TF-0021（视觉基线）、TF-0555（协调 UI）关联，不重开已完成父节点。执行叶子串行，保留现有无关 ready 队列。计划状态不代表 UI 完成；功能关闭必须回读同候选磁盘证据，标注 actor/driven_by=agent、命令/退出码/计数、fixture/provider 边界和未测范围。

本地 TF 已登记：总目标 TF-0656；U1–U6 依次为 TF-0657、TF-0658、TF-0659、TF-0660、TF-0661、TF-0662。当前仅 U1 为 ready，后续 proposed 并串行依赖前项；实施进度均为 0。这里仅保存规划时标识，实时状态以本地 Task Forest 为准，构建不依赖私有历史。

## 2026-11-02 自治项目规划增补

用户授权把本支线接入系统/项目自治规划。原六叶编号、全部验收和依赖链保留；以下增量调整优先于上文旧规划时的ready快照，实时状态仍由Task Forest管理：

| 叶子 | 调整 | 新前置与边界 |
|---|---|---|
| 0657 / U1 | 单一读模型增加project/workspace、generation、任务引用和freshness | 自治A1合同；不写任务/谱系事实 |
| 0658 / U2 | 项目名称进入负责人；折叠独立；项目与会话常驻任务清单；复用面板显式scope | 自治A4真实任务绑定；自动规划/派发由P1/P2交付 |
| 0659 / U3 | Fork/Handoff展示任务/上下文继承，不复制claim/lease；持久操作key区分重试与新意图 | 沿原U2前置及既有runtime owner |
| 0660 / U4 | 按任务显示worker模型、资源、排队、报告、验证与parent续行 | 只展示真实receipt，不推断自动完成 |
| 0661 / U5 | 区分暂停派发、停止run、取消task、归档session及回收结果 | 只接owner已有动作，不伪造全局kill |
| 0662 / U6 | 增加项目→任务→会话→证据整链验收 | 保留原视觉/恢复要求；全自治由V2独立验收 |

项目页复用现有MainLayout/Chat/TaskLedgerSummaryPanel/ResourceChip/角色与worker面板；必要写集增补src/App.tsx、项目页路径、相关panel与project-agent-entry Electron spec。scope/anchor必须显式输入，不能让默认main session管理所有项目。

完整节点合同与骨架对应关系见harness/specs/guides/autonomous-project-system-plan.md；本支线既有“仅现有Host入口”表示不绕过owner，确有事实缺口的typed action须在对应窄spec中声明并验证。
