# 架构骨架收敛宪章（Architecture Skeleton Convergence）

> 状态：`proposal`（规划件，不授权实现）
> 录入日期：2026-10-31，Asia/Shanghai
> 父目标：`TF-0001`（记忆-上下文-工具-经验联合系统受控可运营，非全量 GA）
> 关联研究：`harness/specs/guides/ontology-agent-systems-research.md`
> 任务真源：`.agent-workbench/task-forest/`（本地，不入 Git）

本文件回答一个问题：**在不破坏现有功能结构的前提下，如何把「散」的骨架收成一套可校验的统一底座。**

它是规划与边界文件，不授权实现，不改变产品锁、默认值、发布状态、真人证据口径或 Task Forest 状态。所有落地动作必须在 Task Forest 上有一个 ready 叶子节点和一份 Harness task spec。

---

## 1. 问题陈述（以源码为证）

「过于散了」不是主观感受，它在当前源码里有五个可复现的形态。

### 1.1 两条并行的接入层

| 通道 | 位置 | 当前规模（本检出实测） |
|---|---|---|
| A. 类型化 Host API | `shared/host-api/contract.ts` + `src/lib/host-api.ts` + `HostApiRegistry` | 58 个模块；`contract.ts` 6207 行；`host-api.ts` 1812 行 |
| B. 扁平 IPC 直连 | `electron/main/ipc-handlers.ts` 的 `ipcMain.handle('x:y', ...)` | 43 个 channel |

证据：`electron/main/ipc-handlers.ts` 中 `ipcMain.handle` 出现 43 次；`hostApiRegistry.registerCoreServices({...})` 位于第 226 行。

关键事实：这 43 个扁平 channel 使用 10 个前缀，其中 **8 个前缀（`app` / `dialog` / `gateway` / `openclaw` / `settings` / `shell` / `usage` / `window`）同时也是类型化模块名**。同一领域因此同时存在两套地址空间。

后果：
- 渲染进程当前没有直接 `ipcRenderer.invoke`（实测 0 处），但扁平通道经 preload 暴露，构成事实上的第二接入面；
- `pnpm contract:check` 只覆盖 A 通道（`parseContractActions` → `parseFacadeActions` → `parseRegisteredModules`），**不覆盖 B 通道**，B 通道的语义漂移不会被门禁发现；
- 新增能力时「该走哪条路」没有单一裁定点，只能靠记忆。

### 1.2 语义声明分散在 9 个顶层文件

`shared/` 顶层已有 9 个带「主张 / 边界 / 证据」结构的注册表：

```
capability-claims.ts                 45 条能力主张
reliability-boundaries.ts              7 个子系统可靠性边界
sensitive-content-boundary.ts          7 个敏感面
permission-effect-contract.ts          权限效果最终检查点
product-semantics.ts                   7 概念 / 6 关系 / 41 个语义字段
task-ledger-working-context.ts         任务工作上下文
knowledge-lifecycle.ts                 知识生命周期
long-session-continuity.ts             长会话连续性
long-session-paired-evaluation.ts      配对评估
```

另有 `shared/dcs/component-disposition-catalog.ts`（54 项处置）与 `shared/component-authority-manifest.ts`（35 个权威组件，`ComponentAuthorityManifest/v1`）。

这些表各自有测试，但**彼此之间没有统一的身份、版本与证据绑定约定**。同一组件在「权威矩阵」「处置矩阵」「能力主张」「默认矩阵」各出现一次，靠人类一致性维持，而不靠机械校验。

### 1.3 语义合同的强度不一致

`TF-0622` 已落地的产品语义关系合同（`PRODUCT_SEMANTIC_RELATIONS`，6 条有向边）在当前 main 检出中只有常量与一条正向断言：

- `docs/clawx-product-semantics.md` 声明「不是通用企业本体 / 图数据库 / 推理引擎 / 运行时路径 / prompt 注入」；
- `tests/unit/product-semantics.test.ts` 断言端点合法、无重复、无自环、有证据、无反向 Task Ledger 权威；
- 但当前检出中**没有**合同版本常量、没有可拒绝错误输入的校验器入口、没有 `relationKey` 派生键、没有来源摘要与候选绑定。

证据：对当前检出做静态探测，`CONTRACT_VERSION` / `validateProductSemanticRelation` / `relationKey` 三项均为 `false`；`shared/product-semantics.ts` 为 HEAD blob 684 行。

`harness/specs/tasks/ontology-lite-existing-contracts-hardening.md` 已把「版本 + 摘要 + 来源失效 + 原生门禁」写成四步实施合同，但该文件同时明确写着新增校验尚未实现，未运行项须记 `not-run`。

> 分支 `codex/ontology-contracts` 上存在一份更完整的实现（907 行，含 `CONTRACT_VERSION` 与校验器）。该分支**未合入 main**。本宪章以当前 main 检出为准，不把分支产物当作已落地事实。

### 1.4 证据检查器只到「路径存在」一层

`scripts/check-evidence-refs.mjs`（89 行）扫描 5 个语义文件中的仓库路径字符串，断言文件存在。

它**不检查**：路径归属、是否被 Git 跟踪、是否对应当前候选、是否真的支持那条主张。也没有版本、摘要、candidate commit/tree、actor、退出码。「证据路径存在」与「证据支持声明」之间因此存在无门禁的落差。

### 1.5 治理体量本身已是骨架风险

| 面 | 数量 |
|---|---|
| `electron/services/*.ts` | 120 |
| `harness/specs/tasks/**/*.md` | 681 |
| `harness/specs/rules/**/*.md` | 110 |
| `harness/specs/scenarios/*.md` | 17 |
| `harness/specs/guides/*.md` | 21 |
| `shared/` 顶层语义文件 | 9 |

约束的表达能力已经很强，但**表达面正在超过消费面**。骨架级健康的判据不是「还能写多少规范」，而是「每条规范都有唯一 owner、唯一消费点、可机械验证的失效条件」。

---

## 2. 目标与非目标

### 2.1 目标

1. **单一接入裁定点**：任何 renderer→Main 能力只有一个被门禁覆盖的入口，且入口类型可机械枚举。
2. **单一语义权威**：同一件事（owner / 默认态 / 可信边界）只有一份可读、可校验、可失效的声明。
3. **可拒绝的语义**：错误组合、陈旧来源、越界引用必须被确定性检查拒绝，而不是靠人工复核。
4. **零行为破坏**：以上全部以「只读投影 + 静态校验」实现，不改变运行时路径、默认值、权限与 UI 行为。
5. **可收口**：每个节点有唯一验收口径，证据从磁盘回读，完成后按仓库既有 override 自动收口。

### 2.2 非目标（硬边界）

- 不新增 RDF/OWL/SHACL/PROV 运行时、图数据库、知识图谱存储、推理、遍历或查询服务；
- 不新增第二套任务、权限、上下文、记忆或知识真源；
- 不新增产品页、Host API 模块、UI、subject adapter、suite runner、评分模块或 ID 服务；
- 不改变产品锁（`live_ready` / `product_approved` / `default_on`）、默认矩阵、发布状态或 GA 口径；
- 不以「骨架规整」为名放宽任何现有门禁，也不把静态校验通过当作运行时效果证据；
- 不引入任何以「真人操作 / 真人数据 / 真人 verdict」为前置的验收条件。

---

## 3. 骨架五层模型

把「底座完备」拆成五个可分别验收的层。每层只消费下层既有事实，不新建真源。

```
L5  证据与失效    evidence binding / version / digest / stale invalidation
L4  接入层        single admission surface + mechanical enumeration
L3  语义权威      owner / default / authority / forbidden claim 的单一声明
L2  身份与边界    concept / identity / scope / reference direction
L1  既有运行时    现有 Runtime / Host API / services，行为不变（只读消费）
```

收敛方向自下而上：先固定 L1 身份（零行为改动），再让 L3 语义指向这些身份，再让 L2/L4 机械校验，最后用 L5 绑定来源与失效。**上层不得反向改写下层 owner。**

---

## 4. 与 Palantir「本体论」的关系（明确取舍）

研究结论见 `harness/specs/guides/ontology-agent-systems-research.md`：

- **接受**：显式语义、稳定身份、受治理的动作与权威边界，是真实的架构纪律；
- **拒绝**：「本体论优先」是企业产品不被采用的原因——缺乏受控对照，无法识别因果；
- **不建**：RDF/OWL 运行时、企业知识图谱、自动推理、prompt 注入、第二权威存储。

Palantir 真正值得借鉴的是「对象—关系—动作—权限—血缘」的**运营化整合**，而非「本体」这个词。ClawX 的等价物不是企业对象本体，而是**工作对象本体**：Task / Run / Session / Workspace 身份 + 工具与效果 + 权限检查点 + 证据血缘。

因此路线是 **federated ontology-lite**：每个 domain 保留自己的 owner，只把关系、权威边界与证据显式化。

**不要**把 Palantir 的集中式 ontology 搬进来——那会直接制造第二真源，破坏第 1 节想修的东西。

任务图映射（Task Forest，本地，不入 Git）：

| 批次 | 节点 | 状态 |
|---|---|---|
| 根 | TF-0628 架构骨架收敛 | proposed |
| A | TF-0629 接入层盘点与唯一入口裁定；TF-0630 contract:check 覆盖扁平 IPC | ready / proposed |
| B | TF-0631 语义权威矩阵逐条对齐；TF-0632 唯一 owner 校验 | proposed |
| C | TF-0633 语义合同硬化接入骨架 | proposed |
| D | 未登记（消费需求未证实） | - |

> 状态更新（2026-10-31 收口决策轮）：A 批 TF-0629 / TF-0630 已 done；B 批 TF-0631 done、TF-0632 ready；C 批 TF-0633 拆为 TF-0634…TF-0637 四个串行子叶（均 proposed，C1 依赖 TF-0632）；D 批仍未登记。表中原始状态保留为规划时读数。决策、最小形状与收口口径见 `docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md`。

---

## 5. 四个批次

每批是一次独立、可单独验收的收敛；批内节点串行，批间按依赖推进。

### 批次 A：接入层单一化裁定（L4）

- **A0 裁定**：枚举当前所有 renderer↔Main 接入通道（类型化 Host API / 扁平 IPC / extension contributions），为每个指定唯一入口、owner 与迁移位点；无法判定的记 gap。
- **A1 覆盖**：让 `pnpm contract:check` 对 B 通道（扁平 IPC）也 fail-closed；复用现有入口，不新增 package script。
- **A2 兼容回归**：证明收敛后既有消费者行为不变，无新增权限路径与默认值变化。

**验收口径**：接入通道可从磁盘枚举；未分类通道为 0；坏例（未登记通道 / 双入口同域 / 绕过 registry）被门禁拒绝。

### 批次 B：语义权威单一化（L3）

- **B0 映射**：把 `component-authority-manifest` / `component-disposition-catalog` / `capability-claims` / `reliability-boundaries` / `sensitive-content-boundary` / `product-semantics` 的同一组件逐条对齐，输出「一处声明、多处引用」的映射与冲突清单。
- **B1 唯一 owner 校验**：同一组件出现冲突 owner / 冲突 default / 冲突 authority 时 fail-closed；允许显式豁免并记录理由。

**验收口径**：每个组件在权威矩阵中有唯一 owner；冲突为 0 或已显式豁免；现有语义文件的消费点未变。

### 批次 C：语义合同硬化（L2 + L5）

继承并完成 `harness/specs/tasks/ontology-lite-existing-contracts-hardening.md` 的四步，把它挂到本宪章下作为骨架的一层，而不是孤立的语义练习：

1. 六条关系逐条映射来源 / 实际 owner / 已有消费者 / 回归入口，无法证实的记 `documented-only` 或 gap；
2. 增加可拒绝错误输入的确定性校验器（未知端点、重复、自环、缺证据、错误 kind/authority 组合、反向任务权威），负例走同一入口；
3. 绑定合同版本、来源摘要、candidate commit/tree、actor、命令与退出码；陈旧来源使报告失效；
4. 接入现有 Harness / Vitest / evidence 门禁，证明坏例不能产生有效 pass。

**验收口径**：正例仍通过；每类负例在预期规则上被拒绝并给出可定位诊断；来源变化使旧报告失效；无新增运行时路径。

### 批次 D：证据链可读化（只读产品面，可选）

C 完成后，若且仅有确认了消费需求，再做一个**只读派生视图**：

- 从现有 Task Ledger / session / coding-run JSONL / trace / evidence 派生 `task → run → tool call → artifact → evidence → review` 时间线；
- 每个节点标注 owner / authority / source；缺失数据显示 `unknown`，不猜测；
- 不新增存储、不改变权限、不自动执行动作。

**验收口径**：证据链覆盖率可测；false completion 为 0；无新增 authority path。

D 不是骨架完备的必要条件；若 B/C 已完成而消费需求未被证实，D 保持 `proposed` 不启动。

---

## 6. 硬边界（所有批次共同适用）

1. **只读优先**：优先用静态校验与只读投影达成目标，而不是新增运行时组件。
2. **不移动 owner**：收敛是让 owner 更清晰，不是把 owner 搬到新中心。
3. **可回滚**：每批都能单独撤回，不影响其他批的既有行为。
4. **证据分层**：静态校验通过 ≠ 运行时效果证据 ≠ 真人证据，三者不得互相冒充。
5. **门禁即消费点**：新增约束必须接入既有门禁，否则视为未完成。
6. **失败可复现**：任何「拒绝」都必须在离线、无密钥环境复现。
7. **不越权**：不触碰第 2.2 节任何一项。

---

## 7. 落地顺序

```text
A0 -> A1 -> A2 --> B0 -> B1 -> C1 -> C2 -> C3 -> C4 --> (D?, 可选)

A1 依赖 A0 的裁定；B1 依赖 B0 的映射；
C 批四步串行，每次只推进一个 ready 叶子。
```

A 与 B 并行前提：写入集不重叠（A 触 contract-check 与 ipc-handlers，B 触语义注册表）。出现写入冲突时按 A 先 B 后串行。

---

## 8. 成功判据（骨架级）

| 判据 | 目标值 | 度量方式 |
|---|---|---|
| 未分类接入通道 | 0 | 枚举脚本离线可复现输出 |
| 同一组件冲突 owner | 0 或已显式豁免 | 唯一 owner 校验器 |
| 语义合同坏例拒绝率 | 100% 在预期规则上拒绝 | 负例 fixture + 既有门禁 |
| 陈旧来源被当作当前通过 | 0 | 来源摘要 + 候选绑定 |
| 新增运行时组件 / 第二真源 | 0 | 变更集审查 |
| 现有产品行为变化 | 0 | 兼容回归 |

**明确不在判据内**：业务收益、采用率、任务成功率、性能提升、GA 就绪、发布批准。这些需要各自独立的受控实验，不能由骨架绿灯外推。

---

## 9. 当前状态与已知风险

- 本宪章为 `proposal`，不授权任何实现；
- 第 1 节数字取自当前检出的静态读取，不是运行时观测；
- 批次 C 前置研究已完成，实施未开始；未运行项不得当作已通过；
- 批次 D 尚未证实消费需求，保持未启动；
- 本轮会话期间工作区曾被其他进程改动（HEAD 从 `b2a98f265` 迁到 `1bae32407`，并出现一次大面积瞬时脏化后恢复）。后续实现必须**重新基线**，不得沿用本轮读数作为验收候选。