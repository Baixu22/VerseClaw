# TF-0451 刻意不吸收项清单（闭源参照）

- 日期：2026-10-19
- 基线：`origin/main = 765a47cb1a24e56e42e139cb0b1314b3b64ba9e1`
- driven_by: agent
- actor: codex
- 上游节点：TF-0446（三态归属裁定）

本清单固化 2026-10-19 闭源设计参照调研中「不要借」的项，避免后续会话重复讨论。本清单**不**是功能缺口清单，也不改变任何已收口节点的结论。

## 锚定边界

所有不吸收项都锚定同一条产品边界：

- 本地 Electron 桌面壳 + 本地 Node gateway runtime（`docs/architecture-overview.md`）
- Windows x64 受控预览为第一产品验收目标（`docs/clawx-product-semantics.md`）

## 清单

| # | 闭源参照 | 不吸收什么 | 为什么不成立 | 锚定边界 |
| --- | --- | --- | --- | --- |
| 1 | Cursor Cloud Agents | 远端 VM 执行与托管环境生命周期 | Verse Claw 是本地工作台，非托管云服务。引入远端 VM 会把产品形态从本地 Electron 改为云托管，属**产品范围变更**，超出「吸收设计」的边界 | `docs/clawx-product-semantics.md` Windows x64 Controlled Preview；TF-0379 已冻结「不引入完整 OS 沙箱」 |
| 2 | Manus | 云 VM 沙盒作为每次 agent 运行的执行环境 | 同上。Manus 的 VM 是其产品形态的一部分，不是可单独移植的设计技巧 | TF-0393 已记录不复制云 VM 生命周期 |
| 3 | Manus / Codex Cloud | 实时多人 Collab | 本产品无多人在同一工作区协同的定位；协作语义会与 Task Ledger 的用户可见事实权威冲突 | `docs/clawx-product-semantics.md` Positioning：agent workbench 而非协同平台 |
| 4 | Manus | Website Builder | 垂直场景功能，与 agent workbench 定位无关 | TF-0393 已记录 |
| 5 | Codex Cloud | 托管 attempt（云端运行 PR） | 本产品的 attempt/apply 走本地 Git 与既有审批权威；TF-0387 已以 diff-first attempt 吸收其最小形式 | TF-0387；`docs/clawx-product-semantics.md` 单向 apply 权威 |
| 6 | NotebookLM | claim 级溯源改造 Knowledge 审阅语义 | 会改动 TF-0387 已冻结的 sources/drafts/proposals 三段结构，风险高于本轮收益 | TF-0387 |
| 7 | Glean / Readwise | 捕获摩擦与知识管线产品决策 | 属产品决策而非设计吸收，不在 agent 的设计吸收范围内 | — |
| 8 | Claude Code | 权限模型整体替换 | 已有 `PermissionDecisionEvent` 与 §Unsafe Claims 纪律，等同或更强 | TF-0379 / TF-0380 |

## 与既有结论的一致性

- 第 1、2、4、5 项与 **TF-0393**（「非目标：完整 OS 沙箱、云 VM、实时 Collab、Website Builder 与 Cloud attempts 复制」，`done`）一致，未新增互相矛盾的不吸收声明。
- 第 1 项与 **TF-0379**（重整执行环境与安全姿态，明确不引入完整 OS 沙箱，`done`）一致。
- 第 8 项与 **TF-0446** 的「已覆盖」裁定一致。

## 已吸收的最小形式（避免「全盘不做」的误读）

不吸收云 VM，不等于不吸收其设计立场。已通过既有节点以最小形式吸收：

| 闭源立场 | 本仓库的最小吸收形式 | 来源节点 |
| --- | --- | --- |
| 隔离作为环境属性（Cursor） | `ExecutionEnvironment` 分层：backend / guarantee / network / approval | TF-0380 / TF-0382 |
| 只读聚合与 diff-first apply（Codex Cloud） | `CodingRun` 只读聚合 + immutable diff-first attempt/apply | TF-0375 / TF-0387 |

## 诚实边界

- 本清单只登记不吸收项与其理由，**不构成任何实现或验收完成**。
- 举证来自 `origin/main` 的 Task Forest 记录与语义文档回读，不是命令打印输出。
- 若所有者未来决定把产品扩展到托管云形态，本清单需整体重审——但那是**产品决策**，不在 agent 的设计吸收范围内。
