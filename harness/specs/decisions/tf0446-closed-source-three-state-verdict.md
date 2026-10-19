# TF-0446 决策：闭源参照的三态归属裁定

- 日期：2026-10-19
- 基线：`origin/main = 765a47cb1a24e56e42e139cb0b1314b3b64ba9e1`（本工作树 `codex/closed-source-absorption-20261019`）
- driven_by: agent
- actor: codex
- 上一节点：TF-0445（闭源设计参照吸收根节点）
- 位置：本文件为 tracked 规格（`docs/**` 按 repository-artifact-retention 为 repo-local，故置于 `harness/specs/decisions/`）

## 裁定原则

本节点只做归属裁定，不写实现。每条闭源参照必须落人三态之一：

| 态 | 含义 | 举证要求 |
| --- | --- | --- |
| **吸收** | 仓库内确实缺少该约束，需要新增 | 指向本文件 `剩余缺口` 段的行号级证据 |
| **已覆盖** | 既有收口已实现该约束，不重复做 | 指向 `origin/main` 的具体文件与行号 |
| **刻意不做** | 在本地 Electron + 本地 gateway 边界下不成立 | 锚定产品边界文件 |

裁定基线一律用 `origin/main`，**不用** `D:\ClawX` 的 `HEAD = 8fe67fc2`——后者落后 origin/main 126 提交，本地 grep 会对已落地的能力产生假阴性。

## 逐条裁定

### 1. Manus — KV-cache 命中率作为头条指标 → **吸收**

已有（部分）：
- `openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-observability.ts`：追踪器已存在，且 `isPromptCacheObservabilityEnabled()` 默认 true（`docs/dev/prompt-cache-observability-20261012.md`）。
- `PromptCacheSnapshot` 记录 10 个决定复用前缀的输入；`PromptCacheBreak` 记录 `previousCacheRead / cacheRead / changes`，即归因。

缺口（已核对类型定义）：
- `PromptCacheSnapshot` 的 10 个字段**全部是配置标识**，没有任何累计计数或比率字段。
- `PromptCacheBreak` 是**单次事件**（一次 break 的前后值），不是聚合指标；模块内不存在 hit-rate 累加器。
- 消费侧只有 `run/attempt.ts:3119` 开启追踪，以及 `attempt.context-engine-helpers.ts:9` 消费 `PromptCacheChange` 做归因。**没有任何调度或 UI 消费者**。

因此「追踪」已覆盖，「指标化」未覆盖 → 归为**吸收**，落在 TF-0447。

### 2. LangChain Deep Agents — subagent 只返回有界报告 → **吸收**

已有（部分）：
- `shared/subagent-lifecycle.ts` 只有 `SubagentLifecycleIdentity`（taskNodeId / roleInstanceId / childRunId / roleName / task）——这是**事件合并键**，不是返回契约。
- `shared/subagent-identity.ts` 只有 `SubagentIdentity`。

缺口：仓库内不存在「子代理返回给主代理的报告」的类型定义，既无报告正文也无大小上限；隔离边界（子代理烧了多少 vs 返回多少）不可测量。→ **吸收**，落在 TF-0448。

### 3. Linear — TaskLedgerReference 继承表 → **吸收**

已有（部分）：
- `shared/types/task-ledger-reference.ts` 定义 `TaskLedgerReference = { direction, taskLedgerNodeId, workboardCardId?, source }`，并有 `createTaskLedgerReference` 与严格校验 `isTaskLedgerReference`（`allowedKeys` 只允许 4 个键）。
- TF-0371 已冻结单向权威语义。

缺口：该类型**没有任何继承语义**——4 个字段里没有 priority / project / cycle / labels，因此「什么跨这条链接传递」在类型层完全未定义。`git grep inherit` 对 `shared/product-semantics.ts` 零命中。→ **吸收**，落在 TF-0449。

### 4. VS Code / JetBrains — 会话级上下文压力 → **吸收（部分已覆盖）**

已有（部分）：
- `src/pages/Chat/ChatInput.tsx` 已有 `contextRange`（:140）与 `compactionStatus`（:164）两个入参，并渲染压缩状态与单轮 token 用量。

缺口：`git grep` 对 `sessionTokens|totalSessionTokens|cumulativeTokens` 在 `src/pages/Chat/*.tsx` 零命中——**只有单轮/压缩视图，没有整会话累计视图**。VS Code 的会话级累计上下文窗口用量在本仓库不存在。→ **吸收**，落在 TF-0450。

### 5. Cursor Cloud Agents — 隔离作为默认环境 → **刻意不做**

`TF-0379`（重整执行环境与安全姿态）已明确：**不引入完整 OS 沙箱**，默认安全姿态为 policy + approval。TF-0393 已明确不复制云 VM 生命周期。

本轮裁定维持该边界：Verse Claw 是本地 Electron + 本地 gateway（`docs/architecture-overview.md`），产品边界是 Windows x64 受控预览（`docs/clawx-product-semantics.md`）。引入远端 VM 会把产品从本地工作台变成托管云服务，属于**产品范围变更**，超出「吸收设计」的边界。

保留可吸收的最小形式：`TF-0380` 已冻结的 `ExecutionEnvironment` 分层（backend / guarantee / network / approval）已足够承载 Cursor 的设计立场。

### 6. Claude Code — 具名逃逸口 → **已覆盖**

`docs/clawx-product-semantics.md` 的 `PermissionDecisionEvent`（mode / role / tool / boundary / decision / reason / requestId）与 §Unsafe Claims 已提供同等或更强的显式边界与防夸大纪律。TF-0379 / TF-0380 已在 Settings 展示 backend/guarantee/network/approval 与降级原因。无需重复。

### 7. NotebookLM / Glean — claim 级溯源与廉价捕获 → **刻意不做（本轮）**

claim 级溯源需要改变已收口的 Knowledge 审阅语义（sources/drafts/proposals 三段已由 TF-0387 冻结），风险高于本轮收益。捕获摩擦问题同理属产品决策而非设计吸收。本轮记为不做，并在 TF-0451 具名登记，不静默丢弃。

### 8. 通用方法论 — 「发布数字或硬规则」→ **吸收（落到 TF-0452）**

本轮全部裁定项都不新增产品面，只新增约束与可读性。该方法论本身作为 TF-0452 验收口径的一部分。

## 剩余缺口（吸收项汇总）

| 节点 | 缺口 | 行号级依据 |
| --- | --- | --- |
| TF-0447 | 命中率无累加器、无聚合指标、无消费侧 | `prompt-cache-observability.ts:21-43`（Snapshot 无计数字段）、`:40-44`（Break 为单次事件） |
| TF-0448 | 无 subagent 返回报告类型与大小上限 | `shared/subagent-lifecycle.ts:1-7`（仅身份键） |
| TF-0449 | TaskLedgerReference 无继承语义 | `shared/types/task-ledger-reference.ts:1-6`（4 字段无 priority/project/cycle/labels） |
| TF-0450 | 无会话级累计上下文视图 | `src/pages/Chat/ChatInput.tsx:140,164`（仅单轮/压缩入参） |

## 本节点的诚实边界

- 本节点只做归属裁定，**不构成任何实现或验收完成**。
- 「已覆盖」的举证来自 `origin/main = 765a47cb` 的源码回读，不是来自任何命令打印输出。
- 本节点不锁定任何 default-on 值，不改产品锁，不构成 GA / release 声明。
- 未验证边界：本次未运行 typecheck / test / build；裁定只涉及类型与字段存在性，不涉及运行时行为。
