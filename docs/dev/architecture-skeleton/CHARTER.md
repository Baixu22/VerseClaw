# 架构骨架收敛宪章（Architecture Skeleton Convergence）

> 状态：`done`（五叶整改及限定架构复验已完成；保留LOC与Agent Dev证据时效残差，非全仓通过、非GA。原候选及范围见 §9）
> 录入日期：2026-10-31，Asia/Shanghai
> 根目标：`TF-0628`；关联战略：`TF-0001`（记忆-上下文-工具-经验联合系统受控可运营，非全量 GA）
> 关联研究：`harness/specs/guides/ontology-agent-systems-research.md`
> 任务真源：`.agent-workbench/task-forest/`（本地，不入 Git）

本文件回答一个问题：**在不破坏现有功能结构的前提下，如何把「散」的骨架收成一套可校验的统一底座。**

它是当前架构边界与进展入口。实现依据所有者授权及已应用的 Task Forest 叶子；每次只推进一个 ready 叶子并先读取其 Harness task spec。产品锁、默认值和发布状态仍受原边界约束，所有验收均标为 agent 驱动。第 1 节保留 2026-10-31 的问题快照，当前结果与残差以 §9 为准。

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
   **2026-11-01 修订（所有者授权）**：批次 A 的实际收敛——A3 迁移活体消费者、A4 改写 E2E mock 缝、A5 退役扁平通道——允许改动 `electron/main/ipc-handlers.ts` 与 `electron/preload/index.ts` 的运行时路径，但仅限删除 `ADMISSION-INVENTORY.md` §6 已裁定为 retire 的通道与迁移已登记的消费者；默认值、权限路径（`host:invoke` 的 senderAuth 与 `HostApiRegistry`）与 UI 行为仍不得改变，并须由 A6 兼容回归在干净候选上证明。
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
| 根 | TF-0628 架构骨架收敛 | done；限定架构范围，保留残差 |
| A | TF-0629 接入层盘点与唯一入口裁定；TF-0630 contract:check 覆盖扁平 IPC | done / done |
| B | TF-0631 语义权威矩阵逐条对齐；TF-0632 唯一 owner 校验 | done / done |
| C | TF-0633 语义合同硬化接入骨架（父）；TF-0634…TF-0637 C1–C4 四叶 | done |
| 审查后续 | TF-0638 B2 对账承重化；TF-0639 C5 报告观测化（`REVIEW-20261101.md` §5） | done / done |
| A（2026-11-03 已验收） | TF-0649 A3 迁移活体消费者；TF-0650 A4 改写 E2E mock 缝；TF-0651 A5 退役扁平通道与 preload 第二入口；TF-0652 A6 兼容回归与收口 | done；保留已分类的全仓失败 |
| 2026-11-05 修复 | TF-0786：TF-0787 门禁 → TF-0788 小依赖环 → TF-0789 runtime 反向依赖 → TF-0790 权威描述 → TF-0791 复验 | 五叶限定验收完成（5/5）；584项专项与owner测试通过，残差见 §9 |
| D | 未登记（消费需求未证实） | - |

> 2026-10-31 的拆分与规划状态保留在历史决策记录 `docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md`；上表表达当前交付和正在推进的阶段。

---

## 5. 四个批次

每批是一次独立、可单独验收的收敛；批内节点串行，批间按依赖推进。

### 批次 A：接入层单一化裁定（L4）

- **A0 裁定**：枚举当前所有 renderer↔Main 接入通道（类型化 Host API / 扁平 IPC / extension contributions），为每个指定唯一入口、owner 与迁移位点；无法判定的记 gap。
- **A1 覆盖**：让 `pnpm contract:check` 对 B 通道（扁平 IPC）也 fail-closed；复用现有入口，不新增 package script。
- **A2 兼容回归**：证明收敛后既有消费者行为不变，无新增权限路径与默认值变化。
- **2026-11-01 修订（所有者授权）**：A0/A1 已落地（TF-0629 / TF-0630）。实际收敛拆为四个串行叶子：**A3**（TF-0649）迁移 4 个活体消费者——`shell:openExternal` 的 4 处 renderer 包装调用、`settings:getAll` / `usage:recentTokenHistory` / `provider:save` 的 E2E 直接 invoke；**A4**（TF-0650）改写 4 个 E2E mock 缝——`gateway:status` / `gateway:rpc` / `file:stat` / `file:readText` 由 `tests/e2e/fixtures/electron.ts` 的 host:invoke 拦截器直接供给，去除 legacy-override 桥接；**A5**（TF-0651）退役 43 条扁平通道与 preload 的 invoke 白名单 / `openExternal` 包装 / 3 条悬空 `env:*`（优先 `provider:getApiKey`），门禁改为断言扁平 handler = 0；**A6**（TF-0652）= A2 的实现：干净候选上全量 E2E / 单测 / typecheck / lint / contract:check，默认值与权限路径 diff = 0，更新 §8 读数。输入为 `ADMISSION-INVENTORY.md` §6 的 43 条裁定（35 retire / 4 migrate / 4 freeze）与 `ADMISSION-GATE.md` 的冻结清单。

**验收口径**：接入通道可从磁盘枚举；未分类通道为 0；坏例（未登记通道 / 双入口同域 / 绕过 registry）被门禁拒绝；（修订后）A5 完成时扁平 `ipcMain.handle` = 0 且 preload 无字面 invoke 通道，A6 证明既有消费者行为不变。

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
（2026-11-01 修订）A3 -> A4 -> A5 -> A6   # 批次 A 实际收敛，串行；A6 即 A2 的实现

A1 依赖 A0 的裁定；B1 依赖 B0 的映射；
C 批四步串行，每次只推进一个 ready 叶子。
```

A 与 B 并行前提：写入集不重叠（A 触 contract-check 与 ipc-handlers，B 触语义注册表）。出现写入冲突时按 A 先 B 后串行。

---

## 8. 成功判据（骨架级）

| 判据 | 目标值 | 度量方式 |
|---|---|---|
| 未分类接入通道 | **0（A5 实测）** | 枚举脚本离线可复现输出；仓库仅剩 `host:invoke`，43 条扁平通道均登记 retired |
| 同一组件冲突 owner | 0 或已显式豁免 | 唯一 owner 校验器 |
| 语义合同坏例拒绝率 | 100% 在预期规则上拒绝 | 负例 fixture + 既有门禁 |
| 陈旧来源被当作当前通过 | 0 | 来源摘要 + 候选绑定 |
| 新增运行时组件 / 第二真源 | 0 | 变更集审查 |
| 现有产品行为变化 | **A3-A5 兼容性：0 新增回归；仓库既有失败：明确逐项列出（A6，2026-11-03）** | 干净候选 `590ba5258`（tree `01b8f896...`）：unit 9723 passed / 168 failed / 91 skipped，168 个失败名与 `97cda35de` 基线复现集完全相同；E2E 完整 418 条为 391 passed / 22 failed / 5 skipped / 1 suite error，22 条逐项分类，其中 6 条隔离复跑通过、16 条为候选变更路径外的持久产品/测试债；A3-A5 改动的 22 个 E2E 规格和 15 个单元测试文件全部通过。详见 `ADMISSION-CONVERGENCE.md` 与 `artifacts/admission-convergence-20261102/e2e/failure-classification.json` |

**明确不在判据内**：业务收益、采用率、任务成功率、性能提升、GA 就绪、发布批准。这些需要各自独立的受控实验，不能由骨架绿灯外推。

---

## 9. 当前状态与已知风险

- 当前修复基线为 `bfcf57616b361a12845014b3f054b95e31c4021c`。TF-0789 的实现提交为 `b834bf3e1`，验收包由归档快照 `2d1373988` 完整保留；接力分支为 `codex/architecture-convergence-recovery-20261105`；2026-11-06审查集成后主仓路径为 `D:/ClawX`。首叶冻结现场与临时树按用户要求回收，原日志/图保存在私有压缩归档 `D:/ClawX-acceptance/architecture-review-merge-20261106/prior-architecture-raw-complete.zip`，同目录index给出恢复原路径；本地任务图唯一目标仍为 `D:/ClawX/.agent-workbench/task-forest`。
- A/B/C 与审查后续已经实施；A3–A6 已验收，历史全仓失败不改写为通过。旧规划和验收记录保留原候选、日期与范围。
- `TF-0787` 的接入门禁限定验收通过：72/72 测试、38 项真实入口负例拒绝，完整类型与十项记录门禁均 exit 0。候选 `11adcfbdb`，36 份保留文件的清单读回 35/35 匹配、凭据扫描 0 命中。机制与限制见 `ADMISSION-GATE.md`；证据位于 `harness/specs/fixtures/architecture-admission-ast/report.json`。
- `TF-0788` 把同步叶模块的 workspace 查询改为 owner 传入的读取函数，sandbox API 与同步复用同一个 `sandbox-state` 存储；只读工具目录持有四个名称常量，工厂保持原导出。持久存储、权限 mapper、工具名称/顺序/摘要和注册条件保持。前后依赖图、owner 测试、原循环门禁残差与最终候选见 `harness/specs/fixtures/architecture-small-cycles/report.json`。README 三语已复核，内部依赖重排无需产品说明更新。
- `TF-0788` 限定验收通过：干净候选 `36b37acd4` 的 80/80 相关测试和 4 条反向边负例通过；20 项记录运行 exit 0，含完整 uncached node/web/test 类型、契约、scoped lint、comms 与 Harness。应用静态图 825 → 826 文件、环 1 → 0；context 两文件环 1 → 0。该候选的原 runtime checker 分量 [23, 2] → [23]，exit 1，23 文件成员不变。20 份保留文件的哈希读回 19/19 匹配、凭据 0 命中。两次 Codex 复核无发现；四入口 bundle smoke 不替代完整构建。剩余分量由 `TF-0789` 接续。
- `TF-0789` 将 CVK 引擎身份放到静态叶模块并保持工厂模块原导出；registry 只读取身份，kill-switch 与 VToken 配置解析直接消费原 `runtime-core/types` 中的 `isRecord`。三条反向边均已移开，原循环检查从 23 文件分量降为 0；限定候选 `b834bf3e1` 的 58/58 相关测试通过，24 项记录门禁为 0，完整 `runtime:source:check` 仍保留与基线逐字一致的 LOC 残差。证据见 `harness/specs/fixtures/architecture-runtime-cycles/report.json`；不把该限定结果外推为全仓通过。
- TF-0790 已修正五组件的陈旧声明并删除对应八条裁定。原 checker 规则不变，当前裁定为0；结构例外55项、登记gap35项。逐项分类为18项描述映射缺口、16项领域外owner、1项未实现的全系统model echo保证，详见 `AUTHORITY-RECONCILIATION.md` §12 与 `harness/specs/fixtures/architecture-authority-convergence/gap-classification.json`。TF-0790候选2ca6e2092的150项测试及完整类型通过，证据提交a80f06b17；TF-0791已补关键关系约束并完成既定架构范围复验。
- 原测评的共享工作区会话接口类型漂移属于另一工作流；本轮独立候选的完整node/web/test类型检查已通过。
- TF-0791限定通过：干净候选 `ec2053701`（tree `b5bca90ffa3d81ffc5af1e92d75db3c936777d51`）的29文件584项测试全部通过，含399架构、136 owner、19能力、30 runtime；完整uncached node/web/test类型通过。五种关系的245个已知概念组合只接受六种合法关系，错误目标经原报告入口拒绝；12关系规则与8来源规则均实际观测。
- 同候选应用静态图826文件/2375值边，环0与禁止层间边0；runtime9159文件，环0。9985图输入匹配候选Git原字节，前四叶85哈希匹配；最终证据在 `harness/specs/fixtures/architecture-convergence-final/report.json` 与 `report.md`，18文件/17哈希/凭据0。
- 完整runtime source仍exit1，最后LOC子门禁保留23个未登记超500行及110个超既有基线文件，与TF-0789逐字相同；未新增或加重。额外Harness CI在5文件59测试和policy/catalog通过后，因四份Agent Dev产物过24小时而exit1；CI后续evidence及test-coverage单独通过。详情见最终包 `residuals.json`。不改变LOC基线、时效门槛或旧证据日期。
- 本根收口表示其声明的接入、静态依赖、权威描述与关系约束范围有证据，不能外推为全仓健康、完整发行构建、Electron/live provider效果或GA。维护效率、agent成功率与可靠性净收益尚无本轮对照测量。35gap仍保留，批次D消费需求未证实。


## 10. 合并前独立审查与集成（2026-11-06）

三个同模型子代理分别核查IPC、运行拆环、语义/证据。运行拆环44项测试及服务组合复现通过；
审查发现并修复四类IPC漏检、历史gap哈希钉死活源码及旧报告verify未重跑规则探针，共六项。
修复提交9394c6142、fixture EOF提交23d53a29a；原历史证据不修改。

合并候选已包含main的2fff49d09。615项相关测试全部通过，node/web/test完整类型及VerseBrowser声明
通过；契约、权威、证据report/verify、comms、循环门禁、lint、retention与Harness通过。
测试候选23d53a29a，复验候选d5750f2ba仅变更task spec比较基准，所有受测实现相同。
LOC仍exit1：与当前main同23个未登记/111个增长文件；较main的唯一行数差为此前TF-0788
格式化保留的context-agent-tools +40行，review没有新增runtime/tool行数。

详见 `harness/specs/fixtures/architecture-review-integration/report.json` 与 `report.md`。
这是独立agent审查，非真人；共享依赖安装曾被意外触发并中止，随后在隔离临时依赖上完成验证，
该副作用与失败尝试已记录。主仓快进与其它会话脏文件的保留、进程/工作树清理结果记录在本地
`docs/dev/handoffs/ARCHITECTURE-REVIEW-MERGED-20261106.md`，不由旧报告推断。
