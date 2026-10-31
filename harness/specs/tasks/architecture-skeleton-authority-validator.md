---
id: architecture-skeleton-authority-validator
lifecycleStatus: active
title: 唯一 owner 冲突的确定性校验与门禁接入
type: task
intent: 把上一节点裁定的「唯一 owner」规则实现为确定性校验：同一组件出现冲突 owner / 冲突 default / 冲突 authority 时 fail-closed，允许显式登记的豁免并记录理由；校验接入既有门禁，坏例不能产生有效 pass。
requiredRules:
  - contract-first-boundary
  - capability-owner-resolution
  - repository-artifact-retention
ownedPaths:
  - scripts/check-semantic-authority.mjs
  - scripts/check-semantic-authority.d.mts
  - scripts/check-semantic-authority-adjudication.json
  - scripts/lib/ts-import-hooks.mjs
  - scripts/lib/registry-fixture.mjs
  - tests/unit/semantic-authority-consistency.test.ts
  - tests/fixtures/semantic-authority/**
  - docs/dev/architecture-skeleton/AUTHORITY-VALIDATOR.md
  - docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md
  - docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md
  - scripts/repository-artifacts.json
  - .gitignore
  - harness/specs/tasks/architecture-skeleton-authority-validator.md
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/architecture-skeleton-authority-validator.md
  - pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-authority-validator.md
  - node scripts/check-semantic-authority.mjs
  - pnpm exec vitest run tests/unit/semantic-authority-consistency.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/component-authority-manifest.test.ts tests/unit/component-disposition-catalog.test.ts tests/unit/capability-claims.test.ts tests/unit/reliability-boundaries.test.ts tests/unit/sensitive-content-boundary.test.ts tests/unit/product-semantics.test.ts --maxWorkers=1
  - pnpm contract:check
  - pnpm repo:artifacts:check
  - git diff --check
acceptance:
  - 校验器从磁盘读取六份注册表并产出结构化诊断，定位到 componentId / 表 / 字段 / 规则。
  - 正例（当前仓库的真实注册表）通过；每个已裁定冲突要么在校验器中被显式豁免，要么被修正而非放宽。
  - 独立负例证明：冲突 owner、冲突 default、冲突 authority、表缺失组件、豁免缺理由五类输入分别被拒绝且诊断可定位。
  - 校验接入既有门禁入口；不新增 package script 时，须在既有 harness 或 vitest 路径中被真实调用，且空报告/漏调用不能产生有效 pass。
  - 现有注册表条目、运行时行为、默认值与消费点保持不变；不新增第二真源。
nonGoals:
  - 不合并或删除注册表，不新增统一本体或图存储。
  - 不新增产品模块、Host API、UI 或运行时组件。
  - 不改变产品锁、默认矩阵、发布状态或 GA 口径。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md
    - docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md
---

# 唯一 owner 冲突的确定性校验与门禁接入

## 背景

架构骨架收敛批次 B 的第二步（B1）。依赖 `architecture-skeleton-authority-reconciliation`（TF-0631）的映射与裁定；全部输入在 `docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md` §3.1（身份键 I-1…I-5）、§6.1（轴向规则 R-I / R-O / R-F / R-D1…R-D4 / R-A / R-G）、§6.2（C-01…C-06）、§6.3（X-01…X-05）、§6.4（G-01…G-06）、§7（给本节点的输入）。本合同的执行决策、落点与收口口径由 `docs/dev/architecture-skeleton/CLOSURE-DECISIONS-20261031.md` §2 固定；两份文档冲突时以本合同为准，并在本合同内修订。

## 本轮范围

把裁定变成可执行校验。这是骨架收敛里「语义唯一」的机械保证点。只读六份注册表；不修改任何注册表条目；不新增 package script；不为 G-07（`window` 模块命名漂移，L4 身份 gap）增加规则。

## 实现前的基线纪律

1. 实现开始前执行 `git rev-parse HEAD; git rev-parse 'HEAD^{tree}'; git status --porcelain | wc -l`，工作区必须为 0 行；候选 commit 由本节点自己产生。
2. **不得沿用 TF-0631（基线 `fd2d93a41`）或收口决策轮（基线 `2b87c1c44`）的读数作为验收候选**；校验器在实现候选上重新读取六表并把计数写进报告。两轮读数只用于对照：六表 35 / 44 / 54 / 45 / 7 / 7 / 7+6（+32 task boundary，22 flag）；R-D1 不等 2、R-D2 不对称 2、R-D3 冲突 2、R-D4 冲突 2（R-D4 其余为 ok 5 / exempt 6，见 AUTHORITY-RECONCILIATION §6.1 勘误）；未拥有的读数据类型 16。
3. 七个 TS 注册表模块中，`component-authority-manifest.ts`、`dcs/component-disposition-catalog.ts`、`product-semantics.ts` 以 `./x.js` 形式导入其 `.ts` 邻居，plain Node 直接 `import()` 会 `ERR_MODULE_NOT_FOUND`；本合同用下节的解析钩子解决，**不**引入 esbuild / tsx 等非直接依赖，**不**改注册表的导入写法。

## 校验器落点与加载方式

| 件 | 路径 | 说明 |
|---|---|---|
| CLI 入口 | `scripts/check-semantic-authority.mjs` | `node scripts/check-semantic-authority.mjs [--fixture <json>]... [--report <path>] [--actor <name>]`；正例 exit 0、门禁失败 exit 1、输入自身坏（fixture 不存在 / `find` 不命中 / Node 不支持类型剥离 / 注册表无法加载）exit 2。导出纯函数 `evaluateSemanticAuthority(registries, adjudication, options)` 与规则常量，供 vitest 直接调用；`register()` 只在 `isMainEntrypoint` 分支内执行，被 import 时无副作用 |
| 类型声明 | `scripts/check-semantic-authority.d.mts` | 与 `scripts/contract-check.d.mts` 同惯例 |
| 解析 / 加载钩子 | `scripts/lib/ts-import-hooks.mjs` | `node:module` 自定义钩子：`resolve` 把相对 `./x.js` 在磁盘无 `.js` 但有 `.ts` 时回退到 `.ts`；`load` 对 `initialize(data)` 收到的内存改写表命中的文件 URL 返回改写后的源码（`format: 'module-typescript'`），其余交给 `nextLoad`。改写只在内存，**不触盘**，`git status` 在任何 fixture 运行后不变 |
| fixture 加载器 | `scripts/lib/registry-fixture.mjs` | 读取 `ContractCheckFixture/v1`（与 `tests/fixtures/contract-check/*.json` 同 schema：`id`、`mutations[]`，每条 `file` + `find/replace` \| `append` \| `prepend`，按目标文件自身 EOL 归一化），输出 `{ [absolutePath]: mutatedText }`。本节点**不修改** `scripts/contract-check.mjs` 内嵌的同等逻辑；两处并存记为卫生债，由后续 L4 卫生节点统一 |
| Node 守卫 | 入口内 | `process.features.typescript` 为假时 exit 2 并提示需 Node ≥ 23.6（CI `.github/workflows/check.yml` 使用 Node 24；本地 `v24.22.1`） |
| 裁定登记表 | `scripts/check-semantic-authority-adjudication.json` | schema `SemanticAuthorityAdjudication/v1`，见下文 |
| 单测与真实入口 | `tests/unit/semantic-authority-consistency.test.ts` | (a) 直接 import 注册表与 `evaluateSemanticAuthority` 做规则级断言；(b) `real gate entry` 组用 `execFile(process.execPath, ['scripts/check-semantic-authority.mjs', ...])` 跑正例 / 每个负例 / 坏 fixture / 缺登记表，断言 exit 码、诊断行与报告字段（与 `tests/unit/contract-check.test.ts:386-423` 同形） |
| 负例 fixture | `tests/fixtures/semantic-authority/*.json` | 见"负例要求" |
| 输出文档 | `docs/dev/architecture-skeleton/AUTHORITY-VALIDATOR.md` | 已落地事实、复现命令、证据链、验收逐条对照；经 `scripts/repository-artifacts.json` `retainedFiles` + `node scripts/check-repository-artifacts.mjs --write-ignore` 跟踪 |

## 规则集（封闭；规则 id 在校验器与测试中各写一次并互相对账）

诊断家族统一为 `semantic-authority`。校验器先执行两份矩阵自带校验器（`validateComponentAuthorityManifest()`、`validateComponentDispositionManifest(...)`，其输入与 `tests/unit/component-disposition-catalog.test.ts:28-37` 同源），把它们的每条错误（含 `unknown_coverage`、`duplicate_authority`）原样转成诊断，**复用而非重写**。

| 规则 id | 轴（AUTHORITY-RECONCILIATION） | 判定 | 失败条件 |
|---|---|---|---|
| `registry-self-validation` | §2.1 自带校验 | 两份矩阵自带校验器的错误逐条透传 | 任一错误 |
| `identity-key` | R-I（I-1 / I-2） | 处置 → 组件只经 `coverage.authorityComponentIds`；每个权威组件恰有 1 条 `component.*` 处置项；id 后缀不作身份 | 1:1 不成立 |
| `concept-alias` | R-I（I-4） | 概念 → 组件只承认精确同 id 或登记表 `conceptAliases` 中的别名 | 别名指向不存在的组件 |
| `owner-namespace` | R-O（C-01） | 处置 `owner` 必须 ∈ 本条 `coverage.authorityComponentIds`，或为 `TF-\d{4}` 且等于本条 `implementationNodeId` / `retirementNodeId`；**不**把 `owner` 当授权声明比较 | 其余任何值 → **冲突 owner** |
| `flag-binding` | R-F | 22 个 flag 三方连接（权威 `catalogFlagIds` / 处置 `dcsFlagIds` / flag 目录）且 owner 一致；`catalogFlagIds` 多于 1 的组件只在 flag 粒度比较（X-01） | 任一 flag 缺连接或 owner 不一致 |
| `default-activation` | R-D1 | 权威 `defaultMode ∈ {baseline, opt-in, shadow, disabled}` 与处置 `currentMode ∈ {baseline, opt-in, shadow}` 必须相等；`mixed` 与 `internal` / `read-only` 不可比（X-04，列出不判定） | 可比且不等 → **冲突 default** |
| `default-retirement` | R-D2 | 权威 `defaultMode === 'retired'` ⇔ 处置 `disposition === 'retired'` | 不对称 → **冲突 default** |
| `default-matrix-row` | R-D3 | `runtimeAvailabilitySource` 指向 `docs/dev/default-config-matrix.md#<行>` 时，该行加粗默认值 `true`→baseline、`retired`→retired、`false`/`off`→非 baseline；`auto` 等无枚举值列出不判定（X-05） | 不符 → **冲突 default** |
| `default-flag-risk` | R-D4 | `runtimeAvailabilitySource` 为 `DCS_PROD_FLAGS:<flag>` 时，`baseline-on`↔baseline、`opt-in`↔opt-in、`shadow-only`↔shadow；`api-only` / `request-only` / `read-only` 与权威非激活轴值列出不判定 | 不符 → **冲突 default** |
| `authority-boundary` | R-A（§4.3） | 登记表 `authorityBindings` 逐条：关系存在且 `authorityBoundary === expectedBoundary`；绑定组件存在且满足 `requires`（`ownedDataTypes` / `forbiddenActions` 子集）；权威 44 行键唯一、每 dataType 单 owner、`authorizationRole: 'owner'` 恰 1（透传自带校验） | 任一不符 → **冲突 authority** |
| `gap-registration` | R-G（G-01…G-06） | 任何处置项无权威绑定且无法经 flag / `owner` 反查、任何产品概念无组件、任何只被读取的数据类型、任何无精确锚点连接的可靠性子系统 / 敏感面，必须在登记表 `gaps` 中有条目 | 未登记 → **表缺失组件**（`gap-unregistered`）；已登记但已有身份 → `gap-stale` |
| `exemption-reason-missing` | §7.2 | 登记表每条（exemption / adjudicatedConflict / gap / alias / binding）必须有非空 `reason`、`reviewCondition`、`source` | 缺任一 → **豁免缺理由** |
| `exemption-stale` | §1.2 / §1.6（终态化） | 登记条目记录的两侧原值必须仍等于当前注册表值 | 不等（例如权威矩阵已修正）→ 拒绝，提示删除该条 |
| `exemption-unknown-rule` / `exemption-unknown-target` | 登记表自洽 | 条目引用的规则 id 必须在封闭集内、目标 id 必须存在 | 不符 |
| `adjudication-missing` / `registry-load-failed` | fail-closed | 登记表缺失或不可解析、任一注册表加载失败 | 立即失败，不静默跳过 |

**不得实现的比较**（实现即判失败，测试断言其不存在）：`targetDefaultMode === defaultMode`（X-03，21 个假阳性）；跨表比较 `internal`（X-02，4 对）；按处置 id 后缀推导身份（O-1，9 处）；把处置 `owner` 当 owner 比较（C-01）；为 `window` 模块增加规则（G-07）。

## 裁定登记表 `scripts/check-semantic-authority-adjudication.json`

`SemanticAuthorityAdjudication/v1`，是 AUTHORITY-RECONCILIATION §6.2 / §6.3 / §6.4 / §3.1 / §4.3 的机器形式（与批次 A 的 `scripts/contract-check-flat-ipc.json` 同性质：裁定簿记，不是 owner / default / authority 的真源）。每条目必填 `id`、`rule`、`targets`、`basis: 'explicit-adjudication'`、`source`（文档锚点）、`reason`、`reviewCondition`，以及规则所需的两侧原值（供 `exemption-stale` 对账）。

| 区段 | 种子（必须登记的最小集） | 处置值 |
|---|---|---|
| `exemptions` | X-01（7 个 coding flag 的粒度差）、X-02（4 对 `internal` 碰撞）、X-03（18 对 target≠default）、X-04（20 对激活轴不可比）、X-05（5 行无枚举文档值） | `structural` |
| `adjudicatedConflicts` | C-02、C-03、C-04、C-05、C-06 | **`registered-pending-fix`**（本合同的决定：先登记，不 fail-closed；理由与复核条件见 CLOSURE-DECISIONS §2.3；权威矩阵修正落地后该条因 `exemption-stale` 自动失效并须删除；**不得**通过放宽规则达成绿灯） |
| `gaps` | G-01、G-02、G-03×5、G-04×16、G-05×5、G-06×7（共 35 条） | `registered` |
| `conceptAliases` | `routing-memo` → `routing-memo-observation`（I-4） | — |
| `authorityBindings` | `task-loop--roots-in--task-ledger`（要求 `task-ledger` 拥有 `task.fact`、`task.working-context`）、`workboard--references-one-way--task-ledger`（要求 `task-ledger.forbiddenActions ∋ own-runtime-scheduler`，禁止边界 `task-ledger-authority`）、`routing-memo--quality-gated-by--task-loop`（要求 `routing-memo-observation.forbiddenActions ∋ grant-routing-permissions`） | — |

C-01 **不**登记为豁免：它的读取规则（经 coverage 取 owner）必须实现。

## 诊断格式

与批次 A 完全一致：`<file>[:<line>]: [semantic-authority/<rule>] <message>`。`<file>` 指向最适合修复的位置（`shared/component-authority-manifest.ts`、`shared/dcs/component-disposition-catalog.ts`、`shared/product-semantics.ts`、`docs/dev/default-config-matrix.md`、`shared/dcs/prod-flags-catalog.ts` 或登记表）；`<line>` 由条目 id 字面量（`id: '<componentId>'`、`{ from: '<x>'`）在（改写后的）源码文本中的位置得到；`<message>` 必含 componentId / 表 / 字段 / 规则。无法定位行号时省略 `:<line>`，不得猜测。

## 负例要求（五类各 ≥ 1 个 fixture，经真实入口执行）

| 类 | fixture（`tests/fixtures/semantic-authority/`） | 最小变异 | 期望规则 |
|---|---|---|---|
| 冲突 owner | `owner-conflict.json` | 处置 `component.task-ledger` 的 `owner` 改为 `permission-approval-authority`，coverage 不变 | `owner-namespace` |
| 冲突 default | `default-retirement-asymmetry.json` | 权威 `dcs-context-authority` `defaultMode: 'baseline'` → `'retired'`（处置仍 internal / baseline） | `default-retirement` |
| 冲突 default（第二形） | `default-activation-mismatch.json` | 处置 `component.dcs-context-tools` `currentMode: 'opt-in'` → `'shadow'`（权威仍 opt-in） | `default-activation` |
| 冲突 authority | `authority-boundary-reversed.json` | 产品语义 workboard→task-ledger 的 `authorityBoundary: 'one-way-reference'` → `'task-ledger-authority'` | `authority-boundary` |
| 表声明矩阵中不存在的组件 | `coverage-unknown-component.json` | 处置 `component.task-ledger` 的 `coverage.authorityComponentIds` 改为 `['ghost-component']` | `registry-self-validation`（透传 `unknown_coverage`，复用不重写） |
| 表声明矩阵中不存在的组件（第二形） | `gap-unregistered-concept.json` | 登记表删除 G-03 的 `chat` 条目 | `gap-registration`（`gap-unregistered`） |
| 豁免缺理由 | `exemption-reason-missing.json` | 登记表 X-03 中 `dcs-context-authority` 条目 `reason` 置空 | `exemption-reason-missing` |
| 对照：陈旧豁免 | `exemption-stale.json` | 权威 `working-memory-context-source` `defaultMode` 改为 `baseline`（即 C-02 已修正）而登记表未删 | `exemption-stale` |
| 对照：缺登记表 | （CLI 参数 `--adjudication tests/fixtures/semantic-authority/does-not-exist.json`） | — | `adjudication-missing`，exit 1 |
| 对照：坏 fixture | `does-not-exist.json` / `find` 不命中 | — | exit 2 |
| 对照：正例 | 无 fixture | 当前仓库 | exit 0；报告 `diagnostics: []`，`rulesEvaluated` 等于封闭集 |

每个 fixture 的 `find` 必须含条目 id 字面量以保证唯一命中；测试对每个负例断言**精确的诊断集合**（不要求恰好 1 条，但每条都可定位且含期望规则）。

## 集成要求（门禁入口）

- 真实消费点：`pnpm test`（`vitest.config.ts:145` 包含 `tests/unit/**`；CI `.github/workflows/check.yml` 执行 `pnpm run test`）。`tests/unit/semantic-authority-consistency.test.ts` 的 `real gate entry` 组 spawn CLI，正例、每个负例、坏 fixture、缺登记表各一次。
- "空报告 / 漏调用不能产生有效 pass"的机械保证：测试断言报告 `counts.components === 35`（以实现候选上的实际读数为准）、`rulesEvaluated` 与封闭集逐一相等、`diagnostics` 为空且 `exitCode === 0`；缺登记表 → exit 1；注册表加载失败 → exit 2，三者都不能得到 0。
- 不修改 `package.json`、`scripts/contract-check.mjs`、`scripts/check-evidence-refs.mjs`；不把校验接入 `harness:ci` 命令链（如需独立于 vitest 的 CI 消费点，由后续 L4 卫生节点在 `harness:ci` 追加 `node scripts/check-semantic-authority.mjs`，不在本节点）。

## 写集边界

- 只允许改动 frontmatter `ownedPaths` 列出的路径。
- **禁止**改动：`shared/component-authority-manifest.ts`、`shared/dcs/component-disposition-catalog.ts`、`shared/capability-claims.ts`、`shared/reliability-boundaries.ts`、`shared/sensitive-content-boundary.ts`、`shared/product-semantics.ts`、`shared/dcs/prod-flags-catalog.ts`、`docs/dev/default-config-matrix.md`、`docs/clawx-product-semantics.md`、`package.json`、`scripts/contract-check*.{mjs,json}`、`scripts/check-evidence-refs.mjs`、`electron/**`、`src/**`、`openclaw_runtime/**`。
- 对 `docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md` 只允许追加勘误块（R-D4 "一致 6" 实为 5），不改裁定。

## 证据回读与收口

| 验收条（frontmatter） | 证据文件 | 从磁盘回读方式 |
|---|---|---|
| 1 读六表、产出可定位诊断 | `scripts/check-semantic-authority.mjs`；`node scripts/check-semantic-authority.mjs --report D:/tmp/tf0632/report.json` 产出的 `SemanticAuthorityReport/v1`（`candidate.commit/tree/dirty`、`counts`、`rulesEvaluated`、`diagnostics`、`actor`、`command`、`exitCode`）；AUTHORITY-VALIDATOR.md §证据链 回填报告摘录 | Read 报告 JSON 与文档表；不以 shell 打印行为准 |
| 2 正例通过、已裁定冲突显式豁免 | 登记表 `adjudicatedConflicts`（C-02…C-06，`registered-pending-fix`，各带 reason / reviewCondition / source）；正例报告 `diagnostics: []` | Read 登记表与报告 |
| 3 五类负例被拒且可定位 | `tests/fixtures/semantic-authority/*.json`（≥ 7）；循环 `for f in tests/fixtures/semantic-authority/*.json; do node scripts/check-semantic-authority.mjs --fixture "$f"; echo "exit=$?"; done > D:/tmp/tf0632/fixtures.log 2>&1` | Read 日志；每个负例 exit 1 且诊断含期望规则 |
| 4 接入既有门禁、空报告不能 pass | `tests/unit/semantic-authority-consistency.test.ts`（含 real gate entry 组）；`pnpm exec vitest run … --reporter=json --outputFile=D:/tmp/tf0632/vitest.json` | Read vitest JSON（`numFailedTests === 0`，用例名含 `real gate entry`） |
| 5 注册表 / 运行时 / 默认值 / 消费点不变 | `git diff --stat <base>..<candidate> -- shared/ electron/ src/ openclaw_runtime/ package.json docs/dev/default-config-matrix.md`（期望 0 行）；六表单测与 `pnpm contract:check` 仍绿 | Read diff 输出文件与 vitest JSON |

收口按 `AGENTS.md` §Task Forest closure policy 与 `harness/specs/rules/task-forest-autoclose-and-roles.md`：全部验收条由磁盘产物核实、证据链完整、`proposal-save` 自填的 `base_graph_hash` 在 `proposal-apply --yes` 时仍匹配、节点主张自洽，则自动收口；收口前 `todo --ready --json` 中 stored-status 为 `ready` 的节点必须恰为 TF-0632。未运行的全量门禁（`pnpm run typecheck`、全量 `pnpm test`、E2E、lint 全仓、agent-dev、live provider）如实记 `not-run`。所有产物标 `driven_by: agent` 与实际 actor。

## 验收

见 frontmatter `acceptance`。
