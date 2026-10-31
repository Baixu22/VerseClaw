# 语义权威矩阵逐条对齐与冲突裁定（AUTHORITY-RECONCILIATION）

> 状态：`alignment + adjudication`（只读对齐、只裁定；**不授权实现，不修改任何注册表**）
> 节点：`TF-0631`（批次 B / B0，父 `TF-0628` 架构骨架收敛）
> 合同：`harness/specs/tasks/architecture-skeleton-authority-reconciliation.md`
> 宪章：`docs/dev/architecture-skeleton/CHARTER.md` §1.2、§5 批次 B、§6 硬边界
> 录入日期：2026-10-31，Asia/Shanghai
> 产出者：agent（`driven_by: agent`，`actor: claude-fable-5`）；本文件不含任何真人操作、真人数据或真人 verdict

本文件回答合同第 48–53 行的四个问题：六份注册表的条目数与 id 约定（§2）、同一组件的跨表映射（§4）、某表存在但权威矩阵缺失的组件及反向（§5）、每个冲突的裁定或显式豁免与 gap（§6）。所有数字由**执行注册表本体**（esbuild 打包后 Node 直接 import）与**磁盘静态读取**得到，复现命令见 §10。本轮**不修改**六份注册表中的任何一份，**不**合并、**不**删除、**不**新增注册表，**不**新增 Host API / UI / package script / 运行时组件，**不**改产品锁、默认矩阵、发布状态。本文件把「对齐」写成对齐，**不**把它写成「已统一」：机械统一是 TF-0632 的工作，本文件只给它输入。

---

## 0. 基线

| 项 | 值 |
|---|---|
| HEAD | `fd2d93a41ae5f0b43e68b575fbdefd61ab29095f` |
| tree | `8327f888bcadedc730fed2a0d7150e150e191c4d` |
| 分支 | `main`（仓库主检出） |
| 工作区 | 开工时 `git status --porcelain` 0 行（干净） |
| Task Forest | `todo --json` 中 stored-status 为 `ready` 的节点恰为 1 个：`TF-0631`；处置矩阵引用的实施节点 `TF-0493`…`TF-0511` 在本地 Task Forest 中**全部 `done`** |
| `shared/component-authority-manifest.ts` | 1099 行，blob `875b2fd13d` |
| `shared/dcs/component-disposition-catalog.ts` | 623 行，blob `df1dd65415` |
| `shared/capability-claims.ts` | 1437 行，blob `83034dcc2a` |
| `shared/reliability-boundaries.ts` | 109 行，blob `1ecba3a839` |
| `shared/sensitive-content-boundary.ts` | 151 行，blob `f098e1f587` |
| `shared/product-semantics.ts` | 717 行，blob `ba475d37a1`（宪章 §1.3 记为 684 行：差异 +33 行来自宪章落地提交 `1e278652b` 本身加入的 `PRODUCT_SEMANTIC_RELATIONS` 块，:146–:177） |
| 执行工具 | Node `v24.22.1`；esbuild `0.27.4`（`node_modules/.pnpm/esbuild@0.27.4/…`，仅用于把 TS 注册表打包成可 import 的 ESM，不改源码） |

**合同「已知的规模基线」逐项复核**（合同第 55–62 行）：权威矩阵 35 ✓；处置矩阵 54 = internal 24 + default 13 + advanced 12 + retired 5 ✓（experiment 0）；能力主张 45 ✓；可靠性边界 7 ✓；敏感面 7 ✓；产品语义 7 概念 / 6 关系 ✓。本轮额外实测：权威矩阵 44 条 `authorities` 行、11 条 `productSurfaceLinks`、14 条 `defaultMatrixLinks`；`product-semantics.ts` 同文件另有 32 条 `PRODUCT_SEMANTIC_TASK_BOUNDARIES`（P0-00…P0-17、P1-01…P1-14）并再导出邻接文件 `shared/product-semantic-unsafe-claims.ts` 的 5 条 unsafe claim；邻接的 `shared/dcs/prod-flags-catalog.ts` 有 22 个 flag。

**作为裁定证据读取、但不作为注册表对齐对象的邻接来源**：`shared/dcs/prod-flags-catalog.ts`（22 flag，是两份矩阵共同的连接词汇）、`docs/dev/default-config-matrix.md`（14 行默认矩阵，被权威矩阵 `DEFAULT_MATRIX_AUTHORITY_LINKS` 机械对账，`tests/unit/component-authority-manifest.test.ts:173-179`）、`docs/clawx-product-semantics.md`（11 行组件状态表 :176–:190，被 `PRODUCT_SURFACE_AUTHORITY_LINKS` 机械对账，同测试 :160–:171）、`docs/modules/component-inventory.md:20`（处置侧词汇定义）、两份矩阵的单测与联表单测。

---

## 1. 结论摘要

| 项 | 本轮实测 | 备注 |
|---|---|---|
| 六表条目数 | **35 / 54 / 45 / 7 / 7 / 7+6** | 全部与合同基线一致；§2 |
| 身份键 | **权威矩阵 `AUTHORITY_COMPONENTS[].id`（35 个）** | 唯一带导入期断言的 id 空间；处置矩阵经 `coverage.authorityComponentIds` 机械连接；§3 |
| 权威 ↔ 处置 组件连接 | **35 / 35，恰 1:1** | 已由 `tests/unit/component-disposition-catalog.test.ts:86-91` 机械保证 |
| 出现在 ≥ 2 表（机械键）的组件 | **35** | 全部 35 个至少在权威 + 处置两表；其中 5 个经精确锚点/概念 id 再连到第三、四表（§4.1） |
| 处置矩阵有、权威矩阵无绑定的条目 | **19**（feature 8 / surface 9 / settings 2） | 其中 17 条 owner 可由 `owner` 字段或 flag 反查到权威组件，**2 条不能**（→ G-01、G-02）；§5.2 |
| 产品语义概念无权威组件 | **5 / 7**（chat、plan-mode、chat-plan、workboard、task-loop） | → G-03；2 个有（task-ledger 精确、routing-memo→routing-memo-observation） |
| DCS flag 三方连接 | **22 = 22 = 22**，owner 一致 22/22 | 权威 `catalogFlagIds` ↔ 处置 `dcsFlagIds` ↔ flag 目录 |
| 处置 `owner` 命名空间 | 组件 id **44** / TF 节点号 **10** | 10/10 等于本条 implementation/retirement node；→ C-01 |
| 处置 id 后缀 ≠ 组件 id | **9** | 身份不得由 id 后缀推导；O-1 |
| **冲突（已裁定）** | **6**（owner 1 + default 5） | C-01…C-06，**0 条未裁定**；§6.2 |
| **显式豁免（类）** | **5** | X-01…X-05，每条有理由 + 复核条件；§6.3 |
| **gap** | **6 类 / 35 条**：组件级 **7**（处置 feature 2 + 产品概念 5）；数据类型级 16；可靠性子系统 5；敏感面 7 | G-01…G-06；§6.4 |
| 修改的注册表 | **0** | `git status` 本轮仅新增本文件与一行 spec 引用 |
| TF-0629 §7.6 移交项（`window` 模块命名漂移） | 已裁定：**L4 身份 gap（G-07）**，不是六表冲突；不改名、不拆分 | §6.6 |

**裁定总纲（§6.1 逐条展开）**：

1. **身份**以权威矩阵组件 id 为准；处置矩阵只经 `coverage.authorityComponentIds` 连接，不经 id 后缀、不经 `owner`。
2. **owner**只由权威矩阵声明（组件自身 + 44 条 `authorities` 行 + `authorizationRole`）；处置矩阵的 `owner` 是簿记字段（实现者或责任节点），**不是**授权声明（对应 TF-0632 规则 3）。
3. **default**必须按轴比较：权威 `defaultMode` 一个枚举混合了激活默认（baseline/opt-in/shadow/disabled）、可见性（internal/read-only）与生命周期（retired）三个轴；处置矩阵把它们拆成 `disposition` / `currentMode` / `targetDefaultMode`。把 `targetDefaultMode` 与 `defaultMode` 直接比相等会产生 21 个假阳性（X-03）；按轴比较（R-D1…R-D4）后真实冲突为 **5 个组件**，且每个都有 flag 目录或默认矩阵文档作第三方证据，**5 个都判定权威矩阵的值陈旧**（TF-0494 / TF-0496 收口后未回写）。
4. **authority**：权威矩阵 44 行 authority 键唯一、无一数据类型多 owner、权限 owner 恰 1 个；产品语义 6 条关系的 `authorityBoundary` 与权威矩阵可核对的 3 条全部一致，另 3 条端点无组件（gap），**冲突 0**。

---

## 2. 六份注册表盘点（问题 1）

### 2.1 总表

| # | 注册表 | 版本常量 | 条目数 | id 命名约定（正则，匹配数） | 条目锚点 | owner 字段 | default 字段 | authority 字段 | 自带校验 | 运行时消费点（非测试） |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `shared/component-authority-manifest.ts` | `ComponentAuthorityManifest/v1`（:3） | **35** 组件 + **44** authority 行 + 11 产品面链接 + 14 默认矩阵链接 | 无前缀 kebab 名词短语 `^[a-z0-9]+(-[a-z0-9]+)*$`（35/35）；语义后缀 `-source`×7、`-authority`×2、`-owner`×3、`-registry`×2 | 组件 :93–:673（首条 :95，末条 :658）；authorities :707–:919；链接 :675–:704 | 组件自身（`ownedDataTypes`）+ `authorities[].authorityComponentId` + `authorizationRole`（:25, :41） | `defaultMode`（:40；枚举 :17–:19） | `authorities[]`，键 `dataType::scope::operation`（:926–:930） | `validateComponentAuthorityManifest`（:932–:1052），导入即断言（:1099） | `shared/dcs/component-disposition-catalog.ts:1`、`shared/model-capability-profile.ts:3`、`shared/memory/control-plane.ts:6`、`shared/component-graduation-report.ts:7`、`openclaw_runtime/src/memory/memory-authority.ts:5`、`openclaw_runtime/src/agents/permission-contract.ts:3` |
| 2 | `shared/dcs/component-disposition-catalog.ts` | `ComponentDispositionManifest/v1`（:3），`generatedForDate: '2026-10-21'`（:55, :465） | **54**（component 35 / feature 8 / surface 9 / settings 2；internal 24 / default 13 / advanced 12 / retired 5 / experiment 0） | `^(component\|feature\|surface\|settings)\.[a-z0-9]+(-[a-z0-9]+)*$`（54/54） | :108–:461（首条 :110，末条 :456） | `owner: string`（:32，自由字符串，校验只要求非空 :509） | `targetDefaultMode: ComponentAuthorityDefaultMode`（:39）+ `currentMode`（:38，枚举 :6 含 `mixed`） | `coverage.authorityComponentIds`（:20, :45） | `validateComponentDispositionManifest`（:499–:584），精确覆盖 5 维（:559–:563）；输入由测试提供（`tests/unit/component-disposition-catalog.test.ts:28-37`） | `shared/model-capability-profile.ts:12`（`owner`/`disposition` 原样投影 :375–:376） |
| 3 | `shared/capability-claims.ts` | 无 | **45** | `capability-NN`，`^capability-\d{2}$`（45/45），`reportItem` == NN（45/45） | :89–:1433（首条 :91，末条 :1383） | 无 | 无 | 无（`runtimeProof.status` 是证据强度，不是权威） | 仅测试 `tests/unit/capability-claims.test.ts` + `scripts/check-capability-claims.mjs:5` + `scripts/check-evidence-refs.mjs` | `scripts/check-capability-claims.mjs`、`scripts/generate-capability-claims-artifacts.mjs`、`shared/component-graduation-report.ts:1`（类型） |
| 4 | `shared/reliability-boundaries.ts` | 无 | **7** | 类型联合字面量 kebab `^[a-z0-9]+(-[a-z0-9]+)*$`（7/7） | 类型 :1–:8；条目 :22 :34 :46 :58 :70 :82 :94 | 无 | 无 | 无 | 仅测试 `tests/unit/reliability-boundaries.test.ts` + `check-evidence-refs.mjs` | 无（测试 + `capability-claims.ts:75` 路径引用） |
| 5 | `shared/sensitive-content-boundary.ts` | 无 | **7** | 单词 surface 名；6 个小写 + 1 个 camelCase（`modelEcho`） | 类型 :1–:8；条目 :32 :48 :65 :81 :99 :116 :133 | 无 | 无 | `guaranteeLevel`（保证等级，非权威） | 仅测试 `tests/unit/sensitive-content-boundary.test.ts` + `check-evidence-refs.mjs` | 无（测试 + `capability-claims.ts:74` 路径引用） |
| 6 | `shared/product-semantics.ts` | 无（宪章 §1.3 已记：无 `CONTRACT_VERSION` / `relationKey`） | **7** 概念 + **6** 关系（+32 task boundary，+5 unsafe claim 再导出） | 概念 kebab（7/7）；关系无 id（身份 = `from+kind+to` 三元组）；task boundary `^P[01]-\d{2}$`（32/32） | 概念 :73 :83 :93 :104 :115 :125 :135；关系 :170–:175；task boundary :219–:599 | 概念 `sourceOfTruth`（自由文本） | 无 | 关系 `authorityBoundary`（:153–:158） | 仅测试 `tests/unit/product-semantics.test.ts` + `check-evidence-refs.mjs` | `electron/services/{agent-browser-api,cron-api,permissions-api,permission-decision-audit,workspaces-api}.ts`、`src/pages/Chat/*`、`src/components/{assistant-render/CodingRunEvidence,agents/RolesOrchestrationPanel}.tsx`、`openclaw_runtime/src/agents/{role-spawn,role-permission-audit}.ts`、`shared/host-api/contract.ts:33` |

要点：

- 六表中**只有两表**（1、2）带有组件身份与版本常量，且只有这两表之间存在机械连接；表 3–6 的 id 空间分别是「主张编号」「子系统名」「敏感面名」「产品概念名」，**不是组件**，它们与组件的关系只能靠证据路径或名称推导（§3.2）。
- 表 3–6 都没有 `owner` 字段。因此「冲突 owner」只可能发生在表 1 ↔ 表 2 之间（§6.2 C-01）。
- `scripts/check-evidence-refs.mjs:13-19` 扫描的是表 3、4、5、6 与 flag 目录，**不含**表 1、2；两份矩阵的锚点由各自单测检查（`component-authority-manifest.test.ts:190-208` 校验 `sourceAnchors` 路径与 `contains`；`component-disposition-catalog.test.ts:74` 校验 `evidenceRefs` 存在）。两套机制并存，见 O-3。

### 2.2 T-A 权威矩阵 35 组件（manifest 原值）

| # | component id | 行 | domains | defaultMode | authorizationRole | ownedDataTypes | authority 行数 | catalogFlagIds |
|---|---|---|---|---|---|---|---|---|
| 1 | `context-runtime-kit` | 95 | context | `internal` | `none` | `context.resource-revision` | 1 | — |
| 2 | `dcs-context-authority` | 111 | context | `baseline` | `none` | `context.candidate-set`, `context.prompt-plan` | 2 | — |
| 3 | `dcs-assembler-compat-adapter` | 130 | context | `internal` | `none` | — | 0 | — |
| 4 | `provider-request-guard` | 146 | context, observability | `internal` | `none` | `context.request-envelope` | 1 | — |
| 5 | `context-enhancement-gate` | 162 | context | `baseline` | `none` | `context.enhancement-policy` | 1 | — |
| 6 | `working-memory-context-source` | 178 | context | `opt-in` | `none` | — | 0 | `working-memory` |
| 7 | `tool-registry-context-source` | 195 | context, capability | `opt-in` | `none` | — | 0 | `tool-registry` |
| 8 | `vtoken-context-source` | 212 | context | `opt-in` | `none` | — | 0 | — |
| 9 | `vtoken-bridge` | 228 | context | `opt-in` | `none` | `vtoken.bridge-runtime` | 1 | — |
| 10 | `compass-context-source` | 244 | context | `opt-in` | `none` | — | 0 | `compass-context-block` |
| 11 | `c6-context-ladder-source` | 261 | context | `internal` | `none` | — | 0 | `context-ladder` |
| 12 | `dcs-fact-view-and-tools` | 278 | context, capability | `opt-in` | `none` | — | 0 | `context-view-tools`, `context-tools-alias` |
| 13 | `role-memory-card-governance` | 294 | memory | `opt-in` | `none` | `memory.role-card` | 1 | `role-memory` |
| 14 | `native-file-memory-retrieval` | 311 | memory | `read-only` | `none` | `memory.native-file-query` | 2 | — |
| 15 | `runtime-memory-store` | 327 | memory | `opt-in` | `none` | `memory.runtime-fact`, `memory.runtime-timeline`, `memory.runtime-episode` | 6 | `runtime-memory-persist`, `runtime-memory-inject-pilot` |
| 16 | `memory-candidate-queue` | 344 | memory | `opt-in` | `none` | `memory.candidate` | 2 | `runtime-memory-candidate-generation` |
| 17 | `memory-embedding-provider` | 361 | memory | `opt-in` | `none` | `memory.embedding-index` | 1 | — |
| 18 | `dreaming-derived-cache` | 377 | memory | `internal` | `none` | `memory.dreaming-derived-signal` | 1 | — |
| 19 | `knowledge-review-authority` | 393 | knowledge | `internal` | `none` | `knowledge.source`, `knowledge.draft`, `knowledge.proposal`, `knowledge.applied` | 4 | — |
| 20 | `knowledge-retrieval-source` | 409 | knowledge, context | `read-only` | `none` | `knowledge.retrieval-view` | 1 | — |
| 21 | `sekb-candidate-provider` | 425 | knowledge | `shadow` | `none` | `knowledge.sekb-candidate` | 1 | `sekb-experience-shadow`, `sekb-retrieval-shadow` |
| 22 | `v3-capability-catalog` | 442 | capability | `internal` | `none` | `capability.descriptor` | 1 | — |
| 23 | `skills-mcp-source-registry` | 458 | capability | `internal` | `none` | `capability.source-manifest` | 1 | — |
| 24 | `tool-search-schema-expander` | 474 | capability | `internal` | `none` | `capability.discovery-view` | 1 | — |
| 25 | `coding-execution-backend` | 489 | execution | `opt-in` | `consumer` | `execution.tool-effect`, `execution.write-journal`, `execution.worktree` | 3 | `stale-write-guard`, `write-journal`, `worktree-backend`, `isolation-request`, `symbol-lease`, `symbol-lease-mode`, `patch-flow` |
| 26 | `verseshell-execution-adapter` | 508 | execution | `opt-in` | `consumer` | — | 0 | `verseshell-patch-preview` |
| 27 | `permission-approval-authority` | 525 | permission | `baseline` | `owner` | `permission.authorization-decision`, `permission.approval-decision` | 2 | — |
| 28 | `task-ledger` | 544 | task | `internal` | `none` | `task.fact`, `task.working-context` | 2 | — |
| 29 | `browser-session-owner` | 560 | browser | `opt-in` | `consumer` | `browser.session`, `browser.action` | 2 | — |
| 30 | `browser-task-projection-owner` | 576 | browser, task | `internal` | `none` | `browser.task-projection` | 1 | — |
| 31 | `observability-recorder` | 592 | observability | `internal` | `none` | `observation.trace`, `observation.receipt-index`, `observation.log` | 3 | `rc03-seal` |
| 32 | `routing-memo-observation` | 609 | observability, capability | `shadow` | `none` | `observation.routing-memo` | 1 | `routing-memo-shadow` |
| 33 | `host-api-transport-owner` | 626 | ui-transport, permission | `baseline` | `none` | `ui.host-request` | 1 | — |
| 34 | `renderer-ui-surface` | 642 | ui-transport | `baseline` | `none` | — | 0 | — |
| 35 | `retired-surface-registry` | 658 | ui-transport | `retired` | `none` | `retired.surface-class` | 1 | — |

权威矩阵内部事实（供 §6 引用）：`authorizationRole` 分布 owner 1（`permission-approval-authority`）/ consumer 3（`coding-execution-backend`、`verseshell-execution-adapter`、`browser-session-owner`）/ none 31；9 个组件 `ownedDataTypes` 为空（候选提供者、适配器与 renderer：#3 #6 #7 #8 #10 #11 #12 #26 #34），因此没有 authority 行；44 条 authority 行键唯一（重复 0），无一 dataType 由多个组件拥有；`runtimeAvailabilitySource` 三种来源：`static:*` 20、`DCS_PROD_FLAGS:*` 13、`docs/dev/default-config-matrix.md#*` 2（#8、#9）。

### 2.3 其余五表的条目锚点

- **处置矩阵 54 条**：35 条 `component.*` 的行号见 §4.1 T-X 第 4 列；19 条 `feature.*` / `surface.*` / `settings.*` 的行号见 §5.2 T-D。
- **能力主张 45 条**：见 §4.5 T-C（id、行、分类、`runtimeProof.status`、`relatedTaskIds`）。
- **可靠性 7 子系统**（`subsystem` 行）：`gateway-startup` :22、`provider-fallback` :34、`host-api-api-client` :46、`session-restore-replay` :58、`file-writes` :70、`dangerous-approvals` :82、`task-loop-repair-retry` :94。
- **敏感面 7 项**（`surface` 行 / `guaranteeLevel`）：`file` :32 raw-no-redaction、`transcript` :48 local-policy、`trace` :65 redacted-projection、`memory` :81 local-rejection、`compaction` :99 redacted-projection、`sekb` :116 redacted-projection、`modelEcho` :133 not-guaranteed。
- **产品语义**：概念 `chat` :73、`plan-mode` :83、`chat-plan` :93、`task-ledger` :104、`workboard` :115、`task-loop` :125、`routing-memo` :135；关系 :170 chat→task-loop（advisory-only）、:171 chat→task-ledger（read-only-projection）、:172 chat-plan→task-ledger（read-only-projection）、:173 task-loop→task-ledger（task-ledger-authority）、:174 workboard→task-ledger（one-way-reference）、:175 routing-memo→task-loop（same-session-scorecard）；task boundary `P0-00` :219 … `P1-14` :599。
- **flag 目录 22 条**：行号见 §4.2 T-F。

---

## 3. 身份键与推导规则

### 3.1 规则（本轮裁定，给 TF-0632 作为 R-I）

| 规则 | 内容 | 依据 |
|---|---|---|
| I-1 身份键 | 组件的规范身份 = `AUTHORITY_COMPONENTS[].id`（35 个） | 唯一带导入期唯一性断言的 id 空间（`duplicate_component` :942–:944，`assertComponentAuthorityManifest()` :1099）；宪章 §3 要求 L3 语义指向 L1 身份；处置矩阵自身以它为连接键并导入其枚举（:1） |
| I-2 处置 → 组件 | 经 `coverage.authorityComponentIds` 连接；**不**经 id 后缀，**不**经 `owner` | 35/35 恰 1:1（测试 :86–:91）；id 后缀与组件 id 不同者 9 条（O-1）；`owner` 有 10 条是 TF 节点号（C-01） |
| I-3 flag → 组件 | 经权威 `catalogFlagIds`（精确覆盖，:1026–:1029）；处置经 `dcsFlagIds`（精确覆盖，测试 :60） | 三方 22 = 22 = 22（§4.2） |
| I-4 概念 → 组件 | 仅 `task-ledger` 精确同 id；`routing-memo` → `routing-memo-observation` 为**本轮人工别名**（概念 id 是组件 id 的前缀，且两者 `sourceOfTruth` / `purpose` 同指 routing-memo 观测）；其余 5 个概念无组件（G-03） | §4.3 |
| I-5 主张 / 子系统 / 敏感面 → 组件 | 只承认**精确路径锚点连接**：条目 `evidenceRefs`/`refs` 中的路径 == 某组件 `sourceAnchors[].path`。目录级连接因噪声过大（`openclaw_runtime/src/agents` 一个目录命中 4–5 个组件）被拒绝 | 结果：主张 4/45、子系统 2/7、敏感面 0/7（§4.4） |

### 3.2 机械连接 vs 人工推导（标注口径）

| 连接 | 性质 | 当前覆盖 | 已有机械保证 |
|---|---|---|---|
| 权威 ↔ 处置（I-2） | 机械 | 35/35 | 是（处置单测 + `findComponentDisposition` :586–:591） |
| 权威 ↔ flag ↔ 处置（I-3） | 机械 | 22/22/22 | 是（权威校验器 :1022–:1029；处置单测 :60） |
| 权威 ↔ 默认矩阵文档 / 产品面文档（链接表） | 机械（标签对账） | 14 / 11 | 是（权威单测 :160–:188） |
| 概念 → 组件（I-4） | 1 精确 + 1 人工别名 | 2/7 | 否 |
| 主张 / 子系统 / 敏感面 → 组件（I-5） | 精确锚点 | 4/45、2/7、0/7 | 否（`check-evidence-refs.mjs` 只查路径存在，不查归属） |
| 其余人工语义候选（§6.4 G-05 / G-06 的"候选"列） | 人工 | — | 否；**不作为裁定依据** |

---

## 4. 跨表映射（问题 2）

### 4.1 T-X 35 组件跨表矩阵（每格为该表原值；"—" = 该表无此组件）

| # | component id | 权威 defaultMode / role | 处置 id（行） | 处置 owner | 处置 disposition / currentMode → targetDefaultMode | DCS flags（risk） | 默认矩阵标签 | 产品面标签 | 产品语义概念 | 能力主张（锚点连接） | 可靠性（锚点连接） |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `context-runtime-kit` | `internal` / none | `component.context-runtime-kit`（110） | `context-runtime-kit` | internal / baseline → internal | — | — | — | — | — | — |
| 2 | `dcs-context-authority` | `baseline` / none | `component.dcs-context-authority`（116） | `dcs-context-authority` | internal / baseline → internal | — | Runtime Memory inject pilot | DCS coding loop; C6 automatic context ladder; Runtime Memory injection | — | — | — |
| 3 | `dcs-assembler-compat-adapter` | `internal` / none | `component.dcs-assembler-adapter`（122） | `dcs-assembler-compat-adapter` | internal / baseline → internal | — | — | — | — | — | — |
| 4 | `provider-request-guard` | `internal` / none | `component.provider-request-guard`（128） | `provider-request-guard` | internal / baseline → internal | — | — | — | — | capability-26 | provider-fallback |
| 5 | `context-enhancement-gate` | `baseline` / none | `component.context-enhancement-gate`（134） | `context-enhancement-gate` | internal / baseline → internal | — | Context enhancement kill switch | — | — | — | — |
| 6 | `working-memory-context-source` | `opt-in` / none | `component.working-memory-context`（140） | `working-memory-context-source` | default / baseline → baseline | `working-memory`(baseline-on) | Workspace Context; working-memory | Workspace Context | — | — | — |
| 7 | `tool-registry-context-source` | `opt-in` / none | `component.tool-registry-context`（146） | `tool-registry-context-source` | default / baseline → baseline | `tool-registry`(baseline-on) | Workspace Context; tool-registry | Workspace Context | — | — | — |
| 8 | `vtoken-context-source` | `opt-in` / none | `component.vtoken-context`（152） | `TF-0496` | retired / retired → retired | — | VToken assembly | VToken turn assembly | — | — | — |
| 9 | `vtoken-bridge` | `opt-in` / none | `component.vtoken-bridge`（161） | `TF-0496` | internal / opt-in → internal | — | VToken bridge | VToken turn assembly | — | — | — |
| 10 | `compass-context-source` | `opt-in` / none | `component.compass-context`（167） | `TF-0511` | internal / opt-in → internal | `compass-context-block`(read-only) | — | — | — | — | — |
| 11 | `c6-context-ladder-source` | `internal` / none | `component.c6-context-ladder`（176） | `TF-0493` | internal / opt-in → internal | `context-ladder`(api-only) | — | C6 automatic context ladder | — | — | — |
| 12 | `dcs-fact-view-and-tools` | `opt-in` / none | `component.dcs-context-tools`（182） | `dcs-fact-view-and-tools` | default / opt-in → baseline | `context-view-tools`(opt-in), `context-tools-alias`(opt-in) | DCS Fact view tools | DCS Fact view tools | — | — | — |
| 13 | `role-memory-card-governance` | `opt-in` / none | `component.role-memory`（188） | `role-memory-card-governance` | default / opt-in → baseline | `role-memory`(read-only) | — | — | — | — | — |
| 14 | `native-file-memory-retrieval` | `read-only` / none | `component.native-file-memory-retrieval`（194） | `native-file-memory-retrieval` | internal / baseline → read-only | — | — | — | — | — | — |
| 15 | `runtime-memory-store` | `opt-in` / none | `component.runtime-memory-store`（200） | `runtime-memory-store` | internal / opt-in → internal | `runtime-memory-persist`(opt-in), `runtime-memory-inject-pilot`(opt-in) | Runtime Memory inject pilot; Runtime Memory shadow/provider/persist | Runtime Memory injection | — | capability-34, capability-42 | — |
| 16 | `memory-candidate-queue` | `opt-in` / none | `component.memory-candidate-queue`（206） | `memory-candidate-queue` | internal / opt-in → internal | `runtime-memory-candidate-generation`(opt-in) | Runtime Memory shadow/provider/persist | — | — | — | — |
| 17 | `memory-embedding-provider` | `opt-in` / none | `component.memory-embedding-provider`（218） | `memory-embedding-provider` | internal / opt-in → internal | — | Runtime Memory shadow/provider/persist | — | — | — | — |
| 18 | `dreaming-derived-cache` | `internal` / none | `component.dreaming-derived-cache`（212） | `dreaming-derived-cache` | internal / baseline → internal | — | — | — | — | — | — |
| 19 | `knowledge-review-authority` | `internal` / none | `component.knowledge-review-authority`（224） | `knowledge-review-authority` | default / mixed → baseline | — | SEKB auto writeback | SEKB automatic writeback; C7 knowledge/routing cutover | — | — | — |
| 20 | `knowledge-retrieval-source` | `read-only` / none | `component.knowledge-retrieval-source`（230） | `knowledge-retrieval-source` | default / mixed → baseline | — | — | — | — | — | — |
| 21 | `sekb-candidate-provider` | `shadow` / none | `component.sekb-candidate-provider`（236） | `TF-0499` | internal / mixed → internal | `sekb-experience-shadow`(api-only), `sekb-retrieval-shadow`(shadow-only) | SEKB master; SEKB auto writeback; SEKB shadow evaluation | SEKB automatic writeback | — | — | — |
| 22 | `v3-capability-catalog` | `internal` / none | `component.v3-capability-catalog`（242） | `v3-capability-catalog` | internal / shadow → internal | — | — | — | — | — | — |
| 23 | `skills-mcp-source-registry` | `internal` / none | `component.skills-mcp-source-registry`（248） | `skills-mcp-source-registry` | default / mixed → baseline | — | — | — | — | — | — |
| 24 | `tool-search-schema-expander` | `internal` / none | `component.tool-search-schema-expander`（254） | `tool-search-schema-expander` | default / mixed → baseline | — | — | — | — | — | — |
| 25 | `coding-execution-backend` | `opt-in` / consumer | `component.coding-execution-backend`（260） | `coding-execution-backend` | default / mixed → baseline | `stale-write-guard`(opt-in), `write-journal`(baseline-on), `worktree-backend`(api-only), `isolation-request`(request-only), `symbol-lease`(opt-in), `symbol-lease-mode`(opt-in), `patch-flow`(api-only) | Coding auto verify | DCS coding loop; Coding WAL | — | — | — |
| 26 | `verseshell-execution-adapter` | `opt-in` / consumer | `component.verseshell-execution-adapter`（266） | `verseshell-execution-adapter` | internal / opt-in → internal | `verseshell-patch-preview`(read-only) | — | — | — | — | — |
| 27 | `permission-approval-authority` | `baseline` / owner | `component.permission-approval-authority`（272） | `permission-approval-authority` | default / mixed → baseline | — | — | — | — | — | — |
| 28 | `task-ledger` | `internal` / none | `component.task-ledger`（279） | `task-ledger` | default / mixed → baseline | — | — | — | task-ledger | — | — |
| 29 | `browser-session-owner` | `opt-in` / consumer | `component.browser-session-owner`（285） | `browser-session-owner` | advanced / mixed → opt-in | — | Browser private network | Browser supervised workflows | — | — | — |
| 30 | `browser-task-projection-owner` | `internal` / none | `component.browser-task-projection`（292） | `browser-task-projection-owner` | internal / mixed → internal | — | — | Browser supervised workflows | — | — | — |
| 31 | `observability-recorder` | `internal` / none | `component.observability-recorder`（298） | `observability-recorder` | internal / mixed → internal | `rc03-seal`(opt-in) | — | — | — | — | — |
| 32 | `routing-memo-observation` | `shadow` / none | `component.routing-memo-observation`（304） | `TF-0511` | internal / mixed → internal | `routing-memo-shadow`(shadow-only) | — | C7 knowledge/routing cutover | routing-memo（别名） | — | — |
| 33 | `host-api-transport-owner` | `baseline` / none | `component.host-api-transport-owner`（313） | `host-api-transport-owner` | internal / baseline → internal | — | — | — | — | capability-18 | host-api-api-client |
| 34 | `renderer-ui-surface` | `baseline` / none | `component.renderer-ui-surface`（319） | `renderer-ui-surface` | default / mixed → baseline | — | — | — | — | — | — |
| 35 | `retired-surface-registry` | `retired` / none | `component.retired-surface-registry`（325） | `retired-surface-registry` | internal / baseline → retired | — | — | Surfaces listed in RETIRED-SURFACES.md | — | — | — |

读法：

- 列「处置 owner」为 TF 节点号的 6 行（#8 #9 #10 #11 #21 #32）即 C-01 中 `component.*` 部分；其组件 owner 由 I-2 得到，就是本行的 component id。
- 列「默认矩阵标签 / 产品面标签」来自权威矩阵自己的链接表（:675–:704），与两份文档的标签已被单测对账；**17 个组件不在任何链接表中**（O-5）。
- 出现在 ≥ 3 表（含机械键 + 精确锚点 + 概念 id）的组件 5 个：`provider-request-guard`（权威、处置、主张 26、可靠性 provider-fallback）、`host-api-transport-owner`（权威、处置、主张 18、可靠性 host-api-api-client）、`runtime-memory-store`（权威、处置、主张 34 / 42）、`task-ledger`（权威、处置、概念）、`routing-memo-observation`（权威、处置、概念别名）。其余 30 个只在权威 + 处置两表。

### 4.2 T-F 22 个 DCS flag 的三方连接

| flag | flag 行 | risk / defaultValue | manifest 组件（defaultMode） | 处置项（disposition / target） | 处置 owner | owner 一致 |
|---|---|---|---|---|---|---|
| `context-view-tools` | 37 | opt-in / `false` | `dcs-fact-view-and-tools`（opt-in） | `component.dcs-context-tools`（default / baseline） | `dcs-fact-view-and-tools` | 是 |
| `context-tools-alias` | 57 | opt-in / `false` | `dcs-fact-view-and-tools`（opt-in） | `component.dcs-context-tools`（default / baseline） | `dcs-fact-view-and-tools` | 是 |
| `working-memory` | 76 | baseline-on / `true` | `working-memory-context-source`（opt-in） | `component.working-memory-context`（default / baseline） | `working-memory-context-source` | 是 |
| `tool-registry` | 94 | baseline-on / `true` | `tool-registry-context-source`（opt-in） | `component.tool-registry-context`（default / baseline） | `tool-registry-context-source` | 是 |
| `stale-write-guard` | 112 | opt-in / `false` | `coding-execution-backend`（opt-in） | `feature.stale-write-guard`（advanced / opt-in） | `coding-execution-backend` | 是 |
| `write-journal` | 130 | baseline-on / `true` | `coding-execution-backend`（opt-in） | `feature.coding-recovery`（default / baseline） | `coding-execution-backend` | 是 |
| `worktree-backend` | 149 | api-only / `inprocess` | `coding-execution-backend`（opt-in） | `feature.worktree-isolation`（advanced / opt-in） | `coding-execution-backend` | 是 |
| `isolation-request` | 169 | request-only / `shared` | `coding-execution-backend`（opt-in） | `feature.worktree-isolation`（advanced / opt-in） | `coding-execution-backend` | 是 |
| `symbol-lease` | 189 | opt-in / `false` | `coding-execution-backend`（opt-in） | `feature.symbol-lease`（retired / retired） | `TF-0510` | 是 |
| `symbol-lease-mode` | 208 | opt-in / `memory` | `coding-execution-backend`（opt-in） | `feature.symbol-lease`（retired / retired） | `TF-0510` | 是 |
| `patch-flow` | 226 | api-only / `false` | `coding-execution-backend`（opt-in） | `feature.patch-flow`（retired / retired） | `TF-0510` | 是 |
| `context-ladder` | 248 | api-only / `false` | `c6-context-ladder-source`（internal） | `component.c6-context-ladder`（internal / internal） | `TF-0493` | 是 |
| `routing-memo-shadow` | 268 | shadow-only / `false` | `routing-memo-observation`（shadow） | `component.routing-memo-observation`（internal / internal） | `TF-0511` | 是 |
| `sekb-experience-shadow` | 287 | api-only / `false` | `sekb-candidate-provider`（shadow） | `component.sekb-candidate-provider`（internal / internal） | `TF-0499` | 是 |
| `sekb-retrieval-shadow` | 307 | shadow-only / `false` | `sekb-candidate-provider`（shadow） | `component.sekb-candidate-provider`（internal / internal） | `TF-0499` | 是 |
| `runtime-memory-persist` | 325 | opt-in / `false` | `runtime-memory-store`（opt-in） | `component.runtime-memory-store`（internal / internal） | `runtime-memory-store` | 是 |
| `runtime-memory-inject-pilot` | 343 | opt-in / `false` | `runtime-memory-store`（opt-in） | `component.runtime-memory-store`（internal / internal） | `runtime-memory-store` | 是 |
| `runtime-memory-candidate-generation` | 362 | opt-in / `false` | `memory-candidate-queue`（opt-in） | `component.memory-candidate-queue`（internal / internal） | `memory-candidate-queue` | 是 |
| `compass-context-block` | 380 | read-only / `false` | `compass-context-source`（opt-in） | `component.compass-context`（internal / internal） | `TF-0511` | 是 |
| `role-memory` | 398 | read-only / `false` | `role-memory-card-governance`（opt-in） | `component.role-memory`（default / baseline） | `role-memory-card-governance` | 是 |
| `verseshell-patch-preview` | 416 | read-only / `false` | `verseshell-execution-adapter`（opt-in） | `component.verseshell-execution-adapter`（internal / internal） | `verseshell-execution-adapter` | 是 |
| `rc03-seal` | 438 | opt-in / `false` | `observability-recorder`（internal） | `component.observability-recorder`（internal / internal） | `observability-recorder` | 是 |

「owner 一致」判据：处置项 `owner` == manifest 绑定组件，或该组件在处置项 `coverage.authorityComponentIds` 内，或 `owner` 是 TF 节点号（责任节点）。22/22 成立。粒度差异（7 个 coding flag 在 manifest 绑定到 1 个组件、在处置矩阵绑定到 5 个 `feature.*` 条目）见 X-01。

### 4.3 authority 轴：产品语义关系 vs 权威矩阵

| 关系（行） | authorityBoundary | 可核对的组件 | 权威矩阵对应声明 | 结果 |
|---|---|---|---|---|
| task-loop → task-ledger（:173） | task-ledger-authority | `task-ledger` | 拥有 `task.fact` / `task.working-context`（:548，authority 行 :720, :881） | 一致 |
| workboard → task-ledger（:174） | one-way-reference | `task-ledger` | purpose "other components may reference it one way"（:547）；forbiddenActions 含 `own-runtime-scheduler`（:553） | 一致 |
| routing-memo → task-loop（:175） | same-session-scorecard | `routing-memo-observation` | purpose "active routing requires same-session Task Loop authority"（:612）；forbiddenActions 含 `grant-routing-permissions`（:618） | 一致（task-loop 侧无组件） |
| chat → task-loop（:170） | advisory-only | 无（两端点均无组件） | — | 不可核对 → G-03 |
| chat → task-ledger（:171） | read-only-projection | `task-ledger`（仅目标端） | 与 `browser-task-projection-owner` 的单向投影模式同构，但 Chat 投影无 owner 组件 | 源端不可核对 → G-03 |
| chat-plan → task-ledger（:172） | read-only-projection | `task-ledger`（仅目标端） | 同上 | 源端不可核对 → G-03 |

另：处置矩阵没有 authority 字段；它的 `defaultOffAllowed`（`permission-approval-authority` :276、`browser-session-owner` :289、`feature.stale-write-guard` :343、`surface.cron` :402）与权威矩阵的 owner / consumer 角色不矛盾。能力主张中直接谈权威的条目（33 "One review surface is not a second Memory authority"、45 "task facts stay in Task Ledger"、11 / 15 Routing Memo 需 same-session Task Loop authority）与权威矩阵 memory 域三 owner、`task-ledger`、`routing-memo-observation` 的声明一致——这是**人工阅读**结论，不是机械核对。

### 4.4 其余三表 → 组件（精确锚点连接，I-5）

| 表 | 条目 | 连接到的组件 | 共享的锚点路径 |
|---|---|---|---|
| 能力主张 | `capability-18`（:588） | `host-api-transport-owner` | `src/lib/host-api.ts` |
| 能力主张 | `capability-26`（:822） | `provider-request-guard` | `openclaw_runtime/src/agents/provider-transport-fetch.ts` |
| 能力主张 | `capability-34`（:1058） | `runtime-memory-store` | `openclaw_runtime/src/runtime-core/memory-store.ts` |
| 能力主张 | `capability-42`（:1296） | `runtime-memory-store` | `openclaw_runtime/src/runtime-core/memory-store.ts` |
| 可靠性 | `provider-fallback`（:34） | `provider-request-guard` | `openclaw_runtime/src/agents/provider-transport-fetch.ts` |
| 可靠性 | `host-api-api-client`（:46） | `host-api-transport-owner` | `src/lib/host-api.ts` |
| 敏感面 | （无） | — | 7 个敏感面的 `evidenceRefs` 没有任何一条等于某组件的 `sourceAnchors[].path` |

### 4.5 T-C 能力主张 45 条

| id | 行 | classification | status | relatedTaskIds | 组件（锚点） |
|---|---|---|---|---|---|
| `capability-01` | 91 | PARTIAL | partial | P1-01, P1-02 | — |
| `capability-02` | 121 | PARTIAL | partial | P1-04, P1-05 | — |
| `capability-03` | 150 | PARTIAL | partial | — | — |
| `capability-04` | 179 | TP-SRC + FP-NOT-RUNNABLE | not-runnable | P0-06, P0-07 | — |
| `capability-05` | 209 | PARTIAL | partial | P0-09 | — |
| `capability-06` | 238 | TP-RUN + PARTIAL | partial | P0-08 | — |
| `capability-07` | 268 | FP-OVERCLAIM | not-guaranteed | P1-01, P1-02 | — |
| `capability-08` | 297 | PARTIAL | partial | P1-01, P1-03 | — |
| `capability-09` | 326 | PARTIAL | partial | P1-02 | — |
| `capability-10` | 355 | TP-SRC/TP-TEST | test-verified | — | — |
| `capability-11` | 384 | PARTIAL | partial | P1-06, P1-07 | — |
| `capability-12` | 413 | PARTIAL | partial | — | — |
| `capability-13` | 442 | TP-TEST + PARTIAL | partial | P0-13 | — |
| `capability-14` | 471 | PARTIAL | partial | P2-05 | — |
| `capability-15` | 500 | PARTIAL/FP-OVERCLAIM | partial | P1-04, P1-05, P1-07 | — |
| `capability-16` | 529 | TP-RUN | real-runtime-verified | — | — |
| `capability-17` | 559 | TP-SRC | source-verified | — | — |
| `capability-18` | 588 | PARTIAL | partial | — | `host-api-transport-owner` |
| `capability-19` | 617 | TP-RUN | real-runtime-verified | — | — |
| `capability-20` | 647 | TP-RUN | real-runtime-verified | P0-06, P0-10 | — |
| `capability-21` | 676 | FP-OVERCLAIM | not-guaranteed | P2-02 | — |
| `capability-22` | 705 | PARTIAL | partial | P2-06 | — |
| `capability-23` | 735 | TP-SRC/TP-TEST | test-verified | — | — |
| `capability-24` | 764 | FP-OVERCLAIM | not-guaranteed | P2-01 | — |
| `capability-25` | 793 | TP-SRC | source-verified | — | — |
| `capability-26` | 822 | PARTIAL | partial | P2-06 | `provider-request-guard` |
| `capability-27` | 852 | PARTIAL | partial | — | — |
| `capability-28` | 881 | TP-SRC/TP-TEST | test-verified | — | — |
| `capability-29` | 910 | TP-SRC | source-verified | P2-04 | — |
| `capability-30` | 939 | PARTIAL | partial | P2-04 | — |
| `capability-31` | 968 | PARTIAL | partial | P2-04 | — |
| `capability-32` | 997 | PARTIAL | partial | P2-04 | — |
| `capability-33` | 1026 | TP-RUN + PARTIAL | real-runtime-verified | TF-0497, TF-0498 | — |
| `capability-34` | 1058 | TP-SRC/TP-TEST | test-verified | — | `runtime-memory-store` |
| `capability-35` | 1087 | PARTIAL | partial | P2-03 | — |
| `capability-36` | 1116 | PARTIAL | partial | P2-03 | — |
| `capability-37` | 1145 | FP-OVERCLAIM | not-guaranteed | P1-02, P2-02 | — |
| `capability-38` | 1173 | PARTIAL/FP-NOT-RUNNABLE | not-runnable | P0-06, P0-09 | — |
| `capability-39` | 1202 | PARTIAL | partial | P2-07 | — |
| `capability-40` | 1231 | TP-TEST | test-verified | P1-10, P1-11, P1-12, P1-13, P1-14 | — |
| `capability-41` | 1266 | FP-OVERCLAIM | not-guaranteed | P1-10, P1-11, P1-12, P1-14 | — |
| `capability-42` | 1296 | PARTIAL/FP-OVERCLAIM | partial | — | `runtime-memory-store` |
| `capability-43` | 1325 | PARTIAL | partial | — | — |
| `capability-44` | 1354 | PARTIAL | partial | P1-05, P1-09 | — |
| `capability-45` | 1383 | TP-RUN + PARTIAL | partial | TF-0548, TF-0563 | — |

分类分布：PARTIAL 21、FP-OVERCLAIM 5、TP-SRC/TP-TEST 4、TP-RUN 3、TP-SRC 3、TP-RUN + PARTIAL 3、其余各 1–2；`runtimeProof.status`：partial 26、test-verified 5、not-guaranteed 5、real-runtime-verified 4、source-verified 3、not-runnable 2。`relatedTaskIds` 命名空间：P1 11 条、P2 13 条、P0 6 条、TF 2 条、空 14 条（O-4）。

### 4.6 "一处声明、多处引用"：注册表之间的文件级引用图

| 引用方 | 被引用的注册表（引用方文件行） |
|---|---|
| 处置矩阵 | 权威矩阵（:86 `AUTHORITY`）、flag 目录（:87 `DCS`）；另引用 `docs/dev/default-config-matrix.md`（:88）、`docs/clawx-product-semantics.md`（:89）、D9 ADR（:90）等作为 `evidenceRefs` |
| 能力主张 | 可靠性边界（:75）、敏感面（:74）；主张 22 / 26 引用可靠性，40 / 41 引用敏感面 |
| 可靠性边界 | 能力主张（:42，`provider-fallback.evidenceRefs`） |
| 产品语义 | 能力主张（:234，P0-01 `sourceOfTruth`）、敏感面（:563，P1-10 `boundaryRefs`） |
| 权威矩阵 | 不引用其他注册表；引用 `docs/dev/default-config-matrix.md`（:222, :238）与 `docs/dev/dcs-visible-production/RETIRED-SURFACES.md`（:671） |
| 敏感面 | 不引用其他注册表 |

即：权威矩阵是**只被引用、不引用别表**的根；处置矩阵是它唯一的注册表级引用者；主张 ↔ 可靠性互引；产品语义引用主张与敏感面。没有任何一张表引用 `component-disposition-catalog.ts`（它的唯一注册表级消费者是 `shared/model-capability-profile.ts`）。

---

## 5. 缺失方向（问题 3）

### 5.1 权威矩阵 → 处置矩阵：缺失 **0**

35 个组件各有恰好 1 条 `component.*` 处置项（T-X 第 4 列）。由 `tests/unit/component-disposition-catalog.test.ts:86-91` 机械保证。

### 5.2 处置矩阵 → 权威矩阵：**19** 条无 `coverage.authorityComponentIds`（T-D）

| # | disposition id | 行 | kind | disposition | owner（命名空间） | dcsFlagIds → manifest 组件 | 其他 coverage |
|---|---|---|---|---|---|---|---|
| 1 | `feature.coding-recovery` | 331 | feature | default | `coding-execution-backend`（authority-component-id） | `write-journal` → `coding-execution-backend` | `leaf coding.parseOnTouch.*`, `leaf coding.writeJournal.*`, `leaf coding.autoVerify.*`, `leaf coding.verifier.*` |
| 2 | `feature.stale-write-guard` | 338 | feature | advanced | `coding-execution-backend`（authority-component-id） | `stale-write-guard` → `coding-execution-backend` | `leaf coding.staleWriteGuard.*` |
| 3 | `feature.symbol-lease` | 347 | feature | retired | `TF-0510`（tf-node-id） | `symbol-lease`, `symbol-lease-mode` → `coding-execution-backend` | `leaf coding.symbolLease.*` |
| 4 | `feature.patch-flow` | 353 | feature | retired | `TF-0510`（tf-node-id） | `patch-flow` → `coding-execution-backend` | `leaf coding.patchFlow.*` |
| 5 | `feature.worktree-isolation` | 359 | feature | advanced | `coding-execution-backend`（authority-component-id） | `worktree-backend`, `isolation-request` → `coding-execution-backend` | `leaf coding.worktree.*` |
| 6 | `feature.agent-map` | 365 | feature | internal | `TF-0511`（tf-node-id） | — | `leaf agentMap.*` |
| 7 | `feature.runtime-shadow-governance` | 374 | feature | internal | `TF-0511`（tf-node-id） | — | `leaf registryPilot.*`, `leaf providerRegistry.*`, `leaf contextProviders.*`, `leaf registryDiagnostics.*`, `leaf toolProtocol.*`, `leaf evidenceVerifier.*`, `leaf resilience.*` |
| 8 | `feature.local-control-plane` | 383 | feature | internal | `observability-recorder`（authority-component-id） | — | `leaf localControlPlane.*` |
| 9 | `surface.inbox` | 392 | surface | advanced | `renderer-ui-surface`（authority-component-id） | — | `route /inbox` |
| 10 | `surface.cron` | 398 | surface | advanced | `renderer-ui-surface`（authority-component-id） | — | `route /cron`, `leaf rc05.*` |
| 11 | `surface.remote-tasks` | 405 | surface | advanced | `renderer-ui-surface`（authority-component-id） | — | `route /remote-tasks` |
| 12 | `surface.clawgraph` | 411 | surface | advanced | `coding-execution-backend`（authority-component-id） | — | `route /clawgraph` |
| 13 | `surface.code-review` | 417 | surface | advanced | `renderer-ui-surface`（authority-component-id） | — | `route /code-review` |
| 14 | `surface.image-generation` | 423 | surface | advanced | `renderer-ui-surface`（authority-component-id） | — | `route /image-generation`, `panel ImageGenerationSettings` |
| 15 | `surface.observability` | 429 | surface | advanced | `observability-recorder`（authority-component-id） | — | `route /observability` |
| 16 | `surface.dreams` | 438 | surface | retired | `renderer-ui-surface`（authority-component-id） | — | `route /dreams` |
| 17 | `surface.ui-v2-showcase` | 444 | surface | retired | `renderer-ui-surface`（authority-component-id） | — | `route /ui-v2-showcase` |
| 18 | `settings.developer-advanced` | 450 | settings | advanced | `renderer-ui-surface`（authority-component-id） | — | `section developer`, `panel AgentDevWorkbenchPanel`, `panel ContextControlPlanePanel`, `panel RemoteTaskDeveloperPanel`, `panel DcsProdFlagsPanel`, `panel ContextLayersExplainer`, `panel EfficiencySamplingPanel`, `panel HooksTrustPanel`, `panel ProjectRulesCenter` |
| 19 | `settings.billing` | 456 | settings | advanced | `renderer-ui-surface`（authority-component-id） | — | `section billing` |

owner 可定位性：15 条 `owner` 本身是权威组件 id（可定位）；2 条（#3 #4）`owner` 是 TF-0510 但经 flag 反查到 `coding-execution-backend`（可定位，派生）；**2 条（#6 #7）既无权威绑定、无 flag、`owner` 又是 TF 节点号 → 无法从任一份表定位组件 owner → G-01、G-02**。这 19 条不是"权威矩阵缺组件"的缺陷：它们是 feature / surface / settings 粒度的处置项，权威矩阵按设计只登记组件；但 TF-0632 规则 4 要求"注册表声明的组件若在权威矩阵中不存在，须显式登记为 gap"，因此 #6 #7 必须登记。

### 5.3 产品语义 → 权威矩阵

| 概念（行） | sourceOfTruth | 权威组件 | 结果 |
|---|---|---|---|
| `task-ledger`（:104） | user-visible task facts | `task-ledger`（精确同 id；拥有 `task.fact`） | 有 |
| `routing-memo`（:135） | observed routing outcome and quality state | `routing-memo-observation`（I-4 别名；拥有 `observation.routing-memo`） | 有 |
| `chat`（:73） | conversation transcript | 无；`session.transcript` 只作为 `sekb-candidate-provider` 的 allowedRead 出现（:431），无 owner | **缺** → G-03 |
| `plan-mode`（:83） | workspace permission decision | 无；`workspace.permission-mode` 只作为 `permission-approval-authority` 的 allowedRead（:531），无 owner | **缺** → G-03 |
| `chat-plan`（:93） | orchestrator plan output plus Task Ledger projectionEdit metadata | 无 orchestration 组件 | **缺** → G-03 |
| `workboard`（:115） | runtime/plugin scheduling | 无；`task-ledger` 明确禁止 `own-runtime-scheduler`（:553） | **缺** → G-03 |
| `task-loop`（:125） | Task Ledger root plus loop run/checkpoint state | 无 run / checkpoint owner | **缺** → G-03 |

权威矩阵 10 个域（:5–:7）中没有 session、orchestration、scheduling 域，这是 5 个概念无组件的结构原因。

### 5.4 其余三表 → 组件（精确锚点）

主张 4/45 有组件（18、26、34、42），41 条无；可靠性 2/7 有（provider-fallback、host-api-api-client），5 条无（→ G-05）；敏感面 0/7 有（→ G-06）。无组件**不是**这三张表的缺陷——它们没有组件字段——但意味着「冲突 owner / 冲突 default」对它们无从定义，TF-0632 对它们只能做引用完整性与身份空间检查。

### 5.5 权威矩阵 → 其余表

- 不在 `DEFAULT_MATRIX_AUTHORITY_LINKS` 也不在 `PRODUCT_SURFACE_AUTHORITY_LINKS` 的组件 **17** 个：`context-runtime-kit`、`dcs-assembler-compat-adapter`、`provider-request-guard`、`compass-context-source`、`role-memory-card-governance`、`native-file-memory-retrieval`、`dreaming-derived-cache`、`knowledge-retrieval-source`、`v3-capability-catalog`、`skills-mcp-source-registry`、`tool-search-schema-expander`、`verseshell-execution-adapter`、`permission-approval-authority`、`task-ledger`、`observability-recorder`、`host-api-transport-owner`、`renderer-ui-surface`（O-5）。
- 经精确锚点连到能力主张的组件 3 个、连到可靠性的 2 个；其余 32 / 33 个组件在这两张表中没有任何可机械定位的出现。

### 5.6 数据类型级：被读取但无任何 owner 的 16 个数据类型（T-U）

权威矩阵校验器只要求 `ownedDataTypes` 与 `allowedWrites` 有 authority 行（:960–:971, :1016–:1020），对 `allowedReads` 不做 owner 检查。以下 16 个数据类型只出现在 `allowedReads` 中：

| dataType | readers |
|---|---|
| `capability.execution-schema` | `tool-registry-context-source`, `tool-search-schema-expander`, `coding-execution-backend`, `verseshell-execution-adapter`, `permission-approval-authority` |
| `context.candidate-fragment` | `dcs-context-authority`, `dcs-assembler-compat-adapter` |
| `context.owner-reference` | `context-runtime-kit` |
| `context.source-reference` | `vtoken-context-source`, `compass-context-source`, `c6-context-ladder-source`, `dcs-fact-view-and-tools` |
| `context.token-pressure` | `c6-context-ladder-source` |
| `knowledge.candidate` | `knowledge-review-authority` |
| `mcp.tool-schema` | `skills-mcp-source-registry` |
| `memory.native-file` | `native-file-memory-retrieval`, `memory-embedding-provider` |
| `provider.media` | `provider-request-guard` |
| `provider.model-identity` | `provider-request-guard`, `vtoken-context-source` |
| `provider.transform-declaration` | `provider-request-guard` |
| `runtime.config` | `context-enhancement-gate`, `vtoken-bridge` |
| `runtime.env` | `context-enhancement-gate`, `vtoken-bridge` |
| `session.transcript` | `sekb-candidate-provider` |
| `skill.manifest` | `skills-mcp-source-registry` |
| `workspace.permission-mode` | `permission-approval-authority` |

→ G-04。其中 `session.transcript` 与 `workspace.permission-mode` 正是 G-03 中 `chat` / `plan-mode` 概念的 sourceOfTruth。

---

## 6. 冲突清单与裁定（问题 4）

### 6.1 裁定总纲（按轴）

| 轴 | 规则 | 本轮结果 |
|---|---|---|
| R-I 身份 | §3.1 I-1…I-5 | 35 个身份；9 处 id 后缀漂移不构成冲突（O-1） |
| R-O owner | 组件级 owner 只由权威矩阵声明；处置 `owner` 不是授权声明；TF 节点号按"责任节点"读且须等于本条 implementation/retirement node | 10/10 成立；schema 级冲突 1（C-01） |
| R-F flag | 对每个 flag：manifest 绑定组件 == 处置项 `owner`，或在其 coverage 内，或 `owner` 为责任节点；feature 级处置项的激活态与 flag risk 比较（baseline-on↔baseline、opt-in↔opt-in、shadow-only↔shadow；api-only / request-only / read-only 无激活语义，豁免） | 22/22 一致；粒度差异 → X-01 |
| R-D1 激活轴 | 权威 `defaultMode` ∈ {baseline, opt-in, shadow, disabled} 与处置 `currentMode` ∈ {baseline, opt-in, shadow} 必须相等；`mixed` 与权威 internal / read-only 不可比 | 可比 13：相等 11，**不等 2**（C-02、C-03）；不可比 20 → X-04 |
| R-D2 退役轴 | 权威 `defaultMode === 'retired'` ⇔ 处置 `disposition === 'retired'`（`component.*`） | **不对称 2**（C-04、C-06） |
| R-D3 默认矩阵行 | 组件 `runtimeAvailabilitySource` 指向 `docs/dev/default-config-matrix.md#<行>` 时，该行加粗产品默认值与权威激活态比较：`true`→baseline、`retired`→retired、`false`/`off`→非 baseline；`auto` 豁免 | 2 个组件适用，**2 个冲突**（C-04、C-05）；`auto` 行 2 → X-05 |
| R-D4 flag 来源 | 组件 `runtimeAvailabilitySource` 为 `DCS_PROD_FLAGS:<flag>` 时，权威激活态与 flag risk 比较（映射同 R-F） | 13 个组件适用：一致 6、豁免 5（risk 无激活语义）+ 1（权威 internal）、**冲突 2**（C-02、C-03，与 R-D1 同源佐证） |
| R-D× 直接比相等 | `targetDefaultMode === defaultMode` **不是**有效冲突测试 | 相等 13 / 不等 22；其中 21 条"目标分歧"里只有 3 条是真冲突（已被 R-D1/R-D3 捕获），其余 18 条 → X-03 |
| R-A authority | 权威矩阵 authority 键唯一、每 dataType 单 owner、权限 owner 恰 1；产品语义 `authorityBoundary` 与可核对组件的 purpose / forbiddenActions 一致 | 冲突 0；3 条关系不可核对 → G-03 |
| R-G gap | 任何表声明的组件/概念在权威矩阵无身份，或权威矩阵读取的数据类型无 owner，登记为 gap，不猜测、不默认通过 | G-01…G-06 |

> 勘误（2026-10-31 收口决策轮，deviation `TFD-ca7eb218be`）：上表 R-D4 行的"一致 6、豁免 5（risk 无激活语义）+ 1（权威 internal）、冲突 2"与 13 个 `DCS_PROD_FLAGS:*` 来源的总数不符；在 HEAD `2b87c1c44` 上逐组件重测为 **一致 5**（`dcs-fact-view-and-tools`、`runtime-memory-store`、`memory-candidate-queue`、`coding-execution-backend`、`routing-memo-observation`）、豁免 6（risk 无激活语义 5 + `observability-recorder` 权威 internal 1）、冲突 2，合计 13。§10.5 命令末尾期望注释中的"ok ×6"同为笔误，应读作 ok ×5。冲突（C-02、C-03）与豁免（X-04）结论不受影响。复测命令见 `CLOSURE-DECISIONS-20261031.md` §6.3。

**为什么 5 个默认态冲突都判权威矩阵陈旧**：每一处都有至少两个独立来源（flag 目录 / 默认矩阵文档 / 产品面文档 / 处置矩阵 + 已收口的 TF 节点与在盘的验证产物）站在同一边，而权威矩阵是孤例；其中 C-04 / C-05 的权威条目自己引用的 `runtimeAvailabilitySource` 就是写着 retired 的那一行。这是裁定"以哪份表为准"，**不是**修改——本轮不改任何注册表。

### 6.2 冲突（6 条，全部已裁定；0 条未裁定）

| 编号 | 组件 / 字段 | 表 A 原值（文件:行） | 表 B 原值（文件:行） | 第三方证据 | 裁定（以哪份为准） | 理由 | 复核条件 / 后续（非本轮） |
|---|---|---|---|---|---|---|---|
| **C-01** | 处置矩阵 `owner` 字段的命名空间（schema 级，10 条） | 处置：`owner` 为权威组件 id 44 条、TF 节点号 10 条——`component.vtoken-context` :152、`component.vtoken-bridge` :161、`component.compass-context` :167、`component.c6-context-ladder` :176、`component.sekb-candidate-provider` :236、`component.routing-memo-observation` :304、`feature.symbol-lease` :347、`feature.patch-flow` :353、`feature.agent-map` :365、`feature.runtime-shadow-governance` :374；校验只要求非空（:509） | 权威：组件级 owner = 组件自身 + 44 条 authority 行 + `authorizationRole`；对上述 6 个 `component.*`，组件 owner 经 I-2 为 `vtoken-context-source`、`vtoken-bridge`、`compass-context-source`、`c6-context-ladder-source`、`sekb-candidate-provider`、`routing-memo-observation` | 该字段被 `shared/model-capability-profile.ts:375` 原样投影为 `ModelCapabilityStaticEntry.owner`（类型 :72）并参与 `static_owner_mismatch`（:410）——混用已传播到模型可见投影 | **以权威矩阵为准**。处置 `owner` 不是授权声明（TF-0632 规则 3）；TF 节点号按"责任节点"读 | 同一个字段名在 54 条里指两种东西；10/10 的节点值恰等于本条 implementation/retirement node，说明它实际是节点簿记 | TF-0632 不得把 `owner` 当 owner 比较，须经 coverage 取组件；并要求节点值 == implementation/retirement node（当前成立）。处置矩阵下次修订时把 `owner` 拆为 `ownerComponentId` / `accountableNodeId`（或等价）后撤销本条 |
| **C-02** | `working-memory-context-source` 默认态 | 权威 `defaultMode: 'opt-in'`（:189），`runtimeAvailabilitySource: 'DCS_PROD_FLAGS:working-memory'`（:188） | 处置 `component.working-memory-context` default / currentMode `baseline` / target `baseline`（:140） | flag `working-memory` risk `baseline-on`、defaultValue `true`（`prod-flags-catalog.ts:76`）；默认矩阵 `working-memory` **true**（`default-config-matrix.md:22`）与 TF-0494 决定注（:12）；产品面 `Workspace Context` = `default`（`clawx-product-semantics.md:180`）；TF-0494 在 Task Forest 为 done | **以 flag 目录 + 处置矩阵为准：baseline** | R-D1 与 R-D4 同时不等；权威矩阵自引用的 flag 已是 baseline-on；四个来源对一个 | 权威矩阵下次修订改 `baseline`。在此之前 TF-0632 对该对应 **fail-closed**，或以本编号登记为"已裁定、待修正"豁免；不得放宽 R-D1/R-D4 |
| **C-03** | `tool-registry-context-source` 默认态 | 权威 `opt-in`（:206），source `DCS_PROD_FLAGS:tool-registry`（:205） | 处置 `component.tool-registry-context` default / `baseline` / `baseline`（:146） | flag `tool-registry` `baseline-on` / `true`（:94）；默认矩阵 `tool-registry` **true**（:23）；产品面 `Workspace Context` default（:180）；TF-0494 done | **baseline（同 C-02）** | 同 C-02 | 同 C-02 |
| **C-04** | `vtoken-context-source` 默认态 / 生命周期 | 权威 `opt-in`（:223），source `docs/dev/default-config-matrix.md#VToken-assembly`（:222）；链接 `VToken assembly`（:691）、`VToken turn assembly`（:679） | 处置 `component.vtoken-context` retired / `retired` / `retired`，owner `TF-0496`，`implementationState: 'retired'`，verificationArtifact 三项（:152–:159） | 默认矩阵 `VToken assembly` **retired (always off)**（:19）与说明 :35；产品面 `VToken turn assembly` = `retired`（:182）；`docs/dev/vtoken-retirement-decision.md` 与 `tests/unit/fixtures/vtoken-tf0496/`（含 `verification.json`、`SHA256SUMS`，均已跟踪）；TF-0496 done | **以退役为准（处置矩阵 + 默认矩阵）** | R-D2 与 R-D3 同时命中；权威条目引用的来源本身写着 retired | 权威矩阵下次修订改 `retired`；在此之前 TF-0632 R-D2/R-D3 对该组件 fail-closed 或登记已裁定豁免 |
| **C-05** | `vtoken-bridge` 默认态 | 权威 `opt-in`（:239），source `docs/dev/default-config-matrix.md#VToken-bridge`（:238） | 处置 `component.vtoken-bridge` internal / currentMode `opt-in` / target `internal`，owner `TF-0496`，visibilityReason "Internal diagnostics boundary only…"（:161–:165） | 默认矩阵 `VToken bridge` **retired (always off)**、"sidecar never starts"（:20）；产品面 `VToken turn assembly` retired（:182，链接含 `vtoken-bridge` :679）；TF-0496 done | **产品默认态以默认矩阵为准：retired**。两份注册表的 `opt-in` 只能读作测试 / 诊断可用性（处置 visibilityReason 与 currentConsumers "vtoken package tests" 支持此读法），**不是**产品默认态 | R-D3 命中；权威条目引用的来源写着 retired；处置矩阵与权威矩阵在"诊断可用"上并不矛盾，但现有枚举无法区分产品可用与诊断可用 | 权威矩阵改 `retired`（或 `disabled`）、处置 `currentMode` 改 `retired`、或枚举区分产品 / 诊断可用性之前，TF-0632 R-D3 对该组件 fail-closed 或登记已裁定豁免 |
| **C-06** | `retired-surface-registry` 的 `retired` 词义 | 权威 `defaultMode: 'retired'`（:669），但组件活跃：authority 行 `retired.surface-class::global::update`（:914–:918）、effects `update`/`record`（:666）、被 `host-api-transport-owner`（:632）与 `renderer-ui-surface`（:648）读取 | 处置 `component.retired-surface-registry` internal / currentMode `baseline` / target `retired`，currentConsumers "retirement checks", "product claim scan"（:325–:329） | 产品面链接 `Surfaces listed in RETIRED-SURFACES.md` = `retired`（`clawx-product-semantics.md:189`；manifest :686）——权威矩阵把**所链接产品面的状态**写进了组件自己的 `defaultMode` | **组件生命周期以处置 `disposition: 'internal'` + `currentMode: 'baseline'` 为准**；`retired` 在此是描述所拥有数据 / 所链接产品面的状态，不是组件状态（TF-0632 规则 3：描述性字段不得当状态 / 授权声明） | R-D2 不对称；一个活跃的、有写 authority 行的组件不可能 retired | 权威 `defaultMode` 与处置 `targetDefaultMode` 都应改为 `internal`（后续节点）；在此之前 TF-0632 R-D2 对该组件登记已裁定豁免 |

### 6.3 显式豁免（5 类，每类有理由与复核条件）

| 编号 | 豁免对象 | 理由 | 复核条件 |
|---|---|---|---|
| **X-01** flag 绑定粒度 | 7 个 coding flag（`stale-write-guard`、`write-journal`、`worktree-backend`、`isolation-request`、`symbol-lease`、`symbol-lease-mode`、`patch-flow`）在权威矩阵绑定到 1 个组件 `coding-execution-backend`（:502–:504，`defaultMode: 'opt-in'`），在处置矩阵绑定到 5 个 `feature.*` 条目（T-D #1–#5），而 `component.coding-execution-backend`（:259–:264）无 `dcsFlagIds` | 两种粒度各自合法（权威按组件、处置按用户可见特性）；owner 22/22 一致；组件级 `opt-in` 是 7 个 flag（baseline-on / opt-in / api-only / request-only 混合）的有损汇总，无法逐条比较。在 flag 粒度上比较则一致：`write-journal` baseline-on ↔ `feature.coding-recovery` default/baseline；`stale-write-guard` opt-in ↔ advanced/opt-in；`worktree-backend` / `isolation-request` 无激活语义 | TF-0632 对 `catalogFlagIds` 多于 1 个的组件改用 R-F（flag 级）而非组件级 `defaultMode` 比较。若出现 feature 级处置项的 `owner` 既非 manifest 绑定组件也非其实施 / 退役节点，视为冲突。另见 O-6（flag 目录对已退役 flag 的 riskNote 未更新） |
| **X-02** `internal` 词汇碰撞 | 4 对：`knowledge-review-authority`（权威 `internal` :404 ↔ 处置 default + route `/knowledge` :224–:227）、`skills-mcp-source-registry`（:469 ↔ default + `/channels` :248–:251）、`tool-search-schema-expander`（:485 ↔ default + `/skills` :254–:257）、`task-ledger`（:555 ↔ default + `/task-ledger` :279–:282） | 权威 `defaultMode: 'internal'` 的含义是"未门控的基础设施可用性"（它与 `task-ledger` 自述 "Owns user-visible task facts" :547 并存），而处置 `disposition: 'internal'` 的含义是"无用户表面"（校验器强制 visibility internal 且无 userEntry :519–:520）。同一词、两个轴，不是组件级冲突。另有 8 对两表同为 `internal` 的组件只是两种含义碰巧都成立 | 不得把权威 `defaultMode='internal'` 与处置 `disposition` 比较；权威矩阵没有可见性轴。仓库中没有任何文档定义权威 `defaultMode` 的词汇（仅 `docs/dev/adr/2026-10-23-capability-catalog-authority.md:56` 对单个组件提及），处置侧词汇定义见 `docs/modules/component-inventory.md:20`。一旦权威枚举语义被文档化或拆轴，重新评估这 4 对 |
| **X-03** `targetDefaultMode ≠ defaultMode`（18 对） | `dcs-context-authority`（baseline→internal）、`context-enhancement-gate`（baseline→internal）、`compass-context-source`（opt-in→internal）、`dcs-fact-view-and-tools`（opt-in→baseline）、`role-memory-card-governance`（opt-in→baseline）、`runtime-memory-store`（opt-in→internal）、`memory-candidate-queue`（opt-in→internal）、`memory-embedding-provider`（opt-in→internal）、`knowledge-review-authority`（internal→baseline）、`knowledge-retrieval-source`（read-only→baseline）、`sekb-candidate-provider`（shadow→internal）、`skills-mcp-source-registry`（internal→baseline）、`tool-search-schema-expander`（internal→baseline）、`coding-execution-backend`（opt-in→baseline）、`verseshell-execution-adapter`（opt-in→internal）、`task-ledger`（internal→baseline）、`routing-memo-observation`（shadow→internal）、`host-api-transport-owner`（baseline→internal） | `targetDefaultMode` 是"组件处置目标"（`component-inventory.md:20`），借用了权威矩阵混合三轴的枚举来表达可见性 / 分级目标；与权威"当前声明"直接比相等在语义上无效。注意：不能用"目标尚未到达"解释——处置矩阵引用的实施节点 TF-0493…TF-0511 全部 done；真正的原因是轴混用。21 条"目标分歧"中 3 条（C-02、C-03、C-05）已由 R-D1/R-D3 判为真冲突，其余 18 条豁免 | TF-0632 **不**采用 `targetDefaultMode === defaultMode` 作为冲突测试，改用 R-D1…R-D4。若权威矩阵未来增加独立的可见性 / 目标字段，重新评估 |
| **X-04** 激活轴不可比（20 对） | 处置 `currentMode: 'mixed'` 13 个：`knowledge-review-authority`、`knowledge-retrieval-source`、`sekb-candidate-provider`、`skills-mcp-source-registry`、`tool-search-schema-expander`、`coding-execution-backend`、`permission-approval-authority`、`task-ledger`、`browser-session-owner`、`browser-task-projection-owner`、`observability-recorder`、`routing-memo-observation`、`renderer-ui-surface`；权威值不在激活轴 7 个：`context-runtime-kit`（internal/baseline）、`dcs-assembler-compat-adapter`（internal/baseline）、`provider-request-guard`（internal/baseline）、`c6-context-ladder-source`（internal/opt-in）、`native-file-memory-retrieval`（read-only/baseline）、`dreaming-derived-cache`（internal/baseline）、`v3-capability-catalog`（internal/shadow） | `mixed` 在权威枚举中无对应；`internal` / `read-only` 不表达激活默认 | R-D1 对这 20 对不产生判定；有 flag 的改用 R-D4（如 `observability-recorder` ↔ `rc03-seal` opt-in：权威 internal 不在激活轴 → 豁免并列出）；无 flag 的保持列出，不默认通过 |
| **X-05** 文档值无枚举对应 | 默认矩阵 `auto`（`DCS Fact view tools` :18、`Coding auto verify` :31）；产品面 `deferred`（`SEKB automatic writeback` :183、`C7 knowledge/routing cutover` :185）、`diagnostics-only`（`Runtime Memory injection` :188） | 这些值不在 `ComponentAuthorityDefaultMode` 中，R-D3 无法映射 | R-D3 只对 `true` / `false` / `off` / `retired` 行判定，其余行列出；若未来文档改用枚举值，纳入判定 |

### 6.4 gap（6 类 / 35 条；"缺什么证据"逐条写明）

| 编号 | 对象 | 现状 | 缺什么 |
|---|---|---|---|
| **G-01**（组件级） | `feature.agent-map`（处置 :365） | owner `TF-0511`；无 `authorityComponentIds`、无 `dcsFlagIds`；仅 `runtimeLeafPatterns: ['agentMap.*']`；verificationArtifact 指向 `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`——一个上下文候选提供者，但 `dcs-context-authority` 的 `candidateProviderIds`（:732）不含它，权威矩阵也无对应组件 | 权威矩阵中的组件声明（或显式的"按设计无组件"登记），以便 TF-0632 把它从"缺失"与"外部"中区分 |
| **G-02**（组件级） | `feature.runtime-shadow-governance`（处置 :374） | owner `TF-0511`；7 个 leaf 族（`registryPilot.*`、`providerRegistry.*`、`contextProviders.*`、`registryDiagnostics.*`、`toolProtocol.*`、`evidenceVerifier.*`、`resilience.*`）；无任何组件 / flag 绑定 | 同 G-01 |
| **G-03**（组件级，5 条） | 产品概念 `chat`、`plan-mode`、`chat-plan`、`workboard`、`task-loop` | sourceOfTruth 分别为 conversation transcript / workspace permission decision / orchestrator plan output / runtime scheduling / loop run+checkpoint state；权威矩阵 10 域不含 session、orchestration、scheduling；对应数据类型 `session.transcript`、`workspace.permission-mode` 在权威矩阵里只被读、无 owner（T-U）。影响：6 条关系中 3 条（:170 :171 :172）的源端、:173 :175 的 task-loop 端不可核对 | 权威矩阵的组件声明（或显式外部 owner 表）；在此之前 TF-0632 对涉及这些端点的关系只能检查引用完整性，不能检查权威一致性 |
| **G-04**（数据类型级，16 条） | T-U 列出的 16 个 `allowedReads` 数据类型 | 无 owner 行；校验器不检查 `allowedReads`（:960–:971） | owner 行，或显式 `externalOwner` 标记（如 "L1 runtime"），使"按设计外部"与"漏写 owner"可区分 |
| **G-05**（非组件，5 条） | 可靠性子系统 `gateway-startup`（:22）、`session-restore-replay`（:58）、`file-writes`（:70）、`dangerous-approvals`（:82）、`task-loop-repair-retry`（:94） | 精确锚点连接为空。人工候选（**不作裁定依据**）：`file-writes` → `coding-execution-backend`（拥有 `execution.write-journal`）；`dangerous-approvals` → `permission-approval-authority`；其余 3 个无候选（Gateway 生命周期、session、task-loop 均无组件） | 子系统条目的组件字段，或与权威 `sourceAnchors` 相同的证据路径 |
| **G-06**（非组件，7 条） | 敏感面 `file`、`transcript`、`trace`、`memory`、`compaction`、`sekb`、`modelEcho` | 精确锚点连接 0/7。人工候选（**不作裁定依据**）：`sekb` → `sekb-candidate-provider`（同名且证据同目录 `openclaw_runtime/src/knowledge/sekb/`）；`trace` → `observability-recorder`（拥有 `observation.trace`）；`memory` → `runtime-memory-store` / `memory-candidate-queue` / `role-memory-card-governance`；`file` / `transcript` / `compaction` / `modelEcho` 无候选 | 同 G-05 |

### 6.5 其他观察（不是冲突，记录给后续节点）

- **O-1** 处置 `component.*` id 后缀与组件 id 不同 9 处：`dcs-assembler-adapter`↔`dcs-assembler-compat-adapter`、`working-memory-context`↔`working-memory-context-source`、`tool-registry-context`↔`tool-registry-context-source`、`vtoken-context`↔`vtoken-context-source`、`compass-context`↔`compass-context-source`、`c6-context-ladder`↔`c6-context-ladder-source`、`dcs-context-tools`↔`dcs-fact-view-and-tools`、`role-memory`↔`role-memory-card-governance`、`browser-task-projection`↔`browser-task-projection-owner`。只要连接经 coverage，无害；任何按后缀推导身份的工具都会错 9 次。
- **O-2** 处置 `owner` 经 `shared/model-capability-profile.ts:375` 进入 `ModelCapabilityStaticManifest`，并由 `static_owner_mismatch`（:410）与 :814 比对——C-01 的消费面。
- **O-3** 两份矩阵的证据锚点由单测检查（权威 :190–:208 含 `contains` 子串；处置 :74 仅路径存在），表 3–6 由 `scripts/check-evidence-refs.mjs` 检查路径存在；两套机制、三种强度。是 TF-0633（L5 证据绑定）的输入，不是 B1 问题。
- **O-4** `relatedTaskIds` 的命名空间：P0 / P1 在 `product-semantics.ts` 的 task boundary 中有定义；`P2-01`…`P2-07`（主张 13 条、可靠性 7 条）与 `P3-001`（敏感面 `sekb`）在六表中**无定义**；`TF-0497/0498/0548/0563` 只能在本地 Task Forest 解析。身份 / 引用风险，供 TF-0633；不是 owner gap。
- **O-5** 17 个组件不在任何链接表中（§5.5）——基础设施组件按设计如此，但 R-D3 因此触及不到它们。
- **O-6** flag 目录仍以 `opt-in` / `api-only` risk 列出 `symbol-lease`、`symbol-lease-mode`、`patch-flow`（:189–:247），riskNote 未提 TF-0510 退役，而处置矩阵已将它们 retired（:347, :353）；权威矩阵因校验器要求精确覆盖 flag 目录（:1026–:1029）而不得不继续绑定它们（:502–:504）。邻接表漂移，超出六表范围，但 TF-0632 须知道：退役 feature 的 flag 在 flag 目录里仍带激活语义。
- **O-7** `native-file-memory-retrieval` `defaultMode: 'read-only'`（:322）但 effects 含 `update`、`allowedWrites` 含 `memory.native-file-query`（:318–:319；authority 行 :798 自述 "retrieval metadata, not accepted memory"）——`read-only` 是对产品语义的描述而非对效果的约束。表内张力，与 TF-0632 规则 3 相关。
- **O-8** 枚举中的空值：处置 `experiment` 0 条；权威 `disabled` 0 处使用。

### 6.6 TF-0629 §7.6 移交项：`window` Host API 模块命名漂移（G-07，L4 身份 gap，不计入六表 gap）

TF-0629 把"`window` 模块由 `createSystemNotificationsApi` 实现且混有两类职责"归到本节点（`ADMISSION-INVENTORY.md` §6 `window` 行与 §7.6；本节点 `next_action`）。本轮核实与裁定：

| 项 | 事实（文件:行） |
|---|---|
| 合同模块 | `shared/host-api/contract.ts:5518–5525` `window`：`syncTrafficLightPosition`、`notify`、`minimize`、`maximize`、`close`、`isMaximized`（1 个通知 action + 5 个窗口控制 action） |
| 实现 | `electron/services/system-notifications-api.ts:89` `createSystemNotificationsApi`（:47 `…WithDependencies`） |
| 注册 | `electron/main/ipc-handlers.ts:232` `window: createSystemNotificationsApi(mainWindow)`；facade `src/lib/host-api.ts:745` |
| 六份注册表中的出现 | **0**（`grep -nE "'window'\|system-notifications"` 对六表无命中） |
| 权威矩阵中最近的组件 | `host-api-transport-owner`（:626–:640）——purpose 明确 "does not own domain data"（:629），只拥有 `ui.host-request`；`renderer-ui-surface`（:642）不拥有任何数据类型 |
| 现有门禁的可见性 | TF-0630 的 `contract:check` 按**模块名**对账 contract / facade / 注册（`parseRegisteredModules` 匹配 `window:` 键），不比对实现工厂名或文件名；5 条扁平 `window:*` 已在 `scripts/contract-check-flat-ipc.json` 登记为 retire |

裁定：

1. 它**不是**六表意义上的冲突 owner / default / authority——`window` 既不是权威组件、处置项、主张、子系统、敏感面，也不是产品概念；B1 校验器（TF-0632）不应为它增加规则。
2. 它是 **L4 身份 gap（G-07）**：Host API 模块名与实现身份（工厂 / 文件）之间没有任何注册表声明绑定，且一个模块承载两类职责；门禁按模块名对账因此看不见这种漂移，但它也不改变行为。
3. 本轮**不改名、不拆分**（只读）。处置路径留给 L4 节点（批次 A 的 A2 兼容回归，或独立的接入层卫生节点）：(i) 保留模块名 `window`，把工厂 / 文件改名为 `createWindowApi` / `window-api.ts`——纯标识符与文件重命名，零合同变化；(ii) 把 `notify` 拆到独立模块——这是**合同变更（新增模块）**，必须有自己的 task spec，不得作为"规整"顺手完成（宪章 §2.2、§6.2）。本文件不在二者之间预作选择。

---

## 7. 给 TF-0632 的输入

### 7.1 规则（直接可实现）

R-I（§3.1）、R-O、R-F、R-D1、R-D2、R-D3、R-D4、R-A、R-G（§6.1）。其中 R-D× 的否定（"不以 `targetDefaultMode === defaultMode` 为冲突"）与 X-02 的否定（"不以 `internal` 跨表比较"）同样是规则，避免 21 + 4 个假阳性。

### 7.2 豁免登记表种子（每条必须带理由 + 复核条件，缺理由即拒绝）

- 结构性豁免：X-01（按 flag 粒度）、X-02（4 对）、X-03（18 对）、X-04（20 对）、X-05（5 行）。
- "已裁定、待修正"豁免：C-02、C-03、C-04、C-05、C-06（若 TF-0632 选择先登记再由后续节点修正权威矩阵）；或直接 fail-closed 等修正落地——二者任选其一，**不得放宽规则**。
- 不豁免：C-01 的读取规则（经 coverage 取 owner）必须实现，不能靠豁免绕过。

### 7.3 在当前树上的预期结果

- 无豁免登记时：默认态冲突 5（C-02…C-06）、owner 规则读取 10 条节点值并全部通过等式检查、组件级 gap 7（G-01、G-02、G-03×5）、数据类型 gap 16。
- 登记 §7.2 种子后：通过；gap 以"已登记"状态输出而非静默。

### 7.4 合同要求的五类负例（`architecture-skeleton-authority-validator.md` :57–:63）对应的现成坏例形状

| 负例 | 可用的最小变异 |
|---|---|
| 冲突 owner | 把某 `component.*` 处置项的 `owner` 改为另一个权威组件 id，且 coverage 不变 |
| 冲突 default | 把权威某组件 `defaultMode` 改为 `retired` 而处置 `disposition` 仍为 `default`（R-D2），或把处置 `currentMode` 改为与权威激活态不同（R-D1） |
| 冲突 authority | 把产品语义某关系的 `authorityBoundary` 改为与权威 forbiddenActions 相反（如 workboard→task-ledger 改为 `task-ledger-authority`）；权威矩阵内部重复 authority 行已被自身校验器拒绝（`duplicate_authority`） |
| 表声明了矩阵中不存在的组件 | 处置项 `coverage.authorityComponentIds` 填不存在的 id（处置校验器已以 `unknown_coverage` 拒绝，TF-0632 须复用而非重写）；或新增一个无组件的产品概念 |
| 豁免缺理由 | 登记表条目缺 reason 或 reviewCondition |

---

## 8. 与宪章 §5 批次 B 验收口径 / §8 判据的对应

| 口径 / 判据 | 本轮状态 |
|---|---|
| 每个组件在权威矩阵中有唯一 owner | **达成（声明层）**：35 个身份唯一；44 条 authority 行键唯一、每 dataType 单 owner；权限 owner 恰 1。9 个组件按设计不拥有数据类型（候选提供者 / 适配器 / renderer），没有 authority 行，这是"不拥有"不是"多 owner" |
| 冲突为 0 或已显式豁免 | **达成（裁定层）**：6 条冲突全部有裁定，5 类豁免全部有理由与复核条件；**机械保证未达成**（那是 TF-0632） |
| 现有语义文件的消费点未变 | **达成**：本轮零代码改动；`git status` 仅本文件与 validator spec 的一行 `docs.files` |
| §8 "同一组件冲突 owner = 0 或已显式豁免" | 组件级 owner 冲突 0；schema 级 1（C-01，已裁定） |
| §8 "新增运行时组件 / 第二真源 = 0" | 0；本文件是只读投影 |

---

## 9. 边界声明

- 本文件只产出对齐与裁定，**不产出实现**。所有"后续 / 复核条件"都是对 TF-0632 及更后节点的输入。
- 未修改 `shared/component-authority-manifest.ts`、`shared/dcs/component-disposition-catalog.ts`、`shared/capability-claims.ts`、`shared/reliability-boundaries.ts`、`shared/sensitive-content-boundary.ts`、`shared/product-semantics.ts` 中的任何一个字节；也未修改 `shared/dcs/prod-flags-catalog.ts`、任何文档矩阵、任何测试。
- 未合并、删除或新增注册表；未新增 Host API 模块、UI、package script、运行时组件、统一本体、图存储或第二真源。
- 未改变产品锁、默认矩阵、发布状态或 GA 口径。"以 X 为准"是裁定哪份声明在冲突中胜出，不是修改默认值。
- "对齐"不等于"已统一"：机械统一（校验器 + 门禁）是 TF-0632 的范围。
- 本文件的"消费点"统计是静态 import 扫描，不是运行时观测。
- 本文件不声称任何性能、收益或采用率。
- 全部产出为 agent 驱动（`driven_by: agent`）；没有真人操作、真人数据或真人 verdict 参与；也没有任何以真人为前置的验收条件。

---

## 10. 复现命令（离线，仓库根目录，Git Bash；临时目录用 `D:\tmp`）

```bash
# 10.1 基线
git rev-parse HEAD; git rev-parse 'HEAD^{tree}'; git status --porcelain | wc -l
wc -l shared/component-authority-manifest.ts shared/dcs/component-disposition-catalog.ts shared/capability-claims.ts shared/reliability-boundaries.ts shared/sensitive-content-boundary.ts shared/product-semantics.ts
git ls-files -s shared/component-authority-manifest.ts shared/dcs/component-disposition-catalog.ts shared/capability-claims.ts shared/reliability-boundaries.ts shared/sensitive-content-boundary.ts shared/product-semantics.ts
git diff --numstat 1e278652b~1 1e278652b -- shared/product-semantics.ts     # → 33 0（684 → 717 的来源）
```

```bash
# 10.2 条目数与行号锚点（纯 grep）
grep -nE "^\s{4}id: '[a-z0-9-]+',$" shared/component-authority-manifest.ts | wc -l          # → 35（-n 去掉 wc 即得每个组件的行号）
grep -cE "dataType: '" shared/component-authority-manifest.ts                                # → 44 authority 行
grep -nE "^\s+id: '(component|feature|surface|settings)\." shared/dcs/component-disposition-catalog.ts | wc -l   # → 54
grep -cE "owner: 'TF-[0-9]{4}'" shared/dcs/component-disposition-catalog.ts                   # → 10
grep -nE "^\s+id: 'capability-[0-9]{2}',$" shared/capability-claims.ts | wc -l               # → 45
grep -nE "^\s+subsystem: '" shared/reliability-boundaries.ts                                  # → 7 行
grep -nE "^\s+surface: '" shared/sensitive-content-boundary.ts                                # → 7 行
grep -nE "^\s{4}id: '(chat|plan-mode|chat-plan|task-ledger|workboard|task-loop|routing-memo)',$" shared/product-semantics.ts   # → 7 行
grep -nE "^\s+\{ from: '" shared/product-semantics.ts                                         # → 6 行（170–175）
grep -cE "^\s+id: 'P[01]-[0-9]{2}',$" shared/product-semantics.ts                             # → 32
grep -cE "^\s+id: '[a-z0-9-]+',$" shared/dcs/prod-flags-catalog.ts                            # → 22
sed -n '/^export const PRODUCT_SURFACE_AUTHORITY_LINKS/,/^} as const/p' shared/component-authority-manifest.ts | grep -cE "^\s+'[^']+': \["   # → 11
sed -n '/^export const DEFAULT_MATRIX_AUTHORITY_LINKS/,/^} as const/p' shared/component-authority-manifest.ts | grep -cE "^\s+'[^']+': \["    # → 14
```

```bash
# 10.3 把六份 TS 注册表（+ flag 目录）打包成可 import 的 ESM（仓库自带 esbuild；不改源码）
export TMPDIR=/d/tmp; mkdir -p /d/tmp/tf0631
EB=$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild | head -1)/bin/esbuild
for f in component-authority-manifest dcs/component-disposition-catalog capability-claims reliability-boundaries sensitive-content-boundary product-semantics dcs/prod-flags-catalog; do
  node "$EB" "shared/$f.ts" --bundle --format=esm --platform=node --log-level=warning --outfile="/d/tmp/tf0631/$(echo "$f" | tr / _).mjs"
done
```

```bash
# 10.4 计数、连接、owner 命名空间、R-D1/R-D2、flag 三方、未拥有数据类型、精确锚点连接、概念连接
node --input-type=module -e '
const L=(n)=>import("file:///D:/tmp/tf0631/"+n+".mjs");
const A=await L("component-authority-manifest"),D=await L("dcs_component-disposition-catalog"),C=await L("capability-claims"),R=await L("reliability-boundaries"),S=await L("sensitive-content-boundary"),P=await L("product-semantics"),F=await L("dcs_prod-flags-catalog");
const comps=A.AUTHORITY_COMPONENTS,disp=D.COMPONENT_DISPOSITION_ENTRIES,ids=new Set(comps.map(c=>c.id));
console.log("counts",comps.length,A.COMPONENT_AUTHORITY_MANIFEST.authorities.length,disp.length,C.CAPABILITY_CLAIM_MATRIX.length,R.RELIABILITY_BOUNDARIES.length,S.SENSITIVE_CONTENT_BOUNDARY_MATRIX.length,P.PRODUCT_SEMANTIC_CONCEPTS.length,P.PRODUCT_SEMANTIC_RELATIONS.length,P.PRODUCT_SEMANTIC_TASK_BOUNDARIES.length,F.DCS_PROD_FLAGS.length);
console.log("byDisposition",...D.COMPONENT_DISPOSITIONS.map(d=>d+"="+disp.filter(e=>e.disposition===d).length));
console.log("byKind",...["component","feature","surface","settings"].map(k=>k+"="+disp.filter(e=>e.id.startsWith(k+".")).length));
const byAuth=(id)=>disp.filter(e=>e.coverage.authorityComponentIds?.includes(id));
console.log("authority->disposition 1:1",comps.every(c=>byAuth(c.id).length===1),"| disposition without authority",disp.filter(e=>!(e.coverage.authorityComponentIds?.length)).length);
console.log("owner namespace: component-id",disp.filter(e=>ids.has(e.owner)).length,"tf-node",disp.filter(e=>/^TF-\d{4}$/.test(e.owner)).length,"| node owner == impl/retire node",disp.filter(e=>/^TF-\d{4}$/.test(e.owner)).every(e=>e.owner===(e.implementationNodeId??e.retirementNodeId)));
console.log("id-suffix != component id",comps.filter(c=>byAuth(c.id)[0].id.split(".").slice(1).join(".")!==c.id).length);
const act=new Set(["baseline","opt-in","shadow","disabled"]),cur=new Set(["baseline","opt-in","shadow"]);
const pairs=comps.map(c=>({c:c.id,m:c.defaultMode,e:byAuth(c.id)[0]}));
console.log("target==default",pairs.filter(p=>p.e.targetDefaultMode===p.m).length,"| R-D1 comparable",pairs.filter(p=>act.has(p.m)&&cur.has(p.e.currentMode)).length,"unequal",pairs.filter(p=>act.has(p.m)&&cur.has(p.e.currentMode)&&p.m!==p.e.currentMode).map(p=>p.c));
console.log("R-D2 retired asymmetry",pairs.filter(p=>(p.m==="retired")!==(p.e.disposition==="retired")).map(p=>p.c));
console.log("manifest internal vs disposition default",pairs.filter(p=>p.m==="internal"&&p.e.disposition==="default").map(p=>p.c));
const mf=new Map();for(const c of comps)for(const f of c.catalogFlagIds??[])mf.set(f,c.id);
const df=new Map();for(const e of disp)for(const f of e.coverage.dcsFlagIds??[])df.set(f,e);
console.log("flags manifest/disposition/catalog",mf.size,df.size,F.DCS_PROD_FLAGS.length,"| owner agrees",[...df].every(([f,e])=>e.owner===mf.get(f)||e.coverage.authorityComponentIds?.includes(mf.get(f))||/^TF-\d{4}$/.test(e.owner)),"| feature-level flags",[...df].filter(([,e])=>e.id.startsWith("feature.")).length);
const owned=new Set(comps.flatMap(c=>[...c.ownedDataTypes,...c.allowedWrites]));
console.log("unowned read dataTypes",[...new Set(comps.flatMap(c=>c.allowedReads))].filter(t=>!owned.has(t)).length);
const ap=new Map();for(const c of comps)for(const s of c.sourceAnchors)ap.set(s.path,c.id);
const j=(refs)=>[...new Set(refs.flatMap(r=>ap.has(r)?[ap.get(r)]:[]))];
console.log("claims with anchor join",C.CAPABILITY_CLAIM_MATRIX.filter(c=>j([...c.evidence.flatMap(e=>e.refs),...c.runtimeProof.refs]).length).map(c=>c.id).join(","));
console.log("reliability anchor join",R.RELIABILITY_BOUNDARIES.map(r=>r.subsystem+":"+(j(r.evidenceRefs).join("/")||"-")).join(" "));
console.log("sensitive anchor join",S.SENSITIVE_CONTENT_BOUNDARY_MATRIX.filter(s=>j(s.evidenceRefs).length).length);
console.log("concepts exact/near",P.PRODUCT_SEMANTIC_CONCEPTS.map(c=>c.id+":"+(ids.has(c.id)?c.id:(comps.map(x=>x.id).filter(x=>x.includes(c.id)).join("/")||"-"))).join(" "));
console.log("validators ok",A.validateComponentAuthorityManifest().ok);
console.log("P2/P3 ids referenced",[...new Set([...C.CAPABILITY_CLAIM_MATRIX.flatMap(c=>c.relatedTaskIds),...R.RELIABILITY_BOUNDARIES.flatMap(r=>r.relatedTaskIds),...S.SENSITIVE_CONTENT_BOUNDARY_MATRIX.flatMap(r=>r.relatedTaskIds)])].filter(t=>/^P[23]-/.test(t)).sort().join(","));
'
# 期望：counts 35 44 54 45 7 7 7 6 32 22 ｜ byDisposition default=13 advanced=12 internal=24 experiment=0 retired=5 ｜ byKind component=35 feature=8 surface=9 settings=2
#       1:1 true ｜ without authority 19 ｜ owner component-id 44 tf-node 10 ｜ node==impl true ｜ id-suffix 9
#       target==default 13 ｜ R-D1 comparable 13 unequal [working-memory-context-source, tool-registry-context-source]
#       R-D2 [vtoken-context-source, retired-surface-registry] ｜ internal-vs-default 4 个 ｜ flags 22 22 22 owner agrees true feature-level 7
#       unowned 16 ｜ claims capability-18,26,34,42 ｜ reliability 仅 provider-fallback / host-api-api-client ｜ sensitive 0 ｜ concepts task-ledger 精确、routing-memo→routing-memo-observation ｜ validators ok true ｜ P2-01..P2-07,P3-001
```

```bash
# 10.5 R-D3（默认矩阵行）与 R-D4（flag risk）
node --input-type=module -e '
import { readFileSync } from "node:fs";
const L=(n)=>import("file:///D:/tmp/tf0631/"+n+".mjs");
const A=await L("component-authority-manifest"),F=await L("dcs_prod-flags-catalog");
const doc=readFileSync("docs/dev/default-config-matrix.md","utf8");
const rows=new Map();for(const l of doc.split(/\r?\n/)){const m=/^\|\s*\*\*(.+?)\*\*\s*\|[^|]*\|\s*\*\*(.+?)\*\*/.exec(l);if(m)rows.set(m[1].trim(),m[2].trim());}
console.log("default-matrix rows",rows.size);
const exp=(v)=>v==="true"?["baseline"]:v==="retired"?["retired"]:(v==="false"||v==="off")?["opt-in","shadow","internal","disabled"]:null;
for(const c of A.AUTHORITY_COMPONENTS){const m=/^docs\/dev\/default-config-matrix\.md#(.+)$/.exec(c.runtimeAvailabilitySource);if(!m)continue;const v=rows.get(m[1].replace(/-/g," "));const e=exp(v);console.log("R-D3",c.id,"=",v,"| manifest",c.defaultMode,"|",e===null?"exempt":e.includes(c.defaultMode)?"ok":"CONFLICT");}
const r2m={"baseline-on":"baseline","opt-in":"opt-in","shadow-only":"shadow"},act=new Set(["baseline","opt-in","shadow","disabled"]);
for(const c of A.AUTHORITY_COMPONENTS){const m=/^DCS_PROD_FLAGS:(.+)$/.exec(c.runtimeAvailabilitySource);if(!m)continue;const f=F.DCS_PROD_FLAGS.find(x=>x.id===m[1]);const e=r2m[f.risk];console.log("R-D4",c.id,"->",f.id,f.risk,"| manifest",c.defaultMode,"|",!e?"exempt("+f.risk+")":!act.has(c.defaultMode)?"exempt(manifest "+c.defaultMode+")":e===c.defaultMode?"ok":"CONFLICT");}
'
# 期望：rows 14；R-D3 CONFLICT ×2（vtoken-context-source、vtoken-bridge）；R-D4 CONFLICT ×2（working-memory-context-source、tool-registry-context-source），ok ×6，exempt ×6
```

```bash
# 10.6 消费点（静态 import 扫描）与引用图
grep -rnE "from ['\"][^'\"]*(component-authority-manifest|component-disposition-catalog|capability-claims|reliability-boundaries|sensitive-content-boundary|product-semantics)(\.js)?['\"]" --include=*.ts --include=*.tsx --include=*.mjs electron/ src/ shared/ openclaw_runtime/src/ scripts/ tests/
grep -nE "'shared/(component-authority-manifest|dcs/component-disposition-catalog|capability-claims|reliability-boundaries|sensitive-content-boundary|product-semantics|dcs/prod-flags-catalog)\.ts'" shared/component-authority-manifest.ts shared/dcs/component-disposition-catalog.ts shared/capability-claims.ts shared/reliability-boundaries.ts shared/sensitive-content-boundary.ts shared/product-semantics.ts
sed -n '13,19p' scripts/check-evidence-refs.mjs      # → 扫描 5 个文件，不含两份矩阵
```

```bash
# 10.7 本地 Task Forest 状态（不入 Git；仅用于 C-02…C-05 中"实施节点已 done"的佐证）
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
python -X utf8 "$USERPROFILE/.codex/skills/task-forest/scripts/task_forest.py" list --workspace . --json | python -X utf8 -c "import json,sys;[print(n['id'],n['status']) for n in json.load(sys.stdin) if n['id'] in {'TF-0493','TF-0494','TF-0495','TF-0496','TF-0497','TF-0498','TF-0499','TF-0500','TF-0501','TF-0502','TF-0503','TF-0504','TF-0505','TF-0508','TF-0509','TF-0510','TF-0511'}]"
# 期望：17 个节点全部 done
```

---

## 11. 证据链

以下命令于 2026-10-31 在基线 `fd2d93a41` 上、本文件写入并经 `retainedFiles` + `--write-ignore` 跟踪之后运行（临时目录 `D:\tmp`，日志 `D:\tmp\tf0631-gate-<name>.log`，仅本地保留）。退出码由 shell 直接捕获；关键输出从日志回读。

| # | 命令 | exit | 关键输出 |
|---|---|---|---|
| 1 | `pnpm harness context --spec harness/specs/tasks/architecture-skeleton-authority-reconciliation.md` | 0 | 输出最小阅读清单（rules: `capability-owner-resolution` / `contract-first-boundary` / `repository-artifact-retention`；layer: `harness`） |
| 2 | `pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-authority-reconciliation.md --no-diff` | 0 | `Spec is valid: harness\specs\tasks\architecture-skeleton-authority-reconciliation.md` |
| 3 | `pnpm repo:evidence:check`（`package.json:120` → `node scripts/check-evidence-refs.mjs`） | 0 | `[evidence-refs] PASS 188 referenced path(s)` |
| 4 | `git diff --check`（工作区）与 `git diff --cached --check`（暂存区） | 0 / 0 | 无输出 |
| 5 | `node scripts/check-repository-artifacts.mjs` | 0 | `Repository artifact retention passed (19989 tracked paths).`（本文件已入 `retainedFiles` 与 `.gitignore` 例外块） |
| 6 | `node scripts/check-local-paths.mjs` | 0 | `[local-paths] PASS active docs contain no developer-local absolute paths` |
| 7 | `node scripts/check-evidence-refs.mjs` | 0 | `[evidence-refs] PASS 188 referenced path(s)` |
| 8 | `pnpm harness:specs:lifecycle` | 0 | `[specs] lifecycle status present for 685 task specs.` |
| 9 | `pnpm contract:check` | 0 | `Contract check passed.` |
| 10 | `pnpm exec vitest run tests/unit/component-authority-manifest.test.ts tests/unit/component-disposition-catalog.test.ts tests/unit/capability-claims.test.ts tests/unit/reliability-boundaries.test.ts tests/unit/sensitive-content-boundary.test.ts tests/unit/product-semantics.test.ts --maxWorkers=1`（六表自带校验在本基线上仍为绿，证明本轮未改任何注册表语义） | 0 | `Test Files 6 passed (6)`，`Tests 51 passed (51)` |
| 11 | `pnpm exec vitest run tests/unit/docs-index.test.ts --maxWorkers=1` | 0 | `Test Files 1 passed (1)`，`Tests 3 passed (3)` |
| 12 | `pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-authority-validator.md --no-diff`（校验 TF-0632 spec 的 `docs.files` 改回本文件后仍有效） | 0 | `Spec is valid: harness\specs\tasks\architecture-skeleton-authority-validator.md` |

#4、#5、#6 在本表回填之后再次运行，结果不变（exit 0），见候选提交前的最终复核。

**本轮明确未运行**（不在合同 `requiredTests` 内，且本轮无运行时代码改动）：`pnpm run typecheck`、`pnpm test`（全量）、`pnpm run test:e2e`、`pnpm run lint`、`pnpm agent-dev:*`、任何 live provider / Gateway 运行。这些项记为 `not-run`，不得被解读为已通过。

**验收逐条对照**（合同 frontmatter `acceptance`）：

| 验收条 | 状态 | 证据位置 |
|---|---|---|
| 对齐覆盖六份注册表中的全部条目 | 达成 | §2.1 六表计数与合同基线逐项一致；T-A（35）、T-X（35）、T-D（19，合计处置 54）、T-C（45）、§2.3（7 / 7 / 7+6）；§10.2、§10.4 可复现 |
| 输出同一组件的跨表映射，列出每份表中该组件的 id 与 owner / default / authority 原值 | 达成 | §4.1 T-X（35 行 × 权威 / 处置 / flag / 默认矩阵 / 产品面 / 概念 / 主张 / 可靠性）、§4.2 T-F、§4.3 authority 轴、§4.4 精确锚点 |
| 逐条列出冲突项；每个冲突给出裁定或显式豁免并写明理由与复核条件 | 达成 | §6.2 C-01…C-06（6 条，均有裁定 + 理由 + 复核条件）；§6.3 X-01…X-05（均有理由 + 复核条件）；未裁定 0 |
| 无法定位 owner 的组件记为 gap，不猜测、不默认通过 | 达成 | §6.4 G-01…G-06（组件级 7 条 + 数据类型 16 + 子系统 5 + 敏感面 7）；人工候选明确标注"不作裁定依据" |
| 不修改任何注册表、不合并表、不新增注册表、不改运行时行为与默认值 | 达成 | §9；`git status` 本轮仅本文件 + validator spec 一行 `docs.files`；§11 #10 六表单测仍绿 |
