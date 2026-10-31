# 收口决策与节点切分复核（CLOSURE-DECISIONS，2026-10-31）

> 状态：`decision`（对 TF-0628 子树做一次收口决策与节点切分复核；**不授权本轮实现任何运行时**）
> 节点：TF-0628（父，proposed）→ TF-0632（批次 B / B1，**ready**）、TF-0633（批次 C，proposed；本轮拆为 TF-0634…TF-0637 四个串行子叶）
> 合同：`harness/specs/tasks/architecture-skeleton-authority-validator.md`（本轮修订）、`harness/specs/tasks/ontology-lite-contract-implementation.md`（本轮新增）、`harness/specs/tasks/ontology-lite-existing-contracts-hardening.md`（伞合同，原文有效）
> 读序：`CHARTER.md` → `ADMISSION-INVENTORY.md` → `ADMISSION-GATE.md` → `AUTHORITY-RECONCILIATION.md` → **本文件** → `docs/dev/dsh-superagent-absorption-20261031.md` → 两份 task spec。后文只引用前文已落地的事实。
> 录入日期：2026-10-31，Asia/Shanghai
> 产出者：agent（`driven_by: agent`，`actor: claude-fable-5`）；本文件不含任何真人操作、真人数据或真人 verdict

本文件回答三个问题：当前 TF-0628 子树的切分是否成立（§1）；TF-0632 这个 ready 叶子**做什么、验收口径、证据从哪回读、写集边界**（§2）；TF-0633 的四步是否可直接执行、最小形状是什么、如何不改运行时路径、如何收口（§3）。§4 是两者共用的收口口径，§6 是全部计数的离线复现命令。

---

## 0. 基线（本轮；实现者**不得**把这里的读数当作自己的验收候选）

| 项 | 值 |
|---|---|
| HEAD / tree | `2b87c1c44cf5b38df2127296307d5123c6784856` / `8c50ce0acc3d96230d20d1a1c0697c387febd36c`（即 TF-0631 的候选 commit 与 tree） |
| 工作区 | 决策前 `git status --porcelain` 0 行 |
| 检出路径 | 仓库主检出为 `D:\ClawX`；桌面下同名目录是指向它的 NTFS JUNCTION（`fsutil reparsepoint` 可证），同一检出、同一 HEAD |
| Node | `v24.22.1`，`process.features.typescript === 'strip'`；CI `.github/workflows/check.yml:31,122` 使用 Node 24 |
| 参考仓库 | dsh-superagent-prototype `6337fc823ce20251c8de8085948165c81aaa701e`（只作 B 层设计信号，见吸收研究 §0） |
| Task Forest 导出图 | `generated_at 2026-10-31T14:01:30Z`，633 节点；status 直方图 done 603 / deprecated 17 / in_progress 6 / proposed 6 / ready **1**；CLI `todo --ready --json` 中 stored-status 为 `ready` 的节点恰为 TF-0632 |
| TF-0628 子树 | TF-0629 done（候选 `8a9d173c0`）、TF-0630 done（`fd2d93a41`）、TF-0631 done（`2b87c1c44`）、TF-0632 ready、TF-0633 proposed；边 TFE-1252（0632 depends_on 0631）、TFE-1253（0633 depends_on 0632，理由"避免两套并行语义规则"） |
| 六表在本 HEAD 的重测 | 35 组件 / 44 authority 行 / 54 处置 / 45 主张 / 7 可靠性 / 7 敏感面 / 7 概念 + 6 关系 + 32 task boundary / 22 flag；权威↔处置 1:1；无权威绑定的处置 19；`owner` 命名空间 44 组件 id + 10 节点号（10/10 等于本条实施 / 退役节点）；`target==default` 13；R-D1 可比 13、不等 2（`working-memory-context-source`、`tool-registry-context-source`）；R-D2 不对称 2（`vtoken-context-source`、`retired-surface-registry`）；权威 internal vs 处置 default 4；flag 三方 22=22=22、owner 一致；未拥有的读数据类型 16；概念连接 `task-ledger` 精确 + `routing-memo→routing-memo-observation`；自带校验 ok；默认矩阵 14 行、R-D3 冲突 2（`vtoken-context-source`、`vtoken-bridge`）；R-D4 13 个来源 = **ok 5 + exempt 6 + conflict 2** |
| 批次 A 事实（不重做） | `pnpm contract:check` 覆盖 43/43 扁平 `ipcMain.handle`，冻结清单 `scripts/contract-check-flat-ipc.json` 35 retire / 4 migrate / 4 freeze，preload 44/44 双向对账，8 个负例 fixture 各 exit 1（`ADMISSION-GATE.md` §1、§4） |
| 三项静态探针 | `grep -nE "CONTRACT_VERSION\|validateProductSemanticRelation\|relationKey" shared/product-semantics.ts tests/unit/product-semantics.test.ts` 退出码 1 → 三项均 **false** |
| 分支 `codex/ontology-contracts` | 头 `22c275811`（2026-10-31 00:05 +0800），merge-base `b6b50ceaf`，相对 main 在 `scripts/check-evidence-refs.mjs` +193、`shared/product-semantics.ts` +223、`tests/unit/product-semantics.test.ts` +80；**未合入**，且被另一 worktree 检出；只作命名参考 |

**勘误（TF-0631 文档）**：`AUTHORITY-RECONCILIATION.md` §6.1 R-D4 行写"一致 6、豁免 5 + 1、冲突 2"，§10.5 期望注释写"ok ×6, exempt ×6"，与 13 个 `DCS_PROD_FLAGS:*` 来源的总数不符；逐组件重测（§6.3 命令）为 ok 5（`dcs-fact-view-and-tools`、`runtime-memory-store`、`memory-candidate-queue`、`coding-execution-backend`、`routing-memo-observation`）/ exempt 6（risk 无激活语义 5 + `observability-recorder` 权威 internal 1）/ conflict 2。冲突与豁免结论不变。已在该文档追加勘误块，并登记 deviation `TFD-ca7eb218be`（关联 TF-0631、TF-0632）。

---

## 1. 节点切分复核

| 对象 | 复核结论 | 依据 |
|---|---|---|
| TF-0628 的五子结构（A: 0629→0630；B: 0631→0632；C: 0633；D 未登记） | **成立，不改**。A 批两叶已 done；B 批 0631 done、0632 ready；C 批尚未开始；D 按宪章只在消费需求证实后登记 | `CHARTER.md` §4 表、§5、§7；TF-0628 `acceptance_criteria[0]`"五个子节点按依赖串行推进，每个子节点有独立 Harness task spec" |
| TF-0632 | **保持单叶**。它的写集（校验器 + 登记表 + fixture + 单测 + 文档）是一个内聚的交付，拆分只会制造两套半成品 | 本文件 §2.7 |
| TF-0633 | **拆为四个串行子叶**（本轮已应用）：TF-0634 C1 来源清单 → TF-0635 C2 校验器与负例 → TF-0636 C3 来源摘要与报告失效 → TF-0637 C4 门禁接入与收口；四叶 `child_of` TF-0633，`depends_on` 链 C1→TF-0632、C2→C1、C3→C2、C4→C3；父节点保留 TFE-1253、保持 proposed，四叶 done 后以各叶候选 commit 与 `CONTRACT-HARDENING.md` 收口 | 宪章 §7"C 批四步串行，每次只推进一个 ready 叶子"；伞合同 :61-64"四步串行执行，每次只推进一个 ready leaf…后续按四个串行节点实施"；四步的写集互不重叠（见 §3.4），拆分后每叶可单独回滚 |
| 吸收研究 §5 的候选 N-1…N-7 | **不登记**。它们都不是骨架批次的前置，且多数需要消费需求证实或 `gateway-backend-communication` 场景规范 | `docs/dev/dsh-superagent-absorption-20261031.md` §5；`CHARTER.md` §5 批次 D 规则 |

应用记录：proposal `TFP-20261031-batch-c-split`（新增 4 节点、8 边、1 条 deviation）与 `TFP-20261031-batch-c-split-fields`（补 TF-0632 / TF-0633 的 `execution_hints`、`evidence`、`summary`）；`validate` 通过；两者都不改任何节点 status、不触碰产品锁。

---

## 2. TF-0632 决策（ready 叶子；最高优先）

### 2.1 做什么

把 `AUTHORITY-RECONCILIATION.md` §3.1 / §6.1 的身份与轴向规则实现为 `scripts/check-semantic-authority.mjs`，以登记表 `scripts/check-semantic-authority-adjudication.json`（`SemanticAuthorityAdjudication/v1`）承载 X-01…X-05 豁免、C-02…C-06 已裁定冲突、G-01…G-06 gap、I-4 概念别名与 R-A 的 `authorityBindings`；五类负例以 `tests/fixtures/semantic-authority/*.json` 承载并经真实入口执行；`tests/unit/semantic-authority-consistency.test.ts` 接入 `pnpm test`；输出 `AUTHORITY-VALIDATOR.md`。规则集、登记表 schema、负例形状与诊断格式**全部以修订后的 spec 为准**（本节只记录决策与理由）。

### 2.2 校验器落点与加载方式（决策 + 理由）

- **决策**：plain-Node CLI（`node scripts/check-semantic-authority.mjs`）+ `scripts/lib/ts-import-hooks.mjs`（`node:module` 自定义钩子：`resolve` 把相对 `./x.js` 在磁盘无 `.js` 但有 `.ts` 时回退到 `.ts`；`load` 对内存改写表命中的文件返回改写后的源码，`format: 'module-typescript'`）。
- **为什么不是别的**：(a) 七个注册表模块里 `component-authority-manifest.ts`（`:1` 导入 `./dcs/prod-flags-catalog.js`）、`dcs/component-disposition-catalog.ts`（`:1` 导入 `../component-authority-manifest.js`）、`product-semantics.ts`（`:1-5` 导入 `./types/task-ledger-reference.js` 等）在 plain Node 下 `ERR_MODULE_NOT_FOUND`（本轮实测，§6.2）；其余四个可直接 import。(b) TF-0631 用 esbuild 打包绕过了这一点，但 esbuild 不是根 `package.json` 的直接依赖（只有 `vite` / `vitest` / `typescript` / `@typescript/native-preview`），pnpm 严格布局下不能当门禁依赖。(c) 只用 vitest 加载则没有可被 spawn 的真实入口，与批次 A 的"坏例经真实门禁入口"形态不一致。(d) 钩子方案本轮已用临时脚本验证：六表 + flag 目录全部加载，读数与 TF-0631 逐项一致（§0）。(e) 内存改写 + `load` 钩子保持批次 A 的"改写只发生在读入之后、不触盘"不变量。
- **代价与守卫**：依赖 Node ≥ 23.6 的默认类型剥离（CI 与本地均为 24）；入口以 `process.features.typescript` 守卫，不满足时 exit 2，不静默通过。

### 2.3 C-02…C-06 的处置（二选一，选"先登记"）

- **决策**：登记为 `registered-pending-fix`，每条带 `reason`、`reviewCondition`、`source`（§6.2 行锚点）与两侧原值。
- **理由**：fail-closed 会让 `pnpm test`（CI `check.yml:88`）在当前 main 立刻变红，而修正权威矩阵的 5 个陈旧 `defaultMode` 是**另一个节点**的写集（注册表条目在本节点明令禁改）；红的主门禁会被人绕过，比显式登记更危险。
- **不放宽的保证**：规则照常计算；登记条目记录两侧原值，权威矩阵一旦修正，`exemption-stale` 使该条失效并要求删除（吸收研究 §1.2 / §1.6 的"终态化"），因此豁免是自到期的，不是永久白名单。C-01 的读取规则必须实现、**不可**登记。

### 2.4 五类负例的形状

见 spec "负例要求"表：冲突 owner（处置 `owner` 改指另一权威组件）、冲突 default 两形（R-D2 退役不对称、R-D1 激活不等）、冲突 authority（workboard→task-ledger 边界改为 `task-ledger-authority`）、表声明矩阵中不存在的组件两形（处置 coverage 指向 `ghost-component`，经自带校验器 `unknown_coverage` 透传；登记表删除 G-03 `chat` 条目 → `gap-unregistered`）、豁免缺理由（X-03 条目 `reason` 置空），外加陈旧豁免、缺登记表、坏 fixture、正例四个对照。每个 fixture 的 `find` 必须含条目 id 字面量以保证唯一命中。

### 2.5 门禁入口（决策 + 理由）

- **决策**：唯一消费点是 `pnpm test` 路径下的 vitest（`vitest.config.ts:145` 含 `tests/unit/**`），测试内含 `real gate entry` 组 spawn CLI（与 `tests/unit/contract-check.test.ts:386-423` 同形）；**不**改 `package.json`、**不**追加进 `harness:ci` 命令链、**不**改 `scripts/contract-check.mjs` 与 `scripts/check-evidence-refs.mjs`。
- **理由**：`harness run --spec` 在 CI 里只以 `--dry-run` 跑 gateway 场景（`package.json:82`），不是任意 task spec 的真实门禁；`contract:check` 是批次 A 的文件，改它会破坏"每批可单独回滚"；`check-evidence-refs.mjs` 是批次 C（TF-0636）的写集。vitest 路径是 CI 已经消费的入口，且批次 A 已证明"spawn 真实入口"的形态有效。
- **"空报告 / 漏调用不能 pass"**：测试断言报告 `counts.components`、`rulesEvaluated` 与封闭集逐一相等、`diagnostics: []`、`exitCode 0`；缺登记表 exit 1、注册表加载失败 exit 2；三者都得不到 0。

### 2.6 诊断格式

`<file>[:<line>]: [semantic-authority/<rule>] <message>`，与 `ADMISSION-GATE.md:62` 逐字同形；`<line>` 由条目 id 字面量在（改写后的）源码中的位置得到，定位不到就省略，不猜。

### 2.7 写集边界

允许：spec frontmatter `ownedPaths` 的 14 条路径。禁止：六份注册表与 flag 目录、`docs/dev/default-config-matrix.md`、`docs/clawx-product-semantics.md`、`package.json`、`scripts/contract-check*`、`scripts/check-evidence-refs.mjs`、`electron/**`、`src/**`、`openclaw_runtime/**`。对 `AUTHORITY-RECONCILIATION.md` 只允许追加勘误块。

### 2.8 不得实现的比较

`targetDefaultMode === defaultMode`（X-03）、跨表比较 `internal`（X-02）、按处置 id 后缀推导身份（O-1）、把处置 `owner` 当 owner 比较（C-01）、为 `window` 模块加规则（G-07）。测试断言这些规则 id **不**在封闭集内。

### 2.9 在当前树上的预期结果（实现者以自己候选上的实际读数为准）

登记种子齐全时：诊断 0、exit 0；报告 `exemptionsApplied` X-01 7 flag / X-02 4 / X-03 18 / X-04 20 / X-05 5，`adjudicatedConflicts` 5（全部 `registered-pending-fix`），`gapsRegistered` 35（G-01 1 / G-02 1 / G-03 5 / G-04 16 / G-05 5 / G-06 7），`conceptAliases` 1，`authorityBindings` 3。登记表为空文件时：默认态冲突 5、组件级 gap 7、数据类型 gap 16、未登记 gap 若干，exit 1（与 `AUTHORITY-RECONCILIATION.md` §7.3 一致）。

### 2.10 收口口径（D4：TF-0632）

验收条 → 证据文件 → 回读方式的逐条表在 spec "证据回读与收口"节（五行）。补充三条前置：

1. `todo --ready --json` 中 stored-status 为 `ready` 的节点恰为 TF-0632（若 TF-0634 已被提前置 ready，先纠正）。
2. 候选 commit 必须干净（`dirty: false`），且 `git diff --stat <base>..<candidate> -- shared/ electron/ src/ openclaw_runtime/ package.json docs/dev/default-config-matrix.md` 为 0 行。
3. 收口 proposal 的 `base_graph_hash` 由 `proposal-save` 自填，`proposal-apply --yes` 时仍须匹配；不匹配即重新读图、重新保存，**不**用 `--allow-stale`。

未运行项（`pnpm run typecheck` 全量、`pnpm test` 全量、E2E、lint 全仓、agent-dev、live provider）如实记 `not-run`。

---

## 3. TF-0633 决策（proposed → 四叶）

### 3.1 伞合同四步的可直接执行性复核

| 步 | 伞合同原文 | 可直接执行？ | 阻塞 / 修正（已写入实现合同） |
|---|---|---|---|
| 一 | "先保全原始五个未提交文件的 working/staged 字节及 diff…核对它们仍对应既有工作"（:87-90） | **部分**：清单本身可做；"保全五个未提交文件"的前置在干净基线上**不成立** | 记 `preservation: not-applicable` + 干净工作区读数；不得伪造保全哈希 |
| 二 | "优先在现有语义源文件中补充小型纯函数检查…校验结果至少能定位 relationKey / field / rule / message"（:99-125） | **可**，但缺名称与规则集 | 固定 `PRODUCT_SEMANTIC_CONTRACT_VERSION` / `relationKey` / `validateProductSemanticRelation(s)` / `PRODUCT_SEMANTIC_RELATION_RULES` 与 11 条规则的触发条件；负例以 fixture 承载；正例用活常量 |
| 三 | "在现有证据检查器中产生派生报告…陈旧来源使报告失效"（:127-149） | **可**，但缺报告 schema、失效机制与加载方式 | `ProductSemanticEvidenceReport/v1` 字段表；`--report` / `--verify` / `--fixture` / `--actor`；复用 `canonical-evidence-hash.mjs` 与 TF-0632 的两个 `scripts/lib` 工具；无参默认行为逐字不变 |
| 四 | "将校验接入已有 Vitest/Harness/repo:evidence:check 路径…集成负例要通过真实门禁入口确认"（:151-176） | **可**，但缺真实入口的具体形态 | `tests/unit/evidence-refs-exist.test.ts` real gate entry 组 spawn `scripts/check-evidence-refs.mjs`；文档五列表；README 三语复核记结论；`final/` 精选证据 |

### 3.2 最小形状（决策 + 理由）

- 名称：沿用 `…/v1` 合同惯例取 `'ProductSemanticRelations/v1'`；函数名取**单数** `validateProductSemanticRelation`（与节点摘要和宪章 §1.3 的静态探针字符串一致）加复数包装；`relationKey` 小写开头（探针 `relationKey` 区分大小写——分支 `codex/ontology-contracts` 的 `productSemanticRelationKey` 命中不了该探针，这是不照搬分支命名的直接原因）。
- 派生键 `${from}--${kind}--${to}`：由现有三元组派生、无 ID 服务（伞合同"不可改写的既有语义" 1）；相同输入相同键（吸收研究 §1.8）。
- **无导入时执行**：`shared/product-semantics.ts` 被 `electron/services/*`、`src/pages/Chat/*`、`openclaw_runtime/src/agents/*`、`shared/host-api/contract.ts:33` 导入（`AUTHORITY-RECONCILIATION.md` §2.1 第 6 行），因此新增导出只能是纯函数与常量，顶层**不得**调用校验器（对照：权威矩阵在 `:1099` 导入即断言，那是 L1 已有行为，不在本节点复制）。
- "拒绝项"不作注册表新字段：保持 L1 模块形状不变、避免第二处需要强制的语义；以负例 fixture + 文档五列表承载（吸收研究 §1.8）。
- 报告中的两种摘要分字段：规范化摘要（跨平台文本）与原字节摘要（可恢复），不混用（伞合同 :139-140）。

### 3.3 不改运行时路径的证明口径

每叶重复四条：`git diff --stat` 对 `electron/ src/ openclaw_runtime/ package.json` 为 0 行；新符号在三处非测试代码零引用（grep 输出文件回读）；四个兼容单测仍绿；`node scripts/check-evidence-refs.mjs` 无参 stdout 逐字不变（C3/C4 测试断言）。

### 3.4 四叶写集（互不重叠，串行推进）

| 叶 | 写集 |
|---|---|
| TF-0634 C1 | `harness/specs/fixtures/ontology-lite-existing-contracts/provenance/**` |
| TF-0635 C2 | `shared/product-semantics.ts`、`tests/unit/product-semantics.test.ts`、`harness/specs/fixtures/ontology-lite-existing-contracts/negatives/**` |
| TF-0636 C3 | `scripts/check-evidence-refs.mjs`、`scripts/check-evidence-refs.d.mts`、`tests/unit/evidence-refs-exist.test.ts`、`…/report/**` |
| TF-0637 C4 | `tests/unit/evidence-refs-exist.test.ts`（real gate entry 组）、`docs/clawx-product-semantics.md`、三份 README（仅实际变化）、`docs/dev/architecture-skeleton/CONTRACT-HARDENING.md`、`…/final/**`、`scripts/repository-artifacts.json`、`.gitignore` |

C3 与 C4 共用 `tests/unit/evidence-refs-exist.test.ts`，但串行且各自候选 commit，不构成并行写入。全部叶子禁止：`electron/**`、`src/**`、`openclaw_runtime/**`、`package.json`、`shared/` 其余注册表、`scripts/contract-check*`、`scripts/check-semantic-authority*`。

### 3.5 分支 `codex/ontology-contracts` 的处置

不合并、不 cherry-pick：merge-base `b6b50ceaf` 早于 main 后来加入的 `PRODUCT_SEMANTIC_RELATIONS` 块（`1e278652b`，+33 行），且其命名与探针不符（§3.2）。实现者可读它作形状参考，但验收只认实现候选上的产物。

### 3.6 收口口径（D4：TF-0634…TF-0637 与父 TF-0633）

每叶：验收产物与回读方式见实现合同"四个串行叶子"表；收口前跑该叶相关的 `requiredTests` + `node scripts/check-local-paths.mjs` + `node scripts/check-repository-artifacts.mjs`；`todo --ready` 中 ready 恰为该叶；候选干净；`base_graph_hash` 匹配；`not-run` 如实。父节点：四叶全部 done 后，以四个候选 commit、`CONTRACT-HARDENING.md` 与 `final/` 收口，并对伞合同 `acceptance` 七条逐条对照（最后两条——README 复核与"不以 --no-diff 结构通过代替实现验收"——由 C4 的证据满足）。

---

## 4. 共用收口口径（D4 总则）

1. 依据 `AGENTS.md` §Task Forest closure policy 与 `harness/specs/rules/task-forest-autoclose-and-roles.md`：全部验收条由**磁盘产物**核实（Read 工具回读；shell 打印不算），证据链完整，`base_graph_hash` 匹配，主张自洽 → `proposal-save` + `proposal-apply --yes` 自动收口，随后 `validate` + `export`（export 写 ~377 MB HTML，须后台运行并从日志回读退出码）。
2. 新文档一律经 `scripts/repository-artifacts.json` `retainedFiles` + `node scripts/check-repository-artifacts.mjs --write-ignore` 跟踪（`docs/**` 默认忽略；`git add -f` 会让留存门禁变红）；spec `docs.files` 只能指向已存在且已跟踪的文件。
3. 未提交改动上跑 `pnpm harness validate --spec <spec> --since HEAD`（默认 diff 基为 `origin/main`，会把无关差异算进 touchedAreas）。
4. 提交一律 `git commit -- <explicit paths>`；`pnpm` 命令前把临时目录指向 `D:\tmp`。
5. 所有自动化产物标 `driven_by: agent` 与实际 `actor`；永不写 real-human；不改产品锁、默认矩阵、发布状态、GA 口径。

---

## 5. 本轮改动清单与门禁结果

写集（全部为文档 / 合同 / retention；零运行时、零注册表、零 `package.json`）：`docs/dev/dsh-superagent-absorption-20261031.md`（新）、本文件（新）、`docs/dev/architecture-skeleton/OPERATOR-PLAN-20261031.md`（新）、`harness/specs/tasks/architecture-skeleton-authority-validator.md`（修订）、`harness/specs/tasks/ontology-lite-contract-implementation.md`（新）、`docs/dev/architecture-skeleton/CHARTER.md`（§4 状态注）、`docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md`（§6.1 勘误块）、`scripts/repository-artifacts.json` + `.gitignore`（3 个新文档的 retention）。本地 Task Forest：proposal `TFP-20261031-batch-c-split`、`TFP-20261031-batch-c-split-fields`（不入 Git）。

**并发事实**：本轮写作期间（2026-10-31 23:34 起），另一会话在同一检出上开始实施 TF-0632，工作区出现未跟踪文件 `scripts/check-semantic-authority.mjs`、`scripts/check-semantic-authority.d.mts`、`scripts/check-semantic-authority-adjudication.json`、`scripts/lib/ts-import-hooks.mjs`、`scripts/lib/registry-fixture.mjs`、`tests/unit/semantic-authority-consistency.test.ts`、`tests/fixtures/semantic-authority/**`。本轮**未读取、未暂存、未提交**其中任何文件；提交以显式 pathspec 限定。这些路径全部落在修订后 validator spec 的 `ownedPaths` 内（下表 #8 的未覆盖清单里没有它们）。

以下命令于 2026-10-31/11-01 在上述暂存改动上运行（临时目录 `D:\tmp`，日志 `D:\tmp\closure-20261031\<name>.log`，仅本地保留）；退出码由 shell 捕获，关键输出从日志回读：

| # | 命令 | exit | 关键输出 |
|---|---|---|---|
| 1 | `node scripts/check-repository-artifacts.mjs`（暂存后） | 0 | `Repository artifact retention passed (19993 tracked paths).` |
| 2 | `node scripts/check-local-paths.mjs` | 0 | `[local-paths] PASS active docs contain no developer-local absolute paths` |
| 3 | `git diff --check`；`git diff --cached --check` | 0 / 0 | 无输出 |
| 4 | `node scripts/check-evidence-refs.mjs` | 0 | `[evidence-refs] PASS 188 referenced path(s)` |
| 5 | `node scripts/check-spec-lifecycle.mjs` | 0 | `[specs] lifecycle status present for 686 task specs.`（685 + 本轮新增 1） |
| 6 | `pnpm harness context --spec harness/specs/tasks/architecture-skeleton-authority-validator.md` | 0 | 最小阅读清单（rules: `contract-first-boundary` / `capability-owner-resolution` / `repository-artifact-retention`；layer `harness`） |
| 7 | `pnpm harness validate --spec …/architecture-skeleton-authority-validator.md --no-diff` | 0 | `Spec is valid` |
| 8 | `pnpm harness validate --spec …/architecture-skeleton-authority-validator.md --since HEAD` | 1 | 未覆盖文件**仅**为本轮跨切件：`CHARTER.md`、`OPERATOR-PLAN-20261031.md`、`dsh-superagent-absorption-20261031.md`、`ontology-lite-contract-implementation.md`；在途 TF-0632 实现文件全部被覆盖 |
| 9 | `pnpm harness context --spec harness/specs/tasks/ontology-lite-contract-implementation.md` | 0 | 最小阅读清单（rules: `docs-sync` / `repository-artifact-retention` / `identity-scope-boundary` / `context-family-boundary` / `task-forest-autoclose-and-roles` / `contract-first-boundary`） |
| 10 | `pnpm harness validate --spec …/ontology-lite-contract-implementation.md --no-diff` | 0 | `Spec is valid` |
| 11 | `pnpm harness validate --spec …/ontology-lite-contract-implementation.md --since HEAD` | 1 | 未覆盖 = 本轮跨切件 + validator spec + 另一会话的 TF-0632 文件（属另一 spec 的写集，预期） |
| 12 | `pnpm harness run --spec …/ontology-lite-contract-implementation.md --dry-run` | 1 | 同 #11（dry-run 先做 validate）；报告 `artifacts/harness/latest.md` |
| 13 | `pnpm exec vitest run tests/unit/docs-index.test.ts tests/unit/harness-specs.test.ts tests/unit/harness-spec-lifecycle.test.ts --maxWorkers=1` | 0 | `Test Files 3 passed (3)`，`Tests 48 passed (48)` |
| 14 | `pnpm contract:check` | 0 | `Contract check passed.` |
| 15 | `pnpm docs:policy:validate` | 0 | `[policy-docs] PASS: 10 checks` |
| 16 | task-forest `validate`（两次 proposal 应用后各一次）；`export` | 0 / 0 | `校验通过。`；`已导出：…/exports/task-forest.html`，`export-exit=0` |

#8、#11、#12 的失败是共享脏树上跨 spec 的结构性结果（每个 spec 只覆盖自己的写集），不是合同缺口；TF-0632 / TF-0634…0637 的实现者在各自干净候选上以带 diff 的 validate 收口。**本轮明确未运行**：`pnpm run typecheck`、`pnpm test`（全量）、E2E、`pnpm run lint`（全仓）、`pnpm agent-dev:*`、任何 live provider / Gateway；记 `not-run`。

---

## 6. 复现命令（离线，仓库根目录，Git Bash；临时目录 `D:\tmp`）

```bash
# 6.1 基线
git rev-parse HEAD; git rev-parse 'HEAD^{tree}'; git status --porcelain | wc -l
node -v; node -p process.features.typescript
grep -nE "CONTRACT_VERSION|validateProductSemanticRelation|relationKey" shared/product-semantics.ts tests/unit/product-semantics.test.ts; echo "exit=$?"   # → exit=1
git log -1 --format='%H %ci' codex/ontology-contracts; git merge-base main codex/ontology-contracts
git diff --stat main...codex/ontology-contracts -- shared/product-semantics.ts tests/unit/product-semantics.test.ts scripts/check-evidence-refs.mjs
```

```bash
# 6.2 plain Node 能否直接 import 七个注册表（期望：三个 ERR_MODULE_NOT_FOUND，四个 OK）
for f in shared/component-authority-manifest.ts shared/dcs/component-disposition-catalog.ts shared/capability-claims.ts shared/reliability-boundaries.ts shared/sensitive-content-boundary.ts shared/product-semantics.ts shared/dcs/prod-flags-catalog.ts; do
  node --input-type=module -e "import('./$f').then(m=>console.log('OK  $f', Object.keys(m).length)).catch(e=>console.log('ERR $f ::', String(e.message).split('\n')[0]))"; done
```

```bash
# 6.3 解析钩子探针 + 六表重测（临时文件放 D:\tmp；与 AUTHORITY-RECONCILIATION §10.4/§10.5 同逻辑，只是加载方式换成钩子）
mkdir -p /d/tmp/ts-hook-probe
cat > /d/tmp/ts-hook-probe/hooks.mjs <<'EOF'
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  if (relative && specifier.endsWith('.js') && context.parentURL) {
    const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    const jsPath = fileURLToPath(new URL(specifier, context.parentURL));
    if (!existsSync(jsPath) && existsSync(fileURLToPath(candidate))) return nextResolve(specifier.slice(0, -3) + '.ts', context);
  }
  return nextResolve(specifier, context);
}
EOF
cat > /d/tmp/ts-hook-probe/probe.mjs <<'EOF'
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
register('./hooks.mjs', import.meta.url);
const ROOT = 'file:///D:/ClawX/'; const L = (p) => import(new URL(p, ROOT));
const A = await L('shared/component-authority-manifest.ts'), D = await L('shared/dcs/component-disposition-catalog.ts'), C = await L('shared/capability-claims.ts'), R = await L('shared/reliability-boundaries.ts'), S = await L('shared/sensitive-content-boundary.ts'), P = await L('shared/product-semantics.ts'), F = await L('shared/dcs/prod-flags-catalog.ts');
const comps = A.AUTHORITY_COMPONENTS, disp = D.COMPONENT_DISPOSITION_ENTRIES, ids = new Set(comps.map((c) => c.id));
console.log('counts', comps.length, A.COMPONENT_AUTHORITY_MANIFEST.authorities.length, disp.length, C.CAPABILITY_CLAIM_MATRIX.length, R.RELIABILITY_BOUNDARIES.length, S.SENSITIVE_CONTENT_BOUNDARY_MATRIX.length, P.PRODUCT_SEMANTIC_CONCEPTS.length, P.PRODUCT_SEMANTIC_RELATIONS.length, P.PRODUCT_SEMANTIC_TASK_BOUNDARIES.length, F.DCS_PROD_FLAGS.length);
const byAuth = (id) => disp.filter((e) => e.coverage.authorityComponentIds?.includes(id));
const act = new Set(['baseline', 'opt-in', 'shadow', 'disabled']), cur = new Set(['baseline', 'opt-in', 'shadow']);
const pairs = comps.map((c) => ({ c: c.id, m: c.defaultMode, e: byAuth(c.id)[0] }));
console.log('R-D1 unequal', pairs.filter((p) => act.has(p.m) && cur.has(p.e.currentMode) && p.m !== p.e.currentMode).map((p) => p.c));
console.log('R-D2 asym', pairs.filter((p) => (p.m === 'retired') !== (p.e.disposition === 'retired')).map((p) => p.c));
const r2m = { 'baseline-on': 'baseline', 'opt-in': 'opt-in', 'shadow-only': 'shadow' }; const rd4 = { ok: 0, exempt: 0, conflict: [] };
for (const c of comps) { const m = /^DCS_PROD_FLAGS:(.+)$/.exec(c.runtimeAvailabilitySource); if (!m) continue; const f = F.DCS_PROD_FLAGS.find((x) => x.id === m[1]); const e = r2m[f.risk]; if (!e || !act.has(c.defaultMode)) rd4.exempt++; else if (e === c.defaultMode) rd4.ok++; else rd4.conflict.push(c.id); }
console.log('R-D4', JSON.stringify(rd4));   // → {"ok":5,"exempt":6,"conflict":["working-memory-context-source","tool-registry-context-source"]}
EOF
node /d/tmp/ts-hook-probe/probe.mjs
```

```bash
# 6.4 Task Forest 子树与 ready 节点（本地，不入 Git）
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
python -X utf8 <skill-dir>/scripts/task_forest.py todo --workspace . --ready --json | python -X utf8 -c "import json,sys;[print(n['id'],n['status'],n['title']) for n in json.load(sys.stdin)]"
python -X utf8 -c "import json;g=json.load(open('.agent-workbench/task-forest/exports/task-forest.graph.json',encoding='utf-8'));n=g['nodes'];[print(i,n[i]['status'],n[i]['title'][:40]) for i in ('TF-0628','TF-0629','TF-0630','TF-0631','TF-0632','TF-0633','TF-0634','TF-0635','TF-0636','TF-0637') if i in n]"
```

---

## 7. 需要 operator 决策的事项

**none。** 本轮全部动作（吸收研究、spec 修订与新增、Task Forest 结构变更、文档勘误、retention 跟踪、提交到既有私有远端的本地分支）都在 `AGENTS.md` §Human-in-the-loop policy 第 5 条划给 agent 的职责内；没有发布 / 公开、凭据、不可逆 git 操作、冻结默认值、真人证据或项目范围变更。

一条**观察**（不是决策请求）：`.agent-workbench/task-forest/exports/` 下残留两个导出中断的临时文件 `.task-forest.timeline.json.tmp.*`（10-28 与 10-30，合计约 1.4 GB）；它们是 agent 导出产生的大体积临时输出，按 disk-temp-policy 可由后续会话清理，本轮未动。

---

## 8. 边界声明

- 本轮只产出决策、合同与文档；**没有**实现校验器、登记表、fixture 或报告；没有修改任何注册表、运行时文件、`package.json`、产品文档或 README。
- TF-0632 保持 `ready`、TF-0633 保持 `proposed`、新叶 TF-0634…TF-0637 为 `proposed`；没有任何节点被收口或改状态。
- 未改变产品锁、默认矩阵、发布状态或 GA 口径；没有任何以真人操作 / 真人数据 / 真人 verdict 为前置的条件。
- 全部产出为 agent 驱动（`driven_by: agent`，`actor: claude-fable-5`）。
