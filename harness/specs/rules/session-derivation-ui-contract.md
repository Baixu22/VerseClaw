---
id: session-derivation-ui-contract
title: Session derivation UI contract
type: rule
appliesTo:
  - session-derivation-ui
pathPatterns:
  - src/components/layout/SessionFolderTree.tsx
  - src/components/layout/session-buckets.ts
  - src/components/layout/Sidebar.tsx
  - src/pages/Chat/**
  - src/stores/chat/**
  - shared/chat/**
  - shared/types/session-derivation.ts
  - shared/i18n/locales/**/chat.json
  - src/styles/codex-sidebar.css
  - src/components/file-preview/WorkspaceAgentsPanel.tsx
requiredTests:
  - tests/unit/session-workstreams.test.ts
  - tests/unit/session-folder-tree.test.tsx
  - tests/unit/session-derivation-lineage.test.ts
  - tests/e2e/session-derivation-ui.spec.ts
---

# 会话派生 UI 契约

## 自治项目入口与强任务范围（2026-11-02）

- 项目行的名称是项目负责人导航，disclosure独立展开；会话标题继续切换会话。新项目页和复用面板显式接收project/workspace/coordinator/session scope，不借用全局default main或currentSession作为任意项目负责人。
- 每个会话展示真实任务容器。discussion可空，任务尚未形成与上游不可用/陈旧必须区分；副作用前自动建任务和准入由owner完成，Renderer不补写事实。
- 任务列表来自TaskLedger或带authority的外部任务投影；sessionLinks只关联任务，不推导谱系。一般手工done、turn-check done、run结束与业务任务已验收不能混淆。
- Fork只携带允许的上下文/任务引用，不复制写claim、资源lease或授权；Handoff在既有generation与持久操作合同内交接。
- 已有明确授权覆盖的结构化自治动作不重复要求用户逐步确认；交互式Fork/Handoff的可审查创建意图保持。普通模型文本不能触发隐藏操作。
- 暂停派发、停止run、取消task、归档session和资源回收分别显示实际owner效果；未知/未实现能力不可显示成功或伪造可用控制。
- U2项目入口依赖自治A4强任务绑定，U1读模型依赖A1合同；这六节点不承担自动规划、全局调度或通用资源系统的实现。

## 唯一关系事实

- 会话来源只从现有 session store 字段和只读 `SessionDerivation` 投影读取，包括 `parentSessionKey`、`spawnedBy`、fork 来源字段及逐跳状态。
- Renderer 可建立用于渲染的索引，但不得增加 lineage store、关系表、第二个 writer，也不得用 Task Ledger 的 `sessionLinks` 推断会话父子关系。
- 共享分类按有效 fork 事实、`spawnedBy`、仅有 `parentSessionKey` 的顺序区分 Fork/Spawn/Handoff；worker 同时有 parent/spawnedBy 不得误标 Handoff。矛盾字段保留诊断，修正共享 classifier 和相关 stage 消费者，禁止页面私有修补。
- Handoff 由既有 runtime owner 写入 parent，确认 child 持久来源后才激活/发送。Task Ledger 继续负责任务/深度记录；旧 Ledger-only 来源显示未接齐，不直接写成 root，不增加 UI 旁路树或隐式批量迁移。
- `parent-missing`、`cycle` 和 `bound-exceeded` 必须如实显示为来源缺失、循环或已截断；不得把异常链伪装成根会话。
- 运行状态继续来自现有 session activity/status 投影。父会话的聚合计数不得覆盖父会话自己的状态。

## 派生语义

- **Fork**：从完整 transcript 或指定消息建立独立分支；消息级边界使用现有 `fromLeafId` 能力。
- **Handoff**：准备可编辑的交接包，确认按钮明确写出“创建并发送”，沿用 `ad77bf57c` 后的首轮发送行为。不得把自动发送藏在“创建会话”标签下；发送失败须保留新会话、来源和可重试草稿，效果未知时先核实结果，不能盲目重发。
- 创建与首发由现有持久层保存稳定操作标识、源 key/generation、草稿一致性、child key、首发 idempotency key 和 pending/sent/failed/unknown 阶段。重复点击、创建响应丢失、切换/重启恢复均先对账并复用同一 child；同一发送重试复用 key。更改 payload 必须形成新的明确意图；没有可证明的跨重启发送结果则保持 unknown，不能宣称 exactly-once。
- **Spawn**：显示为父会话委派的 worker/subagent，保留角色和活动状态；打开 worker transcript 的入口与普通 Chat 子会话有明确区别。
- **从消息带问题开新会话**：仍然是 Fork，不新增第五种持久关系。用户消息的分叉点取最近 assistant 祖先，界面明确提示“使用此提问之前的上下文”；原问题可预填供修改。无有效 ancestor 时拒绝，不退化到 transcript tip。新问题在新会话 composer 中作为未发送草稿出现。

## 结构与导航

- 项目视图保留项目和单层工作线，按需展开会话家族；全局时间视图保持活动时间排序的平铺列表，只提供来源入口。`sessionFolderAssignments` 不因血缘变化而改写。
- 同一实际分组内父会话下可展开多个后代，最多一层额外缩进；A→B→C 可压在同一可见祖先下，但每行 tooltip/关系详情保留真实直接父级，不把 A 声称为 C 的直接父级。跨项目/工作线父项不移动、不复制；提供可点击来源和完整关系详情。
- 父行提供独立、可键盘访问的展开控制和子项数量；点击会话标题仍只负责切换会话。展开/收起不能增加第三个 hover action，行级管理继续使用 Pin 与现有 `⋯` 菜单。
- 选中子会话时展开其可见祖先；来源 breadcrumb 和衍生会话列表可互相导航。切换后保留各自草稿和可恢复的滚动位置，不抢焦点。
- 子项的失败、等待、运行、完成状态留在对应子项。父行只显示来自真实状态投影的汇总，不因子项失败变成失败态；失败项保留并可打开。
- 侧栏沿用现有活动排序并冻结当前 hover/焦点行位置，不按状态变化持续重排；等待和失败可提高状态提示优先级，但不得自动展开并挤走焦点。多后代按需读取；不得为每个侧栏行轮询完整 activitySnapshot。
- Spawn 只有已有可访问持久 child key 时提供会话导航；临时 run/已 cleanup worker 留在活动入口，不伪造会话。`accepted-not-completed` 只显示“已接收”；结果回传和父会话续接分别依实际 receipt/wake 事实展示。

## 视觉、可访问性与语言

- 复用 `globals.css`、`codex-sidebar.css` 与现有会话行、状态 orb、activity 组件。侧栏会话行维持现有 30px 高度、标题截断/tooltip、选中和 hover 规范。
- 使用 `bg-surface-modal`、`bg-surface-input` 与 `bg-black/5 dark:bg-white/10` 等现有 token；关系类型使用中性色，状态颜色只表达运行状态。不复制 Codex 或 Claude 的品牌视觉。
- 新增文本完整覆盖 `en`、`zh`、`ja`、`ru`；展开按钮、来源链接、子会话状态和菜单支持键盘与屏幕阅读器，动效遵循 reduced-motion。
- 家族展开按钮与标题剪裁区保持分离；三位数后代计数完整显示，悬停滚动标题不覆盖计数。
- 后台衍生、等待、失败和完成不得自动切换或删除当前会话。只有当前用户确认创建的 Fork/Handoff 可以切换；Handoff 的显式“创建并发送”与 Fork 的“创建并预填”必须可辨。
- 文本声称“已创建会话”不是创建事实。模型建议在新会话继续时使用已有确认/预览入口；没有结构化请求能力时仅提供可操作建议，不解析普通回复文字来偷偷执行。

## 生命周期控制与交付

- SessionKey、sessionId/generation、run、transcript leaf 分开呈现：compact/restore/reset 是同一逻辑会话的事件，不能伪造成子会话。
- Stop、协调器暂停/继续、archive/restore、delete、checkpoint restore、compact 使用已存在的各自 host route 和 owner 屏障。不可用能力明确禁用及说明，不新增模型专用工具的 UI 等价写通道。
- Stop 不等于 Delete；归档可撤销，永久删除沿用确认。只操作目标会话；父项归档/删除不暗中级联子项，幸存子项保留并提示来源不可用。
- 跨会话传递展示源/目标、发送或接收回执、等待/拒绝/未知/已报告；`accepted`、工具完成、任务接纳、父会话恢复分别取自己的权威记录。只读状态不得授予跨 workspace/session 控制权。
- 切换过程中到达的旧请求结果不覆盖当前会话；源/目标 generation 不匹配时显示过期并拒绝写入。控制的失败、未知结果、重试与取消均须有可恢复路径。

## 验收

- 单元测试覆盖多子项、多代链、Fork/Handoff/Spawn 分类、缺失父项、循环、截断及状态独立性。
- 双父字段 worker 分类、Handoff 的 runtime 来源写入与部分失败、创建响应丢失、首发超时及进程重启后的 unknown 恢复必须有回归；只测组件 busy 按钮不构成幂等验收。
- Electron E2E 覆盖展开/收起、来源与后代导航、草稿保持、消息级带问题 Fork、Spawn transcript 入口、等待/失败/完成和活动会话禁用规则。
- Agent 驱动截图覆盖 Light/Dark、窄窗口、折叠侧栏与 reduced-motion；证据标注 `driven_by: agent`，不声称真人验收。
- Renderer 只调用现有 Host API。若现有契约不能提供必需事实，先更新任务范围和通信验收，不绕过 Host API、不从 Gateway 直连。
