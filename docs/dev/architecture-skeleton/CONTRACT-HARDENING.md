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
