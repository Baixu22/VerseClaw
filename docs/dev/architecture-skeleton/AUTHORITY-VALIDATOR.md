# 唯一 owner 冲突的确定性校验与门禁接入（AUTHORITY-VALIDATOR）

> 状态：`implemented + gated`（校验器已落地并接入既有 vitest 门禁；**不修改任何注册表**，已裁定冲突以 `registered-pending-fix` 登记而非放宽）
> 节点：`TF-0632`（批次 B / B1，父 `TF-0628` 架构骨架收敛）
> 合同：`harness/specs/tasks/architecture-skeleton-authority-validator.md`（2026-10-31 收口决策轮修订版）
> 决策：`docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md` §2
> 输入：`docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md`（TF-0631）§3.1、§6.1–§6.4、§7
> 录入日期：2026-11-01，Asia/Shanghai
> 产出者：agent（`driven_by: agent`，`actor: claude-fable-5`）；本文件不含任何真人操作、真人数据或真人 verdict

本文件记录 TF-0631 裁定的机械化结果：六份注册表由 plain Node **执行**（不是正则解析）后按身份键与轴向规则对齐；17 条封闭规则产出 `<file>[:<line>]: [semantic-authority/<rule>] <message>` 诊断；TF-0631 的全部裁定（X-01…X-05、C-02…C-06、G-01…G-06、I-4、R-A 三条绑定）以登记表承载并记录两侧原值，使豁免**自到期**；五类负例经真实入口被拒绝；门禁消费点是 CI 已经执行的 `pnpm test`。本轮**零字节**改动六份注册表、flag 目录、两份文档矩阵、`package.json`、`scripts/contract-check*`、`scripts/check-evidence-refs.mjs`、`electron/**`、`src/**`、`openclaw_runtime/**`。

---

## 0. 基线

| 项 | 值 |
|---|---|
| 开工 HEAD（实现开始时） | `2b87c1c44cf5b38df2127296307d5123c6784856`（TF-0631 候选；工作区 `git status --porcelain` 0 行） |
| 实现期间基线前移 | 收口决策轮在同一检出上提交 `1090f0b88c80584a9c36400d5f98d7a736af16e0`（tree `4d3fa4d5660723781ba21e564af8aeb5919dfa63`）：修订本合同、新增 `CLOSURE-DECISIONS-20261031.md` / `OPERATOR-PLAN-20261031.md` / `ontology-lite-contract-implementation.md`、追加 AUTHORITY-RECONCILIATION §6.1 R-D4 勘误（`TFD-ca7eb218be`）。本轮读数全部在 `1090f0b88` 上重取；§11 门禁亦在其上运行 |
| 本轮写集（相对 `1090f0b88`） | 新增 7 项：`scripts/check-semantic-authority.mjs`（960 行）、`scripts/check-semantic-authority.d.mts`（21）、`scripts/check-semantic-authority-adjudication.json`（1445）、`scripts/lib/ts-import-hooks.mjs`（42）、`scripts/lib/registry-fixture.mjs`（96）、`tests/unit/semantic-authority-consistency.test.ts`（519）、`tests/fixtures/semantic-authority/`（10 负例 + `broken/` 2 坏例）；加本文件与其 `retainedFiles` / `.gitignore` 例外 |
| Task Forest | 开工时 `todo --json` 中 stored-status 为 `ready` 的节点恰为 1 个：`TF-0632`；TF-0633 `proposed`，其四叶 TF-0634…TF-0637 已由决策轮登记（`depends_on` 串行，C1 依赖 TF-0632） |
| 执行工具 | Node `v24.22.1`（`process.features.typescript === 'strip'`），无 esbuild / tsx；vitest `4.1.1` |
| 六表读数（候选上重取，与 TF-0631 / 决策轮一致） | 组件 35 / authority 行 44 / 处置 54 / 主张 45 / 可靠性 7 / 敏感面 7 / 概念 7 + 关系 6；邻接 flag 目录 22 |

---

## 1. 结论摘要

| 项 | 实测 | 备注 |
|---|---|---|
| 封闭规则 | **17** | §3；测试与校验器各写一份并逐项对账 |
| 正例（当前注册表 + 登记表） | **exit 0，诊断 0** | `summary … rules=17 diagnostics=0 adjudicated=8 structural=54 gaps=35/35 aliases=1 bindings=3 not-comparable=20 matrix-unmapped=5` |
| 登记表为空时的原始诊断 | **43** = 默认态冲突 8 条（5 组件：C-02×2、C-03×2、C-04×2、C-05、C-06）+ gap 35 | 与 AUTHORITY-RECONCILIATION §7.3 / CLOSURE-DECISIONS §2.9 一致；owner 规则对 10 条 TF 节点 owner 全部通过；authority 冲突 0 |
| 已裁定冲突（`registered-pending-fix`） | **5 项 / 8 条目** | C-02…C-06；每条记两侧原值，权威矩阵修正后由 `exemption-stale` 自动失效（§4） |
| 结构性豁免（`structural`） | **54 条目** = X-01 7 flag / X-02 4 / X-03 18 / X-04 20 / X-05 5 | 每条含原值，变化即 stale |
| gap（`registered`） | **35** = G-01 1 / G-02 1 / G-03 5 / G-04 16 / G-05 5 / G-06 7 | 双向对账：观察到未登记 → `gap-unregistered`；登记却不再观察到 → `gap-stale` |
| 概念别名 / authority 绑定 | **1 / 3** | I-4；A-01…A-03（§4.3 的三条可核对关系） |
| 负例 fixture | **10**（五类合同负例 + 对照）**全部 exit 1**，诊断数与 `expectIssueCount` 逐一相等 | §5；另 2 坏例 exit 2、缺登记表 exit 1、缺 fixture 文件 / 未知参数 exit 2 |
| vitest | **38 / 38** | 规则级 23 用例（真实注册表 + 变异克隆）+ 真实入口 15 用例（含 10 fixture、2 坏例） |
| 门禁消费点 | `pnpm test`（CI `check.yml:88`）→ `tests/unit/**` 含本测试；本合同 `requiredTests` 直接调用 CLI | 未改 `package.json`、`harness:ci`、`contract-check`、`check-evidence-refs` |
| 修改的注册表 / 运行时路径 | **0** | `git diff --stat HEAD -- shared/ electron/ src/ openclaw_runtime/ package.json docs/dev/default-config-matrix.md docs/clawx-product-semantics.md scripts/contract-check* scripts/check-evidence-refs.mjs` → 0 行 |

---

## 2. 落点与加载方式

| 件 | 路径 | 说明 |
|---|---|---|
| CLI 入口 | `scripts/check-semantic-authority.mjs` | `node scripts/check-semantic-authority.mjs [--fixture <json>]... [--adjudication <json>] [--report <path>] [--actor <name>]`。exit **0** 通过；**1** 门禁失败（含缺登记表 `adjudication-missing`）；**2** 输入自身坏：fixture 不存在 / `find` 不命中 / fixture 改写了本门禁不读的文件 / 未知参数 / `process.features.typescript` 为假 / 注册表无法执行（`registry-load-failed`）。导出纯函数 `evaluateSemanticAuthority(registries, adjudication, options)`、`assembleRegistries(modules, inputs)` 与常量 `RULES` 等；`register()` 只在 `isMainEntrypoint` 分支内由 `loadRegistries()` 调用，被 import 时无副作用 |
| 解析 / 加载钩子 | `scripts/lib/ts-import-hooks.mjs` | `node:module` `register()` 钩子：`initialize(data)` 收内存改写表（file URL → 文本）；`resolve` 把相对 `./x.js` 在磁盘无 `.js` 但有 `.ts` 时回退到 `.ts`（三个注册表模块以 `./x.js` 导入 `.ts` 邻居，plain Node 直接 import 为 `ERR_MODULE_NOT_FOUND`）；`load` 对所有 `.ts` 返回显式 `format: 'module-typescript'`（命中改写表则返回改写文本），因此 `src/**` 下无 `"type"` 字段的模块不会触发格式探测与 `MODULE_TYPELESS_PACKAGE_JSON` 警告。改写只在内存，`git status` 在任何 fixture 运行前后不变（测试断言） |
| fixture 加载器 | `scripts/lib/registry-fixture.mjs` | 读取 `ContractCheckFixture/v1`（与 `tests/fixtures/contract-check/*.json` 同 schema：`id`、`mutations[]`，每条 `file` + `find/replace` \| `append` \| `prepend`，按目标文件自身 EOL 归一化），输出 `{ texts: { [realpath]: mutatedText }, files: { [relative]: realpath } }`。`find` 不命中抛 `RegistryFixtureError` → exit 2。TF-0636 复用这两个 `scripts/lib/*`（实现合同 `ontology-lite-contract-implementation.md:71`） |
| 输入装配 | `assembleRegistries()` | 执行七个 TS 模块（六表 + flag 目录）与两个校验输入模块（`openclaw_runtime/src/config/runtime-feature-leaves.ts`、`src/pages/Settings/route-config.ts`），读 `src/components/settings/*.tsx` 文件名、`src/App.tsx` 路由、`tests/fixtures/component-graduation/task-forest-node-ids.json`、两份文档矩阵；以与 `tests/unit/component-disposition-catalog.test.ts:28-37` 同源的输入运行 `validateComponentDispositionManifest()`，并运行 `validateComponentAuthorityManifest()`。vitest 用同一函数装配（由 vitest 自身解析 `.js`→`.ts`），因此规则级断言与 CLI 走同一输入 |
| 登记表 | `scripts/check-semantic-authority-adjudication.json` | `SemanticAuthorityAdjudication/v1`，§4 |
| 负例 | `tests/fixtures/semantic-authority/*.json`，`broken/*.json` | §5 |
| 单测 | `tests/unit/semantic-authority-consistency.test.ts` | (a) 规则级：真实注册表 + 真实登记表 → 0 诊断与各计数；`structuredClone` 后变异单个事实 → 预期规则；登记表变异 → 预期 `exemption-*` / `gap-registration`。(b) `real gate entry` 组 `execFile(process.execPath, ['scripts/check-semantic-authority.mjs', …])`：正例（含 `--report` 回读）、每个 fixture（exit 1、诊断数 == `expectIssueCount`、含期望诊断、每行可定位且规则在封闭集内、报告回读）、缺登记表 exit 1、坏 fixture exit 2、缺 fixture 文件 / 未知参数 exit 2、工作区不变 |
| 报告 | `--report <path>` → `SemanticAuthorityReport/v1` | `generatedAt`、`actor`（`--actor` / `SEMANTIC_AUTHORITY_ACTOR` / `agent`）、`drivenBy: 'agent'`、`command`、`exitCode`、`candidate{commit,tree,dirty,changedPaths}`、`fixtures`、`adjudication`、`counts`、`rulesEvaluated`、`diagnostics`、`adjudicated`、`exemptionsApplied`、`adjudicatedConflicts`、`gapsRegistered`、`conceptAliases`、`authorityBindings`、`notComparable`、`matrixUnmapped`、`flagGranularity`、`gaps`、`exemptions` |

---

## 3. 规则集（封闭，17 条；诊断家族 `semantic-authority`）

| 规则 id | 轴（AUTHORITY-RECONCILIATION） | 判定 | 当前树 |
|---|---|---|---|
| `registry-self-validation` | §2.1 自带校验 | `validateComponentAuthorityManifest()` 与 `validateComponentDispositionManifest(...)` 的每条错误（`duplicate_authority`、`unknown_coverage`、`unclassified_component`、`visible_shadow_surface`…）原样透传，`<line>` 由 `issue.path` 字面量定位；任一校验器无结果 → 失败 | 0 |
| `identity-key` | R-I（I-1 / I-2） | 每个权威组件恰被 1 条 `component.*` 处置项经 `coverage.authorityComponentIds` 覆盖；主张 id `capability-NN` 且 `reportItem == NN` 且唯一；子系统 / 敏感面 / 概念 id 唯一；关系 `from--kind--to` 唯一且端点存在。**不**按处置 id 后缀推导身份（O-1 的 9 处漂移不产生诊断） | 0 |
| `concept-alias` | R-I（I-4） | 概念 → 组件只承认精确同 id 或登记表 `conceptAliases`；别名重复或对精确同 id 的概念冗余登记 → 失败；别名端点不存在 → `exemption-unknown-target` | 0 |
| `owner-namespace` | R-O（C-01） | 处置 `owner` 为 `TF-\d{4}` 时须等于本条 `implementationNodeId ?? retirementNodeId`；否则须是权威组件 id，且本条有 coverage 时须 ∈ coverage。**不**把 `owner` 当授权声明比较；owner 由权威矩阵声明 | 0（10 条节点 owner 全部等于责任节点） |
| `flag-binding` | R-F / I-3（X-01） | 每个 flag 恰被 1 个组件 `catalogFlagIds` 与 1 条处置 `dcsFlagIds` 绑定；处置项 `owner` == 绑定组件，或该组件 ∈ coverage，或 `owner` 为 TF 节点；处置项不覆盖该组件（feature 粒度）时，flag risk 的激活语义（baseline-on↔baseline、opt-in↔opt-in、shadow-only↔shadow）与处置 `currentMode` 比较，api-only / request-only / read-only 无激活语义不判 | 0；feature 粒度 7 flag 记入报告 `flagGranularity` 并由 X-01 钉住 |
| `default-activation` | R-D1（X-02 / X-03 / X-04） | 权威 `defaultMode ∈ {baseline, opt-in, shadow, disabled}` 与处置 `currentMode ∈ {baseline, opt-in, shadow}` 必须相等；不可比对（`mixed`、权威 internal / read-only；退役侧归 R-D2）记入报告 `notComparable`，不判定。**不**比较 `targetDefaultMode === defaultMode`，**不**跨表比较 `internal` | 原始 2（C-02、C-03，已登记）；不可比 20 |
| `default-retirement` | R-D2 | 权威 `defaultMode === 'retired'` ⇔ 处置 `disposition === 'retired'` | 原始 2（C-04、C-06，已登记） |
| `default-matrix-row` | R-D3（X-05） | `runtimeAvailabilitySource` 指向 `docs/dev/default-config-matrix.md#<行>` 时，该行加粗默认值 `true`→baseline、`retired`→retired、`false`/`off`→非 baseline 非 retired；行缺失 → 失败（fail-closed）；`auto` 等无枚举值的行以及产品面文档的 `deferred` / `diagnostics-only` 行只列入报告 `matrixUnmapped`（5 行） | 原始 2（C-04、C-05，已登记） |
| `default-flag-risk` | R-D4 | `runtimeAvailabilitySource` 为 `DCS_PROD_FLAGS:<flag>` 时，flag risk 激活语义与权威激活态比较；flag 不存在 → 失败 | 原始 2（C-02、C-03）；13 个来源中 ok 5 / 豁免 6 / 冲突 2（与 §6.1 勘误一致） |
| `authority-boundary` | R-A（§4.3） | 每 dataType 单 authority owner（超出自带校验的键级唯一）；`ownedDataTypes` 跨组件不重叠；`authorizationRole: 'owner'` 恰 1；登记表 `authorityBindings` 逐条：关系存在、`authorityBoundary === expectedBoundary`、不在 `forbiddenBoundaries`、绑定组件满足 `requires`（`ownedDataTypes` / `forbiddenActions` 子集）；同一目标概念不得被 ≥ 2 条 authority 类边界（`task-ledger-authority`）声明 | 0 |
| `gap-registration` | R-G（G-01…G-06） | 计算五类 gap：无权威绑定、无 flag 反查、`owner` 非组件的处置项；无组件（含别名）的概念；只被读取的数据类型；无精确锚点连接的可靠性子系统 / 敏感面。与登记表 `gaps` 双向对账：`gap-unregistered` / `gap-stale` | 35 观察 = 35 登记 |
| `exemption-reason-missing` | §7.2 | 登记表每条目（五个区段）必须有非空 `reason`、`reviewCondition`、`source`（须指向 `AUTHORITY-RECONCILIATION.md#<节>`）、`basis: 'explicit-adjudication'`；缺任一即失败且该条**不应用** | 0 |
| `exemption-stale` | §1.2 / §1.6 终态化 | `exemptions` / `adjudicatedConflicts` 条目记录的 `observed` 字段必须逐一等于当前注册表值；`registered-pending-fix` 条目的诊断不再触发也为 stale；**stale 条目不再压制任何诊断**。身份已在 `identity-key` 失败的组件不重复报 | 0 |
| `exemption-unknown-rule` | 登记表自洽 | 条目 `rule` 必须在封闭集且不是元规则；区段 `disposition` 必须是该区段的固定值；gap `class` 必须是五类之一 | 0 |
| `exemption-unknown-target` | 登记表自洽 | 条目目标按 `targetKind`（component / disposition / flag / concept / data-type / subsystem / surface / doc-row / relation）必须存在于注册表或权威矩阵链接表；同一 (区段, id, rule, target) 不得重复 | 0 |
| `adjudication-missing` | fail-closed | 登记表缺失 / 不可解析 / schema 不符 → 立即失败（exit 1），不评估其余规则 | — |
| `registry-load-failed` | fail-closed | 任一注册表或校验输入模块无法执行 → exit 2 并写入报告 | — |

**不得实现的比较**（测试断言规则 id 不在封闭集内，并在真实注册表上断言无诊断）：`targetDefaultMode === defaultMode`（22 对分歧，其中 18 对由 X-03 钉住、4 对为已登记冲突）；跨表比较 `internal`（4 对由 X-02 钉住）；按处置 id 后缀推导身份（9 处漂移）；把处置 `owner` 当 owner 比较（C-01）；为 `window` 模块增加规则（G-07）。

---

## 4. 登记表 `scripts/check-semantic-authority-adjudication.json`

`SemanticAuthorityAdjudication/v1`；是 AUTHORITY-RECONCILIATION §6.2 / §6.3 / §6.4 / §3.1 / §4.3 的机器形式——裁定簿记，**不是** owner / default / authority 的真源：每条只引用注册表 id，记录裁定时的两侧原值（供 `exemption-stale` 对账），并携带 `reason`、`reviewCondition`、`source`（文档节锚点）、`basis: 'explicit-adjudication'`。由 `D:\tmp\gen-adjudication.mjs`（临时、不入库）在 `1090f0b88` 上从执行后的注册表生成，理由文本逐条转写自 TF-0631。

| 区段 | `disposition` | 条目 | 目标与原值 |
|---|---|---|---|
| `exemptions` | `structural` | **54** | X-01 ×7（flag：`stale-write-guard`、`write-journal`、`worktree-backend`、`isolation-request`、`symbol-lease`、`symbol-lease-mode`、`patch-flow`；原值 `manifestComponentId` / `dispositionEntryId` / `risk`）；X-02 ×4（`knowledge-review-authority`、`skills-mcp-source-registry`、`task-ledger`、`tool-search-schema-expander`；`defaultMode` / `dispositionId` / `disposition`）；X-03 ×18（§6.3 原列表；`defaultMode` / `dispositionId` / `targetDefaultMode`）；X-04 ×20（§6.3 原列表；`defaultMode` / `dispositionId` / `currentMode`）；X-05 ×5（doc-row：`DCS Fact view tools`=auto、`Coding auto verify`=auto、`SEKB automatic writeback`=deferred、`C7 knowledge/routing cutover`=deferred、`Runtime Memory injection`=diagnostics-only） |
| `adjudicatedConflicts` | `registered-pending-fix` | **8**（5 项裁定） | `C-02/R-D1`、`C-02/R-D4`（`working-memory-context-source`）；`C-03/R-D1`、`C-03/R-D4`（`tool-registry-context-source`）；`C-04/R-D2`、`C-04/R-D3`（`vtoken-context-source`）；`C-05/R-D3`（`vtoken-bridge`）；`C-06/R-D2`（`retired-surface-registry`）。原值按规则记 `defaultMode` + `currentMode` / `disposition` / `sourceFlag`+`flagRisk` / `matrixRow`+`matrixValue` |
| `gaps` | `registered` | **35** | G-01 `feature.agent-map`；G-02 `feature.runtime-shadow-governance`；G-03 ×5 概念；G-04 ×16 数据类型；G-05 ×5 子系统；G-06 ×7 敏感面 |
| `conceptAliases` | — | **1** | I-4 `routing-memo` → `routing-memo-observation` |
| `authorityBindings` | — | **3** | A-01 `task-loop--roots-in--task-ledger`（期望 `task-ledger-authority`；要求 `task-ledger.ownedDataTypes ⊇ {task.fact, task.working-context}`）；A-02 `workboard--references-one-way--task-ledger`（期望 `one-way-reference`，禁止 `task-ledger-authority`；要求 `forbiddenActions ∋ own-runtime-scheduler`）；A-03 `routing-memo--quality-gated-by--task-loop`（期望 `same-session-scorecard`；要求 `routing-memo-observation.forbiddenActions ∋ grant-routing-permissions`） |

**C-01 不登记**：其读取规则（经 coverage 取 owner；TF 节点值 == 责任节点）实现为 `owner-namespace`，不可豁免。

**为什么 C-02…C-06 先登记而不 fail-closed**（CLOSURE-DECISIONS §2.3）：fail-closed 会让 `pnpm test` 在当前 main 立刻变红，而修正 5 个陈旧 `defaultMode` 是另一个节点的写集（本节点明令禁改注册表）。登记不放宽规则：规则照常计算并把冲突记入报告 `adjudicated`；一旦权威矩阵修正，记录的原值与当前值不等，`exemption-stale` 使该条失效并要求删除（§5 `exemption-stale.json` 正是这一路径的负例）。

---

## 5. 负例 fixture 与真实入口

全部经 `node scripts/check-semantic-authority.mjs --fixture <json>` 执行；改写只在内存。`expectIssueCount` 为精确诊断数；每条诊断形如 `<file>[:<line>]: [semantic-authority/<rule>] …`，规则均在封闭集内（测试逐行断言）。

| 合同类 | fixture | 最小变异 | 期望规则 | exit / 诊断数 |
|---|---|---|---|---|
| 冲突 owner | `owner-conflict.json` | 处置 `component.task-ledger` `owner` → `permission-approval-authority`，coverage 不变 | `owner-namespace` | 1 / 1 |
| 冲突 owner（第二形） | `owner-node-mismatch.json` | 处置 `component.vtoken-context` `owner` `TF-0496` → `TF-0001` | `owner-namespace` | 1 / 1 |
| 冲突 default | `default-retirement-asymmetry.json` | 权威 `dcs-context-authority` `baseline` → `retired`（处置仍 internal / baseline） | `default-retirement`（+ X-03 该组件原值变化 → `exemption-stale`） | 1 / 2 |
| 冲突 default（第二形） | `default-activation-mismatch.json` | 处置 `component.dcs-context-tools` `currentMode` `opt-in` → `shadow`（权威仍 opt-in） | `default-activation`（+ 自带校验 `visible_shadow_surface` 透传） | 1 / 2 |
| 冲突 authority | `authority-boundary-reversed.json` | 产品语义 workboard→task-ledger `one-way-reference` → `task-ledger-authority` | `authority-boundary`（A-02 期望边界、禁止边界；task-ledger 两个 authority 类声明方各报一条） | 1 / 4 |
| 冲突 authority（第二形） | `authority-data-type-multi-owner.json` | 权威矩阵给 `browser-task-projection-owner` 加 `task.fact` 的 ownedDataTypes / allowedWrites 与一条 `task.fact::task::update` authority 行（自带校验器接受：键唯一） | `authority-boundary`（dataType 双 owner；ownedDataTypes 重叠） | 1 / 2 |
| 表声明矩阵中不存在的组件 | `coverage-unknown-component.json` | 处置 `component.task-ledger` coverage → `['ghost-component']` | `registry-self-validation`（透传 `unknown_coverage`、`unclassified_component`，复用不重写）+ `identity-key` + `owner-namespace` | 1 / 4 |
| 表声明矩阵中不存在的组件（第二形） | `gap-unregistered-concept.json` | 登记表删除 G-03 `chat` 条目 | `gap-registration`（`gap-unregistered`） | 1 / 1 |
| 豁免缺理由 | `exemption-reason-missing.json` | 登记表 X-03 `dcs-context-authority` 条目 `reason` 置空 | `exemption-reason-missing`（条目不应用） | 1 / 1 |
| 对照：陈旧豁免 | `exemption-stale.json` | 权威 `working-memory-context-source` `opt-in` → `baseline`（即 C-02 已修正）而登记表未删 | `exemption-stale`（C-02/R-D1、C-02/R-D4 各一条） | 1 / 2 |
| 对照：缺登记表 | （CLI）`--adjudication tests/fixtures/semantic-authority/does-not-exist.json` | — | `adjudication-missing` | 1 / 1 |
| 对照：坏 fixture | `broken/target-not-found.json`（`find` 不命中）、`broken/never-applied.json`（改写 `package.json`，本门禁不读） | — | `Semantic authority fixture error:` | 2 |
| 对照：缺 fixture 文件 / 未知参数 | `--fixture …/does-not-exist.json`、`--nope` | — | 同上 | 2 |
| 对照：正例 | 无 fixture | 当前仓库 | 报告 `diagnostics: []`、`rulesEvaluated` == 封闭集、`counts.components` 35、`exitCode` 0 | 0 |

"空报告 / 漏调用不能 pass"的机械保证：vitest 正例用例回读 `--report` JSON 断言 `exitCode 0`、`diagnostics` 空、`rulesEvaluated` 与封闭集逐一相等、`counts.components === 35`、`adjudicated` 8；缺登记表 exit 1；注册表加载失败与坏 fixture exit 2——三者都得不到 0。`pnpm test` 是 CI 已消费的入口（`.github/workflows/check.yml:88`），本测试在 `tests/unit/**` 下被其包含。

---

## 6. 不变量（本轮未改）

- 六份注册表、`shared/dcs/prod-flags-catalog.ts`、`docs/dev/default-config-matrix.md`、`docs/clawx-product-semantics.md` 零字节改动；六表自带单测 51/51 仍绿（§11 #11）。
- `package.json` 未改：无新 script，`harness:ci` 未追加；`scripts/contract-check.mjs` / `scripts/contract-check-flat-ipc.json`（批次 A）与 `scripts/check-evidence-refs.mjs`（批次 C 写集）未改；`pnpm contract:check` 仍绿。
- `electron/**`、`src/**`、`openclaw_runtime/**` 未改；无新增 Host API、UI、运行时组件、统一本体、图存储或第二真源（登记表只引用 id 与裁定原值）。
- 产品锁、默认矩阵、发布状态、GA 口径未改；"以 X 为准"仍是裁定，不是修改。
- AUTHORITY-RECONCILIATION.md 本轮未再改动（R-D4 勘误已由决策轮追加，`TFD-ca7eb218be`；本轮 R-D4 实测 ok 5 / exempt 6 / conflict 2 与之一致）。
- 对 G-07（`window` 模块命名漂移）未加规则，按 TF-0631 §6.6 留给 L4 节点。

---

## 7. 复现命令（离线，仓库根目录，Git Bash；临时目录 `D:\tmp`）

```bash
# 7.1 基线
git rev-parse HEAD; git rev-parse 'HEAD^{tree}'; git status --porcelain | wc -l
node -p "process.features.typescript"        # 期望 'strip'（否则入口 exit 2）
```

```bash
# 7.2 正例 + 报告
node scripts/check-semantic-authority.mjs
node scripts/check-semantic-authority.mjs --report D:/tmp/tf0632/report.json --actor claude-fable-5
# 期望 stdout：Semantic authority check passed. / summary components=35 authorities=44 dispositions=54 claims=45 reliability=7 sensitive=7 concepts=7 relations=6 flags=22 | rules=17 diagnostics=0 adjudicated=8 structural=54 gaps=35/35 aliases=1 bindings=3 not-comparable=20 matrix-unmapped=5
```

```bash
# 7.3 全部负例（每个 exit 1，诊断数 == expectIssueCount）、坏例（exit 2）、缺登记表（exit 1）
for f in tests/fixtures/semantic-authority/*.json; do node scripts/check-semantic-authority.mjs --fixture "$f"; echo "exit=$?"; done > D:/tmp/tf0632/fixtures.log 2>&1
for f in tests/fixtures/semantic-authority/broken/*.json; do node scripts/check-semantic-authority.mjs --fixture "$f"; echo "exit=$?"; done >> D:/tmp/tf0632/fixtures.log 2>&1
node scripts/check-semantic-authority.mjs --adjudication tests/fixtures/semantic-authority/does-not-exist.json; echo "exit=$?"
grep -c '^exit=1' D:/tmp/tf0632/fixtures.log   # → 10 ；grep -c '^exit=2' → 2
```

```bash
# 7.4 登记表为空时的原始诊断（期望 43：默认态 8 + gap 35；exit 1）
printf '{"schema":"SemanticAuthorityAdjudication/v1"}' > D:/tmp/tf0632/empty.json
node scripts/check-semantic-authority.mjs --adjudication D:/tmp/tf0632/empty.json 2>&1 | grep -c '^- '
```

```bash
# 7.5 单测（规则级 + 真实入口）与门禁
export TEMP='D:\tmp' TMP='D:\tmp'
pnpm exec vitest run tests/unit/semantic-authority-consistency.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/tmp/tf0632/vitest.json
node -e "const r=require('D:/tmp/tf0632/vitest.json');console.log(r.numTotalTests,r.numFailedTests,r.success)"   # → 38 0 true
pnpm contract:check; node scripts/check-local-paths.mjs; node scripts/check-evidence-refs.mjs; node scripts/check-repository-artifacts.mjs; pnpm harness:specs:lifecycle; git diff --check
pnpm exec eslint scripts/check-semantic-authority.mjs scripts/lib/ts-import-hooks.mjs scripts/lib/registry-fixture.mjs tests/unit/semantic-authority-consistency.test.ts
```

```bash
# 7.6 注册表 / 运行时路径未改（期望 0）
git diff --stat 1090f0b88..HEAD -- shared/ electron/ src/ openclaw_runtime/ package.json docs/dev/default-config-matrix.md docs/clawx-product-semantics.md scripts/contract-check.mjs scripts/contract-check-flat-ipc.json scripts/check-evidence-refs.mjs | wc -l
```

---

## 8. 与宪章 §5 批次 B 验收口径 / §8 判据的对应

| 口径 / 判据 | 本轮状态 |
|---|---|
| B1：冲突 owner / default / authority fail-closed；允许显式豁免并记录理由 | **达成**：`owner-namespace` / `default-*` / `authority-boundary` 对变异立即 exit 1（§5）；豁免只能带理由、复核条件、来源与原值登记，且自到期 |
| 每个组件在权威矩阵中有唯一 owner | **机械保证**：`identity-key` 1:1、`authority-boundary` 每 dataType 单 owner、`owner-namespace` 禁止 owner 字段漂移 |
| 冲突为 0 或已显式豁免 | **达成**：原始冲突 5 项全部 `registered-pending-fix`（非 0，非放宽，非永久） |
| 现有语义文件的消费点未变 | **达成**：§6 |
| §8 "语义合同坏例拒绝率 100% 在预期规则上拒绝" | 10/10 fixture 在预期规则上拒绝，诊断集合精确断言 |
| §8 "陈旧来源被当作当前通过 = 0" | 登记表原值对账 + 报告 `candidate.commit/tree/dirty`；陈旧登记由 `exemption-stale` 拒绝 |
| §8 "新增运行时组件 / 第二真源 = 0" | 0 |

---

## 9. 边界声明

- 本文件记录实现与证据，不改变任何裁定；C-02…C-06 的修正、G-01…G-06 的解决、`owner` 字段拆分（C-01 的撤销条件）都是**后续节点**的写集。
- 校验器只读；fixture 改写只在内存；报告写到调用方指定路径（本轮 `D:\tmp\tf0632\`，不入库）。
- 钩子依赖 Node ≥ 23.6 的默认类型剥离（本地与 CI 均为 24）；不满足时 exit 2，不静默通过。
- `registry-self-validation` 的处置校验输入与 `tests/unit/component-disposition-catalog.test.ts` 同源，但 `now` 钉在 `2026-10-21T00:00:00.000Z`（与该测试一致），因此 `experiment` 过期判定不随日历漂移。
- 全部产出为 agent 驱动（`driven_by: agent`，`actor: claude-fable-5`）；没有真人操作、真人数据或真人 verdict 参与；没有任何以真人为前置的验收条件。
- 本文件不声称任何性能、收益或采用率。

---

## 10. 残余风险与后续输入

| 项 | 性质 | 去向 |
|---|---|---|
| 5 个陈旧 `defaultMode`（C-02…C-06）仍在权威矩阵中 | 已登记、待修正；修正落地时本登记表 8 条自动 stale，须同步删除 | 后续节点（注册表写集） |
| 处置 `owner` 混用组件 id 与 TF 节点号（C-01） | 读取规则已实现；schema 拆分未做 | 处置矩阵下次修订 |
| 35 条 gap | 全部登记、不默认通过；无一解决 | G-01/G-02/G-03/G-04 → 权威矩阵声明或显式外部 owner 表；G-05/G-06 → 条目组件字段或锚点路径 |
| `exemption-stale` 的 doc-row 原值依赖两份文档的表格形状（加粗默认值 / 反引号标签） | 文档改格式会使 X-05 条目 stale（fail-closed，而非漏判） | 届时更新解析或登记 |
| fixture 只能改写本门禁读取的 15 个文件（§2 `readableProjectFiles`） | 改写其他文件 → exit 2（不会假通过），但也意味着传递导入的 `.ts` 邻居（如 `shared/types/task-ledger-reference.ts`）不可作为 fixture 目标 | 如需，扩展可读集并补测试 |
| `pnpm harness validate --spec …authority-validator.md`（无 `--since`）在本检出失败：默认 diff 基 `origin/main`（`2b87c1c44`）包含决策轮未推送提交 `1090f0b88` 的 4 个非本节点文件 | 环境态（上游未推送），非本节点写集问题；`--since HEAD` 通过（§11 #2/#3） | 上游推送后消失 |
| 决策轮已把 TF-0634…TF-0637 登记为 TF-0633 四叶并要求复用 `scripts/lib/ts-import-hooks.mjs` / `registry-fixture.mjs` | 本轮接口：`initialize({ rewrites })`、`loadRegistryFixtures(paths, { root })` → `{ fixtures, texts, files }` | TF-0636 |
| not-run | `pnpm run typecheck` 全量、`pnpm test` 全量、E2E、`pnpm run lint` 全仓（只对新增 4 文件跑 eslint + `check-no-bom`）、agent-dev 门禁、live provider / Gateway | 不得解读为已通过 |

---

## 11. 证据链

以下命令于 2026-11-01 在 HEAD `1090f0b88`（工作区含本轮未提交新增文件）上运行；退出码由 shell 直接捕获，日志在 `D:\tmp\tf0632\{gates.log,gates2.log,fixtures.log,vitest.json,report-precandidate.json}`（本地保留，不入库）。

| # | 命令 | exit | 关键输出 |
|---|---|---|---|
| 1 | `pnpm harness context --spec harness/specs/tasks/architecture-skeleton-authority-validator.md` | 0 | 最小阅读清单（rules: `contract-first-boundary` / `capability-owner-resolution` / `repository-artifact-retention`；layer: `harness`） |
| 2 | `pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-authority-validator.md` | **1** | `changed files are not covered by touchedAreas or ownedPaths: docs/dev/architecture-skeleton/CHARTER.md, …/OPERATOR-PLAN-20261031.md, docs/dev/dsh-superagent-absorption-20261031.md, harness/specs/tasks/ontology-lite-contract-implementation.md`——全部是决策轮提交 `1090f0b88` 的文件（`origin/main` 仍为 `2b87c1c44`），非本节点写集；见 #3 |
| 3 | `pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-authority-validator.md --since HEAD` | 0 | `Spec is valid: harness\specs\tasks\architecture-skeleton-authority-validator.md`（CLOSURE-DECISIONS §4.3 规定的未提交改动口径） |
| 4 | `node scripts/check-semantic-authority.mjs` | 0 | `Semantic authority check passed.` + `summary … rules=17 diagnostics=0 adjudicated=8 structural=54 gaps=35/35 aliases=1 bindings=3 not-comparable=20 matrix-unmapped=5` |
| 5 | `node scripts/check-semantic-authority.mjs --report D:/tmp/tf0632/report-precandidate.json --actor claude-fable-5` | 0 | 报告：`schema SemanticAuthorityReport/v1`、`actor claude-fable-5`、`drivenBy agent`、`candidate.commit 1090f0b88…`、`candidate.dirty true`（changedPaths = 本轮 7 项新增）、`counts.components 35`、`rulesEvaluated` 17、`diagnostics []`、`exemptionsApplied {X-01:7,X-02:4,X-03:18,X-04:20,X-05:5}`、`adjudicatedConflicts {rulings:5,entries:8}`、`gapsRegistered {total:35}` |
| 6 | `pnpm exec vitest run tests/unit/semantic-authority-consistency.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/tmp/tf0632/vitest.json` | 0 | `numTotalTests 38, numFailedTests 0, success true`（含 `real gate entry` 组 15 用例） |
| 7 | 10 个 fixture 逐个 `--fixture`（§7.3） | 10 × **1** | 每个诊断数 == `expectIssueCount`，含期望诊断（`D:\tmp\tf0632\fixtures.log`） |
| 8 | `broken/never-applied.json`、`broken/target-not-found.json` | 2 / 2 | `Semantic authority fixture error: fixture mutation never applied (file is not read by this gate): package.json` / `… fixture mutation target not found in shared/dcs/component-disposition-catalog.ts: …` |
| 9 | `--adjudication tests/fixtures/semantic-authority/does-not-exist.json` | 1 | `[semantic-authority/adjudication-missing] adjudication registry … is missing or unparsable …` |
| 10 | `pnpm contract:check` | 0 | `Contract check passed.` |
| 11 | `pnpm exec vitest run` 六表自带单测（component-authority-manifest / component-disposition-catalog / capability-claims / reliability-boundaries / sensitive-content-boundary / product-semantics）`--maxWorkers=1` | 0 | `Test Files 6 passed (6)`，`Tests 51 passed (51)` |
| 12 | `node scripts/check-local-paths.mjs` | 0 | `[local-paths] PASS active docs contain no developer-local absolute paths` |
| 13 | `node scripts/check-evidence-refs.mjs` | 0 | `[evidence-refs] PASS 188 referenced path(s)` |
| 14 | `node scripts/check-repository-artifacts.mjs`（`pnpm repo:artifacts:check`） | 0 | `Repository artifact retention passed (19993 tracked paths).` |
| 15 | `pnpm harness:specs:lifecycle` | 0 | `[specs] lifecycle status present for 686 task specs.` |
| 16 | `pnpm exec eslint scripts/check-semantic-authority.mjs scripts/lib/ts-import-hooks.mjs scripts/lib/registry-fixture.mjs tests/unit/semantic-authority-consistency.test.ts`；`node scripts/check-no-bom.mjs` | 0 / 0 | 0 error 0 warning |
| 17 | `git diff --check` | 0 | 无输出 |
| 18 | `git diff --stat HEAD -- shared/ electron/ src/ openclaw_runtime/ package.json docs/dev/default-config-matrix.md docs/clawx-product-semantics.md scripts/contract-check.mjs scripts/contract-check-flat-ipc.json scripts/check-evidence-refs.mjs \| wc -l` | 0 | `0` |

#14、#17 在本文件经 `retainedFiles` + `--write-ignore` 跟踪后再次运行（见 §11.1）。

### 11.1 本文件入库与候选提交后复核

（候选提交后回填：候选 commit / tree、`dirty: false` 的报告读数、#14 / #17 复跑结果、`git diff --stat 1090f0b88..<candidate>` 对禁改路径的 0 行。）

**验收逐条对照**（合同 frontmatter `acceptance`）：

| 验收条 | 状态 | 证据位置 |
|---|---|---|
| 校验器从磁盘读取六份注册表并产出结构化诊断，定位到 componentId / 表 / 字段 / 规则 | 达成 | §2（执行加载）、§3（17 规则，`<file>[:<line>]: [semantic-authority/<rule>]`，message 含 componentId / 表 / 字段）；#4 / #5 报告 `diagnostics` 结构化 |
| 正例通过；每个已裁定冲突要么显式豁免，要么被修正而非放宽 | 达成 | #4 exit 0；C-02…C-06 为 `registered-pending-fix` 且自到期（§4、`exemption-stale.json`）；规则未放宽（登记表为空时 43 条原始诊断，§7.4） |
| 五类负例分别被拒绝且诊断可定位 | 达成 | §5 十个 fixture（五类各 ≥ 1）全部 exit 1，#7；每行 `file[:line]` + 规则，测试逐行断言 |
| 校验接入既有门禁入口；空报告 / 漏调用不能产生有效 pass | 达成 | `pnpm test` 路径的 vitest（CI 消费）spawn 真实入口；#6 报告回读断言；缺登记表 exit 1（#9）、坏 fixture exit 2（#8）；合同 `requiredTests` 直接调用 CLI；未新增 package script |
| 现有注册表条目、运行时行为、默认值与消费点保持不变；不新增第二真源 | 达成 | §6；#10、#11、#18 |
