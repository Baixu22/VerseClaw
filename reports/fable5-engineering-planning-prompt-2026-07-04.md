# Fable5 工程化规划提示词

用途：把 `report-authenticity-audit-2026-07-04.md` 和 `report-authenticity-followup-plan-2026-07-04.md` 转化为可执行的工程化规划。

注意：下面提示词刻意使用中性工程表达，避免把任务描述成缺陷排查或攻防类任务；目标是让 Fable5 输出产品化路线、模块连接方案、验证计划和交付拆分。

## 可直接复制给 Fable5 的提示词

你是 Fable5，请以资深工程规划协作者的身份，基于当前仓库做一份“能力产品化与工程落地计划”。请保持只读分析，不修改代码，不运行长耗时任务；如需定位代码，请优先使用本地 `codegraph` CLI，而不是 MCP 服务。若 `codegraph` 不可用，直接跳过并使用 `rg` 与源码阅读替代。

工作目标：

把现有两份文档中的“底层存在但未贯通”能力，整理成一份可执行工程规划，回答：哪些能力已经可由用户触达，哪些已有底座但缺连接，哪些还没有实现基础；并给出下一迭代的工程拆分、涉及模块、验收口径和交付顺序。

输入文档：

- `reports/report-authenticity-audit-2026-07-04.md`
- `reports/report-authenticity-followup-plan-2026-07-04.md`

表达约束：

- 使用“产品化差距”“权限边界”“数据流”“稳健性”“脱敏边界”“质量信号”“调用链可达性”等中性词。
- 不要把任务表述为攻防、漏洞、绕过、爆破或故障利用。
- 不要要求真实写入敏感内容；如需举例，用 `PLACEHOLDER_VALUE`。
- 不要扩大范围做重构，只输出规划、分期、模块清单、验证口径。
- 所有结论都要标注证据等级：`源码存在`、`调用链可达`、`需要运行确认`、`用户可触达`。

建议先用 CodeGraph 做定位：

```powershell
codegraph status
codegraph query OrchestrationPlanView --limit 10
codegraph query recordLongTaskCheckpoint --limit 10
codegraph query routingMemoPilot --limit 10
codegraph query reviewMemoryProposal --limit 10
codegraph query decideWorkspaceCommand --limit 10
codegraph query team_orchestrate --limit 10
codegraph query sanitizeTraceForPersistence --limit 10
codegraph query buildRolePermissionDenyList --limit 10
```

已知 CodeGraph 定位锚点：

- `src/components/agents/OrchestrationPlanView.tsx:68`：Chat 侧编排计划展示组件。
- `src/components/agents/RolesOrchestrationPanel.tsx:54`：引入 `OrchestrationPlanView`。
- `openclaw_runtime/src/agents/long-task-control/store.ts:440`：`recordLongTaskCheckpoint`。
- `openclaw_runtime/src/gateway/server-methods/chat.ts:57`：Chat server methods 引入 long-task control store。
- `openclaw_runtime/src/agents/routing-memo.ts:76`：`resolveRoutingMemoPilotMode`。
- `openclaw_runtime/src/config/types.openclaw.ts:225`：`runtime.orchestration.routingMemoPilot` 配置说明，含 `off | shadow | active`。
- `openclaw_runtime/src/memory/gatekeeper.ts:281`：`reviewMemoryProposal`。
- `openclaw_runtime/src/memory/memory-store.ts:1208`：`reviewMemoryProposalRecord`。
- `electron/services/workspace-permissions.ts:171`：`decideWorkspaceCommand`。
- `electron/services/terminal-api.ts:18`：terminal 服务引入 workspace permission。
- `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:1`：普通 team orchestration tool。
- `src/stores/chat/helpers.ts:648`：Chat message enrichment for team orchestration results。
- `electron/services/observability-redaction.ts:107`：`sanitizeTraceForPersistence`。
- `electron/services/observability-index.ts:18`：Observability index 引入 redaction。
- `openclaw_runtime/src/agents/role-permissions-policy.ts:44`：`buildRolePermissionDenyList`。

需要重点回答的工程问题：

1. Chat Plan 与 Task Ledger / Workboard 的连接方案
   - 当前 Chat plan 为什么只是只读展示？
   - Task Ledger 的 node/edge/DAG 能力与 Workboard card/dependency 能力是什么关系？
   - 如果要做最小产品化版本，应优先做“从 plan 生成 Task Ledger 节点”还是“在 plan 中编辑依赖”？
   - 需要改哪些组件、host API、类型和 i18n 文案？

2. Routing Memo 的产品化路径
   - `routingMemoPilot` 的 `off / shadow / active` 分期含义是什么？
   - `qualityOverall` 当前缺口在哪里？
   - 质量信号可从哪些现有模块接入：Task Loop evidence gate、worker outcome、用户反馈、trace scorecard？
   - 先做 shadow 观测还是直接开放 active？请给出推荐。

3. `team_orchestrate` 质量信号补齐
   - 当前 `quality: []` 与 `qualitySummary` 空数据的影响是什么？
   - 哪些 Task Loop 机制可以轻量复用，哪些不宜直接复用？
   - 最小可交付版本如何定义：例如 worker outcome summary、spawn status aggregation、route diagnostics 展示。

4. Checkpoint 与恢复边界说明
   - `ResumeCheckpoint` 保存了什么，不保存什么？
   - checkpoint 与 Task Ledger、session transcript、runtime event 的关系是什么？
   - 产品文案应该如何描述恢复能力，避免让用户误解为完整快照。

5. Context Compaction 的用户可见性
   - 当前 compaction/context pruning 的触发条件和默认阈值是什么？
   - 用户是否能看到状态、摘要或恢复提示？
   - 是否应该做一个轻量 UI：显示“上下文已整理”、摘要入口、保留项说明。

6. Memory Gatekeeper 的用户路径
   - proposal 从哪里来，如何审核，如何进入 active/cold/archive 等状态？
   - Roles panel 已有多少管理能力？
   - 下一步是补说明、补批量操作、补冲突处理，还是补注入预览？

7. Workspace Permission 与 Role Permission 的优先级
   - workspace mode 与 role tool allow/deny 如何叠加？
   - 哪些 enforcement 点在 Electron Main，哪些在 runtime role context？
   - 是否需要一张权限矩阵帮助后续开发。

输出格式：

请输出一份 Markdown 规划，结构如下：

1. 执行摘要
2. 当前能力分层表
   - 已用户可触达
   - 底层已存在但缺连接
   - 尚缺基础实现
3. 关键调用链图（可用 Mermaid）
   - Chat send
   - team orchestration
   - Memory lifecycle
   - Observability trace persistence
4. Top 5 产品化建议
   - 用户价值
   - 工程成本
   - 稳健性注意点
   - 涉及文件
   - 验收口径
5. 分阶段计划
   - Phase 1：只读可见性与说明
   - Phase 2：轻量连接和持久化
   - Phase 3：反馈信号闭环
6. 待确认问题
7. 建议先读的源码清单

请保持结论谨慎：如果只是看到源码存在，就写“源码存在”；如果能找到调用者，写“调用链可达”；如果需要真实运行才能确认，就写“需要运行确认”。不要把静态代码存在写成已经产品化。

