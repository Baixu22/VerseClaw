# ClawX 实习展示项目 · QA 评审与收尾决策报告

> 【2026-09-22 标注】本文是收尾讨论的输入之一，已被 `docs/dev/qa-synthesis-roadmap-20260922.md`（唯一入口）综合；结论以该文与 Task Forest（D7 = TF-0225、里程碑 TF-0226）为准。

日期：2026-09-22。对象：用户提供的完整 QA（收缩叙事、以一条 Windows 编码旅程收尾、不再为 Task Forest 涂绿）。
性质：基于当前仓库实测的独立判断，供收尾决策使用。不是新的任务真源，不签发产品验收。
展示收尾不改变 `liveReady`、`productApproved`、`defaultOn`，不把仿真改写成真人。

> **验证复核与独立背书（2026-09-22，Opus 5，本会话）：此文件为对该 QA 的唯一权威评审。**
> 本轮在 HEAD `ba1206324` 独立重核了 §1 台账里承重的声明，全部与本文吻合：森林 224 节点（done 193 / blocked 12 / proposed 12 / deprecated 7）、边 373；`todos.json` 24 条中唯一 `ready:true` 即 TF-0030 且 `status:proposed`、`progress 0`；`shadow-census.ts` 仅一处行为变化（`buildWireOwnerCensus(body, input.adapterId ?? input.providerId)` → `input.adapterId`）及测试覆盖，当前未提交 diff 为 +25/−1；七个 200KB 级大文件字节数逐一命中（chat.ts 205,480、ChatInput.tsx 202,784、Chat/index.tsx 182,961、RolesOrchestrationPanel.tsx 196,039、Knowledge/index.tsx 187,153、knowledge-api.ts 195,187、attempt.ts 252,309）；J-02 README `runtime_receipts=0 / effect_receipts=0 / context_blocks=0`、58 秒、3/3、agent-driven；能力表生成于 2026-07-05、44 条（PARTIAL 21 / FP-OVERCLAIM 5 / TP-RUN 3）；`compaction-artifact-viewer.spec.ts` 第 13 行起 `test.skip`「entry point is unwired」；CodeGraph README 首行 `RETIRED`、`openclaw.plugin.json` `enabledByDefault:false`。
> 我的独立结论与 §0 一致：QA 收缩方向应采纳（约 85%），三处修正/降级保留。同向的前一轮独立产物 `qa-project-assessment-20260922.md` 保留但不背书；不再新增第三份评审，以免叠加 §3 P0-A 的「多份当前状态文档」熵。

当前快照（已查证）：分支 `feat/runtime-lifecycle-governance`，HEAD `ba1206324`。
未提交改动仅 `openclaw_runtime/src/agents/shadow-census.ts` 与 `shadow-census.test.ts`（+25/−1），另有一份前一轮产物 `docs/dev/qa-project-assessment-20260922.md`（本报告独立成文，对该文件内容不背书，两文结论可交叉比对）。

---

## 0. 结论（我的看法，先给判断）

**QA 的收缩方向应当采纳，采纳度约 85%；收尾边界要在其基础上加一条可验收标准；有三处需要修正或降级。**

应当停在：Windows x64、一个 provider、一个工程工作区、一条可重复的编码旅程，外加两个已有机制的示例。不要为把 224 个节点涂绿去做 RC-03→RC-10、M6、渠道扩展、Docker 或默认开启。理由不是「来不及」，而是这些在仓库自己的任务语义里已经被判定为本周期不投入或范围外（TF-0144 摘要、README Controlled Preview 段），收尾时推翻它们反而是熵。

三处修正：

1. **「卡住的是叙事和验收链，不是缺下一块架构」——方向对，但说窄了。**（推断，依据见 §2.1）J-02 暴露并修掉的两个缺陷都是跨层运行链路问题（API key 送不到源码运行时、exec policy 送不到源码运行时），不是文案问题。真正的收尾风险是：**差异化能力（上下文归因/收据）在演示里不可见**——J-02 当次 `runtime_receipts=0、context_blocks=0`。只放一段修复 `calc.js` 的录像，评委必然会问「503 篇 harness 规格、context-engine、验收器和这次演示有什么关系」。所以最小收尾不能只是文档收口，还应包含两个**已有代码**的机制示例（见 §5）。
2. **「P0：叙事和状态机已经分裂」——定级应拆开。**（已查证）`todos.json` 里 TF-0030 是 `ready: true` 且 `status: proposed`，forest 图 224 节点中持久状态 ready 为 0。这是工具里并存的两种语义（「依赖已满足的待办」vs「持久状态」），不是状态机损坏。修复成本是一页改口径，按 P0 做**口径收口**；但若理解为要修任务系统/重开节点，就会把收尾做成另一轮治理工程，应当拒绝。真正误导评委的是多份「当前状态」文档互相矛盾（见 §3.3）。
3. **「演示主路径大约七成」不再复述。**（推断成分过高）完成度百分比无法从仓库证据推出来。本报告改用事实表：哪段跑过、哪段只证明机制、哪段没跑过（§3.4）。

QA 的事实陈述经逐条核验基本准确（§1 台账），计数有几处小出入（行数/目录数口径），不影响任何结论。QA 的取舍清单（§5 裁剪项）与收尾三档（P0/P1/P2）**全部保留**，本报告只做增补不做翻案。

---

## 1. 核验台账：QA 声明逐条对照

| QA 声明 | 实测结果 | 判定 |
|---|---|---|
| HEAD `ba1206324`，两处未提交改动（shadow-census，4 行有效逻辑 / 25 行） | `git status` + `git diff`：shadow-census.ts 改 1 处行为（`input.adapterId ?? input.providerId` → `input.adapterId`）+ 注释，测试覆盖 +22 行，合计 +25/−1 | 已查证，吻合 |
| 森林：done 193 / blocked 12 / proposed 12 / deprecated 7，in_progress 0，持久 ready 0，边 373 | forest.json：224 节点、373 边，状态计数完全一致 | 已查证，吻合 |
| TF-0030 `updated_at` 仍是 2026-08-03、todos 里唯一 `ready: true` 但 `status: proposed` | todos/todos.json 共 24 条，唯一 ready 即 TF-0030（proposed、progress 0、difficulty very_high）；节点 updated 2026-08-03 | 已查证，吻合 |
| TF-0028 下 14 子节点只有 TF-0029 done，TF-0030→…→TF-0042 串行 | children 恰 14 个：TF-0029 done，TF-0030…TF-0041 proposed，TF-0042 blocked；depends_on 链逐条成立（TF-0031←0030、…、TF-0042←0041） | 已查证，吻合 |
| TF-0007/TF-0009 卡在已提交的真人守卫 | `tests/unit/tf0009-engineering-evidence-audit.test.ts` L115/L117：`requiresNamedHumanOperator: true`、`syntheticCounts: false`；节点摘要自认 D6 仿真不计入 | 已查证，吻合 |
| TF-0102 78/79 done，M6（TF-0144 等）标「本轮不投入」 | TF-0102 done，摘要明写 M6 residual 独立后续；TF-0144 blocked，摘要写明 1800min/低置信/会成为第 9、10、11 个零调用模块 | 已查证，吻合 |
| LATEST.md 约 2,559 行，多代「当前接力」叠加 | 2,558 行（口径差 1，无影响）；L3「当前接力：TF-0029…TF-0030 转 ready（2026-09-21）」，往下叠 9/15、9/14、9/13 等多代接力 | 已查证，吻合 |
| 交接写「TF-0030 ready」超过图的状态 | LATEST.md L9「TF-0030 自动转 ready」；提交 `de54b5680` 信息亦写「TF-0030 ready」。图内持久状态仍 proposed | 已查证，吻合（口径问题见 §0 修正 2） |
| J-02 存在：58 秒、3/3、agent 驱动、收据为 0 | `artifacts/live-model-cdp/20260921-senseaudio-journey-J02/README.md`：发送→最终回复 58 秒，exec→read×2→edit→exec→git commit，3 pass；操作者 agent-driven（Claude Code 经 Playwright/CDP）；`runtime_receipts=0、effect_receipts=0、context_blocks=0` | 已查证，吻合 |
| 5 条未修尾项 | J-02 README「未修、需登记的观察」恰好 5 条：sessions.history 路径错位、非 fullAccess 挂起（指向 TF-0032）、首次配置需重启 Gateway、工作区创建有副作用文件、renderer 头部不刷新 | 已查证，吻合 |
| 6760b372e 修了 custom key 与 tools.exec 权限送不进源码运行时 | 提交在 HEAD 祖先链；J-02 README 两缺陷段逐条对应 | 已查证，吻合 |
| 能力表 2026-07-05、44 条：PARTIAL 21 / FP-OVERCLAIM 5 / TP-RUN 3 | status-table.json `generatedAt: 2026-07-05`，items 44；分类计数完全一致；5 条 FP-OVERCLAIM = 可编辑任务 DAG、失败自动全量回滚、checkpoint 全量快照、任务编辑事务回滚、明文保证；3 条 TP-RUN = Gateway 拉起、异步 JSON-RPC、观测失败不挡执行 | 已查证，吻合 |
| 大文件断点清单（chat.ts 205KB 等 7 个） | 7 个文件字节数逐一吻合（205,480 / 202,784 / 182,961 / 196,039 / 187,153 / 195,187 / 252,309） | 已查证，吻合 |
| 测试在主动跳过未接线 UI | `tests/e2e/compaction-artifact-viewer.spec.ts:15`（unwired）、`tests/e2e/chat-checkpoints.spec.ts:134`（曾 unwired） | 已查证，吻合 |
| CodeGraph 插件已退役 | `openclaw_runtime/extensions/codegraph/README.md:1`「RETIRED」，替代面 DCS FactStore；`openclaw.plugin.json` `enabledByDefault: false` | 已查证，吻合 |
| 定调文档记 runtime_receipts=0、context_blocks=0、RC-03 seal 未开 | `docs/dev/engineering-product-node-plan-20260921.md:27` | 已查证，吻合 |
| README 首产品 = Windows x64 DCS Coding Controlled Preview、opt-in、不宣称 GA | README.md L42-46 | 已查证，吻合 |
| 20 页面 / 143 扩展 / 505 harness 规格 / 731 runtime-research 笔记 | 20 页面目录（名称列表亦吻合）；extensions 目录 140（QA 143）；harness/specs 下 .md 503（QA 505）；runtime-research .md 731 | 基本吻合，目录/文件计数口径略有出入，不影响结论 |
| 过程资产体积：timeline 499MB、events 257MB、HTML 92MB、CodeGraph 库 754MB | 523 MB / 270 MB / 96 MB / codegraph.db 790 MB | 同量级吻合（时点与计量口径不同） |
| CodeGraph 索引 13,259 文件 / 290,753 节点 / 993,114 边、相对导入无断 | 未复计（索引库存在，本轮未打开数据库、未重跑索引） | 推断/沿用：无相反证据，但不升级为已查证 |

---

## 2. 项目真实全貌

### 2.1 模块划分（已查证，按收尾视角）

- **桌面壳（本仓库的本体）**：`electron/` + `src/` + `shared/`。20 个页面目录中，Chat、Agents、Channels、Cron、Knowledge、Models、Settings、Setup、Skills 是工作台本体；Billing、Browser、ClawGraph、CodeReview、Dreams、ImageGeneration、Inbox、Observability、RemoteTasks、TaskLedger、UiV2Showcase 是继承/扩出的第二产品面。
- **上游运行时（继承资产）**：`openclaw_runtime/`（agent、gateway、渠道、140 个 extensions）。按 CodeGraph 节点计数，真正占地图的是这部分，不是桌面论文（QA 同判断）。
- **治理与证据层（本仓库的差异化）**：`harness/specs/**`（约 503 篇规格）、`context-engine/`（注入预算、收据、损伤审计）、`scripts/lib/agent-engineering-acceptance.mjs`（工程验收器）、`artifacts/**`（能力声明表、J-02 旅程、deep-test/audit 报告）、`.agent-workbench/task-forest/**`（任务森林）。
- **过程/研究资产**：`runtime-research/` 731 篇笔记、task-forest 导出（523+270+96 MB）、`.codegraph/codegraph.db`（790 MB）。它们是思考沉淀，不是产品。

### 2.2 完成度（不用百分比，用事实表）

| 路径 | 状态 | 证据 |
|---|---|---|
| Windows 桌面 → 真实 provider → 工作区 exec→read→edit→exec | **跑通过一次**（2026-09-21，agent 驱动，58 秒，3/3） | J-02 README + journey.json + 独立复跑 `node --test` exit 0 |
| 跨层配置送达（custom key、exec policy → 源码运行时） | 本次旅程逼出 2 个真缺陷并已修 | `6760b372e`，J-02 README 缺陷 1/2 |
| 演示尾项（5 条观察） | **未修**，待在当前 HEAD 复核 | J-02 README「未修观察」 |
| 收据/上下文归因可见化 | **机制在源码，演示中为 0**（`runtime_receipts=0、context_blocks=0`，RC-03 seal 未开） | J-02 README 收据行；定调文档 L27 |
| RC-02 双收据普查（TF-0030） | proposed / progress 0，仅 23 行未提交增量 | forest + git diff |
| 工程验收器与门合同 | **机制可用**（TF-0029 双执行者 25 门双 pass，`allowedPromotion=false` 诚实保留） | TF-0029 摘要 |
| 真人验收（TF-0009/TF-0042） | **故意过不了**：具名真人 0/10，仓库守卫明确仿真不计入 | 守卫测试 L115/L117 |
| 全量 Electron UI / 发行基线 | 显式 defer（`deferredProfiles`） | LATEST.md L8 |

### 2.3 健康度（按展示项目口径）

- **演示主路径：可用但带伤。** 一次完整旅程有录屏、事件流、前后哈希、独立复跑；但操作者是 agent-driven，5 条尾项未复核，收据为 0。
- **证据链：机制已建成，产品可见结果为 0。** 这是当前最大的名实缺口。
- **过程信号：部分失效但非损坏。** 森林计数诚实（没有把 blocked 涂绿，TF-0007 甚至「撤回 done」），但多份「当前状态」文档互相矛盾（§3.3）。
- **代码可改动性：偏差。** 七个 200KB 级文件是修改成本热点；抽查未发现断导入（QA 已查证，本轮未复扫——见 §7 盲区）。

---

## 3. 软件熵与断点清单（按对收尾的伤害排序）

**P0-A｜多份「当前状态」文档互相矛盾（叙事熵的真正来源）。（已查证）**
LATEST.md 顶部写「TF-0030 自动转 ready」，图内是 proposed；同仓库 `docs/dev/unified-agent-system/runtime-convergence/STATUS.md` 写 `engineering_verdict: accepted`、候选 `657b51e1c`、`last_verified_at` 2026-08-11，而 `AGENT-START.md` 横幅写候选 `fac6327a2` 独立审计 NO-GO。四份文档（forest、LATEST、STATUS、AGENT-START）不能同时当放行依据。→ 处置：**只标日期与适用范围，不改内容**。改 STATUS.md 等于重开 Runtime 收敛验收，禁止。

**P0-B｜差异化能力没有接上演示。（已查证）**
收据/上下文归因是本项目自证「不是套壳」的核心，但 J-02 三张收据表全是 0。不解决「演示里看不到护城河」，收尾叙事就立不住。→ 处置见 §5（两个机制示例 + 诚实的名实声明）。

**P1-A｜5 条演示尾项未复核。（已查证存在，是否仍在当前 HEAD 为推断）**
sessions.history 路径错位、非 fullAccess 挂起、首次配置需重启 Gateway、工作区副作用文件、renderer 头部不刷新。注意其中「非 fullAccess 挂起」的根因是审批无处理器，图内对应 TF-0032（Durable Approval）——**它不是小修**。若复核发现需要动审批框架，直接写进限制，不要在收尾窗口做完 TF-0032。

**P1-B｜大文件热点（已查证尺寸）：**
`openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts` 252,309 B、`src/stores/chat.ts` 205,480 B（250 节点）、`src/pages/Chat/ChatInput.tsx` 202,784 B、`src/components/agents/RolesOrchestrationPanel.tsx` 196,039 B、`electron/services/knowledge-api.ts` 195,187 B、`src/pages/Knowledge/index.tsx` 187,153 B、`src/pages/Chat/index.tsx` 182,961 B。它们是**修改成本断点**（改一处牵整条 UI），不是功能断点（未见断导入证据）。→ 处置：冻结增长，不拆不删。

**P1-C｜有名词没接通的表面。（已查证）**
`tests/e2e/compaction-artifact-viewer.spec.ts:15`（压缩证据入口 unwired）、`tests/e2e/chat-checkpoints.spec.ts:134`（长任务干预 UI 曾 unwired），与能力表 5 条 FP-OVERCLAIM 同类。→ 处置：列入「不承诺」清单，不动代码。

**P2-A｜过程资产比产品大。（已查证）**
task-forest timeline 523 MB + events 270 MB + HTML 96 MB，codegraph.db 790 MB，合计约 1.7 GB 的过程态。`e043cad95` 已做过一次 untrack oversized state。→ 处置：不导出新的百兆 HTML；展示仓库叙事里不提它们。

**P2-B｜未提交的 shadow-census 增量悬空。（已查证）**
diff 只有一处行为变化：wire owner 必须是具名 transport adapter，provider id 不能充数；测试期望 `acceptanceReady: false`。这是 TF-0030 的真实缺口修复，不是可顺手标完成的改动。→ 处置见 §6。

---

## 4. 过度工程化识别（可裁剪/弃用清单，与 QA 同向）

**从叙事和后续投入中拿掉（不删除代码）：**

1. **RC-03→RC-10 整条串行迁移**（TF-0031…TF-0042）——硬串依赖（§1 已查证链），做完普查才放行双收据→审批→Operator→四种生命周期→记忆/MCP/观测→总验收→真人。展示项目不需要全绿；图自己也把 TF-0042 的 accepted verdict 挂在真人上。
2. **M6（TF-0144 损失追踪/定向再注入/A-B）**——节点自己判定会成为第 9/10/11 个零调用模块（RISK-1 自认）。这是仓库已做过的取舍，延续即可。
3. **CodeGraph 产品面**——已退役（RETIRED + enabledByDefault:false），替代面 DCS FactStore。索引仅留作本地地图。
4. **渠道扩展群**（Discord/Matrix/Telegram/Slack/WhatsApp 等）——上游 OpenClaw 表面，不是本论文。
5. **第二产品面页面**（Dreams/ImageGeneration/Billing/UiV2Showcase/ClawGraph/RemoteTasks 等）——不进首版承诺；无依赖证据前不物理删除。
6. **成熟度分数 / Agent Dev 审计等级 / 2026-07-05 能力表作为进度指标**——TF-0076 的 done 是「成本 NO-GO 负面结论收口」（历史 2.52x token / 3.11x latency 超预算），不是优化成功。
7. **向 chat.ts / ChatInput.tsx / attempt.ts 继续加功能**——在最大文件上继续长，是熵的直接来源。

**保留但冻结（是证据和边界，不是施工图）：** harness 规格、VerseShell、context-engine、host-api 契约、工程验收器。

**不建议删除式重构**——QA 此判断我完全同意：仓库没有断导入证据支持「删了才健康」，删除本身会制造新的验证负担。

---

## 5. 统一主线与差异化（基于现有资产提炼）

**主线（用仓库已有的句子）：本地优先的桌面工作台——一个人用一个模型，在一个 Windows 工作区里做完一件工程事，并且能解释执行过程。**

差异化不是「功能多」也不是「节点多」（上游 OpenClaw 已提供 agent/gateway/渠道），而是三层可指认的约束，且每层都有代码对应物：

1. **执行有边界。** VerseShell / 审批 / 工作区权限。J-02 曾真实卡在无人处理的 `exec.approval.requested` 上 377 秒直到 stuck-session 恢复——这条边界是**真的**，不是摆设（已查证，J-02 run5）。
2. **上下文可归因。** context-engine 的注入预算账本（`turn-injection-budget.ts` 把 knowledge/working_memory/tool_registry 记到同一轮账、超预算按序 skip/truncate/drop）、收据、损伤审计。**理念成立，演示时收据为 0**——必须老实说「机制已建成未通电」。
3. **不把测试绿说成产品绿。** 能力声明分类（TP-SRC/TP-TEST/TP-RUN/FP-OVERCLAIM）、`allowedPromotion=false`、`liveReady/productApproved/defaultOn` 三锁保持 false、TF-0009 真人守卫不可协商。这是工程品味，收尾时**保持，不为好看改口**。

**最小成果应是三件已存在的东西（不是新功能）：**
① 一条真实编码旅程（J-02，含它逼出的 2 个跨层缺陷与 5 条未修观察）；
② 两个机制示例：上下文共享注入预算（固定输入演示账本与降级顺序）、工程验收器对缺门/错来源/把跳过包装成通过的拒绝（放 TF-0029 的既有负例即可，不必重跑 25 门）；
③ 一页范围与证据边界：跑过 / 只证明机制 / 未完成 / 范围外四栏。

**预期目标改写为：** 评委或读者能在一台 Windows 机器上重复一条旅程，并看懂三句限制——收据默认关、非 fullAccess 可能挂起、这不是 GA（且操作者是 agent-driven）。再往下是 9 月 21 日定调的那个产品周期（可安装、失败可解释、重启可恢复、变更可回退、证据可追溯），不属于本次收尾。

---

## 6. 收尾路径（最小成本，三档）

**P0（定口径，不写新功能）：**

1. **对外叙事收成一页。** 以 `docs/dev/engineering-product-node-plan-20260921.md` 的场景为底，但把出口从「完整工程产品」降为「实习展示」：Windows、一个 provider、一个工作区、一条编码旅程、两个机制示例。写明四栏边界（§5 ③）。注意该计划文档自身快照已过时（当时 HEAD `752b936a`、192 done），引用时注明差异。
2. **Task Forest 只改口不改状态机。** 准确表述：「TF-0030 是 proposed，依赖已满足、todo ready，是当前可推进的工程待办，尚未开工更未验收」。不说「图没有放行」，也不说「已自动转 ready」。为 LATEST.md / STATUS.md / AGENT-START.md 各标注日期与适用范围。**不为清 blocked 去改 TF-0009 的真人守卫。**
3. **演示脚本就用 J-02**，附 5 条未修观察、收据为 0、agent-driven 声明。失败（`&&` 在 PowerShell 报错、git 缺 identity）保留为真实样本。

**P1（只修演示会走到的点）：**

4. 在当前 HEAD 复核 5 条尾项，**仍在且演示会走到的才修**，只修这条路径。其中「非 fullAccess 挂起」若发现要动审批框架 → 降级为限制说明（指向 TF-0032），不修。
5. **shadow-census 的决定（我的倾向性建议）：提交它**，作为 TF-0030 的唯一代码增量、独立 commit，注明「wire owner 具名化缺口修复，普查未完成、`acceptanceReady: false`」。即便演示不讲收据也应提交——它保护的是「谁序列化了最终请求可以被指认」这个可信度主张本身。**不要**混进别的提交，**不要**宣称普查完成。（QA 给的是「讲收据才提交」的二选一，此处是修正点之一。）
6. 材料明确不承诺：渠道、Dreams/生图/账单、M6、Docker、默认开启、具名真人 10 次、全量回滚、checkpoint 全量快照、可编辑任务 DAG、压缩证据查看器。

**P2（刻意不做）：**

7. 不新建 Task Forest 节点，不导出新的百兆 HTML。
8. 不拆大文件、不恢复 CodeGraph 插件、不把 140 个扩展/20 个页面收进故事、不物理删除未承诺页面。
9. 不把全量 Electron 套件当收尾门禁（TF-0041 自己就把发行基线放在后面）。
10. 不改 STATUS.md 配合展示叙事。

**停的边界（QA 边界 + 一条可操作验收标准）：**
一条旅程能从头配置到改完文件并跑测试；失败时能说出卡在批准、重启还是权限；材料写明收据未默认开启；两个机制示例能独立复验；**并且一位未接触过项目的人按 README 在 30 分钟内复现该旅程（或用留档证据兜底走完讲解）并复述三句限制**。到这里就停。再往下是另一个产品周期。

**演示日风险预案（QA 未覆盖，补）：** J-02 依赖真实 senseaudio 可用。若演示日 provider 不可用，以 `journey.json` + 3 张截图 + `session.jsonl` 作留档证据讲解，不现场重试长跑。

---

## 7. 验证方式与盲区

**本轮已查证（全部有文件/命令对应）：** git 状态与 diff 全文；forest.json 224 节点/373 边状态计数、TF-0028 的 14 子节点、depends_on 串行链、TF-0029/0030/0007/0009/0102/0144/0041/0076 节点摘要；todos.json 24 条中唯一 ready 即 TF-0030；LATEST.md 行数与「TF-0030 ready」表述；定调文档 L27 收据为 0；README 定位段；J-02 README 全文（工具序列、58 秒、5 条尾项、收据计数）；能力表 44 条分类计数与 FP-OVERCLAIM/TP-RUN 具名清单；7 个大文件字节数；2 个 unwired 测试注释；CodeGraph RETIRED 声明与 enabledByDefault:false；tf0009 守卫 L115/L117；20 页面目录名清单；过程资产体积（523/270/96/790 MB）。

**未做，因此不能当健康证明：** 未重跑 J-02；未跑全量 typecheck / 全量测试 / Electron E2E；未重跑 CodeGraph 索引与「13,259 文件/290,753 节点/993,114 边」计数（沿用 QA 自述）；未做全库导入扫描（QA 的「无断导入」是其抽查自述，本轮不升级为全库证明）；未重放 TF-0029 的 25 个门；未打开 `docs/dev/unified-agent-system/runtime-convergence/` 之外的全部状态文档排查是否还有第五份「当前状态」。本次仅补跑了下面第 8 节列出的聚焦验证。

**仍存的盲区：** ① 5 条尾项在当前 HEAD 的可复现性未知；② 演示复现对 senseaudio、Windows 环境、Gateway 重启时序的依赖未做压力验证；③ 个人与 AI 协作的贡献归属未逐提交审计——建议用一页说明回答「设计决策是什么、否决过哪些方案、如何审查 AI 生成的改动」，不要用目录体积代替；④ 能力表与当前代码的偏差方向「一致」是抽查印象（unwired 测试 + FP-OVERCLAIM 对得上），未逐条复核 44 条。

## 8. 接续复核（2026-09-22）

原会话因代理错误中断后，当前工作树补跑了原先未完成的聚焦门：

- `pnpm --dir openclaw_runtime exec vitest run src/agents/shadow-census.test.ts --maxWorkers=1`：8/8 通过。
- `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts --maxWorkers=1 --reporter=verbose`：61/61 通过，用时约 96 秒；此前 120 秒的外层超时不是测试失败。
- `pnpm --dir openclaw_runtime run tsgo:core`：通过。
- `git diff --check`：通过。

补跑前发现新增的 provider-owner 测试把缺失 `adapterId` 的输入同时送进了严格的 `ReceiptStore`，因此在 wire-owner 断言前先被模型收据身份校验拒绝。测试已收窄为直接验证 `emitShadowWireReceipt` 的边界，并使用最小 store stub；生产代码仍只做 `input.adapterId` 的行为变化。收据普查仍未完成，`acceptanceReady: false` 的范围判断不变。
