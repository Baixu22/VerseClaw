---
id: architecture-skeleton-authority-reconciliation-hardening
lifecycleStatus: active
title: 语义权威校验 B2：对账承重化与登记表定位
type: task
intent: 把 TF-0632 校验器里只靠 vitest 计数钉住的四类判定做成 fail-closed：structural exemptions 与 not-comparable / flag-granularity / matrix-unmapped 三个只报告列表都与登记表双向对账；登记表路径的诊断定位到行；权威表自身的重复行以规则诊断而非 exit 2 结束；fixture 锚点纪律由加载器强制。不修改任何注册表。
requiredRules:
  - contract-first-boundary
  - capability-owner-resolution
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
ownedPaths:
  - scripts/check-semantic-authority.mjs
  - scripts/check-semantic-authority.d.mts
  - scripts/check-semantic-authority-adjudication.json
  - scripts/lib/registry-fixture.mjs
  - tests/unit/semantic-authority-consistency.test.ts
  - tests/fixtures/semantic-authority/**
  - docs/dev/architecture-skeleton/AUTHORITY-VALIDATOR.md
  - harness/specs/tasks/architecture-skeleton-authority-reconciliation-hardening.md
humanEvidence: not-required
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-authority-reconciliation-hardening.md --no-diff
  - node scripts/check-semantic-authority.mjs
  - pnpm exec vitest run tests/unit/semantic-authority-consistency.test.ts --maxWorkers=1
  - pnpm contract:check
  - pnpm repo:evidence:check
  - node scripts/check-repository-artifacts.mjs
  - node scripts/check-local-paths.mjs
  - pnpm harness:specs:lifecycle
  - pnpm run typecheck
  - node scripts/check-no-bom.mjs
  - git diff --check
acceptance:
  - exemptions 为空或缺任一条 structural 条目时校验器 exit 1 并定位到缺失条目：五类 structural（X-01 flag-granularity / X-02 internal-vocabulary / X-03 target-divergence / X-04 not-comparable / X-05 matrix-unmapped）各有一个由注册表计算的 observed 集合，与登记表 registered 集合双向对账，形态同 gaps（structural-unregistered / structural-stale）。
  - notComparable / flagGranularity / matrixUnmapped 三个列表分别就是 X-04 / X-01 / X-05 的 observed 集合；未登记的新项与登记了却不再出现的旧项都产生可定位诊断；三类各有一个经真实入口执行的负例。
  - 登记表路径的每条诊断带 scripts/check-semantic-authority-adjudication.json:<line>，行号由条目 id 字面量在登记表文本中的位置得到，同 id 多条时以 id + target 组合定位，无条目可指时定位到区段键所在行；authority-boundary 的数据类型诊断带 shared/component-authority-manifest.ts 来源行号。
  - 权威表重复 authority 行（duplicate_authority）经真实入口以 [semantic-authority/registry-self-validation] 规则诊断结束（exit 1），不再是 registry-load-failed exit 2；负例走真实入口；六份注册表零字节改动。
  - fixture 锚点纪律由 scripts/lib/registry-fixture.mjs 在 anchors=required 模式下强制：每条 find 变异必须声明 anchor（条目 id 字面量）且 find 包含它、find 在目标文本中恰好命中一次，否则拒绝加载（exit 2）；现有 fixture 全部补齐锚点并通过。
  - 所有新增负例经 tests/unit/semantic-authority-consistency.test.ts 真实 spawn 入口断言退出码与诊断码；现有 12 个 fixture 的 exit code 与诊断数不变（只补锚点）。正例（当前仓库）继续 exit 0 且 adjudicated=8 / gaps=35/35 不变；structural 读数以 observed/registered 形式给出且相等。
  - AUTHORITY-VALIDATOR.md 新增 §13 记录四项对账的规则、复现命令与门禁 exit code，并把 §12.3 第 1–4 条标注已落地（TF-0638）。
nonGoals:
  - 不修改六份注册表（shared/component-authority-manifest.ts、shared/dcs/component-disposition-catalog.ts、shared/capability-claims.ts、shared/reliability-boundaries.ts、shared/sensitive-content-boundary.ts、shared/product-semantics.ts）、flag 目录、两份文档矩阵。
  - 不新增 package script、Host API、运行时组件或第二真源；不改产品锁、默认矩阵、发布状态。
  - 不实现 I-5（capability claims 精确锚点连接）；不改 ts-import-hooks 的 .js 优先策略；不合并两份 relationKey 实现。
  - 不修改 scripts/check-evidence-refs.mjs 及其 fixture：锚点纪律是加载器的可选模式，由本门禁开启。
  - 不引入任何以真人操作或真人数据为前置的验收条件。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/AUTHORITY-VALIDATOR.md
    - docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md
---

# 语义权威校验 B2：对账承重化与登记表定位

## 背景与输入

批次 B 的第三步（B2，Task Forest `TF-0638`，父 `TF-0628`）。输入是收尾审查
`docs/dev/architecture-skeleton/REVIEW-20261101.md` §1 / §5 与
`docs/dev/architecture-skeleton/AUTHORITY-VALIDATOR.md` §12.3 第 1–4 条：

1. 54 条 structural exemptions 在 CLI 判定中不承重（`exemptions: []` 仍 exit 0）。
2. `notComparable` / `flagGranularity` / `matrixUnmapped` 只报告不对账，与 X-04 的复核条件"保持列出，不默认通过"不符。
3. 登记表路径的诊断 `line` 恒为 `null`；`authority-boundary` 的数据类型诊断无行号。
4. fixture 锚点纪律未强制：12 个 `find` 中 11 个不含条目 id 字面量，加载器只替换首次出现且不检查唯一性。

另一条审查勘误（§12.1）：`duplicate_authority` 因 `shared/component-authority-manifest.ts:1099`
的 `assertComponentAuthorityManifest()` 在 import 时抛错而以 `registry-load-failed` exit 2 结束，
没有规则名与行号。

B1 合同 `harness/specs/tasks/architecture-skeleton-authority-validator.md` 的规则集、登记表 schema、
诊断格式与写集边界**继续有效**；本合同只在其上追加，不复述、不覆盖。两份合同冲突时以本合同为准。

## 对账 1：structural exemptions 承重（新规则 `exemption-registration`）

封闭规则集从 17 条扩为 **18** 条：新增 `exemption-registration`，与 `gap-registration` 同形。

登记表 `exemptions` 区段每条目新增必填字段 `class`，取值与 observed 集合如下（五类的 observed
集合全部由执行后的注册表计算，不读登记表）：

| `class` | 裁定 | `targetKind` | observed 集合（R-D1…R-D4 之外的"列出不判定"集合） | 当前树 |
|---|---|---|---|---|
| `flag-granularity` | X-01 | `flag` | `flagGranularity`：flag 经 `dcsFlagIds` 绑定到的处置项**不**覆盖其 manifest 绑定组件 | 7 |
| `internal-vocabulary` | X-02 | `component` | 权威 `defaultMode === 'internal'` 且其处置项 `disposition === 'default'` | 4 |
| `target-divergence` | X-03 | `component` | 处置 `targetDefaultMode !== defaultMode`，且该组件**不是**任何合法 `adjudicatedConflicts` 条目的目标（这些分歧已作为 C-02…C-05 真冲突登记） | 18 |
| `not-comparable` | X-04 | `component` | `notComparable`：R-D1 两侧有一侧不在激活轴且两侧都非 retired | 20 |
| `matrix-unmapped` | X-05 | `doc-row` | `matrixUnmapped`：权威链接表指向的文档行值不在枚举中 | 5 |

对每一类：`observed` 中有而 `registered` 中无 → `structural-unregistered`；`registered` 中有而
`observed` 中无 → `structural-stale`。两者都是 `[semantic-authority/exemption-registration]`，exit 1。

去重与例外（避免同一条目被重复报告、避免级联）：

- 条目已因 `exemption-stale`（记录的 `observed` 值变化）被报告，或条目本身因字段校验失败（`exemption-reason-missing` / `exemption-unknown-rule` / `exemption-unknown-target`）而不被应用时，**不再**对它追加 `structural-stale`；但它仍计入 `registered`（它的存在已被定位并诊断，缺的是有效性而不是登记）。
- 目标组件已在 `identity-key` 失败（`identityBroken`）时，该组件既不计入 observed 也不要求登记，与 `exemption-stale` 的既有口径一致。
- `class` 缺失或不在五类之内、`targetKind` 与 `class` 不匹配 → `exemption-unknown-rule`，条目不应用。

明确不是冲突规则：`target-divergence` 与 `internal-vocabulary` 的 observed 集合用到 `targetDefaultMode !== defaultMode`
与跨表 `internal` 的**成员谓词**，只用于对账 X-03 / X-02 的登记完整性，不产生任何 `default-*` 诊断；
B1 合同"不得实现的比较"原文不变，测试继续断言这些比较不是规则 id、在真实注册表上无诊断。

报告新增 `structural: { [class]: { observed: string[], registered: string[] } }`，与 `gaps` 同形；
summary 的 `structural=54` 改为 `structural=<observed>/<registered>`（当前 `54/54`）。

## 对账 2：三个只报告列表即三类 observed 集合

`notComparable`（X-04）、`flagGranularity`（X-01）、`matrixUnmapped`（X-05）不再是独立的"只报告"列表：
它们就是对账 1 中三类的 observed 集合，由同一段代码产出并写入报告。三类负例形状（均经真实入口）：

| 负例 | 最小变异 | 期望 |
|---|---|---|
| `structural-not-comparable-unregistered.json` | 处置 `component.dcs-context-authority` `currentMode: 'baseline'` → `'mixed'`（权威仍 baseline） | `structural-unregistered: not-comparable 'dcs-context-authority'`，exit 1 |
| `structural-flag-granularity-unregistered.json` | 把 flag `working-memory` 的 `dcsFlagIds` 从 `component.working-memory-context` 移到 `feature.patch-flow`（owner 为 TF 节点，owner 一致；coverage 不含 `working-memory-context-source`） | `structural-unregistered: flag-granularity 'working-memory'`；以及 feature 级激活比较产生的 `flag-binding`（risk baseline-on ↔ currentMode retired），exit 1 |
| `structural-matrix-unmapped-unregistered.json` | `docs/dev/default-config-matrix.md` 行 `**working-memory**` 的加粗默认值 `**true**` → `**auto**` | `structural-unregistered: matrix-unmapped 'working-memory'`，exit 1 |

对账 1 的负例：`structural-exemption-missing.json`（删除 X-04 `context-runtime-kit` 条目 → 1 条
`structural-unregistered`）、`structural-exemptions-absent.json`（`"exemptions"` 区段键改名使区段缺失 →
54 条 `structural-unregistered`，定位到登记表头部）。stale 方向由进程内用例覆盖（登记一条当前不再观察到的
X-04 目标 → `structural-stale`）。

## 对账 3：登记表路径与权威表的行号定位

- `evaluateSemanticAuthority(registries, adjudication, { adjudicationText })` 接收登记表**文本**；所有 `file === 登记表` 的诊断按下列顺序定位：(a) 条目 `id` 字面量 `"id": "<id>"` 所在行；同 id 多条时，取其后紧随（下一条 `"id":` 之前）出现 `"target": "<target>"`（别名用 `"conceptId"`、绑定用 `"relation"`）的那一条；(b) 无条目可指（`gap-unregistered`、`structural-unregistered`、区段不是数组）→ 区段键 `"<section>":` 所在行；(c) 区段键也不存在 → `"schema"` 所在行。CLI 入口总是传入文本；进程内用例可不传（行号为 `null`，字符串形态不变）。
- `authority-boundary` 的数据类型诊断：`data type 'X' has N authority owners` 定位到第 2 个 owner 的 authority 行（同一行含 `dataType: 'X'` 与 `authorityComponentId: '<owner>'`）；`is listed in ownedDataTypes of N components` 定位到第 2 个组件块内含 `ownedDataTypes` 与 `'X'` 的行；定位不到时回退到组件 `id: '<componentId>'` 行，仍不到则省略 `:<line>`，不猜测。
- `registry-self-validation` 透传 `duplicate_authority` 时定位到**最后一次**出现 `dataType / scope / operation` 三元组的 authority 行（即重复行）。

验证：vitest 对一个登记表负例回读 `--report`，断言每条登记表路径诊断 `line` 为正整数，且登记表第 `line`
行文本包含该诊断对应条目的 id 字面量（或区段键）。

## 对账 4：`duplicate_authority` 经真实入口以规则诊断结束

`loadRegistries()` 向导入钩子提供的权威表文本，把**顶层**（列首）那一行 `assertComponentAuthorityManifest();`
替换为同一行的 `void 0;` 注释——只在内存，文件零字节改动，行数不变（函数体内缩进的同名调用不受影响）。
门禁自己已经通过 `assembleRegistries()` 调用 `validateComponentAuthorityManifest()` 并透传全部错误，
因此重复行自然以 `[semantic-authority/registry-self-validation] duplicate_authority: …` 结束，exit 1。

替换模式未命中（文件被重构）时不做任何改写，行为回到既有的 `registry-load-failed` exit 2——fail-closed。

负例：`authority-duplicate-row.json`（复制 `vtoken.bridge-runtime::global::update` 这一行 → 1 条
`registry-self-validation`，exit 1；owner 相同，`authority-boundary` 不触发）。

## 对账 5：fixture 锚点纪律

`scripts/lib/registry-fixture.mjs` 新增可选模式 `loadRegistryFixtures(paths, { root, anchors: 'required' })`：

- 每条含 `find` 的变异必须声明非空字符串 `anchor`（被变异条目的 id 字面量，例如 `id: 'component.task-ledger'`、`"id": "X-03"`、`**working-memory**`、`dataType: 'vtoken.bridge-runtime'`），且 `find` 必须包含 `anchor`；
- `find` 在（逐步变异中的）目标文本里必须恰好命中 **1** 次；0 次仍是"target not found"，≥ 2 次是"ambiguous"；
- 任一不满足 → `RegistryFixtureError` → 本门禁 exit 2。
- 默认模式（不传 `anchors`）行为不变，`scripts/check-evidence-refs.mjs` 不受影响。

`scripts/check-semantic-authority.mjs` 以 `anchors: 'required'` 调用加载器；12 个既有 fixture 补齐 `anchor`
并把 `find` 扩到包含条目 id 字面量；新增坏例 `broken/anchor-missing.json`（无 `anchor`）、
`broken/anchor-not-in-find.json`（`find` 不含 `anchor`）、`broken/anchor-ambiguous.json`（`find` 命中 2 次），
均 exit 2。

## 写集与硬边界

只允许改动 frontmatter `ownedPaths`。**禁止**改动六份注册表、`shared/dcs/prod-flags-catalog.ts`、
`docs/dev/default-config-matrix.md`、`docs/clawx-product-semantics.md`、`package.json`、`scripts/contract-check*`、
`scripts/check-evidence-refs.mjs`、`scripts/lib/ts-import-hooks.mjs`、`electron/**`、`src/**`、`openclaw_runtime/**`。
登记表只新增 `class` 字段与（若对账要求）新的 structural 条目并在文档说明来源；不改任何裁定。

## 证据回读与收口

| 验收条 | 证据 | 回读方式 |
|---|---|---|
| 1、2 对账承重 | `--report` 的 `structural.{class}.observed/registered`；五个 structural 负例 exit 1 | Read 报告 JSON 与 fixtures 日志 |
| 3 行号 | 登记表负例报告中每条登记表路径诊断 `line`；vitest 用例回读行文本 | Read 报告 JSON / vitest JSON |
| 4 duplicate_authority | `authority-duplicate-row.json` exit 1 且诊断为 `registry-self-validation` | Read fixtures 日志 |
| 5 锚点 | 三个 `broken/anchor-*.json` exit 2；12 个既有 fixture exit 1 诊断数不变 | Read fixtures 日志 |
| 6 真实入口 | vitest JSON `numFailedTests === 0`，`real gate entry` 组覆盖全部 fixture | Read vitest JSON |
| 7 文档 | AUTHORITY-VALIDATOR.md §13 与 §12.3 标注 | Read 文档 |

收口按 `AGENTS.md` §Task Forest closure policy 与 `harness/specs/rules/task-forest-autoclose-and-roles.md`：
全部验收条由磁盘产物核实、`base_graph_hash` 仍匹配、`todo --json` 中 stored-status `ready` 恰为 TF-0638，
则 `proposal-save` → `proposal-apply --yes` → `validate` → `export`，同一提案把 TF-0639 置 ready。
未运行的全量门禁（全量 `pnpm test`、E2E、lint 全仓、agent-dev、live provider）如实记 `not-run`。
所有产物 `driven_by: agent`。

## 验收

见 frontmatter `acceptance`。
