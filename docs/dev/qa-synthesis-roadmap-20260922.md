# ClawX 何去何从：多方 QA 综合与收尾总规划

日期：2026-09-22。分支 `feat/runtime-lifecycle-governance`，HEAD `ba1206324`（与 origin 同步）。

本文是对以下全部本地材料的综合，此后它是"接下来做什么"的唯一入口；其余文档一律降为带日期的输入或历史：

| # | 材料 | 时间 | 立场 |
| --- | --- | --- | --- |
| A | `docs/dev/engineering-product-node-plan-20260921.md` | 09-21 00:47 | 用户定调：**完整产品闭环收敛期**，RC 链复验、TF-0041 冻结发行、TF-0042 场景、12 条旅程×3 |
| B | `docs/dev/HANDOFF-tf0029-product-convergence-20260921.md` | 09-21 12:00 | 接力交接：RC 链顺序、§6 首条产品旅程优先；**含明文 API key（见 §2）** |
| C | `docs/dev/handoffs/LATEST.md` 首段 | 09-21 22:28 | TF-0029 done、"TF-0030 自动转 ready"、J-02 跑通、5 条未修观察 |
| D | 用户粘贴的 QA（原始，另一模型） | 09-22 10:03 | **改口为实习展示**：一条 Windows 旅程收尾，不做 RC-03～10，不为涂绿返工 |
| E | `docs/dev/qa-project-assessment-20260922.md` | 09-22 10:41 | 与 D 同向；5 条尾项逐条对代码；"停的条件" |
| F | `docs/dev/qa-review-report-20260922.md` | 09-22 11:36 | 采纳 D 约 85%；三处修正；两个机制示例；"陌生人 30 分钟复现"门槛；提交 shadow-census |
| G | `docs/dev/qa-closing-verdict-20260922.md` | 09-22 12:23 | 采纳 D；两处关键修正：收据可零改动通电、审批挂起是 ClawX 缺桥非 TF-0032 |
| H | 记忆：D6 决策（TF-0224）、TF-0029 blocker map、审批/效果平面状态、隔离配置陷阱 | 09-01～09-21 | 背景事实 |
| I | `docs/dev/first-product-controlled-preview/STATUS.md` | 07-30 | 首产品硬锁：`liveReady/productApproved/defaultOn=false`，Windows x64，不得翻默认值证明可用 |

标注约定：**[已查证]** = 本会话或 G 直读磁盘；**[推断]** = 有代码依据未执行；**[裁定]** = 本文做出的取舍。

---

## 0. 一句话结论

**项目定位从 A（完整产品闭环）切换为 D（实习展示收尾），这是用户在 09-22 明确改口的，本文据此裁定。** A 不作废，降为"下一周期若有"的冻结路线。收尾的目标是：**一条可重复的 Windows 编码旅程 + 护城河通电一次 + 审批边界发生一次 + 一页诚实的限制**，时间盒 **3 个工作日**，不新增功能、不返工架构、不为 Task Forest 涂绿。

---

## 1. 各方共识、分歧与裁定

### 1.1 全体共识（不再争论）

1. 不做 RC-03～RC-10 串行链（TF-0031…TF-0042）、M6（TF-0129/0130/0141/0144/0151）、Docker（TF-0047）、143 个渠道扩展、第二产品面页面、CodeGraph 产品面（README 首行 RETIRED）。[已查证]
2. 不拆三个 200 KB 文件（`chat.ts` / `ChatInput.tsx` / `attempt.ts`），不物理删除未承诺页面，不导出新的百兆 HTML，不跑全量 Electron 套件当门禁。
3. 不改 `tf0009` 真人守卫，不改 STATUS.md 配合叙事，三锁保持 false，agent-driven 不写成真人，engineering-simulated 标签保持。
4. "193/224 done" 不代表完成度；真正未完成的是 TF-0028 下的 RC 链，而它已被裁定为范围外。
5. J-02 是演示脚本；它逼出的两个缺陷（`6760b372e`）和 5 条未修观察原样进材料。
6. 多份"当前状态"文档互相矛盾是最大的叙事熵。

### 1.2 分歧与裁定

| 议题 | D/E | F | G | **裁定** |
| --- | --- | --- | --- | --- |
| 收据为 0 怎么办 | 写成限制；或做 TF-0030 增量 | 两个机制示例 + 名实声明 | 重跑 J-02 带 `OPENCLAW_RC02_SHADOW_CENSUS=1 OPENCLAW_RC03_SEAL=1`，零代码通电 | **采 G 为主、F 为辅**：先带 flag 重跑；成功则收据表非 0 进材料，失败则诊断原样进材料并回落到 F 的机制示例。链路三段已查证（`driver.mjs:65`、`config-sync.ts:1054/1080`、`rc03-seal-hook.ts:110` / `shadow-census.ts:255`），两条路径均为纯观测。 |
| 非 fullAccess 挂起 | → TF-0032，写成限制 | 同左，"不是小修" | ClawX 从未调 `exec.approval.resolve`（电子端零引用）；经 host `gateway.rpc` 演示边界 | **采 G**：演示"挂起 → 人经 RPC 决定 → 继续"；材料写"无应用内审批 UI"。不建 TF-0032。最小 resolve 桥列为可选项（§4 Phase 3）。 |
| 未提交 shadow-census | 讲收据才提交 | 提交，独立 commit | 提交；两个生产调用点已传 `adapterId: model.api`，不会回归 J-02 | **提交，独立 commit，措辞"TF-0030 局部增量，普查未完成"。** |
| 停的判据 | 旅程通 + 失败可解释 + 收据默认关写明 | + 陌生人 30 分钟复现 | + 通电一次 + 边界一次；陌生人复现降为加分项 | **采 G**。30 分钟复现不现实（代理 7897、key、dist 三件套、Gateway 重启时序，作者的 agent 都跑了多轮）。改为"作者能用仓库内 driver 在最终 HEAD 重跑；读者能离线核对产物"。 |
| 定调文档 §6 的 tf0009 守卫迁移 | 未提 | 未提 | 明确移出收尾 | **移出**。这是状态语义变更，展示不需要。 |
| 是否新建 Task Forest 节点 | 不新建 | 不新建 | 不新建 | **只新建决策节点**（仿 TF-0224 的 D6 形式，done/0）：D7 记录"实习展示收尾边界"，防止下一个接力 agent 重开 RC 链；D8 记录角色与自动收口策略（2026-09-22 追加）。不建任何工作节点。 |
| 演示主路径"七成" | 给出 | 拒绝复述 | 用事实表 | **不用百分比**，用 §3 事实表。 |

### 1.3 本轮新增发现（各 QA 均未覆盖）

**明文 API key 已入库并推送。[已查证]** `docs/dev/HANDOFF-tf0029-product-convergence-20260921.md:86` 含完整 senseaudio key，提交 `dab4aaff7`，已在 `origin/feat/runtime-lifecycle-governance`（GitHub 私有仓）。J-02 README 的"本目录密钥扫描 0 命中"只覆盖它自己的目录。**用户裁定（09-22）：该 key 专用于真实数据沉淀、仓库私有，不轮换。** 处置降为文档卫生：把该行改为环境变量引用、扫描 `docs/ artifacts/`；git 历史保留不重写；若将来仓库或演示包公开，轮换成为强制项。见 §4 Phase 0 第 1 条。

---

## 2. 定位裁定（唯一口径）

**这是一个人与 AI Agent 协作完成的「Agent 基座 + Harness + LLM 工程化」实习展示项目。** 展示的是一条跑通的路径和一套约束自己不撒谎的纪律，不是商业产品，不是 GA，不承诺长期运营。

三句限制随材料一起走：① 收据默认关（演示时显式开启）；② 非 fullAccess 无应用内审批 UI，会挂起；③ 操作者是 agent-driven、Windows x64、一个 provider、一个工作区。

与 A 的关系：A 的"可安装、失败可解释、重启可恢复、变更可回退、证据可追溯"是下一周期的入口，本次收尾不承诺；A 文档保留，标注"快照 `752b936a`、已被 09-22 改口覆盖"。

与 I 的关系：I 的硬锁全部继续有效；本次收尾不翻任何默认值，演示开启的 flag 只在驱动进程环境中存在，与 I 第 3 条"禁止用翻默认值证明可用"不冲突——演示写明"flag 默认关、演示显式开"。

---

## 3. 现状事实表（收尾视角）[已查证]

| 路径 | 状态 | 依据 |
| --- | --- | --- |
| Windows 桌面 → senseaudio → fullAccess 工作区 exec→read→edit→exec | 跑通一次（09-21，58 s，3/3，agent-driven） | `artifacts/live-model-cdp/20260921-senseaudio-journey-J02/` |
| custom key / `tools.exec` → 隔离运行时 | 2 缺陷已修 | `6760b372e`；`config-sync.ts:810` sync keys 含 `tools` |
| ContextReceipt/v1 + WireReceipt/v1 | 生产链上、默认关、演示为 0 | `extensions.ts:337` → `context-orchestrator.ts:341` → `rc03-seal-hook.ts:284`；`stream-resolution.ts:307` → `provider-transport-fetch.ts:864` |
| 审批边界 | 运行时六个 RPC 齐全；ClawX 零引用 | `openclaw_runtime/src/gateway/**`；`electron/ src/ shared/` grep 无 `exec.approval` |
| 注入账本 | 有源码有测试 | `context-engine/turn-injection-budget.ts` + `.test.ts` |
| 工程验收器 | TF-0029 25/25 双执行者 pass，`allowedPromotion=false` | LATEST.md L3（未复跑）[推断] |
| Task Forest | 224 节点：done 193 / blocked 12 / proposed 12 / deprecated 7；`ready=[]`；TF-0030 todo `ready:true` 但 status proposed | `forest.json` generated 09-21T10:09Z |
| 真人证据 | D6 改为 engineering-simulated；TF-0009/0007 因守卫测试保持 blocked | `tf0009-engineering-evidence-audit.test.ts:80,115-119` |
| 有名词未接通 | 压缩证据查看器、CheckpointsDialog、5 条 FP-OVERCLAIM | 两个 e2e skip 注释；能力表（07-05，44 条） |
| 工作树 | shadow-census +25/−1 未提交；四份 QA 文档未提交 | `git status` |

---

## 4. 路线图：3 个工作日的收尾窗口

时间盒是建议，不是承诺；每个 Phase 有明确出口，出口不达就停在该 Phase 写清楚，不顺延到下一个。

### Phase 0 · 今天 · 卫生与口径（不写功能）

| # | 动作 | 出口判据 | 负责 |
| --- | --- | --- | --- |
| 0.1 | **文档密钥卫生**：把 `HANDOFF-tf0029-…:86` 的 key 替换为 `<见环境变量 SENSEAUDIO_API_KEY>`；对 `docs/ artifacts/` 跑一次含文档的密钥扫描。不轮换（用户裁定：专用沉淀 key、仓库私有）；历史不重写；公开即轮换 | 该行不含 key；扫描 0 命中；残余风险写明 | agent |
| 0.2 | 提交 shadow-census（独立 commit：`fix(rc02): wire owner must be a named adapter; census incomplete`） | 工作树无源码改动 | agent |
| 0.3 | 提交 E/F/G + 本文（一个 docs commit），头部各加一行"输入/历史/入口"标注 | `git status` 干净（J-02 驱动会记录 `dirty`） | agent |
| 0.4 | LATEST.md 首段改口："TF-0030 = proposed，依赖已满足、todo ready，未开工未验收"；给 AGENT-START.md / A 文档头部各加日期与适用范围一行，**不改正文**。STATUS.md **不能加任何注记**：`tests/unit/runtime-authority-convergence-control-pack.test.ts` 断言它是纯 frontmatter、不含 `# `、正文为空（实测加一行即红）——其时点标注改写在 AGENT-START.md 与本文 §1 表 | 四份文档不再互相当放行依据；control-pack 测试 8/8 绿 | agent |
| 0.5 | Task Forest：经官方 CLI 应用提案 `TFP-showcase-closing-program-20260922`——D7 决策节点 + 收尾里程碑（4 阶段 / 11 子任务，各带开发要求与验收判据）+ RC 链三个入口节点的冻结注记；不动任何既有节点状态 | proposal-apply 成功；validate 通过；export 成功 | agent（证据核对通过即自动应用，见 §6 收口策略） |

**不做**：tf0009 守卫迁移、STATUS.md 正文、任何源码。

### 24 个开放节点的去留（本提案的裁定，0 废止、0 改状态）

| 分类 | 节点 | 处置 |
| --- | --- | --- |
| 冻结链 15 | TF-0010、TF-0028、TF-0030～TF-0041（12）、TF-0042 | 保持原状态与依赖链；TF-0010 / TF-0028 / TF-0030 摘要加 `[冻结 2026-09-22 · D7]` 注记；下一周期从 TF-0030 重启 |
| 显式后置 6 | TF-0144、TF-0129、TF-0130、TF-0141、TF-0151（M6）、TF-0047（Docker） | 维持 blocked，理由已在各自节点（"本轮不投入""有意延后"） |
| 守卫阻塞 2 | TF-0007、TF-0009 | 维持 blocked；`tf0009-engineering-evidence-audit.test.ts` R7 守卫是权威，不迁移 |
| residual 归并 1 | TF-0013 | 维持 blocked；未闭合项随冻结链后置，归 TF-0030/TF-0031 验收 |

### 新节点结构（提案内容）

```text
D7 决策（decision, done/0）  ←derived_from—  实习展示收尾（milestone, in_progress）
                                                ├─ 阶段 0 卫生与口径（ready）
                                                │    ├─ 提交 shadow-census 独立 commit（→contributes_to TF-0030）
                                                │    ├─ 提交四份 QA/规划文档 + LATEST 改口 + 旧状态文档标注
                                                │    └─ 交接文档 key → 环境变量引用 + docs/artifacts 扫描
                                                ├─ 阶段 1 通电与边界（depends_on 阶段 0）
                                                │    ├─ J-03 带收据开关重跑，收据非 0 + correlation join（related_to TF-0031）
                                                │    ├─ J-04 非 fullAccess 审批边界一次，经 gateway.rpc 决定（related_to TF-0032）
                                                │    └─ 五条尾项在最终 HEAD 逐条裁定（depends_on J-03）
                                                ├─ 阶段 2 材料与封存（depends_on 阶段 1）
                                                │    ├─ 对外说明一页 + 贡献归属一页
                                                │    ├─ 演示包（产物、收据 dump、审批对、哈希清单、VERIFY.md、预案）
                                                │    └─ 封存：LATEST 收尾接力、forest 收口、showcase tag
                                                └─ 阶段 3 可选增量（depends_on 阶段 2；做不了不影响收尾）
                                                     ├─ 最小审批桥（depends_on J-04；contributes_to TF-0032）
                                                     └─ 头部绑定单文件修复（depends_on 尾项裁定）
```

每个节点都带 `requirements`（做法）、`acceptance_criteria`（可核对的产物/命令/状态）、`non_goals`（边界）、`execution_hints`（环境与铁律）。阶段任务的 `acceptance_criteria` 即该阶段的出口判据；子任务 done 需登记证据后经 proposal 流程收口。

### Phase 1 · 第 1 天 · 通电与边界（两次执行，零功能代码）

| # | 动作 | 出口判据 | 风险与回落 |
| --- | --- | --- | --- |
| 1.1 | 重建 dist 三件套（`ext:bridge` / `build:vite` / `build:runtime`，代理 7897），在最终 HEAD 用仓库内 `driver.mjs` 重跑 J-02，**驱动环境加 `OPENCLAW_RC02_SHADOW_CENSUS=1 OPENCLAW_RC03_SEAL=1`** | `journey.json.receipts` 中 `runtime_receipts > 0`，且能按 `correlation_digest` join 出 ContextReceipt/v1–WireReceipt/v1 对；dump 进 artifacts | [推断] `assertSealProducersRegistered` 可能报未注册 producer、写入失败进 `getShadowCensusDiagnostics()`——**原样记录，不补注册、不改代码**。若收据仍 0，则回落 F 方案：材料用 `turn-injection-budget` 固定输入示例 + 验收器负例。 |
| 1.2 | 同一 HEAD、非 fullAccess 工作区下达同一任务；观察 `exec.approval.requested`；经 host `gateway.rpc` 调 `exec.approval.list` → `exec.approval.resolve`；记录 request/decision 对与随后的执行 | 一对 request/decision 落盘；执行在决定后继续 | [推断] `decideGatewayRpc`（`gateway-api.ts:413`）可能在非 fullAccess 下拦 `exec.approval.*`；若拦，切 fullAccess 再调，仍证明"运行时接受了一次决定"；若仍不通，写成限制，不建桥。 |
| 1.3 | 5 条尾项在当前 HEAD 逐条复核，按 G §5 P1 裁定：`sessions.history` 不修；8 秒 reload 不修；工作区副作用现码只种 harness 模板、`git init` 已无；**只有"头部不刷新"在 1.1 截图里可见时才修，且只修 `workspace.permissionMode` 绑定一处** | 每条有"仍在/已消失/不修理由"三选一 | 若修头部要碰 `ChatInput.tsx` 大范围 → 不修，写限制 |

**不做**：TF-0030 普查、TF-0032、审批 UI、任何默认值。

### Phase 2 · 第 2 天 · 材料与封存

| # | 动作 | 出口判据 |
| --- | --- | --- |
| 2.1 | **一页对外说明**（以 A 的场景为底、D 的出口）：定位一句、主线一句、三层护城河各一句并指向代码、四栏边界（跑过 / 只证明机制 / 未完成 / 范围外）、三句限制、演示日预案 | 每句能指到文件 |
| 2.2 | 演示包：J-02 产物（journey.json、session.jsonl、前后哈希、截图）+ 1.1 的收据 dump 与 join 查询 + 1.2 的审批对 + 两个已修缺陷的提交 + 5 条尾项裁定 | 读者可离线核对全部哈希 |
| 2.3 | 「贡献归属」一页：**由 agent 从仓库记录重建**，不向用户提问——设计决策与取舍（TF-0131 因不改默认值被砍、TF-0076 成本 NO-GO、AGENT-START NO-GO 横幅、TF-0007 撤回 done）逐条指向提交或 diff；分工口径固定为「agent 是主线开发者、用户是发布者」；如何审查 AI 改动（验收器双执行者、判决只从磁盘读、禁凭证变量） | 每句可指向文件或提交号，不出现需要用户口述的内容 |
| 2.4 | 更新 LATEST.md 首段为"收尾完成"接力，引用本文与演示包；README 三语只核对不改产品范围 | 下一个接力 agent 只读本文即可 |
| 2.5 | 打 tag `showcase-20260924`（或实际日期）并 push；不打 release，不签名 | tag 指向最终 HEAD |

### Phase 3 · 第 3 天 · 可选（只在 Phase 0–2 全部出口达成后）

按价值排序，做多少算多少，做不了不影响收尾：

1. **最小审批桥**：ClawX 订阅 `exec.approval.requested` → 一个独立模态（不进 `ChatInput.tsx`）→ 调 `exec.approval.resolve`。这是护城河第一支柱的产品入口，RC 链里唯一值得做的一件。约束：新文件为主、不碰三个大文件、有一条 e2e。
2. 头部不刷新的一处绑定修复（若 Phase 1 未修且演示可见）。
3. `sessions.history` 读取隔离状态目录（`electron/utils/paths.ts:71` → `openclaw-source-state`），仅当演示要回放历史。

**永不进入本窗口**：RC-03～RC-10、M6、Docker、渠道、默认开启、tf0009 迁移、大文件拆分、能力表刷新当进度。

---

## 5. 收尾之后（冻结的下一周期，不在本次承诺内）

若项目继续，入口是 A 文档 + D7 节点，顺序不变：TF-0030 普查 → TF-0031 seal 复验 → **TF-0032 审批持久化（Phase 3.1 的桥是它的前置产品入口）** → … → TF-0041 冻结发行 → TF-0042 场景。届时再决定 tf0009 守卫迁移与 M6。本次收尾不为这条链做任何"顺手"工作。

---

## 6. 文档治理（从现在起）

- **真源**：Task Forest（状态）、本文（方向）、LATEST.md 首段（接力）。三者冲突以 Task Forest 状态为准，方向以本文为准。
- **输入/历史**：A、B、C 旧段、D、E、F、G、AGENT-START.md。头部标日期与适用范围，不改正文。runtime-convergence/STATUS.md 受守卫测试保护（纯 frontmatter、不得含注记），其时点由 AGENT-START.md 头部与本文 §1 表说明。
- **规则**：不再新增"当前状态"类文档；新信息写进 LATEST.md 首段或本文的"更新记录"。
- **密钥**：任何文档不写 key；J-02 式"密钥扫描"以后覆盖 `docs/`。

### 收口策略（2026-09-22 用户裁定，D8）

角色固定：**agent 是主线开发者，用户是发布者。** 用户审查已完成且有证据的结果，不参与逐节点问答；任何验收口径都不得要求用户口述内容（贡献归属一页由 agent 从提交、diff、任务图历史与偏差账本重建）。

**自动收口门**：某节点的每条验收判据都被直读磁盘核对通过、证据链完整、提案 `base_graph_hash` 未漂移、结论自洽时，agent 直接 `proposal-save` + `proposal-apply --yes`，随后 `validate`、`export`，并把状态与证据在同一个 change set 入库——不再等待用户确认 apply。该覆盖对本仓库显式生效，覆盖 task-forest skill 的默认"apply 前等用户确认"，并登记在 D8 节点与偏差账本。

只有以下情形才停下询问用户：对外发布或公开仓库/产物、凭证轮换或新暴露、不可逆 git 操作、改动冻结的产品锁或默认值、声明真人证据、改动范围。自动收口是对证据的门，不是对自信的门：证据缺失、过期或互相矛盾的节点保持未完成，并把缺口写清楚。完整规则见 `harness/specs/rules/task-forest-autoclose-and-roles.md`。

---

## 7. 需要用户拍板的事项（其余按授权由 agent 直接做）

1. ~~key 轮换~~ → 已裁定不轮换（专用沉淀 key、仓库私有）；降为文档卫生。
2. ~~确认改口 A → D 需用户一句确认~~ → **2026-09-22 已裁定**：改口本身、提案应用与节点收口都不再需要用户确认（见 §6 收口策略）；D7/D8 决策节点即为登记。
3. ~~展示时仓库/产物是否公开~~ → 已裁定当前不公开；若将来公开，key 轮换成为强制项（已写入节点 non_goals/残余风险）。**公开动作仍属于需要用户授权的清单。**
4. ~~Phase 3 最小审批桥做不做~~ → 不影响收尾，节点保持 proposed，可随时 deprecated；**无需用户确认**。

当前没有等待用户答复的阻塞项。后续只有在 §6 列出的六类外部授权情形出现时，才会停下来询问。

---

## 8. 风险与预案

| 风险 | 预案 |
| --- | --- |
| 演示日 senseaudio 不可用 | 用 Phase 2.2 的留档讲解，不现场重试长跑 |
| 带 flag 重跑时 seal 报未注册 producer / 写失败 | 原样进材料，这本身是"收据链在真实调用上的行为"证据；不补注册 |
| `decideGatewayRpc` 拦 `exec.approval.*` | 切 fullAccess 再调；再不通写限制 |
| bash 输出被篡改（09-20/21 已发生） | 所有判决与计数只用 Read 直读磁盘文件；J-02 `receipts` 以 `journey.json` 为准 |
| 接力 agent 重开 RC 链 | D7 节点 + 本文 §5；LATEST.md 首段只指向本文 |
| 自动收口被当成"降低标准" | 规则 spec R6 + §6：门设在证据上，缺证据/过期/矛盾的节点保持未完成并写明缺口；提案基线漂移时默认拒绝应用 |
| 接力 agent 又把内容问题抛回给用户 | AGENTS.md 收口策略段 + 规则 R1/R2：验收口径不得要求用户口述；贡献归属等事实从提交、diff、任务图历史与偏差账本重建 |
| 工作树被其他会话弄脏导致 driver 记 `dirty` | Phase 0.3 先清空；重跑前 `git status --porcelain -- src electron shared openclaw_runtime/src` 必须为空 |

---

## 9. 验证方式与盲区

**本轮直读磁盘核过**：三份 qa 文档全文、A/B/C/I 文档、forest.json 计数与 TF-0028 子树、`git diff` / `git status` / `git log @{u}..HEAD`、key 所在行与提交、GitHub 仓可见性（`gh repo view` → PRIVATE）、G 中列出的全部代码坐标。

**未做**：未重跑 J-02；未执行带 flag 重跑；未调 `exec.approval.*`；未跑 typecheck / 测试 / Electron；未复跑 TF-0029；未复计过程资产体积（沿用 F）。

**盲区**：① 带 flag 重跑的实际收据行数；② `decideGatewayRpc` 对 `exec.approval.*` 的放行；③ "头部不刷新"是否仍在；④ 除 B 之外是否还有其他文档含凭证（Phase 0.1 的扫描回答）；⑤ `.codex/attachments` 里另两份 09-21 文本属于 `D:/helmor-main`（VerseSpace）项目，与 ClawX 无关，未纳入。

---

## 更新记录

- 2026-09-22：初版。综合 A–I 九项输入；新增 key 泄露发现；裁定 §1.2 八项分歧；给出 3 日时间盒。
- 2026-09-22（同日）：用户裁定 key 不轮换、仓库不公开；24 个开放节点去留裁定与 17 个新节点（D7 + 里程碑 + 4 阶段 + 11 子任务）已保存为提案 `TFP-showcase-closing-program-20260922`，待确认后应用。
- 2026-09-22（TF-0234 接力复核）：阶段 0 已完成，当前 HEAD `b6c736191`。J-03 已留档 3/3 测试与 7 对 v1 收据；J-04 只有 host 拦截、直连 Gateway 决定和随后执行的证据，缺最终 `journey.json`，阶段 1 尚未整体验收。本轮在 J-03 README 完成五行裁定，并将限制同步至 [对外说明草稿](showcase-overview-20260922.md)；没有产品源码改动或新的 provider 调用。**纠正 §4 Phase 1 的两项预判**：④ Runtime `workspace.ts:797` / `1000` 仍执行 bootstrap `git init`，J-03 的 after 清单确有 `.git/**`，不能写「已消失」；⑤ J-03 两张截图仍显示旧工作区/权限，但现有 ChatInput 已绑定 `workspace.permissionMode`，驱动直接 hostInvoke 未经过 renderer store 更新，单改标签不解决状态差异，按范围保留限制。①③不修，②仍在；五项完整证据见 J-03 README。专项 43/43、原哈希 J-03 13/13 与 J-04 7/7 通过。Task Forest 收口另存提案等待确认；阶段 2 草稿不代表材料/封存节点完成。

- 2026-09-22（证据审批与 apply）：用户授权「证据充足就认定节点 apply」后，逐项复核 TF-0232/TF-0234 全部验收条件，提案基线与当前任务图一致，正式应用 `TFP-tf0234-tail-verdict-20260922`。两节点 done/100；TF-0233/TF-0231 为 in_progress，其余状态未改。额外只读原 SQLite 得到 28 行与 7 对 v1，全部 correlation digest 与留档一致；离线回放原始 workload 的 before 1 pass/2 fail exit 1、after 3/3 exit 0。validate 通过；check-landing exit 1，2 条提示均是本次 done 状态及证据尚未提交。阶段 1 未完成，不启用阶段 2 封存或 Phase 3。

- 2026-09-22（J-04 接力，TF-0233）：J-04 的证据缺口已在干净候选上重跑补齐。`artifacts/live-model-cdp/20260922-senseaudio-journey-J04/` 现有 `journey.json`（候选 `a8c9f4b69`、`candidate.dirty=false`、`stopReason=approval-boundary-observed`）：运行时 `exec.approval.requested`（`node --test`，`allow-once`/`deny`）→ host `gateway.rpc` 在 readOnly 下被拦 → 直连 Gateway 的 pending 列表与 `exec.approval.resolve(allow-once)` ok → 决定后 12:22:43.838Z 的 exec toolResult 继续；`gateway-events.jsonl` 32 帧含 requested/resolved 两个事件。第一次未写 `journey.json` 的尝试原样保存在 `run-1-partial/`；哈希清单 24 文件、凭证扫描 0 命中；独立复核脚本 15/15 通过。**更正**：J-03 README 里「J-04 缺 journey.json」是 TF-0234 当时的时点记录，现状以本节与 J-04 README 为准。产品源码改动 0，收据 flag 只在驱动进程（12 行 / 3 对 v1）。阶段 1 出口条件已具备，待 Task Forest 收口提案确认；阶段 2/3 仍未开始。

- 2026-09-22（角色与收口策略改口，D8）：用户裁定接力角色固定为 **agent 是主线开发者、用户是发布者**，并取消收口前的人工确认门——证据链完整、验收逐条核对通过、提案基线未漂移、结论自洽时，agent 自行 `proposal-save` + `proposal-apply --yes`，随后 validate/export 并把状态与证据同批入库。据此：(a) 新增规则 `harness/specs/rules/task-forest-autoclose-and-roles.md`（R1–R6）与任务规格 `harness/specs/tasks/task-forest-autoclose-policy.md`；(b) AGENTS.md 增加"Task Forest closure policy (project override)"段，显式覆盖 task-forest skill 的默认确认步骤；(c) 本节 §6 新增收口策略、§7 清空待拍板项（保留对外发布、凭证轮换、不可逆操作、产品锁/默认值、真人证据、范围变更六类外部授权）；(d) Phase 2.3 的贡献归属一页改为由 agent 从提交与 diff 重建，不再向用户提问；(e) Task Forest 新增 D8 决策节点，TF-0236 验收口径去掉用户依赖，TF-0238 改为自动应用。据此自动收口 TF-0233 与 TF-0231（阶段 1 出口达成），阶段 2/3 未开始。产品源码改动 0，产品锁与默认值未动。
