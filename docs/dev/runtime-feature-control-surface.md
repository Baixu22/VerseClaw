# 自研能力接线与运行期功能控制面（GitHub issue #96）

| 字段 | 值 |
|------|-----|
| **文档性质** | 接线事实基线 + 控制面说明（定性记录，不做修复决策） |
| **对应 issue** | #96（本文件即其 Q1/Q2/Q3 结论落盘处）；#95 拥有 `coding.uftk` 的实际修复；#158 为运行期资源追踪索引 |
| **代码基线** | 分支 `codex/nop-issues-batch1-20261010`，基于 `origin/main` `ca093b5fb` |
| **驱动方式** | `driven_by: agent`；actor: automated agent。全部结论来自本会话读取该工作树磁盘文件，**未声称任何真人证据**、未执行真人投放 |
| **权威锚点** | `openclaw_runtime/src/config/runtime-feature-leaves.ts`、`openclaw_runtime/src/config/types.openclaw.ts`、`openclaw_runtime/src/config/zod-schema.ts`、`shared/dcs/prod-flags-catalog.ts`、`docs/dev/default-config-matrix.md` |
| **可执行守卫** | `node scripts/check-feature-leaf-consumers.mjs`（+ `--self-test`） |
| **单元测试** | `tests/unit/feature-leaf-consumers.test.ts` |
| **规则** | `harness/specs/rules/runtime-feature-leaf-consumers.md` |

> **本条目的单一最重要纠正**：`openclaw_runtime/src/config/runtime-feature-leaves.ts` 里的 `RUNTIME_FEATURE_EXHAUSTIVE`
> **不是默认值表**，而是「类型/ zod-schema 一致性守卫」所用的 `DeepRequired` **取样树**。它的取样值只需满足 zod 约束即可编译，
> 与运行期真实默认无因果关系。issue #96 正文中「vtoken 默认开启…（runtime-feature-leaves.ts:152）」这一判读就是踩了这个坑。
> 该结论在本文档被两处独立反证：`vtoken.assembly.enabled` 与 `rc05.operatorSliceEnabled` 在取样文件里都是 `true`，而两者真实默认都是关闭。

---

## 第一部分（Q1）：`coding.uftk` 的定位

### 结论

**`coding.uftk` 整棵子树（12 个开关，共 19 个叶子）属于「已声明、未接线」——运行期零消费方。不是「已实现但换了入口」。** 唯一正确的修复方向是**从类型 / zod-schema / `RUNTIME_FEATURE_EXHAUSTIVE` / UI 标签中移除**（或由 #95 决定等价删除），而不是"把实现改为读 uftk 配置"。

### 12 个开关的逐叶核对

树内 `uftk` 字样只出现在四个位置，全部是**声明面**，没有任何运行期读取：

| 文件 | 角色 |
|---|---|
| `openclaw_runtime/src/config/types.openclaw.ts:207` | 类型声明 |
| `openclaw_runtime/src/config/zod-schema.ts:390` | schema 校验 |
| `openclaw_runtime/src/config/runtime-feature-leaves.ts:81` | 一致性取样 |
| `openclaw_runtime/src/config/runtime-coding-uftk.test.ts` | 只测「解析通过 / 未知键被拒」 |

决定性的结构性证据是：coding 配置的**唯一**通用读取助手是 `readCodingLeaf(coding: Record<string, unknown> | undefined, key: string)`（`openclaw_runtime/src/context-engine/coding-runtime-flags.ts:71-80`），而它的全部调用点只传了三个 key：`parseOnTouch`（:103）、`staleWriteGuard`（:115）、`writeJournal`（:127）。**没有任何调用点传过 `uftk`**，也没有任何以 `uftk` 为根的读取函数。

因此 12 个开关全为零消费方，包含 `uftk.enabled` 自身（即整棵子树的总开关也是死开关）。issue 原文的「12 个中 9 个零消费」是**低估**：实测 12/12 零消费。

对照：同级的 `coding.staleWriteGuard` / `coding.writeJournal` / `coding.parseOnTouch` **是**真实接线的（同一助手读取），所以问题被精确限定在 `uftk` 子树，而非整个 `coding`。

### 「脱钩实现」的性质判定

issue 点名的三个"实现存在但脱钩"文件，实测结论是**它们不读任何 uftk 配置**，且分两类：

| 文件 | 实测 | 判定 |
|---|---|---|
| `openclaw_runtime/src/infra/exec-approvals-allowlist.ts` | 全文无 `config`/`cfg`/`runtime.` 读取（仅一处 PowerShell 参数正则、一处注释含 "runtime" 字样）——**完全不读配置** | 该能力存在，但由调用方传参决定，不读任何配置项；与 `uftk.commandApproval` 无关 |
| `openclaw_runtime/src/agents/checkpoint-rollback-executor.ts` | 无 `config`/`cfg`/`runtime.`/`uftk`/`process.env` 命中；靠 `CheckpointRollbackExecutorOptions`（依赖注入）驱动；头注明确「**NOT a new git transaction**…reuses the write-journal」 | 该能力复用 write-journal 路径实现，**从未打算由 `uftk.gitCheckpoint`/`safetySnapshot`/`execUndo` 驱动** |
| `openclaw_runtime/src/agents/tools/write-journal.ts` | 只读注入的 `options.enabled` 与 `process.env.VERSE_CLAW_GATEWAY_GENERATION`，**不读配置** | 其真正的配置入口是 `coding.writeJournal.enabled`（经 `isCodingWriteJournalEnabled` → 注入 `options.enabled`），**不是** `uftk.execUndo` |

**必须排除的两个同名陷阱**（否则会误判为"有消费方"）：

- `openclaw_runtime/src/infra/sqlite-wal.ts:23,43-54` 的 `autoCheckpointPages` 是 SQLite `wal_autocheckpoint` pragma，与 `coding.uftk.autoCheckpoint` 无关。
- `openclaw_runtime/extensions/codex/src/app-server/approval-bridge.ts:233,669` 的 `commandApprovalDecision()` 是一个吃 `requestParams`/`outcome` 的局部函数，不读配置，与 `coding.uftk.commandApproval` 无关。

### 对 issue #95 的后果

- **方向**：移除（remove from schema / labels / UI），**不是** re-wire。因为这些叶子背后并不存在"等着被接线的实现"——真正干活的代码走的是别的入口或不读配置。
- **优先级最高的一条**：`commandApproval` 是安全相关开关且改动完全无效果，属于最危险的一类"看起来能控、实则无效"的开关，应当优先清除或明确标注为 no-op。
- **注意**：删除需与 `config-schema-parity.test.ts` 的类型/schema 双向守卫同步进行（删一处会编译失败，这是设计使然）。

---

## 第二部分（Q2）：DCS Prod Flags 控制面

### 2.1 catalog 事实（实测）

`shared/dcs/prod-flags-catalog.ts` 头部声明其为「**P0 packaging surface** 的 opt-in 目录…`Does NOT flip any production defaults.`」，共 **21** 条 flag（issue 的 21 计数正确）。分布实测：

- wave：R3=4，C5=3，C1/C2/C4/C7/KE-P1 各 2，C6/VS-P3/DCS-S1/DCS-S3 各 1。
- kind：`config`=13，`api`=4，`env`=2，`info`=1，`request`=1。
- risk：`opt-in`=10，`api-only`=4，`read-only`=3，`shadow-only`=2，`baseline-on`=1，`request-only`=1。

三者均与 issue 正文一致（**已验证**）。catalog 自带 `assertCatalogDefaultHonesty()`（:348-382）强制 15 个 opt-in 默认必须是 `false`。

UI 侧 `src/components/settings/DcsProdFlagsPanel.tsx` 是**由 catalog 数据驱动**的通用面板（`DCS_PROD_FLAGS[0]?.id` 起选、逐条渲染 `FlagRow`／`riskTone`／`statusTone`）。host-api 侧 `shared/host-api/contract.ts:5105-5111` 暴露 **5** 个方法：`getFlags` / `setFlag` / `requeryAck` / `getPreview` / `setPreview`（issue 正文写"6 方法"，实测为 5，属计数笔误）。

> **控制面设计含义**：新增一个 UI 开关 = 新增一条 catalog entry。这是"如何加 flag"的正规路径，已写入 `harness/specs/rules/runtime-feature-leaf-consumers.md` 与本文件第 2.4 节。

### 2.2 config 组覆盖映射（修正 issue 的算术）

`RuntimeFeatureConfig` 顶层组 **27** 个（issue 计数正确）。按 catalog 的 `key` 前缀归属，**只有 4 个组被 flag 覆盖**：

| 有 flag 覆盖 | flag 数 | 无 flag 覆盖（23 组） |
|---|---|---|
| `verseShellFoundation` | 1 | `registryPilot` `providerRegistry` `contextProviders` `contextRuntimeKit` `contextFamily` `eventLog` `checkpointSerializer` `resume` `toolRegistry` `mission` `registryDiagnostics` `toolProtocol` `toolGovernance` `evidenceVerifier` `traceContext` `contextEnhancement` `vtoken` `agentMap` `localControlPlane` `orchestration` `resilience` `rc03` `rc05` |
| `contextBlock` | 4 | |
| `coding` | 6 | |
| `memory` | 3 | |

**两处修正 issue 正文**：

1. issue 写「仅 5 组被任何 flag 覆盖」，但它自己列出的覆盖列只有 4 组；实测确为 **4 组**（4+23=27 自洽）。
2. issue 写 `memory`(5)。按 `runtime.memory.*` 前缀实测为 **3** 条（`persist` / `injectPilot.enabled` / `candidateGeneration`）。issue 的"5"只有在按**能力域**（把 `sekb-retrieval-shadow`、`sekb-experience-shadow` 两条 KE-P1/C7 知识影子 flag 计入 memory 域）计数时才成立。两种口径都有意义，但不能混用。

### 2.3 三个子问题的证据化结论

#### (i) `vtoken.assembly.enabled` 是否本就该由配置文件控制？

**结论：应当继续由「配置文件 + env」控制，不应为了"能看见"而新增 DCS opt-in flag。但 issue 的前提「它默认 true」是错的——真实默认是 `false`（opt-in / canary）。**

反证链（全部来自本树）：

- `openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts:50-58` `DEFAULT_VTOKEN_ASSEMBLY_CONFIG = { enabled: false, … }`。
- 同文件 `:159-160`：`const enabled = assembly?.enabled === true || isVtokenAssemblyEnvForcedOn();` —— **纯 opt-in**，省略即为关。
- 同文件 `:38` 类型注释：`Product default OFF (opt-in). Explicit true enables canary injection.`
- `openclaw_runtime/src/config/types.openclaw.ts:402,412`：`product default OFF — opt-in / canary`、`omitted defaults to disabled`。
- `openclaw_runtime/src/context-engine/vtoken-rpc-client.ts:398-402` 直接把这件事写进了注释：`Unset does NOT mean product default ON — product default is opt-in via runtime.vtoken.assembly.enabled=true`。
- 独立第三方锚点：`docs/dev/default-config-matrix.md` 的 VToken 行写明 **`false`（opt-in）**。

它**有**真实消费方（`context-orchestrator.ts:468-469,777-779`、`chat-turn-vtoken-injection.ts:156-157`、`runtime-flag-ack.ts:291-298`），也**有** env 双通道（`:148` 显式 `0/false/off` 可关；`:160` `VERSE_VTOKEN_ASSEMBLY_ENABLED=1` 可强开）与 `contextEnhancement.killSwitch` 三级 kill（`:151-153`）。

判据：catalog 的目的是「把 opt-in 打包面上可翻的默认集中登记」。vtoken 技术上符合（opt-in、default false、有 enable/rollback），`write-journal` 条目（`risk: 'baseline-on'`, `defaultValue: true`）也证明 catalog 能容纳非常规条目。但它在 labels/help 中**已有完整条目**（`schema.labels.ts:792-801`、`schema.help.ts:2102-2110`），即已通过通用配置编辑器可见可改；再进 catalog 只会制造第二份真值面。**建议：保持配置面不变；若要求可发现性，在 catalog 增加一条 `kind: 'info'` / `risk: 'opt-in'` 的说明条目，且禁止翻默认**（属产品范围决定，见 2.4）。

#### (ii) `contextRuntimeKit` 是否需要 UI 开关？

**结论：不需要，且现状是有意的"无 UI"设计——证据来自该叶子自己的文档注释。**

- 真实注册：`openclaw_runtime/src/context-engine/init.ts:2,25` `registerContextRuntimeKitContextEngine()`；实现 `cvk/registration.ts:8`。
- **两个叶子都有真实消费方**：`enabled` 由 `openclaw_runtime/src/context-engine/registry.ts:894`（`config?.runtime?.contextRuntimeKit?.enabled === false`）读取；`shadow` 由 `cvk/shadow-provider.ts:61-65,276` 读取。属 issue 所谓"B 档已接线、默认走 shadow"。
- **决定性的设计意图证据**：`types.openclaw.ts:242-247` 对该叶子的注释为 —— `Set false to roll backend context engine selection back to legacy **without UI changes**.` 即"回退路径**刻意不**经过 UI"是写下来的设计，而不是覆盖缺口。
- 覆盖缺口实证：`schema.labels.ts` / `schema.help.ts` 中**没有** `runtime.contextRuntimeKit*` 任何条目（同目录下 `runtime.vtoken.*`、`runtime.memory.*`、`runtime.orchestration.*` 都有），且 catalog 无对应 flag。

**判定：非缺口。** 它是一个"默认开 + shadow + 无 ref 回退 legacy"的后端选择开关，回退由配置文件承担；不需要为新面板或新 flag 立项。

#### (iii) `rc05`（2 消费方 vs rc03 的 10）是否为遗留实验？

**结论：是低投入/未产品化的最小切面，但"遗留实验"的定性证据是间接的；可确认的是它相比 rc03 处于极低接线水位，且**缺 labels/help。

| 维度 | `rc03`（`seal`） | `rc05`（`operatorSliceEnabled`/`cronAutoApprove`） |
|---|---|---|
| 生产消费方 | 多（见下） | **2 处**：`openclaw_runtime/src/cron/operator-delivery.ts:7`、`:50` |
| labels / help | **有**（`schema.labels.ts:821-822`、`schema.help.ts:2155-2157`） | **无**（`schema.labels.ts`/`schema.help.ts` 零命中） |
| DCS flag | 无 | 无 |
| 类型注释 | `RC-03 pre-seal semantic producer seal gate. Default off; env OPENCLAW_RC03_SEAL.` | `RC-05 **minimal** Operator governance slice flags. Defaults off.` |

rc03 的生产消费方（部分）：`context-orchestrator.ts:364-377`、`rc03-seal-hook.ts:250-253`、`rc03-producers.ts`、`stage2-transform-graph.ts`、`agents/embedded-agent-runner/run.ts:1238`、`stream-resolution.ts`、`run/attempt.ts`、`role-spawn.ts`、`stage1-request-envelope.ts`、`stage1-golden-run.ts`、`provider-transport-fetch.ts`、`shadow-census.ts`。rc05 读数严格为 `=== true`（省略即关，与 `types.openclaw.ts:500` 的 `Defaults off` 一致），且额外有 env 通道 `RC05_OPERATOR_SLICE`（`operator-delivery.ts:8`）。

**判定**：issue 的"2 vs 10"数量级方向正确且被实测支持（本会话复算 rc03 相关引用约为 rc05 的 20 倍以上，但 issue 的具体计数口径无法复现，见第五节"未能验证"）。**"遗留实验"这一措辞缺乏直接证据**——树内没有把 rc05 标为 legacy/experimental 的注释；可确证的是它是 `minimal` 切面、无 UI 元数据、消费面极小。建议在 #95 同批清理时把 rc05 一并交产品定性，不要由本基线单方面宣布其为遗留。

### 2.4 新增 flag / 例外怎么加（缺的文档，即本节）

1. **要一个用户可翻的开关** → 在 `shared/dcs/prod-flags-catalog.ts` 增加一条 entry，字段必须齐全：`id`/`wave`/`kind`/`key`/`defaultDisplay`/`defaultValue`/`risk`/`enable`/`rollback`/`riskNote`。UI 会自动出现（面板由 catalog 驱动），无需改 `DcsProdFlagsPanel.tsx`。
2. **默认值纪律**：`defaultValue` 必须是 `false`（或 `'shared'`/`'inprocess'` 等同义安全值），否则 `assertCatalogDefaultHonesty()` 会抛错。翻默认属于产品锁变更，需所有者决策。
3. **key 必须指向真实存在的配置叶子或 API/env**；若指向配置叶子，该叶子必须已接线，否则会制造 #96 那类"面板能开、运行期不动"的假开关——这正是 `scripts/check-feature-leaf-consumers.mjs` 要拦的类。
4. **catalog 与运行时表对齐**：头部注释要求与本表对齐的是 `openclaw_runtime` 的 `coding-runtime-flags` / `dcs-context-tools-flags`；新增 flag 必须同时保证两边一致。
5. **不需要 UI 的开关**：留在配置文件，**不要**进 catalog。典型就是 `contextRuntimeKit`（有意无 UI）与需要 env 兜底的能力。
6. **例外/登记缺口**：catalog 允许用 `riskNote` 记录已知登记缺口（例如 `verseshell-patch-preview` 条目自述同族 10 个旗标尚未单独入目录）。这是登记缺口的**唯一**合法落盘处，不要在别处另建真值表。
7. **本地化**：面板文案改动需同步 `ja`/`ru`（见 `harness/specs/rules/dcs-production-flags-localization.md`）。

---

## 第三部分（Q3）：自研能力的 UI 暴露面

### 3.1 实测暴露面矩阵

扫描面：`src/components/settings/*.tsx`（共 10 个面板）、`shared/dcs/prod-flags-catalog.ts`、`openclaw_runtime/src/agents/tools/`、`openclaw_runtime/src/agents/sessions/slash-commands.ts`、配置叶子。

| 能力 | 专属 Settings 面板 | DCS flag | Agent 工具 | 斜杠命令/CLI | 配置面 | 默认 |
|---|---|---|---|---|---|---|
| `vtoken` | **有**：`VtokenBridgePanel.tsx`（+ host-api 12 方法、bridge、Python sidecar） | 无 | 无（作为注入通道，非工具） | 无 | `runtime.vtoken.*`，有 labels+help | **off（opt-in）** |
| `contextRuntimeKit`(CVK) | 无（仅聚合面板） | 无 | 无 | 无 | `runtime.contextRuntimeKit.{enabled,shadow}`，**无 labels/help** | `enabled` true + `shadow` true |
| `memory` | 无（仅聚合面板） | **有**（3 条：persist / injectPilot / candidateGeneration） | 有（`context-agent-tools.ts`） | 无 | `runtime.memory.*`，**有 labels+help**（`schema.labels.ts:767-777`） | `shadow`/`provider` 等按 `default-config-matrix.md` 分项 |
| `orchestration` | 无（仅聚合面板） | 无 | 有（`team-orchestrate-tool.ts`） | 无 | `runtime.orchestration.*`，**有 labels**（`:816-818`） | `routingMemoPilot: 'shadow'`、`handoffArtifacts: 'on'` |
| `mission` | 无（仅聚合面板） | 无 | 有（`mission-loop-tool.ts`） | 无 | `runtime.mission.*`（自身无 labels）；经 `runtime.localControlPlane.missionReport` 有 labels（`:815`） | `rollback`/`goalWake` 等 |

聚合面板(非专属)：`ContextControlPlanePanel.tsx`、`ContextLayersExplainer.tsx`、`DcsProdFlagsPanel.tsx`。

**关键消极证据**：`openclaw_runtime/src/agents/sessions/slash-commands.ts:25-45` 的斜杠命令表全部是**会话管理**类（settings/model/export/import/share/name/session/fork/tree/compact/resume/reload/quit 等），**没有任何** memory / orchestration / mission / CVK / vtoken 命令。所以"能力通过 CLI 斜杠命令暴露"这一说法在本树**不成立**；真实的 agent 面暴露是 **agent tools**（`mission-loop-tool.ts`、`team-orchestrate-tool.ts`、`context-agent-tools.ts`）。

### 3.2 结论：是缺陷还是有意选择？

**判定：对 `memory` / `orchestration` / `mission` 而言，缺少专属 Settings 面板是"有意的暴露选择 + 一处真实但次要的可发现性缺口"，不是必须补面板的缺陷。**

证据与理由：

1. **三者都已有非 UI 的真实操作面**：各能力都有 agent 工具（上表），且配置面在 labels/help 中有登记（`runtime.memory.*`、`runtime.orchestration.*` 均在 `schema.labels.ts`）。即"可调"这件事已经存在，只是入口在 agent/配置而非 Settings 专属面板。
2. **产品锁与默认值明确把可调性压在 fail-closed 一侧**：`docs/dev/default-config-matrix.md` 自述为「**product defaults** 的唯一真值源」，并要求「must stay fail-closed / opt-in until the human-canary and release-approval gates explicitly permit graduation」。给这些能力加"操作员随手可调"的专属面板会与"受控毕业"口径冲突。
3. **`contextRuntimeKit` 的反证最硬**：它的类型注释写着回退「**without UI changes**」，直接证明"没有 UI"在至少一处是写下来的设计。
4. **`vtoken` 是反例对照**：唯一有专属面板的自研能力，恰恰因为它有独立的进程/sidecar 生命周期（启停、状态、预算）需要运维操作，而 memory/orchestration/mission 都是进程内的策略开关，没有可运维实体。
5. **风险不在"缺面板"，而在"假开关"**：真正会误导操作员的是"面板/标签存在但改动无效"——即 #96 Q1 那类。`memory`/`orchestration` 有 labels 且有消费方，不属此列。

**建议（不在本 issue 实施，属产品范围）**：不建议为三者补专属 Settings 面板。若产品确要提升可发现性，更小且更一致的方案是**一个只读的"自研能力接线总览"页**（数据源 = `scripts/check-feature-leaf-consumers.mjs` 的报告 + catalog + labels 覆盖表），而不是三个新的可写面板。是否立项需所有者决策。

---

## 第四部分：自动化守卫（AC b）

`scripts/check-feature-leaf-consumers.mjs` 覆盖「配置叶子无运行期消费方」这一类问题。

- **叶子枚举**：直接从 `openclaw_runtime/src/config/runtime-feature-leaves.ts` 的 `RUNTIME_FEATURE_EXHAUSTIVE` 对象字面量（括号/字符串/注释感知扫描 + 求值）取，**不手工复制**，因此不会漂移；实测 129 个叶子。
- **消费方判定（一个确定性启发式）**：在 `openclaw_runtime/src`（**排除 `src/config/**`**，因为那里是声明面）、`electron`、`shared`、`src` 中，排除 `*.test.ts`/`*.spec.ts`/`tests`/`__tests__`/`fixtures` 后，叶子被判为"有消费方"当且仅当被**具体点名**：①完整点径以引号形式出现；②≥2 段的后缀链作为属性访问出现（允许 `?.`）；③该叶子"最具体段"（末尾非通用门名如 `enabled`/`shadow`）作为属性访问或引号/方括号键出现。
- **诚实的边界**：这是**文本/结构**检查，不是可达性证明。命中可能来自注释、同名但无关的标识符或仅类型引用；仅通过计算键/配置透传到达的叶子可能漏检；某个**新**叶子若其"最具体段"名字在别处已被使用，可能被误判为已消费。它故意 **fail open**（模糊即视为已消费），因此漏检只会削弱基线，永不产生误红。这一点同时写在脚本头部、规则 spec 与本文件。
- **失败语义（fail closed 的唯一条）**：未在基线中的叶子无消费方 → exit 1 并点名该叶子。
- **基线与 #95 解耦**：`FEATURE_LEAF_CONSUMER_BASELINE` 固定登记今日零消费叶子并注明 owner 为 #95。**两个方向都不变红**：已登记叶子获得消费方（re-wire 修复）→ INFO 且保持绿；已登记叶子从 schema 消失（删除修复）→ INFO 且保持绿。
- **`--self-test`**：在 `os.tmpdir()` 自建一次性工作树，写入合成 `runtime-feature-leaves.ts`（一个已接线叶子 + 一个未接线叶子）并跑两遍（空基线必须 fatal；pin 后必须通过），打印 PASS/FAIL 并在自身失败时非零退出；不触碰仓库、自动清理临时目录。用于让"故意失败"的负向对照可被任何人复现。
- **接入方式（遵循仓库既有约定）**：`package.json` 增加 `check:feature-leaf-consumers` 与 `check:feature-leaf-consumers:self-test`（对照 `runtime-lifecycle-audit`）；负向/正向对照由 `tests/unit/feature-leaf-consumers.test.ts` 承担（对照 `check-capability-claims.mjs` 被 `tests/unit/capability-claims.test.ts` 导入的既有模式）。`.github/workflows/check.yml` 已有 `Run tests → pnpm run test` 步骤会执行 `tests/unit/**`，因此**未新增 workflow 步骤**（同级 `check-capability-claims.mjs`、`check-runtime-lifecycle-audit.mjs` 也都不是独立 CI 步骤，遵循同一约定）。

## 第五部分：未能验证 / 明确不下结论的事项

1. **issue 正文的 context-engine「各子目录消费方数量」无法复现**：正文列 `memory 416 / orchestration 62 / mission 46 / resume 77 / rc03 10 / rc05 2` 等。本会话实测：这些名字中 `mission`、`orchestration`、`memory`、`rc03`、`rc05`、`resume` **都不是** `openclaw_runtime/src/context-engine/` 下的子目录（该目录实测只有 `cvk factstore fixtures handlers producers registry tools views`），故"各子目录消费方数量"这一口径本身与本树不符；用简单子串计数得到的是 10343/1114/4835 量级，用"导入该目录的文件数"得到的是 0，两种口径都对不上正文。**因此本文只采用可复现的替代口径**（`rc05` 生产读取点 2 处、`rc03` 生产消费方 10+ 处），并据此支持"rc05 接线水位远低于 rc03"的方向性结论。
2. **路径笔误**：issue 写的 `src/context-engine/cvk/`、`src/context-engine/init.ts:25` 实际位于 `openclaw_runtime/src/context-engine/...`（行号 `init.ts:25` 正确，根路径缺 `openclaw_runtime/`）。CVK 目录实测 11 个文件（与正文"11 文件"一致），合计约 73.9 KB（正文写 71.4 KB，略有差异）。
3. **`rc05` 是否"遗留实验"**：树内无 legacy/experimental 标注，本文只给出"`minimal` 切面、无 labels/help、消费面极小"的可确证事实，**不**替产品宣布其为遗留。
4. **本文件未改动任何配置、运行期实现、shared 契约或其他 issue 的文件**；所有结论均为定性记录，不是产品锁、不是默认值变更、不是发布声明。
5. **harness 校验现状（如实记录）**：`node harness/src/cli.mjs validate --spec harness/specs/rules/runtime-feature-leaf-consumers.md --no-diff` → `Spec is valid`（exit 0）。去掉 `--no-diff` 在本共享工作树上会报 `changed files are not covered by touchedAreas`，但这是**脏工作树产物**而非本 spec 的问题——同一命令对既有的 `harness/specs/rules/active-config-guards.md`、`harness/specs/rules/error-governance-boundary.md` 也报同类错误，且未覆盖清单里剩的都是本批其他 subagent 的文件（`packages/vtoken/*`、`scripts/analyze-reference-graph.*`、`tests/unit/repository-artifact-retention.test.ts`、`harness/specs/tasks/nop-issue-fixes-batch1-20261010.md`）。
