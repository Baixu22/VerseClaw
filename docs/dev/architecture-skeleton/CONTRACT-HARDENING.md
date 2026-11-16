# 语义合同硬化的四叶落地与收口（CONTRACT-HARDENING）

> 状态：`implemented + gated`（四叶 C1→C4 全部落地；校验经真实入口接入 CI 已消费的 `pnpm test`；**零字节**改动 `electron/**`、`src/**`、`openclaw_runtime/**`、`package.json`、`shared/` 其余注册表、`scripts/contract-check*`、`scripts/check-semantic-authority*`）
> 节点：`TF-0637`（批次 C / C4）；父 `TF-0633`（批次 C，本文件是其收口依据）；根 `TF-0628`
> 合同：`harness/specs/tasks/ontology-lite-contract-implementation.md`（实现合同）；`harness/specs/tasks/ontology-lite-existing-contracts-hardening.md`（伞合同，原文有效）
> 决策：`docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md` §3、§4
> 输入：`docs/dev/architecture-skeleton/CHARTER.md` §3 L2+L5、§5 批次 C、§6；`harness/specs/guides/ontology-lite-existing-contracts-research.md` §"四步实施顺序"
> 录入日期：2026-11-01，Asia/Shanghai
> 产出者：agent（`driven_by: agent`，`actor: chain-driver`）；本文件不含任何真人操作、真人数据或真人 verdict

本文件记录批次 C 四个串行叶子的落地结果与证据链，并以此收口父节点 TF-0633。四叶各自一个干净候选 commit：C1 `832aa5ab2`（来源清单）、C2 `2b819e342`（合同版本 + 派生键 + 可拒绝校验器 + 21 个负例）、C3 `819d23439`（`--report` / `--verify` / `--fixture` / `--actor` 与 8 条来源规则）、C4 本叶（real gate entry 组 + 产品语义文档五列表 + README 复核 + `final/` 精选证据）。宪章 §1.3 指出的三项静态探针（`CONTRACT_VERSION` / `validateProductSemanticRelation` / `relationKey`）在 C2 后全部为真；§1.4 指出的"证据检查器只到路径存在一层"在 C3 后变为"路径存在 + 跟踪状态 + 两种摘要 + 候选绑定 + 版本绑定"；§6.5 "门禁即消费点"由 C4 的真实入口用例满足。全部四叶产出标 `driven_by: agent`、`actor: chain-driver`。

---

## 0. 基线

| 项 | 值 |
|---|---|
| C4 开工 HEAD / tree | `819d234397b08793763a33c79b536f0195d1e2ad` / `30fa851fb68b706f720a962615eb9c2c72e63377`（即 C3 候选）；`git status --porcelain` 0 行 |
| 上游 | `origin/main` = `2b87c1c44`；本地 main 领先 6 个提交（决策轮 `1090f0b88`、TF-0632 `aebf87169` + `b442f5dd5`、C1 `832aa5ab2`、C2 `2b819e342`、C3 `819d23439`），均未推送 |
| Task Forest（开工时） | `todo --json` 中 stored-status 为 `ready` 的节点恰为 1 个：`TF-0637`；TF-0632 / TF-0634 / TF-0635 / TF-0636 `done`，TF-0633 `proposed`（父节点未被误置）；无标题含 TF-0632…TF-0637 的会话在运行 |
| 执行工具 | Node `v24.22.1`（`process.features.typescript === 'strip'`）；vitest `4.1.1`；临时目录 `D:\tmp\tf0637-c4\`（不入库） |
| 四叶写集互不重叠 | C1 `…/provenance/**`；C2 `shared/product-semantics.ts` + `tests/unit/product-semantics.test.ts` + `…/negatives/**`；C3 `scripts/check-evidence-refs.{mjs,d.mts}` + `tests/unit/evidence-refs-exist.test.ts` + `…/report/**`；C4 `tests/unit/evidence-refs-exist.test.ts`（仅新增 real gate entry 组）+ `docs/clawx-product-semantics.md` + 本文件 + `…/final/**` + `scripts/repository-artifacts.json` + `.gitignore`。三份 README 在写集内但本轮**无改动**（§4.2） |
| 改动前的无参 stdout 捕获 | `node scripts/check-evidence-refs.mjs` → `[evidence-refs] PASS 188 referenced path(s)`，与 `report/default-stdout.expected.txt` 字节相同（`cmp` 退出 0） |

---

## 1. 结论摘要（四叶数字）

| 叶 | 候选 commit / tree | 基线 | 关键数字 |
|---|---|---|---|
| C1 TF-0634 来源 / owner / 消费者清单 | `832aa5ab293cb5bb9d5e2e1e3452fc30c127e445` / `5fcf05dcd50d7568967a346d795bc9f88c875ea6`（3 文件 +327） | `b442f5dd5` | `relations.json`（`ProductSemanticRelationProvenance/v1`）6/6 关系；docBasis 17 条 file:line；enforcingOwner 6/6 定位到代码（R1 `createTaskLoopUpgradeSuggestion`、R2+R3 `task-ledger-plan-projection.ts`、R4 `task-loop-controller.ts ensureTaskLedgerRoot`、R5 `task-ledger-reference.ts`、R6 `routing-memo.ts resolveRoutingMemoAuthority`）；evidenceGrade executed 6 / documented-only 0 / gap 0；消费者 grep 7 行（声明 1 + TF-0632 门禁输入 1 + 测试 5），应用代码（electron/ src/ openclaw_runtime/src/）0 行；`preservation: not-applicable`（porcelain 0 行，未伪造保全哈希）；SHA256SUMS 3 条 `-c` 退出 0；credential-scan 0 命中 |
| C2 TF-0635 合同版本、派生键与可拒绝校验器 | `2b819e342a4d8d9fbf4f48de8a4185d52f94f87d` / `0b10b86d536aa1e2f18ad45c5592396f50b7f42f`（25 文件 +938） | `832aa5ab2` | `shared/product-semantics.ts` +156 / −0（既有导出与常量字节不变）；新增导出 6：`PRODUCT_SEMANTIC_CONTRACT_VERSION = 'ProductSemanticRelations/v1'`、`PRODUCT_SEMANTIC_RELATION_RULES`（**11** 条封闭）、`ProductSemanticRelationDiagnostic`、`relationKey`、`validateProductSemanticRelation`、`validateProductSemanticRelations`；负例 fixture **21**（`ProductSemanticRelationFixture/v1`），伞合同步骤二负例表 8/8 行覆盖、11/11 规则各被预期 rule/field 拒绝；正例 = 活的 6 条关系全部有效；顶层无校验调用；新符号在 electron/ src/ openclaw_runtime/src/ 零引用；vitest product-semantics 40/40 |
| C3 TF-0636 来源摘要、candidate 绑定与报告失效 | `819d234397b08793763a33c79b536f0195d1e2ad` / `30fa851fb68b706f720a962615eb9c2c72e63377`（16 文件 +1325 / −4） | `2b819e342` | 无参 stdout 逐字不变（测试断言）；新增 flag 4（`--report` / `--verify` / `--fixture` / `--actor`）、导出 13；报告 `ProductSemanticEvidenceReport/v1` 15 个顶层键；来源规则 **8** 条封闭且与 11 条关系规则不相交 → `rulesEvaluated` **19**；活注册表报告 6 关系 / 8 来源引用 / 0 诊断；report fixture 8（7 负例 + 1 正例，经真实入口）；`--verify` 篡改用例 20 + 空报告 + 后转未跟踪；vitest evidence-refs-exist 47/47 |
| C4 TF-0637 原生门禁接入、兼容回归与收口 | 见 §11.1（候选提交后回填） | `819d23439` | real gate entry 组 **5** 用例（封闭集 19 + 四负例：坏关系 exit 1 / 陈旧来源 `--verify` exit 1 / 空报告与空壳报告 `--verify` exit 1 / 遗漏调用由 6 关系 + 8 来源引用 + 19 规则断言覆盖）；vitest evidence-refs-exist **52/52**（47 + 5）、product-semantics 40/40、兼容 54/54；`docs/clawx-product-semantics.md` §Typed product relations 新增合同版本段 + **6 行五列表**（+13 行）；三份 README 复核 **no-change**（§4.2）；`final/` 5 个文件（§5）；运行时路径 diff **0** 行 |

四叶合计：六条关系、身份兼容映射、单向字段继承与最终权限 owner 行为不变（每叶兼容单测 54/54）；无新增运行时路径、prompt、routing、tool、approval、storage、UI、默认值或产品锁变化；无新增 package script、Host API、注册表字段、第二真源。

---

## 2. 四叶落点

| 件 | 路径 | 叶 | 说明 |
|---|---|---|---|
| 来源清单 | `harness/specs/fixtures/ontology-lite-existing-contracts/provenance/{relations.json,SHA256SUMS,credential-scan.json}` | C1 | 每条关系：`relationKey`、`docBasis[] {path,line,excerpt}`、`enforcingOwner {path,line,symbol,mechanism}`、`ownerCallSites`、`consumers[]`、`regressionEntry[]`、`evidenceGrade`；`commands[]` 12 条可离线复现；`candidate {commit b442f5dd5, tree bf02d1db2, dirty false}`。文档 docBasis 的行号绑定该候选（C4 的偏移见 §4.3） |
| 合同版本 / 派生键 / 校验器 | `shared/product-semantics.ts` :178–332 | C2 | 纯函数与常量；kind→authorityBoundary 封闭映射以 `as const satisfies Record<ProductSemanticRelationKind, ProductSemanticAuthorityBoundary>` 从既有类型字面量派生（不复制第二份表）；端点词表取活的 `PRODUCT_SEMANTIC_CONCEPTS`；`relationKey` 不可读部分记 `?`；顶层无校验调用 |
| 负例 fixture（规则级） | `harness/specs/fixtures/ontology-lite-existing-contracts/negatives/*.json`（21）+ `SHA256SUMS` + `credential-scan.json` | C2 | `ProductSemanticRelationFixture/v1`：`id`、`candidate`、`context?`、`expect {rule, field}`；由 `tests/unit/product-semantics.test.ts` 逐个送入 `validateProductSemanticRelation(s)` |
| 证据检查器 | `scripts/check-evidence-refs.mjs`、`scripts/check-evidence-refs.d.mts` | C3 | 无参：原行为与输出逐字不变。`--report <path>` 写报告（不覆盖已存在文件）；`--verify <path>` 重算每个 sourceRef 的规范化摘要与原字节摘要、候选 commit/tree、合同版本、规范化策略；`--fixture <json>` 经 `scripts/lib/registry-fixture.mjs` 内存改写、经 `scripts/lib/ts-import-hooks.mjs` 执行 `shared/product-semantics.ts`（复用 TF-0632 的两个 `scripts/lib/*`，未另起加载机制）；`--actor` 缺省 `CLAWX_EVIDENCE_ACTOR` 再 `unknown`，`human` / `real-human` 直接 exit 2。exit 0 有效 / 1 无效 / 2 用法、fixture、加载、I/O 错误（永不是判定结果） |
| 报告 fixture（真实入口） | `harness/specs/fixtures/ontology-lite-existing-contracts/report/{default-stdout.expected.txt,fixtures/*.json(8),sources/*.md(2),SHA256SUMS,credential-scan.json}` | C3 | `ContractCheckFixture/v1`（与 `tests/fixtures/contract-check/*.json` 同 schema）；`default-stdout.expected.txt` 钉住 188 个引用路径 |
| 单测 | `tests/unit/product-semantics.test.ts`（C2）、`tests/unit/evidence-refs-exist.test.ts`（C3 + C4） | C2/C3/C4 | 均在 `vitest.config.ts:145` 的 `tests/unit/**` 内，由 `pnpm test`（CI `.github/workflows/check.yml:88`）消费 |
| 产品语义文档 | `docs/clawx-product-semantics.md` §Typed product relations | C4 | §4.1 |
| 精选最终证据 | `harness/specs/fixtures/ontology-lite-existing-contracts/final/**` | C4 | §5 |
| 本文件 | `docs/dev/architecture-skeleton/CONTRACT-HARDENING.md` | C4 | 经 `scripts/repository-artifacts.json` `retainedFiles`（ASCII 序插入 `CLOSURE-DECISIONS-20261031.md` 之后）+ `node scripts/check-repository-artifacts.mjs --write-ignore` 跟踪 |

---

## 3. C4 原生门禁接入：real gate entry 组

`tests/unit/evidence-refs-exist.test.ts` 新增 `describe('evidence refs check: real gate entry (node scripts/check-evidence-refs.mjs)')`，与 `tests/unit/contract-check.test.ts:386`、`tests/unit/semantic-authority-consistency.test.ts:422` 同形：每个用例 `execFile(process.execPath, ['scripts/check-evidence-refs.mjs', …])` 真实 spawn，断言退出码、stderr 诊断行与回读的报告 JSON。fixture 全部复用 C3 的 `report/fixtures/*.json`，**未**新增第二套 fixture；临时报告写在 `os.tmpdir()`（本机 `D:\tmp`）并在 `afterAll` 删除；工作区由既有用例 `left the working tree as it found it` 断言不变。

| # | 伞合同步骤四负例 | 真实入口调用 | 期望（测试断言） | 本轮 CLI 实测（§11 #7–#13） |
|---|---|---|---|---|
| 1 | 封闭集 | （函数级）`PRODUCT_SEMANTIC_RELATION_RULES` 11 + `SOURCE_DIAGNOSTIC_RULES` 8，并集大小 19 | 规则数固定；新增或删除任一规则即失败 | — |
| 2 | **坏关系** | `--fixture report/fixtures/bad-relation-self-loop.json --report <tmp> --actor vitest-evidence-refs` | exit **1**；stderr `FAIL report invalid: 6 relation(s), 8 source ref(s), 1 diagnostic(s)` + `[self-loop] chat--suggests-upgrade-to--chat to: "chat" cannot relate to itself.`；报告 `status invalid`、`exitCode 1`、`fixtures ['bad-relation-self-loop']`、`relations.length 6`、诊断规则 ∈ 封闭集。再对该报告 `--verify` → exit **1**：`[candidate-mismatch] - fixtures: Report was generated under 1 in-memory fixture mutation(s)` + `[report-field-missing] - status: Report recorded status "invalid"`（负例报告不能被当作候选证据） | exit 1；诊断 1（`self-loop`）；`--verify` exit 1（`candidate-mismatch` + `report-field-missing`） |
| 3 | **陈旧来源** | 先 `--report <tmp>`（exit 0），再 `--fixture report/fixtures/stale-source-rewrite.json --verify <tmp>` | exit **1**；`source-digest-mismatch` 行数 = 引用 `docs/clawx-product-semantics.md` 的关系数 × 2（digest + rawDigest）= 6，每行含该路径与 `the source changed after the report was written`；无 `candidate-mismatch`；报告文件字节不变 | exit 1；6 条 mismatch，全部指向 `docs/clawx-product-semantics.md` |
| 4 | **空报告 / 空壳报告** | `--verify <{}>`；`--verify <relations: [] 的完整报告>` | 空报告 exit **1**、`(15 diagnostic(s))`、15 个顶层键各一条 `[report-field-missing] - <field>:`，文件不被改写；空壳报告 exit **1**、`(1 diagnostic(s))`、`[report-field-missing] - relations: relations records no relation check result.` | exit 1 / 15 条；exit 1 / 1 条 |
| 5 | **遗漏调用** | `--report <tmp> --actor vitest-evidence-refs` 正例 + `--verify` | exit **0**；stdout `report valid: 6 relation(s), 8 source ref(s), 0 diagnostic(s)`；报告 `relations.length === PRODUCT_SEMANTIC_RELATIONS.length === 6` 且 relationKey 序列等于活注册表的 `relationKey()`；sourceRefs 合计 8；`rulesEvaluated` 逐项等于 11 + 8 的封闭集；`status valid`、`exitCode 0`、`diagnostics []`、`unverified []`、`fixtures []`；`--verify` exit 0 且 stdout 形如 `verify valid: … (6 relation(s), 8 source ref(s), candidate <9 hex>)` | exit 0；6 / 8 / 19；`--verify` exit 0 |

"遗漏调用不能 pass"的机械保证：(a) 正例断言 `rulesEvaluated` 与封闭集逐项相等——若 `buildEvidenceReport` 不再调用 C2 校验器或不再评估来源规则，列表长度或内容即变；(b) 断言 `relations.length === 6`——跳过关系枚举得不到 6；(c) `--verify` 对 `relations: []` 判 `report-field-missing`（#4 空壳报告）；(d) 坏关系负例（#2）证明校验器确实被真实入口调用。消费点是 CI 已执行的 `pnpm test`（`vitest.config.ts:145` 含 `tests/unit/**`）；未改 `package.json`、未追加 `harness:ci`。

---

## 4. 文档与 README 复核

### 4.1 `docs/clawx-product-semantics.md` §Typed product relations

保留原段落（关系是有向元数据边，不是权限 / 逆边 / 传递事实，不是本体 / 图库 / 推理 / 运行时 / prompt 注入），新增：

- 合同版本段：`PRODUCT_SEMANTIC_CONTRACT_VERSION = 'ProductSemanticRelations/v1'`；`relationKey` = `${from}--${kind}--${to}`、无 ID 服务；校验器与 11 条关系规则；检查器 `--report` / `--verify` 与 8 条来源规则（逐条列出）；"metadata-only、无运行时读取、通过不授予任何 grant、owner 保留真实权威"；消费点 `pnpm test` → 两个单测；对所有行都适用的形状规则（`unknown-*` ×3、`self-loop`、`duplicate-relation`、`missing-evidence`、`forged-grant-field` 及其示例键、`unsupported-contract-version`）。
- 五列表 6 行。文档为英文，列名与实现合同的对应：关系 → `Relation (relationKey → authority boundary)`；定义 → `Definition`；守的规则 → `Guarded rule (enforcing owner)`（取 C1 `enforcingOwner.symbol` + 文件，不写行号）；为什么存在 → `Why it exists`；拒绝项 → `Rejected by`（该行特有的 C2 规则 + 对应负例 fixture 名；通用形状规则在表前一次说明）。
- 收尾段指向 `provenance/relations.json`（含行锚点与候选）、`negatives/`、`report/fixtures/`、`final/`。
- `Last updated` 2026-10-22 → 2026-11-01。

六行与 C1 清单逐条同源：R1 `createTaskLoopUpgradeSuggestion`（`shared/product-semantics.ts`，现 :859；`src/pages/Chat/task-loop-upgrade.ts:74` 唯一调用点）；R2/R3 `buildProjectionMetadata` / `isReadOnlyTaskLedgerProjection`（`src/lib/task-ledger-plan-projection.ts:115/142`，共享 owner 为设计事实）；R4 `ensureTaskLedgerRoot` / `recordTaskLoopCheckpoint`（`openclaw_runtime/src/agents/task-loop-controller.ts:3380/2803`，`Cannot start /loop without a Task Ledger root` :3397/:3403）；R5 `createTaskLedgerReference` / `isTaskLedgerReference` / `TASK_LEDGER_REFERENCE_INHERITANCE`（`shared/types/task-ledger-reference.ts:14/32`，direction 字面量 :2/:25/:38）；R6 `resolveRoutingMemoAuthority`（`openclaw_runtime/src/agents/routing-memo.ts:143`，`task_loop_verified_scorecard` :157、`missing-scorecard-quality` :173）。以上行号为 C4 开工 HEAD `819d23439` 上 `grep -n` 的读数（§7.6）。

### 4.2 三份 README 复核结论：**no-change**

| README | 引用处 | 复核 |
|---|---|---|
| `README.md` | :64 "See the default configuration matrix, product semantics and capability claims before changing a default or making a release claim"；:238 文档索引行 `[Product semantics](docs/clawx-product-semantics.md)`；:248 贡献规则"update the product semantics/default matrix when applicable" | 三处均为指向 `docs/clawx-product-semantics.md` 的路径与阅读义务，路径未变、义务未变；本轮正是对产品语义文档的一次更新，满足 :248 的规则而非改变它 |
| `README.zh-CN.md` | :64、:238、:248（同三处的中文） | 同上 |
| `README.ja-JP.md` | :64、:236、:246（同三处的日文） | 同上 |

不改的理由（docs-sync 规则的触发条件未满足）：本轮无用户可见功能、默认值、接口、Host API、UI、入口或行为变化——`git diff --stat HEAD -- electron/ src/ openclaw_runtime/ package.json` 为 0 行（§11 #16）；新增的是 L2+L5 层的静态合同与门禁，其用户面入口仍是 README 已指向的产品语义文档。`README.ru-RU.md`（:64、:236、:246 同三处）一并复核结论相同，但它不在实现合同 C4 行的写集内，本轮未触碰。

### 4.3 对 C1 清单行锚点的影响（历史不回写）

§4.1 在第 13 行之后插入 13 行，`docs/clawx-product-semantics.md` 从 366 行变为 379 行。C1 `provenance/relations.json` 对该文档的 `docBasis` 行号绑定其候选 `b442f5dd5`：第 9、13 行（在插入点之前）在 C4 候选上不变；第 299 → 312（Workboard 行）、317 → 330（`TaskLedgerReference` 单向句）、337 → 350（Chat Plan 行），偏移 +13，`excerpt` 文本逐字可在新行号找到（§7.6 的 `grep -n` 读数）。C1 清单**原封保留**（伞合同步骤三"历史哈希、候选与 verdict 不被回写"）；读者按清单内 `candidate.commit` 检出即得原行号。`report/fixtures/stale-source-rewrite.json` 对该文档用 `append`（非 `find`），不受影响；`source-line-endings.json` 的 `find` 目标在 `shared/product-semantics.ts`，不受影响；`default-stdout.expected.txt` 只统计五个 `shared/*.ts` 与 `package.json` scripts 中的路径，文档改动不改变 188。

---

## 5. `final/` 精选最终证据

目录 `harness/specs/fixtures/ontology-lite-existing-contracts/final/`（普通跟踪路径，不在 `docs/**` 忽略范围内）：

| 文件 | 内容 | 生成方式 |
|---|---|---|
| `evidence-report.json` | `ProductSemanticEvidenceReport/v1`：合同版本、6 条关系键与 8 个来源引用（exists / insideRoot / tracked / symlinkEscape / digest / rawDigest）、`candidate {commit, tree, dirty: false, dirtyPaths: []}`、`actor {driven_by: 'agent', actor: 'chain-driver'}`、`command`（相对路径，不含本机绝对路径）、`exitCode 0`、`rulesEvaluated` 19、`diagnostics []`、`unverified []`、`status 'valid'` | 在 C4 候选提交后的**干净**工作区运行 `node scripts/check-evidence-refs.mjs --report harness/specs/fixtures/ontology-lite-existing-contracts/final/evidence-report.json --actor chain-driver`（§11.1） |
| `gates.json` | 本叶全部门禁命令、退出码、关键输出与本地日志索引（`D:\tmp\tf0637-c4\`，不入库）；四个真实入口负例的诊断摘要；候选 commit / tree | 由 §11 / §11.1 的读数手工转录为 JSON，`driven_by: agent`、`actor: chain-driver` |
| `limitations.json` | 本叶与四叶合计的明确限制（§10）与 `not-run` 清单 | 同上 |
| `credential-scan.json` | `ProvenanceCredentialScan/v1`：对 `final/` 其余文件 + 本叶改动的源文件做字面凭据模式扫描（与 C1–C3 相同的 look-behind 模式；`grep -P` 退出 1 = 无命中；自测 2/2） | 扫描在 SHA256SUMS 之前运行，`excluded` 记录两者 |
| `SHA256SUMS` | `final/` 内除自身外每个文件的 SHA-256（`sha256sum` 文本模式，两空格），`sha256sum -c` 退出 0 | 最后生成 |

**候选绑定的必然后果（设计行为，非缺陷）**：报告绑定的是它生成时的 HEAD（C4 候选提交 `C4₁`）。把报告提交进仓库必然产生一个新的 HEAD（`C4₂`，仅证据回填），因此在 `C4₂` 及之后任何 HEAD 上对 `final/evidence-report.json` 运行 `--verify` 都会且只会得到两条 `candidate-mismatch`（`candidate.commit`、`candidate.tree`）并 exit 1——来源摘要、合同版本、规范化策略与其余字段全部仍然匹配，因为 `C4₂` 不改任何被引用的来源文件。这正是 C3 让"陈旧候选不能被当作当前通过"成立的机制在起作用；一个能在自己所在提交上 `--verify` 通过的报告在逻辑上不可能存在（报告无法包含含有它自己的 tree 的哈希）。要得到 exit 0 的复核，在报告记录的候选上运行检查器（§7.5 用分离 worktree 复现，不动分支引用）。TF-0632 的 `AUTHORITY-VALIDATOR.md` §11.1 采用了同样的"候选提交 + 仅证据回填提交"两步形态。

---

## 6. 不变量（四叶均未改）

- `electron/**`、`src/**`、`openclaw_runtime/**`、`package.json`：每叶 `git diff --stat <base>..<candidate>` 0 行；C4 本轮 `git diff --stat HEAD -- electron/ src/ openclaw_runtime/ package.json` 0 行（§11 #16）。
- `shared/` 除 `product-semantics.ts` 外的注册表、`scripts/contract-check*`、`scripts/check-semantic-authority*`（TF-0632 产物，只消费其 `scripts/lib/*`）：0 字节改动；C4 对 `shared/` 整体亦 0 行。
- `shared/product-semantics.ts` 既有导出与常量字节不变（C2 diff 只含新增块 +156 / −0；C3、C4 未触碰该文件）。
- `scripts/check-evidence-refs.mjs` 无参 stdout / stderr / exit 逐字不变（C3、C4 测试断言；C4 开工与收口两次 `cmp` 均相同）。
- 无新增 package script（`repo:evidence:check` 仍为 `node scripts/check-evidence-refs.mjs`）、Host API、UI、运行时组件、第二真源、RDF/OWL/SHACL/PROV 运行时、图库、推理或遍历。
- 产品锁（`live_ready` / `product_approved` / `default_on`）、默认矩阵、发布状态、GA 口径未改。
- 身份兼容映射、单向字段继承、最终权限 owner 行为不变：`tests/unit/identity-scope.test.ts`、`task-ledger-reference.test.ts`、`task-ledger-reference-inheritance.test.ts`、`permission-effect-contract.test.ts` 在每叶候选上 54/54。
- 历史产物不回写：C1 清单、C2 负例、C3 报告 fixture 与各自的 SHA256SUMS / credential-scan 在 C4 中零字节改动（§4.3）。
- 分支 `codex/ontology-contracts` 未合并、未 cherry-pick（C2 只参考命名形状，名称以实现合同为准）。

---

## 7. 复现命令（离线，仓库根目录，Git Bash；临时目录 `D:\tmp`）

```bash
# 7.1 基线与四叶候选
git rev-parse HEAD; git rev-parse 'HEAD^{tree}'; git status --porcelain | wc -l
for c in 832aa5ab2 2b819e342 819d23439; do echo "$c $(git rev-parse $c^{tree}) $(git show --stat --format= $c | tail -1)"; done
```

```bash
# 7.2 单测（含 real gate entry 组）与兼容回归
export TEMP='D:/tmp' TMP='D:/tmp'
pnpm exec vitest run tests/unit/product-semantics.test.ts tests/unit/evidence-refs-exist.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/tmp/tf0637-c4/vitest-c4.json
node -e "const r=require('D:/tmp/tf0637-c4/vitest-c4.json');console.log(r.numTotalTests,r.numFailedTests,r.success)"   # → 92 0 true
pnpm exec vitest run tests/unit/identity-scope.test.ts tests/unit/task-ledger-reference.test.ts tests/unit/task-ledger-reference-inheritance.test.ts tests/unit/permission-effect-contract.test.ts --maxWorkers=1   # → 54 passed
```

```bash
# 7.3 真实入口：四负例 + 正例（与 §3 同形；报告写到 D:/tmp，不入库）
F=harness/specs/fixtures/ontology-lite-existing-contracts/report/fixtures; R=D:/tmp/tf0637-c4/real-entry; mkdir -p $R
node scripts/check-evidence-refs.mjs --fixture $F/bad-relation-self-loop.json --report $R/bad-relation.json --actor chain-driver; echo "exit=$?"   # → 1, [self-loop]
node scripts/check-evidence-refs.mjs --verify $R/bad-relation.json; echo "exit=$?"                                                                 # → 1, [candidate-mismatch] + [report-field-missing]
node scripts/check-evidence-refs.mjs --report $R/positive.json --actor chain-driver; echo "exit=$?"                                                # → 0, 6 relation(s), 8 source ref(s), 0 diagnostic(s)
node scripts/check-evidence-refs.mjs --verify $R/positive.json; echo "exit=$?"                                                                     # → 0
node scripts/check-evidence-refs.mjs --fixture $F/stale-source-rewrite.json --verify $R/positive.json 2>&1 | grep -c source-digest-mismatch         # → 6 ; exit 1
printf '{}\n' > $R/empty.json; node scripts/check-evidence-refs.mjs --verify $R/empty.json 2>&1 | grep -c report-field-missing                       # → 15 ; exit 1
node -e "const r=require('$R/positive.json'); r.relations=[]; require('fs').writeFileSync('$R/hollow.json', JSON.stringify(r,null,2)+'\n')"
node scripts/check-evidence-refs.mjs --verify $R/hollow.json; echo "exit=$?"                                                                       # → 1, relations records no relation check result
```

```bash
# 7.4 无参默认行为逐字不变 + 门禁
node scripts/check-evidence-refs.mjs > D:/tmp/tf0637-c4/default.txt; cmp D:/tmp/tf0637-c4/default.txt harness/specs/fixtures/ontology-lite-existing-contracts/report/default-stdout.expected.txt && echo identical
pnpm repo:evidence:check; node scripts/check-repository-artifacts.mjs; node scripts/check-local-paths.mjs; pnpm harness:specs:lifecycle; pnpm docs:policy:validate
pnpm harness validate --spec harness/specs/tasks/ontology-lite-contract-implementation.md --since HEAD
pnpm exec eslint tests/unit/evidence-refs-exist.test.ts; node scripts/check-no-bom.mjs; git diff --check
git diff --stat HEAD -- electron/ src/ openclaw_runtime/ package.json | wc -l    # → 0
```

```bash
# 7.5 final/ 报告：在其记录的候选上 --verify（期望 exit 0）；在后续 HEAD 上 --verify（期望恰两条 candidate-mismatch，exit 1）
cd harness/specs/fixtures/ontology-lite-existing-contracts/final && sha256sum -c SHA256SUMS && cd -
C=$(node -p "require('./harness/specs/fixtures/ontology-lite-existing-contracts/final/evidence-report.json').candidate.commit")
git worktree add --detach D:/tmp/tf0637-c4/wt "$C" && node D:/tmp/tf0637-c4/wt/scripts/check-evidence-refs.mjs --verify "$PWD/harness/specs/fixtures/ontology-lite-existing-contracts/final/evidence-report.json"; echo "exit=$?"   # → 0
git worktree remove D:/tmp/tf0637-c4/wt
node scripts/check-evidence-refs.mjs --verify harness/specs/fixtures/ontology-lite-existing-contracts/final/evidence-report.json; echo "exit=$?"   # 在 C4₂ 及之后：exit 1，且诊断恰为 candidate.commit / candidate.tree 两条
```

```bash
# 7.6 文档行锚点读数（§4.1 / §4.3）
grep -nE "export function createTaskLoopUpgradeSuggestion" shared/product-semantics.ts                       # 859
grep -nE "readonlyProjection: true|export function isReadOnlyTaskLedgerProjection" src/lib/task-ledger-plan-projection.ts   # 115 / 142
grep -nE "Cannot start /loop without a Task Ledger root|async function recordTaskLoopCheckpoint" openclaw_runtime/src/agents/task-loop-controller.ts   # 2803 / 3397 / 3403
grep -nE "export function (createTaskLedgerReference|isTaskLedgerReference)" shared/types/task-ledger-reference.ts   # 14 / 32
grep -nE "function resolveRoutingMemoAuthority|missing-scorecard-quality\"" openclaw_runtime/src/agents/routing-memo.ts   # 143 / 173
wc -l docs/clawx-product-semantics.md                                                                        # 379（C3 候选上为 366）
grep -nE "^\| Workboard \| Runtime/plugin scheduling board|^- \`TaskLedgerReference\` is one-way|^\| Chat Plan \| P1-01, P1-02" docs/clawx-product-semantics.md   # 312 / 330 / 350
```

---

## 8. 验收逐条对照

### 8.1 伞合同 `ontology-lite-existing-contracts-hardening.md` frontmatter `acceptance`（7 条）

| # | 验收条 | 状态 | 证据位置 |
|---|---|---|---|
| 1 | 六条既有关系有逐条来源、实际 owner、已有消费者与回归入口映射；无法从执行路径证实的如实标 documented-only 或 gap | 达成 | C1 `provenance/relations.json` 6/6，evidenceGrade executed 6（每条 owner 定位到代码与行号并给出 mechanism；R6 的"同 session receipt 只能由服务端解析"写在 notes，未冒充运行时证据） |
| 2 | 独立正负 fixture 经同一确定性入口；错误组合、反向任务权威、语义元数据冒充授权均被定位并拒绝 | 达成 | C2 21 个负例经 `validateProductSemanticRelation(s)`，8/8 行、11/11 规则；`kind-boundary-mismatch`（组合）、`reverse-task-authority`（反向）、`forged-grant-field`（冒充授权）各有 fixture；诊断含 `relationKey / field / rule / message` |
| 3 | 合同版本、关系派生键、来源摘要、candidate commit/tree、实际 actor、命令与退出码可回读；陈旧来源、不支持版本、越界或未跟踪引用不能冒充当前候选的有效证据 | 达成 | C3 报告 15 键；来源规则 8 条；真实入口负例 `source-missing` / `source-outside-root` / `source-untracked` / `source-symlink-escape` / `version-unsupported` 各 exit 1；`--verify` 对摘要 / 候选 / 版本 / 策略 / 缺字段 / fixture 出身共 20 篡改用例 + 空报告判 invalid |
| 4 | 检查接入已有 Harness/Vitest/evidence 路径，门禁集成负例证明遗漏调用、空报告或坏例不能产生有效 pass | 达成 | C4 §3：`pnpm test` 路径的 vitest spawn 真实入口；坏关系 exit 1、陈旧来源 exit 1、空报告 / 空壳报告 exit 1、遗漏调用由 6 / 8 / 19 断言覆盖；§11 #7–#13 的 CLI 实测与之一致；`repo:evidence:check` 原覆盖（188 路径）不退化 |
| 5 | 现有六条关系、身份兼容映射、单向字段继承及最终权限 owner 保持原行为；无新的关系值消费路径、prompt、routing、tool、approval、storage 或 UI 行为 | 达成 | §6；兼容 54/54（C2、C3、C4 各一次）；C2 静态 grep 新符号在 electron/ src/ openclaw_runtime/src/ 0 行；C1 消费者扫描应用代码 0 行；运行时路径 diff 0 行 |
| 6 | 产品语义与三份 README 完成声明复核；没有新增企业本体、SHACL/PROV 合规实现、任务收益、采用率或 GA 声明 | 达成 | §4.1（文档只增加合同版本与五列表，明文"metadata-only、grants nothing"）；§4.2（三份 README no-change 及理由）；本文件与 `final/limitations.json` 不作任何收益 / 采用率 / GA 声明 |
| 7 | 每个实施节点以新干净候选、磁盘回读、哈希清单、凭据扫描和明确限制收口；不改历史候选或 verdict，不以 `--no-diff` 结构通过代替实现验收 | 达成 | 四叶各自干净候选（§1）；每叶目录含 SHA256SUMS（`-c` 退出 0）与 credential-scan.json（0 命中）；本轮 `harness validate` 一律带 diff（`--since HEAD`，§11 #22），未使用 `--no-diff`；历史产物零字节改动（§4.3、§6）；限制见 §10 与 `final/limitations.json` |

### 8.2 实现合同 `ontology-lite-contract-implementation.md` frontmatter `acceptance`（5 条）

| # | 验收条 | 状态 | 证据位置 |
|---|---|---|---|
| C1 | 六条关系各有 relationKey、文档依据 file:line、enforcing owner file:line 或 documented-only、消费者清单、回归入口与证据等级；JSON + SHA256SUMS；计数命令写在清单内 | 达成 | `provenance/relations.json`：`commands[]` 12 条、`summary`、`consumerScan`；SHA256SUMS 3 条 |
| C2 | 导出 `PRODUCT_SEMANTIC_CONTRACT_VERSION`、`relationKey`、`validateProductSemanticRelation(s)` 与封闭规则集；六条通过；每类负例由预期规则拒绝并给出 relationKey / field / rule / message；模块无导入时执行；新符号在 electron、src、openclaw_runtime 零消费者 | 达成 | `shared/product-semantics.ts:178–332`；`tests/unit/product-semantics.test.ts` 40/40（含顶层无调用的静态断言与 grep 回读）；名称逐字按合同"最小形状" |
| C3 | 默认行为不变前提下新增 `--report` 与 `--verify`，报告记录合同版本、关系键、来源引用及跟踪状态与规范化摘要、candidate、actor、命令、退出码与诊断；删除 / 移动 / 越界 / 未跟踪 / symlink escape、摘要 / 候选 / 版本不匹配、缺字段均使 `--verify` invalid 且 exit 非 0 | 达成 | `scripts/check-evidence-refs.mjs`；`default-stdout.expected.txt` 逐字断言；47 用例 |
| C4 | 坏关系、陈旧来源、空报告、遗漏调用经真实入口各自失败；产品语义文档补关系五列表与合同版本；三份 README 按 docs-sync 复核并记录结论；精选最终证据含新干净 candidate、SHA256SUMS、凭据扫描与限制 | 达成 | §3（5 用例 + CLI 实测）；§4.1；§4.2；§5 + §11.1 |
| 合计 | 六条关系、身份兼容映射、单向字段继承与最终权限 owner 行为不变；无新增运行时路径、prompt、routing、tool、approval、storage、UI、默认值或产品锁变化 | 达成 | §6 |

### 8.3 TF-0637 `acceptance_criteria`（4 条）

| # | 条 | 状态 | 证据 |
|---|---|---|---|
| 1 | real gate entry 组对坏关系（exit 1）、陈旧来源（`--verify` exit 1）、空报告（缺字段报告 `--verify` exit 1）、遗漏调用（断言 relations.length 与规则集）各有用例，vitest JSON 回读 `numFailedTests === 0` | 达成 | §3；`D:\tmp\tf0637-c4\vitest-c4.json` `numTotalTests 92 / numFailedTests 0 / success true`（§11 #3；§11.1 在干净候选上复跑） |
| 2 | `docs/clawx-product-semantics.md` §Typed product relations 含合同版本与五列表；三份 README 复核结论（含 no-change 理由）写入本文件 | 达成 | §4.1、§4.2 |
| 3 | `final/` 含最终报告、SHA256SUMS、credential-scan.json 与限制清单；本文件含证据链与验收逐条对照，并经 retainedFiles + `--write-ignore` 跟踪 | 达成 | §5、§8、§11；`scripts/repository-artifacts.json` + `.gitignore`（§11 #17–#18） |
| 4 | `git diff --stat` 对 electron/、src/、openclaw_runtime/、package.json 为 0 行；`pnpm repo:evidence:check` 原覆盖不退化；未运行的全量门禁如实记 not-run | 达成 | §11 #16（0 行）、#5–#6（188 路径、exit 0）；§10 not-run 清单 |

---

## 9. 边界声明

- 本文件记录实现与证据，不改变任何裁定、产品锁、默认矩阵、发布状态或 GA 口径；"metadata-only"的校验通过不构成运行时效果证据，更不构成真人证据（宪章 §6.4 三者不互相冒充）。
- 校验器与检查器只读；fixture 改写只在内存；报告写到调用方指定路径。`final/evidence-report.json` 是唯一入库的报告，其候选绑定语义见 §5。
- 未新增 Electron 交互用例、后端通信、prompt / 执行变更；若后续出现此类变化，属 `gateway-backend-communication` 等其它 spec 的范围，不能以本轮绿灯替代。
- 全部产出为 agent 驱动（`driven_by: agent`，`actor: chain-driver`）；没有真人操作、真人数据或真人 verdict 参与；没有任何以真人为前置的验收条件（AGENTS.md §Human-in-the-loop policy）。
- 本文件不声称任何性能、收益、采用率或任务成功率。

---

## 10. 残余风险、限制与未做

| 项 | 性质 | 去向 |
|---|---|---|
| `pnpm run typecheck` exit 1 = node 0 / web 0 / **test 2**：唯一错误 `tests/unit/contract-check.test.ts(171,30): TS7006`（TF-0630 `fd2d93a41` 引入，批次 A 写集），C2 / C3 / C4 三叶均复现且不在任何批次 C 叶的写集内；本叶改动文件 0 错误 | 既有红，非本叶引入；不得解读为通过 | 批次 A 文件的后续修订 |
| `pnpm harness validate --spec …`（无 `--since`）exit 1：默认 diff 基 `origin/main`（`2b87c1c44`）到 HEAD 含决策轮与 TF-0632 的非本 spec 文件 | 环境态（上游未推送），`--since HEAD` 为 CLOSURE-DECISIONS §4.3 规定口径并通过 | 链条收尾推送后消失 |
| `final/evidence-report.json` 在 `C4₂` 及之后 HEAD 上 `--verify` 必为 exit 1（两条 `candidate-mismatch`） | 设计行为（§5）；在其候选上 exit 0（§7.5） | 无 |
| C1 清单对 `docs/clawx-product-semantics.md` 的 3 个行锚点在 C4 候选上偏移 +13 | 历史产物按其候选解读；未回写 | §4.3 已记录映射 |
| `default-stdout.expected.txt` 钉住 188 个引用路径 | 五个 evidence 文件新增路径引用时须同步更新该 fixture（逐字不变合同的显式成本） | 届时同步 |
| 五列表的"守的规则"只引用 symbol 与文件，不引用行号 | 文档稳定性优先；行号在 C1 清单（绑定候选）与 §4.1（绑定 `819d23439`）中 | 无 |
| `README.ru-RU.md` 复核结论相同但不在写集 | 未触碰 | 若 README 规则要求四语同步，另开节点处理写集 |
| 报告只对 `shared/product-semantics.ts` 的六条关系与其 `evidenceRefs` 做绑定；不覆盖其它注册表 | 伞合同范围 | 批次 D 或后续节点 |
| **not-run**（如实记录，不得解读为通过） | `pnpm test` 全量、E2E（含 `tests/e2e/chat-task-loop-upgrade.spec.ts`）、`pnpm run lint` 全仓（只对本叶改动的 `.ts` 跑 eslint + `check-no-bom`）、`pnpm agent-dev:*`、`pnpm harness run --spec … --dry-run`、`pnpm contract:check`（本叶未改其输入；TF-0632 收口时 exit 0）、任何 live provider / Gateway / 真实 session receipt | — |

---

## 11. 证据链

以下命令于 2026-11-01（Asia/Shanghai；日志时间戳 UTC `2026-10-31T20:49Z` 起）在 HEAD `819d23439`、工作区含本叶未提交改动（`tests/unit/evidence-refs-exist.test.ts`、`docs/clawx-product-semantics.md`、`scripts/repository-artifacts.json`、本文件、`.gitignore`）上运行；退出码由 shell 直接捕获，日志在 `D:\tmp\tf0637-c4\{gates.log,gates2.log,vitest-c4.json,vitest-compat.json,typecheck.log,eslint.log,real-entry/}`（本地保留，不入库；`final/gates.json` 收录其索引）。

| # | 命令 | exit | 关键输出 |
|---|---|---|---|
| 1 | `pnpm harness context --spec harness/specs/tasks/ontology-lite-contract-implementation.md` | 0 | 最小阅读清单（rules: `context-family-boundary` / `contract-first-boundary` / `docs-sync` / `identity-scope-boundary` / `repository-artifact-retention` / `task-forest-autoclose-and-roles`；layer `harness`） |
| 2 | `pnpm harness context --spec harness/specs/tasks/ontology-lite-existing-contracts-hardening.md` | 0 | 最小阅读清单 |
| 3 | `pnpm exec vitest run tests/unit/product-semantics.test.ts tests/unit/evidence-refs-exist.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/tmp/tf0637-c4/vitest-c4.json` | 0 | `numTotalTests 92, numFailedTests 0, success true`（product-semantics 40 + evidence-refs-exist 52 = 47 + real gate entry 5） |
| 4 | `pnpm exec vitest run tests/unit/identity-scope.test.ts tests/unit/task-ledger-reference.test.ts tests/unit/task-ledger-reference-inheritance.test.ts tests/unit/permission-effect-contract.test.ts --maxWorkers=1` | 0 | `numTotalTests 54, numFailedTests 0` |
| 5 | `node scripts/check-evidence-refs.mjs` | 0 | stdout `[evidence-refs] PASS 188 referenced path(s)`，stderr 0 字节，与 `report/default-stdout.expected.txt` `cmp` 相同 |
| 6 | `pnpm repo:evidence:check` | 0 | 同 #5 |
| 7 | `node scripts/check-evidence-refs.mjs --fixture report/fixtures/bad-relation-self-loop.json --report D:/tmp/tf0637-c4/real-entry/bad-relation.json --actor chain-driver` | **1** | 诊断 1：`[self-loop] chat--suggests-upgrade-to--chat to: "chat" cannot relate to itself.`；报告已写，`fixtures ['bad-relation-self-loop']` |
| 8 | `node scripts/check-evidence-refs.mjs --verify D:/tmp/tf0637-c4/real-entry/bad-relation.json` | **1** | `[candidate-mismatch] - fixtures`、`[report-field-missing] - status`（负例报告不能冒充候选证据） |
| 9 | `node scripts/check-evidence-refs.mjs --report D:/tmp/tf0637-c4/real-entry/positive.json --actor chain-driver` | 0 | `report valid: 6 relation(s), 8 source ref(s), 0 diagnostic(s)`；`relations 6`、`rulesEvaluated 19`、`candidate.dirty true`（提交前的开发树；§11.1 在干净候选上重取为 `false`） |
| 10 | `node scripts/check-evidence-refs.mjs --verify D:/tmp/tf0637-c4/real-entry/positive.json` | 0 | `verify valid: … (6 relation(s), 8 source ref(s), candidate 819d23439)` |
| 11 | `node scripts/check-evidence-refs.mjs --fixture report/fixtures/stale-source-rewrite.json --verify D:/tmp/tf0637-c4/real-entry/positive.json` | **1** | `source-digest-mismatch` 6 条，全部指向 `docs/clawx-product-semantics.md`；无 `candidate-mismatch` |
| 12 | `printf '{}\n' > empty.json; node scripts/check-evidence-refs.mjs --verify empty.json` | **1** | 诊断 15，全部 `report-field-missing`（15 个顶层键各一条） |
| 13 | `relations: []` 的完整报告 `--verify` | **1** | 诊断 1：`[report-field-missing] - relations: relations records no relation check result.` |
| 14 | `pnpm run typecheck` | **1** | `typecheck:node` 0（28.4 s）、`typecheck:web` 0（9.6 s）、`typecheck:test` **2**（28.0 s）：`artifacts/typecheck-cache/test-typecheck-errors.log` 1 行 = `tests/unit/contract-check.test.ts(171,30): error TS7006`（既有，§10）；本叶改动文件 0 错误 |
| 15 | `pnpm exec eslint tests/unit/evidence-refs-exist.test.ts`；`node scripts/check-no-bom.mjs` | 0 / 0 | 0 error 0 warning |
| 16 | `git diff --stat HEAD -- electron/ src/ openclaw_runtime/ package.json \| wc -l`；`git diff --stat HEAD -- shared/ scripts/check-evidence-refs.mjs scripts/contract-check.mjs scripts/check-semantic-authority.mjs \| wc -l` | 0 / 0 | `0` / `0` |
| 17 | `node scripts/check-repository-artifacts.mjs --write-ignore`（本文件写入、`retainedFiles` 已插入后） | 1 → 0 | 首次 exit 1：`Reviewed input is not tracked: docs/dev/architecture-skeleton/CONTRACT-HARDENING.md`（文件尚未暂存，预期）；`.gitignore` 新增 1 行 `!/docs/dev/architecture-skeleton/CONTRACT-HARDENING.md`（:1448）；普通 `git add`（无 `-f`）后重跑 exit 0，再次 `--write-ignore` 幂等（`.gitignore` numstat 仍 1 / 0） |
| 18 | `node scripts/check-repository-artifacts.mjs`；`pnpm repo:artifacts:check`（暂存后） | 0 / 0 | `Repository artifact retention passed (20052 tracked paths).` |
| 19 | `node scripts/check-local-paths.mjs` | 0 | `[local-paths] PASS active docs contain no developer-local absolute paths` |
| 20 | `pnpm harness:specs:lifecycle` | 0 | `[specs] lifecycle status present for 686 task specs.` |
| 21 | `pnpm docs:policy:validate` | 0 | `[policy-docs] PASS: 10 checks` |
| 22 | `pnpm harness validate --spec harness/specs/tasks/ontology-lite-contract-implementation.md --since HEAD` | 0 | `Spec is valid: harness\specs\tasks\ontology-lite-contract-implementation.md`（CLOSURE-DECISIONS §4.3 规定的未提交改动口径；本叶 5 个改动路径全部在 `ownedPaths` 内） |
| 23 | `pnpm harness validate --spec harness/specs/tasks/ontology-lite-contract-implementation.md`（无 `--since`） | **1** | `changed files are not covered by touchedAreas or ownedPaths:` 列出的全部是 `origin/main`（`2b87c1c44`）到 HEAD 之间决策轮 `1090f0b88` 与 TF-0632 `aebf87169` / `b442f5dd5` 的文件（`CHARTER.md`、`OPERATOR-PLAN-20261031.md`、`AUTHORITY-RECONCILIATION.md`、`AUTHORITY-VALIDATOR.md`、`dsh-superagent-absorption-20261031.md`、`architecture-skeleton-authority-validator.md`、`scripts/check-semantic-authority*`、`scripts/lib/*`、`tests/fixtures/semantic-authority/**`、`tests/unit/semantic-authority-consistency.test.ts`）；**无一**是本叶写集。环境态（上游未推送），与 TF-0632 §11 #2 同因 |
| 24 | `pnpm harness validate --spec harness/specs/tasks/ontology-lite-existing-contracts-hardening.md --since HEAD` | **1** | 未覆盖恰为 `.gitignore`、`docs/dev/architecture-skeleton/CONTRACT-HARDENING.md`、`scripts/repository-artifacts.json`——三者在实现合同 `ownedPaths` 内、不在伞合同 `touchedAreas` 内；跨 spec 的结构性结果（每个 spec 只覆盖自己的写集，CLOSURE-DECISIONS §5），不是合同缺口；伞合同自身的 `requiredTests` 由 #1–#6、#14、#18、#20、#21、#25 覆盖 |
| 25 | `git diff --check` | 0 | 无输出 |

#3–#13 在 `docs/clawx-product-semantics.md` 改动**之后**运行（§4.1 的 +13 行已在树上），因此 #11 的 6 条 `source-digest-mismatch` 与 #9 / #10 的摘要都是对改动后文档的读数。

### 11.1 候选提交后复核与 `final/` 生成

C4 候选提交 **`6944b059cd5deda27c39e59cc1bb95042712f153`**（tree `582054179acfbdba7dd77fe7cba91074713da2cf`；5 文件 +397 / −1；基于 `819d23439`；显式 pathspec：`tests/unit/evidence-refs-exist.test.ts`、`docs/clawx-product-semantics.md`、本文件、`scripts/repository-artifacts.json`、`.gitignore`）。提交后 `git status --porcelain` 0 行，在该干净候选上运行：

| # | 命令（HEAD `6944b059c`） | exit | 关键输出 |
|---|---|---|---|
| 26 | `node scripts/check-evidence-refs.mjs --report harness/specs/fixtures/ontology-lite-existing-contracts/final/evidence-report.json --actor chain-driver` | 0 | `report valid: 6 relation(s), 8 source ref(s), 0 diagnostic(s) -> harness/specs/fixtures/ontology-lite-existing-contracts/final/evidence-report.json`；stderr 0 字节（无 dirty 提示）；报告 `candidate.commit 6944b059c…`、`candidate.tree 582054179…`、**`dirty false`**、`dirtyPaths []`、`actor {driven_by: 'agent', actor: 'chain-driver'}`、`command` 全为相对路径、`exitCode 0`、`status valid`、15 键、`rulesEvaluated` 19、`relations` 6 / `sourceRefs` 8、`diagnostics []`、`unverified []`、`fixtures []` |
| 27 | `node scripts/check-evidence-refs.mjs --verify harness/specs/fixtures/ontology-lite-existing-contracts/final/evidence-report.json`（同一 HEAD） | 0 | `verify valid: … (6 relation(s), 8 source ref(s), candidate 6944b059c)` |
| 28 | `pnpm exec vitest run tests/unit/product-semantics.test.ts tests/unit/evidence-refs-exist.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/tmp/tf0637-c4/vitest-c4-candidate.json` | 0 | `numTotalTests 92, numFailedTests 0, success true` |
| 29 | `node scripts/check-evidence-refs.mjs` | 0 | `[evidence-refs] PASS 188 referenced path(s)`，与钉住的 fixture `cmp` 相同 |
| 30 | `final/limitations.json`、`final/gates.json` 写入（§5；由 #1–#29 的读数转录） | — | `ContractHardeningLimitations/v1`（10 条限制 + not-run 7 项 + not-claimed 4 项）；`ContractHardeningGateIndex/v1`（gates 30 条、realGateEntry、runtimePathProof、documentation、localLogs 索引） |
| 31 | 凭据扫描（`LC_ALL=C.UTF-8 grep -nP <C1–C3 同一 look-behind 模式>` 对 `final/evidence-report.json`、`final/gates.json`、`final/limitations.json`、`tests/unit/evidence-refs-exist.test.ts`、`docs/clawx-product-semantics.md`、本文件；自测 3 行输入期望 2 命中） | grep **1**（= 无命中） | `final/credential-scan.json`：`status clean`、`filesScanned 6`、`findings []`、自测 2/2 |
| 32 | `cd harness/specs/fixtures/ontology-lite-existing-contracts/final && sha256sum evidence-report.json gates.json limitations.json credential-scan.json > SHA256SUMS && sha256sum -c SHA256SUMS` | 0 | 4 条 `OK`；SHA256SUMS 覆盖 `final/` 内除自身外的每个文件 |
| 33 | `node scripts/check-repository-artifacts.mjs`；`node scripts/check-local-paths.mjs`（`final/**` 与本节暂存后） | 0 / 0 | `Repository artifact retention passed (20057 tracked paths).`；`[local-paths] PASS …` |
| 34 | `pnpm harness validate --spec harness/specs/tasks/ontology-lite-contract-implementation.md --since HEAD`（暂存 `final/**` + 本文件） | 0 | `Spec is valid`（`final/**` 在 `ownedPaths` 的 `harness/specs/fixtures/ontology-lite-existing-contracts/**` 内） |
| 35 | `git diff --check`；`git diff --cached --check` | 0 / 0 | 无输出 |

本节与 `final/{limitations,gates,credential-scan}.json`、`SHA256SUMS` 由紧随 `6944b059c` 的**仅证据回填提交**落盘（TF-0632 §11.1 同形）；该提交的 hash 不可能写进它自己提交的文件，记入 Task Forest TF-0637 / TF-0633 的 `evidence`。按 §5 的说明，在回填提交及之后任何 HEAD 上对 `final/evidence-report.json` 运行 `--verify` 恰得两条 `candidate-mismatch`（`candidate.commit`、`candidate.tree`）并 exit 1，其余字段与 8 个来源摘要全部匹配；在 `6944b059c` 的分离 worktree 上运行则 exit 0（§7.5）。这两个读数在回填提交后由同一会话运行并记入 Task Forest evidence。

---

## 12. 审查勘误与已知限制（2026-11-01，独立审查后落地）

本节由 TF-0629…TF-0637 收尾审查追加（`driven_by: agent`，`actor: claude-fable-5`）。上文 §1–§11 保持四叶收口时的原貌。

### 12.1 本次修补（审查提交）

| 修补 | 原缺陷（审查探针） | 改动 | 验证 |
|---|---|---|---|
| `--verify` 现在对照**活注册表**复核报告 | `verifyEvidenceReport` 只校验字段形态、候选、版本与来源摘要，从不对照 `PRODUCT_SEMANTIC_RELATIONS`：把 `relations` 裁到 1 条、把所有 `sourceRefs` 清空、改 `relationKey`、把 `rulesEvaluated` 换成 `['x']`、`status: valid` 却带非空 `diagnostics`、同一关系重复六次——全部 `verify valid` exit 0。最尖锐的输入：用 `source-line-endings` fixture 生成报告后把 `fixtures` 清空，报告引用两个测试源文件而非注册表的 `docs/clawx-product-semantics.md`，仍通过。因此 §8.1 #4"空报告 / 漏调用不能产生有效 pass"只对 `relations: []` 和 vitest 自己生成的报告成立 | `verifyEvidenceReport` 新增可选 `registry`，`runSemanticMode` 的 `--verify` 路径传入：每条注册表关系必须恰有一条结果（缺失 / 未知键 / 重复均报）；每条结果的 `sourceRefs` 路径集合必须等于注册表该关系的 `evidenceRefs`；`rulesEvaluated` 必须等于封闭规则集；`status: valid` 时 `diagnostics` 必须为空。全部以既有规则 `report-field-missing` 报告（不新增规则名，避免改变已封存报告的 `rulesEvaluated`） | 默认调用仍逐字 `PASS 188 referenced path(s)`；新鲜 `--report` 仍 `verify valid`；上述探针现在 exit 1 并定位到 `relations[2].sourceRefs`；`final/evidence-report.json` 在本 HEAD 上仍恰为两条 `candidate-mismatch`、无其它诊断；`tests/unit/evidence-refs-exist.test.ts` 篡改表新增 7 行（裁剪 / 改键 / 重复 / 清空来源 / 改指来源 / 换规则表 / 带诊断的 valid） |
| `docs/clawx-product-semantics.md` Workboard 行"Rejected by"单元格 | 原文称把边界抬到 `task-ledger-authority` 由 `reverse-task-authority` 拒绝；校验器实际只发 `kind-boundary-mismatch@authorityBoundary`，与 C2 自己的 fixture `kind-boundary-mismatch-references-one-way-task-ledger-authority.json` 一致 | 单元格改为与校验器一致的表述 | 该文件是 `final/evidence-report.json` 绑定的来源之一；自本修补起，该封存报告在后续 HEAD 上的 `--verify` 除两条 `candidate-mismatch` 外还会多出该文件的 `source-digest-mismatch`（§10 第 3 行的"必为两条"自此失效，这正是 C3"陈旧来源使报告失效"的设计行为）。封存证据本身未改、未重签 |

### 12.2 已知限制（本次未修，作为后续节点输入）

1. **`rulesEvaluated` 是声明而非观测**：它是常量拼接（`PRODUCT_SEMANTIC_RELATION_RULES ∪ SOURCE_DIAGNOSTIC_RULES`），C2 校验器被替换成空操作时列表不变；§3 (a)"列表会变化"的说法不成立。真正守住"校验器没被调用"的是 `--fixture bad-relation-self-loop` 负例。—— **已落地（TF-0639，§13.2）**：关系规则部分由校验器在封闭探针集 `RELATION_RULE_PROBES` 下实际回报的集合产生；`validator-noop` 负例经真实入口 exit 1、`rulesEvaluated` 只剩 8 条、诊断定位 `rulesEvaluated`。
2. **脏候选只是提示**：工作区有未跟踪文件时 `--report` 仍写 `status: valid`、`exitCode: 0`、`dirty: true`，`--verify` 也通过；合同所说"不能满足干净候选收口"没有任何字段或退出码承载，只有 stderr NOTE。—— **已落地（TF-0639，§13.3）**：`candidate.dirty !== false` → `[candidate-mismatch] - candidate.dirty`，`status invalid` / exit 1；`--verify` 对 `dirty: true` 的报告同样拒绝；NOTE 行删除。
3. **`rawDigest` 绑定的是工作树字节而非候选 blob**：`core.autocrlf=true` 的检出会对 LF blob 多出 `source-digest-mismatch`；对已跟踪源文件的未提交修改也会被当成候选内容哈希（只靠 `dirty` 标记提示）。改为对 `git cat-file blob HEAD:path` 哈希可消除对检出方式的依赖。—— **已落地（TF-0639，§13.4 / §13.7）**：两种摘要都对 `git cat-file --batch` 读回的候选 blob 计算，`tracked` 改为"在候选树 HEAD 中有 blob"；策略文本变更使封存的 `final/evidence-report.json` 在 `--verify` 下得到两条 `version-unsupported`（不重签）。
4. **测试向已跟踪 fixture 树写入**：`withRuntimeFile` / `withEscapeLink` 在 `harness/.../report/runtime/` 下创建未跟踪文件与 junction（未被 gitignore），前后 `git status --porcelain` 断言在 `--maxWorkers=2` 或并行写者下有竞态（审查期间实际观察到）；被中断的运行会留下 junction。spec 的 C3 行说有界 fixture 放 `os.tmpdir()`，根内偏离未记录。—— **已落地（TF-0639，§13.6）**：全部 `--report` / `--verify` 用例在 `os.tmpdir()` 下自建的干净候选沙箱里运行；runtime 文件写在沙箱的 `report/runtime/`（已 gitignore）；真实检出零写入，前后 porcelain 快照删除。
5. `reverse-task-authority` 比伞合同第 5 行 / 文档"Why it exists"更窄：`{workboard, roots-in, task-ledger, task-ledger-authority}` 等形状零诊断；没有规则限制哪些 `from` 可以主张 `task-ledger-authority`（批次 B 的第二主张者检查可能覆盖）。
6. 级联诊断：`unknown-endpoint-run-as-task` 同时触发 `reverse-task-authority`；逐 fixture 测试只断言包含而非唯一（fixture 16 / 17 各产生 6 / 3 条）。第 8 行"run success as task completion"的覆盖是名义的（任何未知键都会同样被 `forged-grant-field` 拒绝）。
7. 两份 `relationKey` 实现并存（`shared/product-semantics.ts` 与 `scripts/check-semantic-authority.mjs`，格式相同）——既有重复，非本批引入。
8. 文档小错：§5 称 SHA256SUMS 为"text mode, two spaces"，实际条目为二进制模式 ` *name`（校验无碍）；`final/gates.json`（已跟踪）含本机绝对路径 `D:/tmp/tf0637-c4/...`（`check-local-paths` 只扫 docs，且其模式只匹配用户目录）；§2 的行号范围应为 `:179–332`。
9. 默认行为的逐字不变只对**无参数**调用成立：多余参数原先被忽略，现在 exit 2（唯一调用方 `repo:evidence:check` 不传参数）。

建议归属：第 1–4 条作为一个新的批次 C 叶子（"报告观测化：rulesEvaluated 观测、脏候选 fail-closed、候选 blob 哈希、fixture 出根"）在 TF-0628 下登记后再做；本次审查不扩大 TF-0634…0637 的范围。—— 该叶子即 TF-0639，落地记录见 §13。

---

## 13. C5 报告观测化与候选绑定收紧（TF-0639，2026-11-01）

本节由批次 C 的第五个叶子追加（`driven_by: agent`，`actor: claude-fable-5`）。上文 §1–§12 保持原貌。合同：
`harness/specs/tasks/ontology-lite-report-observability.md`（本叶专用，TF-0639 `required_spec` 已指向它）；输入是 §12.2 第 1–4 条。
一句话结论：`--report` 的四个"只靠 vitest 计数钉住"的弱点现在都由检查器自己 fail-closed——校验器不回报规则、工作树不干净、
工作树字节冒充候选、测试写进已跟踪树，四者都不再能产生或冒充一份 `status: valid` 的报告；默认无参调用逐字不变；
`shared/product-semantics.ts` 零字节改动；封存的 `final/` 零字节改动且不重签。

### 13.0 基线与写集

| 项 | 值 |
|---|---|
| 开工 HEAD / tree | `c9a761cb5fbbc869bcb0a2e96615fa4b0e2d7fcf` / `b5e89b2336b340297c7836a0f32e860b27f08d24`（= `origin/main`）；`git status --porcelain` 恰 1 行 `?? _s07cfg/`（别的会话留下的未跟踪目录，未触碰；它使真实检出在本叶之后对 `--report` 恒为脏候选——见 §13.3 末段） |
| Task Forest（开工时） | `todo --json` 中 stored-status 为 `ready` 的节点恰为 1 个：`TF-0639`（`TF-0571` 为 `in_progress`）；开工后 `update-node` 把 `required_spec` 指向本叶 spec、状态置 `in_progress` |
| 执行工具 | Node `v24.22.1`（`process.features.typescript === 'strip'`）；vitest `4.1.1`；git `2.51.0.windows.1`；pnpm `11.2.2`；临时目录 `D:/tmp/tf0639/`（不入库） |
| pnpm 环境事件 | pnpm 11 的运行前依赖校验在本检出上弹出交互式 "modules purge" 提示并挂起（`pnpm harness …` / `pnpm exec …` 超过 400 s 无输出）。本叶全部 pnpm 包装命令以 `pnpm --config.verify-deps-before-run=false <script>` 运行：只跳过该交互校验，**未执行任何安装或清理**，底层命令与 `package.json` 一致；`node harness/src/cli.mjs validate …` 与 `pnpm harness validate …` 同一入口（`harness/package.json` `start`） |
| 写集（实际） | `scripts/check-evidence-refs.mjs`（+168/−? 见 §13.10）、`scripts/check-evidence-refs.d.mts`、`tests/unit/evidence-refs-exist.test.ts`、`.gitignore`（+3 行）、新增 `harness/specs/fixtures/ontology-lite-existing-contracts/report/fixtures/validator-noop.json`、`report/SHA256SUMS`（只追加）、新增 `report/credential-scan-c5.json`、新增 `harness/specs/tasks/ontology-lite-report-observability.md`、本文件。**未改**：`shared/**`、`scripts/lib/canonical-evidence-hash.mjs`、`scripts/lib/registry-fixture.mjs`、`scripts/lib/ts-import-hooks.mjs`、`report/` 下既有 8 个 fixture + 2 个来源 + `default-stdout.expected.txt` + `credential-scan.json`、`final/**`、`provenance/**`、`negatives/**`、`package.json`、`scripts/repository-artifacts.json`（新增 ignore 行不涉及任何跟踪文件，`check-repository-artifacts` 通过，无需登记） |

### 13.1 结论摘要

| 收紧 | 规则 / 字段变化 | 新增负例 → 拒绝结果 | 正例读数 |
|---|---|---|---|
| 1 `rulesEvaluated` 观测化 | 新导出 `RELATION_RULE_PROBES`（11 条，每条声明规则恰一个探针）与 `observeRelationRules(registry, extraDiagnostics)` → `{ observed, missing, unknown }`；报告 `rulesEvaluated = [...observed, ...SOURCE_DIAGNOSTIC_RULES]`；`missing ∪ unknown ≠ ∅` → `[report-field-missing] - rulesEvaluated`，`invalid` / exit 1。不新增规则名 | `validator-noop.json`（真实入口）→ exit **1**，恰 1 条诊断定位 `rulesEvaluated`，消息 `reported 0 of 11 declared relation rule(s) … missing: <11 条>`，`rulesEvaluated` 恰为 8 条来源规则，`relations` 6 / `sourceRefs` 8 仍被绑定；进程内 no-op / 未声明规则各一例；篡改表 +1（`rulesEvaluated` 裁成 8 条 → `--verify` 拒绝） | 活注册表 `observed` 逐项等于声明的 11 条，`missing` / `unknown` 空；报告 `rulesEvaluated` 仍为 19 条且顺序不变 |
| 2 脏候选 fail-closed | `buildEvidenceReport`：`candidate.dirty !== false` → `[candidate-mismatch] - candidate.dirty`（`null` 时消息为 could not be observed）；`verifyEvidenceReport`：`dirty === true` → 同一诊断；stderr `NOTE candidate is dirty` 行删除 | 沙箱根放 1 个未跟踪文件 → `--report` exit **1**，`candidate.dirty true`、`dirtyPaths ['tf0639-dirty-probe.txt']`、恰 1 条诊断、`status invalid`，8 个 `rawDigest` 仍等于候选 blob；对该报告 `--verify` → exit **1**（`candidate.dirty` + `status` 两条）；篡改表 +1（`dirty = true`） | 干净沙箱 `--report` stderr 0 字节、`candidate.dirty false`、`dirtyPaths []`（原先只断言 boolean） |
| 3 候选 blob 摘要 | 新导出 `collectCandidateBlobs(root, refs)`（一次 `git cat-file --batch`，stdin `HEAD:<ref>`）；`describeSourceRef` 选项 `trackedPaths` → `candidateBlobs`，`tracked := HEAD 中有 blob`，摘要对 blob 字节（或内存 rewrite）计算，无候选 blob 则不哈希；`collectTrackedPaths` 删除；`EVIDENCE_NORMALIZATION.policy` / `rawDigestPolicy` 文本改为候选 blob 口径 | 把沙箱里 HEAD 为 LF 的 `docs/modules/multi-agent-and-tasks.md` 工作副本改写为 CRLF → `--report` exit **1**，诊断恰 `[candidate-mismatch] - candidate.dirty`，**0** 条 `source-digest-mismatch`，该路径 `digest` / `rawDigest` 与改写前逐项相同且等于 `git cat-file blob HEAD:` 的摘要；纯函数：工作树为真实文档而 `candidateBlobs` 给 `alpha\nbeta\n` → 摘要是后者的；篡改表 +1（`rawDigestPolicy` 换回旧文本 → `version-unsupported`） | 正例 8 个 `sourceRefs` 的 `digest` / `rawDigest` 均等于 `digestEvidenceBytes(git cat-file blob HEAD:<path>)`；`source-line-endings` 的 LF / lone-CR 读数不变（期望来源改为 blob） |
| 4 测试出根 | 测试在 `os.tmpdir()` 自建 `git init` 干净候选沙箱（工作树副本，约 800 文件 / 8 MB / 1–2 s）；`.gitignore` +1 行忽略 `report/runtime/`；真实检出零写入；porcelain 前后快照删除 | — （结构性收紧，由"沙箱保持干净 + 真实检出无 `runtime/`"的末尾断言与 `git check-ignore -v` 读数证明） | `--maxWorkers=1` 全文件 69/69；真实检出在整轮测试后 `git status --porcelain` 仍恰为 `?? _s07cfg/` 以外的本叶写集 |
| 封存 `final/` | 不改、不重签：`sha256sum -c final/SHA256SUMS` exit 0（4 条 OK） | 单测 `the sealed final/ report … verifies as version-unsupported`：`--verify` exit 1，含 `normalization.policy` 与 `normalization.rawDigestPolicy` 两条 `version-unsupported` | 本 HEAD 上 `--verify final/evidence-report.json` → **10** 条诊断 = 2 `candidate-mismatch` + 2 `version-unsupported` + 6 `source-digest-mismatch`（§13.7） |

测试：`tests/unit/evidence-refs-exist.test.ts` 59 → **69**（+10；59 = C3/C4 的 52 + 审查的 7 条篡改表）；`tests/unit/product-semantics.test.ts` **40/40** 不变；因策略变更调整的既有断言 3 处（§13.5）。默认无参调用 `node scripts/check-evidence-refs.mjs` stdout 与 `report/default-stdout.expected.txt` `cmp` 相同、stderr 0 字节、exit 0。

### 13.2 收紧 1：`rulesEvaluated` 由观测产生

探针集（`scripts/check-evidence-refs.mjs` `RELATION_RULE_PROBES`，基准关系 `chat --projects--> task-ledger / read-only-projection / ['docs/clawx-product-semantics.md']`）：

| 声明规则 | 探针输入 |
|---|---|
| `unknown-endpoint` | `from: 'not-a-declared-concept'` |
| `unknown-kind` | `kind: 'not-a-declared-kind'` |
| `unknown-authority-boundary` | `authorityBoundary: 'not-a-declared-boundary'` |
| `self-loop` | `to: 'chat'` |
| `duplicate-relation` | 基准关系两份 |
| `missing-evidence` | `evidenceRefs: []` |
| `kind-boundary-mismatch` | `authorityBoundary: 'advisory-only'` |
| `reverse-task-authority` | `from: 'task-ledger', to: 'chat'` |
| `forged-grant-field` | 多出 `grants: ['write']` |
| `cross-session-quality` | `routing-memo --quality-gated-by--> task-loop` + `context.sessionScope: 'cross-session'` |
| `unsupported-contract-version` | 基准关系 + `context.contractVersion: 'ProductSemanticRelations/v0'` |

`observeRelationRules` 把每个探针送入注册表导出的 `validateProductSemanticRelations(candidates, context)`，并把活关系校验已产生的诊断一并计入
`seen`；`observed` 按声明顺序列出被看到的声明规则，再附上未声明却被回报的规则。活注册表上 `observed` 恰为 11 条、顺序相同。

为什么不改 `shared/product-semantics.ts`：节点 non_goals 与宪章 §6.2 要求 owner 不动；在 `scripts/` 侧探针能观测到"校验器是否
真的评估了某条规则"而不要求校验器自述，一个被替换成空操作的校验器无论自述什么都观测不到任何规则。副作用：探针用注册表自己的
概念 / kind 词表；词表若改名，受影响的探针会以 `unknown-*` 而非目标规则失败，`missing` 非空 → 报告失效（fail-closed，而非静默）。

### 13.3 收紧 2：脏候选 fail-closed

`describeCandidate` 不变（`git status --porcelain` 全部行）。`buildEvidenceReport` 在版本检查之后、关系校验之前追加
`candidate.dirty` 诊断；`verifyEvidenceReport` 在 `candidate.dirty must be a boolean` 之外对 `true` 追加 `candidate-mismatch`。
消息列出前 3 个脏路径。

**对真实检出的直接影响（设计后果，必须说清）**：本检出存在他人留下的未跟踪目录 `_s07cfg/`，因此在本叶之后、在该目录仍存在的任何
时刻，直接在 `D:/ClawX` 运行 `--report` 都得到 exit 1 的 `candidate.dirty` 报告——这正是"脏候选不能冒充干净候选证据"的本意。
要得到 exit 0 的真实候选读数，用 §13.9 7 的 sparse detached worktree（未跟踪文件不进入 worktree）。单测不受影响（§13.6 的沙箱）。

### 13.4 收紧 3：对候选 blob 哈希

- `collectCandidateBlobs(root, refs)`：`spawnSync('git', ['cat-file', '--batch'])`，stdin 每行 `HEAD:<normalizedRef>`，解析
  `<oid> <type> <size>\n<bytes>\n` / `<object> missing\n`；只收 `blob`；返回 `Map<ref, Buffer>`，git 失败返回 `null`（永不假定）。
  8 个引用一次往返。
- `describeSourceRef(root, ref, { candidateBlobs, rewrites, readPaths })`：`exists` / `insideRoot` / `symlinkEscape` 仍是工作树事实
  （缺文件、越界、逃逸链接必须能被看见）；`tracked = candidateBlobs === null ? null : candidateBlobs.has(ref)`；被哈希字节
  = `rewrites[ref]`（内存 fixture 仍表示"候选内容变了"，`stale-source-rewrite` 行为不变）否则候选 blob；没有候选 blob → 两摘要 `null`
  并进入 `unverified`。`source-untracked` 消息改为 "is not part of the candidate commit (HEAD)"。
- `core.autocrlf`：`git cat-file blob` 返回对象库字节，不经任何检出转换；因此 `autocrlf=true/false/input` 的检出对同一候选得到逐字相同
  的 `sourceRefs`。单测以"把 LF 来源的工作副本改写成 CRLF"覆盖这一机制（它同时就是"已跟踪源文件的未提交修改"负例）：摘要不变，
  报告只因 `candidate.dirty` 失效，0 条 `source-digest-mismatch`。本机 `core.autocrlf=false`，没有另一台 `autocrlf=true` 的机器
  参与读数；结论来自机制（blob 不经检出）与上述等价负例，如实记为推理 + 等价证明而非双机实测。

### 13.5 因策略变更调整的既有断言（逐条）

| # | 用例 | 原断言 | 现断言 | 理由 |
|---|---|---|---|---|
| 1 | `an untracked local file is rejected …` | `digest` / `rawDigest` 记录为工作树字节的两种摘要且互不相同；`unverified` 为空 | `digest: null` / `rawDigest: null`；`unverified` 恰含该引用（reason `source-untracked`）；并新增 `candidate.dirty false`、诊断恰 `['source-untracked']` | 未跟踪文件没有候选 blob；原断言记录的正是 §12.2 第 3 条要去掉的工作树哈希 |
| 2 | `--report on the live registry …`、`tracked sources with LF and lone-CR …` | 期望摘要 = `readFileSync(<工作树路径>)` | 期望摘要 = `git cat-file blob HEAD:<path>`（沙箱） | 摘要口径变更；在 `autocrlf=false` 的干净检出上两者字节相同 |
| 3 | `treats an unobserved tracking answer …`（纯函数） | `{ trackedPaths: null }` / `{ trackedPaths: new Set() }` | `{ candidateBlobs: null }` / `{ candidateBlobs: new Map() }` | 选项改名；断言内容不变 |

加严（非放宽）：正例 `--report` 现在断言 stderr 为 0 字节、`candidate` 恰为 `{ commit, tree, dirty: false, dirtyPaths: [] }`；
`--verify` 篡改表的 `accepts the untampered report` 新增 `base.candidate.dirty === false`。其余 56 个既有用例的断言文本未变，
只是运行根从真实检出换成沙箱（§13.6）。`source-untracked.json` / `source-symlink-escape.json` 的 `purpose` 文本（"under report/runtime/"）
仍然准确，fixture 文件零字节改动。

### 13.6 收紧 4：测试出根与干净候选沙箱

模块顶层（`describe` 收集前，因为篡改表在收集期就调用 `buildEvidenceReport`）：

1. `mkdtempSync(os.tmpdir()/tf0639-c5-)/candidate`；
2. `git ls-files -z -co --exclude-standard -- scripts shared harness/specs/fixtures/ontology-lite-existing-contracts docs/clawx-product-semantics.md docs/modules/multi-agent-and-tasks.md README.md` 枚举真实检出里已跟踪与未跟踪但未被 ignore 的文件，逐个 `copyFileSync`（**工作树就是被测候选**：正在编辑的检查器与本变更集新增的 fixture 都在内；被 ignore 的 `report/runtime/` 不在内）；
3. 写只含 `/harness/specs/fixtures/ontology-lite-existing-contracts/report/runtime/` 的 `.gitignore`（真实 `.gitignore` 整体忽略 `docs/**`，照搬会把两份被引用文档挡在提交之外）；
4. `git init -q -b main`；`core.autocrlf=false`、`commit.gpgsign=false`、固定 user；`git add -A`；提交一次。

所有 `--report` / `--verify` 以 `node <sandbox>/scripts/check-evidence-refs.mjs`、`cwd: <sandbox>` spawn；所有 `buildEvidenceReport` /
`verifyEvidenceReport` 以 `root: <sandbox>`、`candidate: describeCandidate(<sandbox>)`。默认无参调用与 `checkEvidenceRefs(process.cwd())`
仍以真实检出为根。runtime 探针与越界 junction 写在沙箱的 `report/runtime/`（已 ignore：`tracked false` 且不进入 porcelain）；
脏候选探针写在沙箱根（未 ignore，才会脏）；CRLF 改写用 `git checkout -- <path>` 复原。文件末尾断言：沙箱 `dirty false` / `dirtyPaths []`、
沙箱无 `report/runtime/`、真实检出无 `report/runtime/`。`afterAll` 删除整个临时目录。真实检出与其 `.git` 零写入——没有 worktree 登记、
悬空对象或 `prune`。

为什么不用 `git worktree`：worktree 只能检出 HEAD，提交前的测试会去跑**旧**检查器（本叶开发中实测如此）；且需要在共享 `.git/worktrees/`
登记并依赖 `prune`。完整 worktree 在本机 >300 s 未完成（285 MB / 20071 文件 + 杀毒），sparse worktree 1–2 s 但仍是 HEAD 的副本。
`git init` 沙箱两者皆无，并让测试在脏检出上也确定性通过。

### 13.7 封存 `final/` 证据的兼容结论

`final/evidence-report.json`（候选 `6944b059c`）的 `normalization.policy` / `rawDigestPolicy` 记录的是工作树字节口径，与 C5 的
`EVIDENCE_NORMALIZATION` 文本不同。合同选择**策略文本变更 → 旧报告 `version-unsupported`**，不保留只读的旧策略校验分支：
一份摘要取自工作树的报告无法不重新推导就对照候选 blob 复核，而重新推导就是重签。后果与读数：

- `final/**` 零字节改动；`sha256sum -c final/SHA256SUMS` exit 0（§13.10 #12）。
- 本 HEAD（`c9a761cb5` + 未提交写集）上 `node scripts/check-evidence-refs.mjs --verify final/evidence-report.json` → exit **1**，
  **10** 条诊断：`[candidate-mismatch] - candidate.commit`、`[candidate-mismatch] - candidate.tree`、
  `[version-unsupported] - normalization.policy`、`[version-unsupported] - normalization.rawDigestPolicy`、
  以及 `docs/clawx-product-semantics.md` 的 6 条 `source-digest-mismatch`（引用它的 3 条关系 × digest / rawDigest；自 TF-0638 修改该文件起已存在，§12.1 第 2 行）。
  其余字段与另外 5 个来源引用全部匹配——摘要恰好相同，是因为 `autocrlf=false` 的干净检出上工作树字节等于 blob 字节。
- 推论：自 C5 起，该封存报告在**任何** HEAD（包括它自己的候选 `6944b059c`）上都不再能 `--verify` 为 exit 0——两条 `version-unsupported`
  与候选无关。§5 "在其候选上 `--verify` exit 0" 与 §7.5 自此成为历史读数（对 C4 候选 + C4 检查器成立），不再对当前检查器成立。
  这是接受的、如实记录的代价；它不改变该报告作为 TF-0637 收口证据的历史效力（证据绑定的是它生成时的检查器与候选）。
- 单测钉住两条 `version-unsupported` 与 `candidate.commit` 一条，并钉住 `final/SHA256SUMS` 全部条目的 SHA-256（证明未改写）；
  6 条 `source-digest-mismatch` 的数量随后续 HEAD 变化，不钉。
- 报告 schema 仍为 `ProductSemanticEvidenceReport/v1`：15 个顶层键与 `sourceRefs` 7 键未变；版本语义由 `normalization` 承担
  （C3 把它设计成"不可比较即 `version-unsupported`"正是为此），无需 v2。

### 13.8 新增用例（10）

| # | 用例（`tests/unit/evidence-refs-exist.test.ts`） | 入口 | 期望 |
|---|---|---|---|
| 1 | probes every declared relation rule exactly once and observes all of them on the live validator | 进程内 | `RELATION_RULE_PROBES.map(rule)` = 声明 11 条；每个探针命中其规则；`observed` = 声明、`missing` / `unknown` 空 |
| 2 | observes nothing from a validator that reports nothing, and names what is missing | 进程内 | no-op 校验器 → `observed []`、`missing` = 11 条；回报 `made-up-rule` → `unknown ['made-up-rule']` |
| 3 | hashes the candidate blob, never the working-tree bytes, and hashes nothing without a candidate blob | 进程内 | 工作树为真实文档、`candidateBlobs` 给 `alpha\nbeta\n` → 两摘要为后者的 sha256；`candidateBlobs: new Map()` → `tracked false`、摘要 `null`、`source-untracked` |
| 4 | a validator stubbed to a no-op cannot keep the declared rules | 真实入口 `--fixture validator-noop.json --report` | exit 1；诊断恰 `[report-field-missing] - rulesEvaluated`，消息 `reported 0 of 11 …` 并列出 11 条；`rulesEvaluated` 恰 8 条来源规则；6 关系 / 8 来源仍绑定；`unverified []` |
| 5 | a dirty candidate cannot pass | 真实入口 `--report` + `--verify` | 未跟踪探针在沙箱根 → exit 1、`dirty true`、`dirtyPaths` 恰该文件、诊断恰 `candidate-mismatch@candidate.dirty`、8 个 `rawDigest` 仍等于候选 blob；探针删除后 `--verify` 该报告 → exit 1，含 `candidate.dirty` 与 `status` 两条 |
| 6 | working-tree bytes never enter a digest | 真实入口 `--report` ×2 | LF 来源改写为 CRLF → exit 1、诊断恰 `candidate.dirty`、`dirtyPaths` 恰该文件、无 `source-digest-mismatch`；该路径 `sourceRefs` 与改写前逐项相等且 `rawDigest = sha256(blob) ≠ sha256(crlf)`；复原后沙箱干净 |
| 7 | dirty candidate -> invalid（篡改表） | 进程内 `--verify` | `candidate-mismatch` 定位 `candidate.dirty` |
| 8 | working-tree raw digest policy -> invalid（篡改表） | 进程内 `--verify` | 把 `rawDigestPolicy` 换回 C3 文本 → `version-unsupported` 定位 `normalization.rawDigestPolicy` |
| 9 | rules trimmed to the source rules -> invalid（篡改表） | 进程内 `--verify` | `rulesEvaluated` 裁成 8 条来源规则（no-op 校验器会写出的形状）→ `report-field-missing` 定位 `rulesEvaluated` |
| 10 | the sealed final/ report is unchanged and … verifies as version-unsupported | 真实入口 `--verify <final/evidence-report.json>` | `final/SHA256SUMS` 每条 SHA-256 相符；封存 `normalization` 两字段 ≠ 当前；exit 1；stderr 含两条 `version-unsupported` 与 `candidate.commit` 一条；文件字节不变 |

### 13.9 复现命令（离线，仓库根目录，Git Bash；临时目录 `D:/tmp/tf0639`；pnpm 包装命令前置 `--config.verify-deps-before-run=false`）

```bash
# 1 单测（沙箱自建，脏检出亦可）与 C2 负例
export TMPDIR=D:/tmp
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/evidence-refs-exist.test.ts tests/unit/product-semantics.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/tmp/tf0639/vitest.json
node -e "const r=require('D:/tmp/tf0639/vitest.json');console.log(r.numTotalTests,r.numFailedTests,r.success)"   # → 109 0 true
# 2 默认行为逐字不变
node scripts/check-evidence-refs.mjs > D:/tmp/tf0639/default.txt 2> D:/tmp/tf0639/default.err; cmp D:/tmp/tf0639/default.txt harness/specs/fixtures/ontology-lite-existing-contracts/report/default-stdout.expected.txt && [ ! -s D:/tmp/tf0639/default.err ] && echo identical
# 3 脏检出上的 --report 失效（本检出因 _s07cfg/ 恒脏）
node scripts/check-evidence-refs.mjs --report D:/tmp/tf0639/dirty.json --actor claude-fable-5; echo "exit=$?"   # → 1, [candidate-mismatch] - candidate.dirty
# 4 封存报告在新策略下
node scripts/check-evidence-refs.mjs --verify harness/specs/fixtures/ontology-lite-existing-contracts/final/evidence-report.json; echo "exit=$?"   # → 1；2 candidate-mismatch + 2 version-unsupported + 6 source-digest-mismatch
cd harness/specs/fixtures/ontology-lite-existing-contracts/final && sha256sum -c SHA256SUMS && cd -   # → 4 OK
# 5 门禁
pnpm --config.verify-deps-before-run=false repo:evidence:check; pnpm --config.verify-deps-before-run=false contract:check; node scripts/check-semantic-authority.mjs
node scripts/check-repository-artifacts.mjs; node scripts/check-local-paths.mjs; pnpm --config.verify-deps-before-run=false harness:specs:lifecycle
node harness/src/cli.mjs validate --spec harness/specs/tasks/ontology-lite-report-observability.md --no-diff
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false exec eslint scripts/check-evidence-refs.mjs tests/unit/evidence-refs-exist.test.ts --max-warnings 0; node scripts/check-no-bom.mjs; git diff --check
git check-ignore -v harness/specs/fixtures/ontology-lite-existing-contracts/report/runtime/x.md   # → .gitignore:144
# 6 report/ 校验和（只追加）
cd harness/specs/fixtures/ontology-lite-existing-contracts/report && sha256sum -c SHA256SUMS && cd -
# 7 真实候选上的干净读数：sparse detached worktree（1–2 s；未跟踪目录不进入 worktree）
W=D:/tmp/tf0639/wt; git worktree add --no-checkout --detach $W HEAD
MSYS_NO_PATHCONV=1 git -C $W sparse-checkout set --no-cone '/scripts/' '/shared/' '/docs/' '/harness/specs/fixtures/ontology-lite-existing-contracts/' '/README.md' '/.gitignore' '/package.json'
git -C $W checkout --detach HEAD; git -C $W status --porcelain | wc -l   # → 0
node $W/scripts/check-evidence-refs.mjs --report D:/tmp/tf0639/candidate.json --actor claude-fable-5; echo "exit=$?"   # → 0, dirty false
node $W/scripts/check-evidence-refs.mjs --verify D:/tmp/tf0639/candidate.json; echo "exit=$?"                          # → 0
node $W/scripts/check-evidence-refs.mjs --fixture harness/specs/fixtures/ontology-lite-existing-contracts/report/fixtures/validator-noop.json --report D:/tmp/tf0639/noop.json --actor claude-fable-5; echo "exit=$?"   # → 1, rulesEvaluated
git worktree remove --force $W; git worktree prune
```

### 13.10 证据链（2026-11-01，HEAD `c9a761cb5` + 本叶未提交写集；退出码由 shell 直接捕获，日志在 `D:/tmp/tf0639/`，本地保留不入库）

| # | 命令 | exit | 关键输出 |
|---|---|---|---|
| 1 | `node harness/src/cli.mjs validate --spec harness/specs/tasks/ontology-lite-report-observability.md --no-diff` | 0 | `Spec is valid`（`pnpm harness validate …` 同入口；pnpm 包装见 §13.0 环境事件） |
| 2 | `pnpm … exec vitest run tests/unit/evidence-refs-exist.test.ts --maxWorkers=1 --reporter=json` | 0 | `numTotalTests 69, numFailedTests 0, success true`（文件 29.8 s；沙箱自建于脏检出之上） |
| 3 | `pnpm … exec vitest run tests/unit/product-semantics.test.ts --maxWorkers=1 --reporter=json` | 0 | `numTotalTests 40, numFailedTests 0` |
| 4 | `node scripts/check-evidence-refs.mjs` + `cmp` + stderr 大小 | 0 | `[evidence-refs] PASS 188 referenced path(s)`，与钉住 fixture 相同，stderr 0 字节 |
| 5 | `pnpm … repo:evidence:check` | 0 | 同 #4 |
| 6 | `pnpm … contract:check` | 0 | `Contract check passed.` |
| 7 | `node scripts/check-semantic-authority.mjs` | 0 | `… relations=6 … rules=18 diagnostics=0 adjudicated=8 …` |
| 8 | `node scripts/check-repository-artifacts.mjs` | 0 | `Repository artifact retention passed (20071 tracked paths).` |
| 9 | `node scripts/check-local-paths.mjs` | 0 | `[local-paths] PASS …` |
| 10 | `pnpm … harness:specs:lifecycle` | 0 | `[specs] lifecycle status present for 688 task specs.`（686 + TF-0638 + 本叶） |
| 11 | `node harness/src/cli.mjs validate --spec harness/specs/tasks/ontology-lite-contract-implementation.md --no-diff` | 0 | `Spec is valid`（C3/C4 合同仍有效） |
| 12 | `cd …/final && sha256sum -c SHA256SUMS` | 0 | 4 条 `OK`（`final/` 未改写） |
| 13 | `node scripts/check-evidence-refs.mjs --verify …/final/evidence-report.json` | **1** | `(10 diagnostic(s))`：2 `candidate-mismatch` + 2 `version-unsupported`（`normalization.policy` / `normalization.rawDigestPolicy`）+ 6 `source-digest-mismatch`（全部 `docs/clawx-product-semantics.md`）（§13.7） |
| 14 | `node scripts/check-evidence-refs.mjs --report D:/tmp/tf0639/smoke/dirty.json --actor smoke`（真实检出，脏） | **1** | `FAIL report invalid: 6 relation(s), 8 source ref(s), 1 diagnostic(s)`；`[candidate-mismatch] - candidate.dirty: The working tree is dirty (3 path(s): _s07cfg/, …)`；报告 `rulesEvaluated` 19 |
| 15 | `pnpm … run typecheck` | 0 | node / web / test `errorCount 0`，67.5 s |
| 16 | `pnpm … exec eslint scripts/check-evidence-refs.mjs tests/unit/evidence-refs-exist.test.ts --max-warnings 0` | 0 | 0 error 0 warning |
| 17 | `node scripts/check-no-bom.mjs` | 0 | `check-no-bom: ok` |
| 18 | `git diff --check` | 0 | 无输出 |
| 19 | `git check-ignore -v harness/specs/fixtures/ontology-lite-existing-contracts/report/runtime/x.md` | 0 | `.gitignore:144:/harness/specs/fixtures/ontology-lite-existing-contracts/report/runtime/` |
| 20 | `pnpm … docs:policy:validate` | 0 | `[policy-docs] PASS: 10 checks` |
| 21 | `cd …/report && sha256sum -c SHA256SUMS`（追加 2 行后） | 0 | 14 条 `OK`（既有 12 条字节不变 + `fixtures/validator-noop.json` + `credential-scan-c5.json`） |
| 22 | 凭据扫描（`LC_ALL=C.UTF-8 grep -nP <C1–C3 同一 look-behind 模式>` 对 `validator-noop.json`、`scripts/check-evidence-refs.{mjs,d.mts}`、`tests/unit/evidence-refs-exist.test.ts`、本叶 spec、本文件、`.gitignore`；自测 3 行输入期望 2 命中） | grep **1**（= 无命中） | `report/credential-scan-c5.json`：`status clean`、`filesScanned 7`、`findings []`、自测 2/2 |
| 23 | `git diff --stat`（跟踪文件，提交前） | — | `.gitignore +3`、`scripts/check-evidence-refs.d.mts` 35 行、`scripts/check-evidence-refs.mjs` 168 行、`tests/unit/evidence-refs-exist.test.ts` 310 行、`report/SHA256SUMS +2`、本文件；`git diff --stat HEAD -- shared/ electron/ src/ openclaw_runtime/ package.json` **0** 行；`git status --porcelain -- …/final` 空 |
| 24 | 新增文件 | — | `harness/specs/tasks/ontology-lite-report-observability.md`、`report/fixtures/validator-noop.json`、`report/credential-scan-c5.json` |

### 13.11 候选提交后复核

C5 候选提交 **`698d59d6a381d81a65bd5a649a900831984376e3`**（tree `f8de380c3dbd6e6172d03bc44437f28db0d6469f`；9 文件 +969 / −89；
基于 `c9a761cb5`；显式 pathspec：`.gitignore`、本文件、`report/SHA256SUMS`、`report/credential-scan-c5.json`、
`report/fixtures/validator-noop.json`、本叶 spec、`scripts/check-evidence-refs.{mjs,d.mts}`、`tests/unit/evidence-refs-exist.test.ts`）。
提交后真实检出 `git status --porcelain` 恰为 `?? _s07cfg/`。按 §13.3 的说明，真实候选上的干净读数取自该提交的 sparse detached worktree
（§13.9 7：`git worktree add --no-checkout --detach` → `sparse-checkout set --no-cone` → `checkout --detach HEAD`，`status --porcelain` 0 行，
HEAD `698d59d6a`）；worktree 用后 `remove --force` + `prune`，日志在 `D:/tmp/tf0639/post/`（本地保留不入库）。

| # | 命令（worktree HEAD `698d59d6a`，除注明者外） | exit | 关键输出 |
|---|---|---|---|
| 25 | `node <wt>/scripts/check-evidence-refs.mjs --report D:/tmp/tf0639/post/candidate.json --actor claude-fable-5` | 0 | `report valid: 6 relation(s), 8 source ref(s), 0 diagnostic(s)`；报告 `status valid`、`exitCode 0`、`candidate {commit 698d59d6a…, tree f8de380c3…, dirty false, dirtyPaths []}`、`rulesEvaluated` **19**、`relations` 6 / `sourceRefs` 8、`diagnostics []`、`unverified []`、`fixtures []`、`rawDigestPolicy` 含 `candidate blob` |
| 26 | `… --verify D:/tmp/tf0639/post/candidate.json` | 0 | `verify valid: … (6 relation(s), 8 source ref(s), candidate 698d59d6a)` |
| 27 | `… --fixture …/report/fixtures/validator-noop.json --report D:/tmp/tf0639/post/noop.json --actor claude-fable-5` | **1** | 诊断恰 `[report-field-missing] - rulesEvaluated: The registry validator reported 0 of 11 declared relation rule(s) under probing (missing: unknown-endpoint, unknown-kind, …)`；报告 `rulesEvaluated` 恰为 8 条来源规则、`relations` 6、`status invalid`、`exitCode 1` |
| 28 | worktree 根写 `tf0639-dirty-probe.txt` 后 `… --report D:/tmp/tf0639/post/dirty.json`，随后删除探针 | **1** | 诊断恰 `[candidate-mismatch] - candidate.dirty: The working tree is dirty (1 path(s): tf0639-dirty-probe.txt) …`；报告 `dirty true`、`dirtyPaths ['tf0639-dirty-probe.txt']`、`status invalid` |
| 29 | `… --verify D:/tmp/tf0639/post/dirty.json`（探针已删除，worktree 干净） | **1** | `[candidate-mismatch] - candidate.dirty: Report records a dirty candidate (1 path(s)) …` + `[report-field-missing] - status: Report recorded status "invalid" with 1 diagnostic(s)` |
| 30 | worktree 里把 `docs/modules/multi-agent-and-tasks.md`（HEAD 为 LF）工作副本改写为 CRLF 后 `… --report D:/tmp/tf0639/post/crlf.json`，随后 `git checkout -- <path>` | **1** | 诊断恰 `[candidate-mismatch] - candidate.dirty`（`dirtyPaths` 恰该文件）；`source-digest-mismatch` **0** 条；该路径 4 个 `sourceRefs` 的 `rawDigest` 与 #25 逐项相同（工作树字节未进入摘要） |
| 31 | `… --verify <wt>/…/final/evidence-report.json` | **1** | `(10 diagnostic(s))` = `candidate.commit`（6944b059c ≠ 698d59d6a）+ `candidate.tree` 两条 `candidate-mismatch` + `normalization.policy` / `normalization.rawDigestPolicy` 两条 `version-unsupported` + `docs/clawx-product-semantics.md` 6 条 `source-digest-mismatch`（§13.7） |
| 32 | `cd <wt>/…/final && sha256sum -c SHA256SUMS`；`cd <wt>/…/report && sha256sum -c SHA256SUMS` | 0 / 0 | 4 条 `OK` / 14 条 `OK` |
| 33 | worktree `git status --porcelain`（全部读数之后） | 0 | 0 行（探针与 CRLF 改写均已复原） |
| 34 | `node scripts/check-evidence-refs.mjs`（**真实检出**，HEAD `698d59d6a`；sparse worktree 缺少默认路径要检查的 188 个引用文件，默认调用在那里必然 `FAIL missing referenced paths`，不是读数） | 0 | `[evidence-refs] PASS 188 referenced path(s)`，与钉住 fixture `cmp` 相同，stderr 0 字节 |
| 35 | `pnpm … exec vitest run tests/unit/evidence-refs-exist.test.ts tests/unit/product-semantics.test.ts --maxWorkers=1 --reporter=json`（真实检出，HEAD `698d59d6a`；沙箱副本此时等于候选） | 0 | `numTotalTests 109, numFailedTests 0, success true`（69 + 40）；运行后 `os.tmpdir()` 下无 `tf0639-c5-*` 残留，真实检出 porcelain 仍恰为 `?? _s07cfg/` |

本节由紧随 `698d59d6a` 的**仅证据回填提交**落盘（TF-0637 §11.1 / TF-0638 §13.9 同形）；回填提交的 hash 不可能写进它自己提交的文件，
记入 Task Forest TF-0639 的 `evidence`。本叶没有新的封存报告入库：`final/evidence-report.json` 仍是 TF-0637 的那一份（§13.7）。

### 13.12 未做与残余风险

| 项 | 性质 | 去向 |
|---|---|---|
| `core.autocrlf=true` 检出未实机复跑 | 结论由机制（`git cat-file blob` 不经检出转换）+ 等价负例（工作副本 CRLF 改写摘要不变）给出；无第二台机器参与 | 如需双机读数，另开环境节点；不影响本叶判定 |
| 真实检出因 `_s07cfg/` 恒为脏候选 | 设计后果；`--report` 的干净读数须在 sparse worktree 上取 | §13.3 / §13.9 7 |
| 封存 `final/evidence-report.json` 自 C5 起在任何 HEAD 上 `--verify` 均 exit 1 | 接受的兼容代价（§13.7）；历史效力不变 | 无 |
| 探针绑定注册表当前词表 | 词表改名 → 对应探针以 `unknown-*` 失败 → `missing` 非空 → 报告失效（fail-closed），需同步探针 | 届时同步 |
| `rulesEvaluated` 的来源规则部分仍是检查器自己的声明 | 这 8 条由本检查器代码路径产出，不存在"被替换的校验器"问题；合同只要求关系规则观测化 | 无 |
| `pnpm` 运行前依赖校验在本检出弹出 purge 提示 | 环境事件，非代码；以 `--config.verify-deps-before-run=false` 绕过且未安装 | 环境修复不在本叶写集 |
| **not-run**（如实记录，不得解读为通过） | `pnpm test` 全量、E2E、`pnpm run lint` 全仓（只对两个改动的 .ts/.mjs 跑 eslint）、`pnpm agent-dev:*`、`pnpm harness run … --dry-run`、live provider / Gateway | — |


## 14. TF-0791 关键关系端点与最终复验（2026-11-05）

旧校验器接受 routing-memo --quality-gated-by--> chat：端点都在词表内、kind/boundary也合法，
但它不表达实际scorecard权威。新增`relation-endpoint-mismatch`覆盖五kind既定domain/range，
7×7×5=245种已知概念组合恰接受六种关系。self-loop与反向Task Ledger权威继续由原规则拒绝。
关系形状和v1标识保持，新增规则使旧报告的规则集合验证失败；历史final/provenance证据不重签。

真实报告入口增加known-wrong-endpoint负例；规则观测探针增加新规则，validator-noop负例仍验证
实际观测而非声称已执行。原owner集合全部复跑：Task Loop根绑定/失败拒绝、Chat Plan只读投影、
显式upgrade、Workboard单向引用及字段继承、Routing Memo同session scorecard准入。
这些行为测试补充元数据检查，不把文件存在或关系形状当成真实执行效果。

最终专项全集、类型、contract/authority/evidence、静态依赖图、runtime source六子门禁、comms、
scoped lint和Harness以同一干净候选运行。全仓pnpm test、Electron、完整runtime build和收益指标
不在此限定验收内；已有LOC残差保留exit1并与原候选比较。最终报告位于
`harness/specs/fixtures/architecture-convergence-final/`，提供逐项范围、来源和实际结果。


## 2026-11-06 合并前审查修正

独立agent发现默认测试把TF-0790历史gap审计的原字节摘要/行号钉在当前工作树，
主仓合法移动hybridSearchFacts也使测试失败。历史gap-classification原字节保留；
日常测试检查完整gap映射、分类、数量及当前源码锚点存在，允许无关注释/行号变化，删除锚点仍拒绝。
原摘要/行号通过原候选Git blob重放核验，不能用今天的源码重新签名历史审计。

另一复现表明旧 `--verify` 仅对比声明规则列表，未重新观测validator探针；停用validator后旧有效报告仍可验证。
修复在verify时复用现有规则观测函数，缺失或未知诊断规则立即invalid。新增真实入口validator-noop verify负例，
原报告字节保持。此更强检查不授予运行权限，也不改六条关系和任何执行owner。
新审查/合并证据在 `harness/specs/fixtures/architecture-review-integration/`，既有final包保留原候选。
