# ADR-2026-10-21（D9）：从展示收尾转向内部组件毕业

| 字段 | 值 |
|---|---|
| 状态 | `accepted`（TF-0488 scope decision；不代表产品发布或默认值变更） |
| 日期 | 2026-10-21 |
| 任务 | `TF-0488`（父节点 `TF-0483`） |
| 分支 | `codex/component-graduation-20261021` |
| 基线 | `origin/main@350b330ae44fb9b718403cdc1debcbe8c6c42bf5`；worktree 起始 `d7fb59801ac570d1217656c71b60023128ff1d6c` |
| 关系 | `clarifies` `TF-0225` / D7；保留历史，不废止、不改写、不追溯否定当时裁决 |
| 范围 | 非 VerseGit 组件的内部产品化、默认毕业决策路径、agent-driven 自动验收 |
| 不自动授权 | public release、GA、`liveReady`、`productApproved`、产品锁或产品默认值变更 |

## 1. 背景与已核对事实

本 ADR 解决 D7 的“实习展示收尾”与当前组件毕业计划之间的范围张力。结论只重建自仓库文件、提交、diff 和测量产物，不依赖口述历史。

已直接核对的事实来源：

1. D7 决策记录在提交 `b2a4069872c8ea7930d046b5e838780a77682876`，方向文档在提交 `9355d77630acd92f96695c405dc330975063f1eb` 的 `docs/dev/qa-synthesis-roadmap-20260922.md`。D7 当时的定位是实习展示、非商业产品、非 GA、不承诺长期运营，并冻结 RC-03～RC-10、M6 与 Docker 等后续工作。
2. TF-0007 / TF-0009 已于 2026-09-30 按 owner policy 使用 agent 证据收口：`docs/dev/tf0009-policy-decision-20260930.md` 记录 `driven_by: agent`、三 profile 的 agent 运行、kill/rollback、零未授权写入与零真人计数；相关提交为 `ed5b829515ff03e07810de9381c0cfbbb65f8f6a` 和 `3cd0b09d93125a8399e533ee364e682f808dae2a`。
3. `docs/dev/component-controlled-rollout-p0-closeout.md` 与 `docs/dev/default-config-matrix.md` 仍把当前产品默认值锁定为 fail-closed / opt-in；这些是当前配置事实，不是未来默认毕业的批准。
4. `docs/dev/adr/2026-08-16-context-authority-boundaries.md`（基线提交 `985d83de1a91bb93d8c90ac0a01c44ac8da53c06`）仍是 DCS、Mem、V3、Working Context、Provider Guard 与 Receipt 的权威边界来源。其 `accepted-in-principle` 状态没有因为本 ADR 变成“已实现”或“已发布”。
5. TF-0454 的 `harness/specs/fixtures/landed-unwired-closeout/audit.json` 记录 22/22 目录条目已接线、0 pending、0 missing、0 真未接线，`driven_by: agent`、`actor: codex`。接线完成只证明生产调用点存在，不证明组件已达到默认毕业或产品批准。
6. `docs/clawx-product-semantics.md` 的 FP-P1 组件表仍是当前受控预览基线；TF-0488 不改任何组件标签或运行时默认值。

## 2. 决策

### D9-1：当前范围是内部组件毕业，不是发布

以下工作在后续节点按各自 `ready` 状态激活时属于本轮范围：

- 盘点非 VerseGit 组件并为每个组件指定唯一职权、入口、默认模式和处置；
- 对 `default`、`advanced`、`internal`、`experiment`、`retired` 做证据驱动的毕业或退役裁决；
- 构建可回读的组件毕业报告、模型有效状态和自动验收链；
- 在不建立第二套 context/memory/capability/executor authority 的前提下，收敛生产路径、回滚和用户可见表面。

“默认毕业在范围内”指默认模式可以作为有证据的候选、决策和后续实现目标；它不表示 TF-0488 已启用某个默认值，也不表示 `defaultOn` 产品锁已经翻转。任何实际默认值变更必须是后续明确激活的节点、通过对应证据矩阵和显式 Task Forest proposal 的结果。

“自动验收在范围内”指 agent 可以执行场景、生成产物、读取磁盘和给出受约束结论；它不等于 public release、GA、`liveReady` 或 `productApproved` 的自动批准。

### D9-2：证据角色和禁止事项

- 所有 agent 产物必须写 `driven_by: agent` 和具体 `actor`；不得把 agent 结果写成真人证据。
- 需要“人工”判断的步骤由可复核的 agent-driven 路径模拟；零真人计数作为事实保留，不作为节点保持 open/blocked 的理由。
- 不把测试绿灯、目录存在、接线位点或“agent 已完成”解释成产品发布批准。
- 不以 synthetic/scripted-only 证据单独支撑默认值翻转；agent-driven 的生产路径、回滚、有效状态和收益/必要性证据也不能跳过显式决策。
- 任何后续实现都必须遵守 `docs/clawx-product-semantics.md` 的现行不作为声明和 `default-config-matrix.md` 的当前值，直到匹配节点明确改变它们。

### D9-3：D7 的历史关系

D7 的原始定位与时间盒保留为历史记录。D9 只做 `clarifies`：

- D7 当时的“展示项目、不是商业产品、不是 GA、不承诺长期运营”仍用于防止发布夸大。
- D7 当时的“3 个工作日、不新增功能、不为涂绿投入”是本轮组件工作开始之前的历史执行约束，不再是否决当前内部组件毕业工作的通用理由。
- D7 冻结的 RC-03～RC-10、M6、Docker、渠道扩展范围仍不由 D9 自动重开；后续节点若需要这些范围，必须单独激活并取得授权。
- D7 的“不翻默认、不宣称 GA”、三锁和零真人计数继续作为边界；其中“必须等待真人”已由 owner policy 取代，零真人事实本身仍保留。

### D9-4：硬边界

- 全量排除 VerseGit 节点、worktree 和产品文件；本 ADR 不修改 VerseGit。
- TF-0488 不执行 TF-0489 及其后的 Context、Memory、Knowledge、Capability、Browser、VerseShell 实现。
- 不新增第二 context/memory/capability authority，不新增第四个能力目录，不绕过审批或 effect boundary。
- 不因为本 ADR 通过而修改任何产品默认值、产品锁、发布状态或 capability claim。

## 3. 现行约束替代矩阵

逐条矩阵见 `docs/dev/component-graduation-scope-matrix-20261021.md`。该矩阵是 D9 的规范性配套文件；本 ADR 与它冲突时，以更窄、更晚且证据更具体的约束为准，且不得据此扩大权限。

## 4. 验收与可回读性

- TF-0488 的 acceptance evidence 位于 `docs/dev/component-graduation/TF-0488/acceptance.json`，并附 SHA-256 清单；结论必须能从磁盘文件和历史提交重建。
- `ComponentGraduationReport/v1` 的正式 validator 属于 TF-0490，TF-0488 只提供与该方向兼容的 decision-level prefix，不声称 schema 或 validator 已实现。
- 本 ADR 的文件存在、矩阵行、默认表不变性、产品语义表不变性、聚焦测试和 Task Forest 状态均需分别回读。

## 5. 后果

- 后续节点可以在不重写 D7 的前提下推进内部组件毕业、默认能力决策和 agent-driven 自动验收。
- 后续节点不能用 D7 的时间盒或展示定位自动阻断本计划，也不能用 D9 自动换取发布、GA、产品批准或默认翻转。
- D7 作为历史仍然可追溯；新的实施和证据必须在对应节点中单独落盘。