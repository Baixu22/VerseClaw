# ClawX 收尾裁定：对本轮 QA 的看法与依据

> 【2026-09-22 标注】本文是收尾讨论的输入之一，已被 `docs/dev/qa-synthesis-roadmap-20260922.md`（唯一入口）综合；结论以该文与 Task Forest（D7 = TF-0225、里程碑 TF-0226）为准。

日期：2026-09-22。分支 `feat/runtime-lifecycle-governance`，HEAD `ba1206324`。未提交改动：`openclaw_runtime/src/agents/shadow-census.ts` + 测试（+25/−1），以及两份前序 QA 产物（`qa-project-assessment-20260922.md`、`qa-review-report-20260922.md`）。

性质：这是收尾决策记录，不是新的任务真源，不签发产品验收，不改 `liveReady / productApproved / defaultOn`，不把 agent-driven 写成真人。前两份 QA 产物保留为带日期的输入，本文是这轮讨论的终点；之后不再新增第四份"当前状态"文档。

每条结论标 **[已查证]**（本会话用 Read/grep/node 直读磁盘）或 **[推断]**（有代码依据但未执行）。

---

## 0. 结论先行

**QA 的收缩方向是对的，我采纳它的边界、裁剪清单和"不为涂绿做 RC-03~RC-10"的判断。** 但 QA 在两个关键点上把选择题出窄了，而这两点恰好决定收尾后这个项目"能不能自证不是套壳"：

1. **收据为 0 不是"要么做完 TF-0030、要么写成限制"的二选一。** 两条收据写入路径都已接在生产链上，只是被两个默认关的环境变量门住；而这两个变量从 J-02 驱动脚本的进程环境一路透传到 Gateway。**重跑一次 J-02、多带两个环境变量，就能在真实模型调用上得到非 0 的 ContextReceipt/v1 + WireReceipt/v1，零代码改动，且不翻任何默认值。** 这是把"机制已建成未通电"变成"通电过一次、有证据、默认关"的最便宜路径。（§3.1）
2. **"非 fullAccess 会挂起"被三份材料都路由到 TF-0032，路由错了。** TF-0032 是"审批跨重启持久化"；而挂起的直接原因是 ClawX 从未调用运行时已经暴露的 `exec.approval.resolve`。这是 ClawX 侧缺一座桥，不是运行时缺持久化。演示层面不需要建这座桥：通过 host API 已有的 `gateway.rpc` 透传，可以让"边界拦住 → 人做决定 → 执行继续"这条护城河第一支柱完整发生一次。（§3.2）

停的边界（在 QA 的基础上加两条）：一条旅程从配置到改完文件跑过测试；**护城河通电一次**（收据表非 0，flag 默认仍关）；**审批边界发生一次**（挂起 → 决定 → 继续，哪怕决定是经 RPC 做的）；未提交的 shadow-census 作为独立提交落盘；材料写明三句限制。到这里停。

---

## 1. 项目真实全貌（以收尾视角）

### 1.1 这是什么 [已查证]

Electron + React 的 OpenClaw 桌面壳，加一层自己叠上去的运行时治理。README 第 42–44 行把首产品写成 **Windows x64 DCS Coding Controlled Preview**：单一 workspace、显式 opt-in、不宣称 GA。当前主导航只有收件箱 / 定时任务 / 知识库 + 聊天 + 设置（`src/components/layout/Sidebar.tsx:1005-1012`）；Models/Agents/Channels/Skills 已重定向进设置，Image Generation / Dreams 要 `devModeUnlocked`，Task Ledger / ClawGraph / Observability / UiV2Showcase 有路由但不在导航里（`src/App.tsx:107-138`）。

### 1.2 任务森林的真实读数 [已查证]

`.agent-workbench/task-forest/graph/forest.json`（generated 2026-09-21T10:09Z）：224 节点 / 373 边，done 193、blocked 12、proposed 12、deprecated 7，in_progress 0，`status_queues.ready = []`。

真正没做完的是 **TF-0028 下的串行 RC 链**：14 个子节点只有 TF-0029 done；TF-0030…TF-0041 全是 proposed / progress 0 / difficulty very_high，`depends_on` 逐级硬串（TFE-0063 → 0065 → 0066 → … → 0083，全部 `blocking: true`）；TF-0042 blocked。12 个 blocked 里 5 个是作者自己标"本轮不投入"的 M6（TF-0129/0130/0141/0144/0151），2 个是真人守卫（TF-0007/TF-0009），1 个 Docker（TF-0047），其余是这条链的父节点。

所以"193/224 = 86%"是误导：done 大头是运行时可靠性补丁（TF-0160～0223，64 个）和上下文护城河子节点，不是桌面产品做完了。

### 1.3 三层"护城河"在代码里都有对应物 [已查证]

| 支柱 | 代码对应物 | J-02 里的状态 |
| --- | --- | --- |
| 执行有边界 | `tools.exec` 工作区策略 → 运行时 `exec.approval.requested`；ClawX 侧 `decideGatewayRpc` 也按 permissionMode 过滤 RPC（`electron/services/gateway-api.ts:413`） | run5 真实卡住 377 秒直到 stuck-session 恢复；修了 `tools` 同步键后 fullAccess 下不再误卡 |
| 上下文可归因 | RC-03 seal：`extensions.ts:337` → `finalizeContextOrchestratorTurn` → `context-orchestrator.ts:341-355` → `runRc03SealHook` → `ReceiptStore.put`（ContextReceipt/v1）；RC-02 census：`stream-resolution.ts:307` → `provider-transport-fetch.ts:864` `emitShadowWireReceipt`（WireReceipt/v1）；两者以 `correlationDigest` 关联（`stream-resolution.ts:311-329`）；注入账本 `turn-injection-budget.ts` | **接在生产链上但默认关**：`runtime_receipts=0 / effect_receipts=0 / context_blocks=0`（journey.json） |
| 不把测试绿说成产品绿 | 能力表分类（44 条：PARTIAL 21 / FP-OVERCLAIM 5 / TP-RUN 3，2026-07-05）、`allowedPromotion=false`、三锁 false、`tf0009` 守卫测试 L80/L115-119、TF-0076 成本 NO-GO、TF-0131 因"不改默认值"被砍、AGENT-START 的 NO-GO 横幅 | 全部仍在，且没有被涂改 |

### 1.4 完成度：用事实表，不用百分比

| 路径 | 状态 | 依据 |
| --- | --- | --- |
| Windows 桌面 → 真实 provider → fullAccess 工作区 exec→read→edit→exec | **跑通过一次**（2026-09-21，58 秒，3/3，agent-driven） | `artifacts/live-model-cdp/20260921-senseaudio-journey-J02/` [已查证] |
| 跨层配置送达（key、exec policy → 隔离运行时） | 逼出 2 个真缺陷并修入 `6760b372e` | J-02 README §缺陷 1/2 [已查证] |
| 收据 / 上下文归因 | 机制在生产链上，**演示为 0**，因 flag 默认关 | §3.1 [已查证] |
| 审批边界 | 运行时完整（request/waitDecision/resolve/list/get 六个 RPC），**ClawX 无处理器** | §3.2 [已查证] |
| TF-0030 双收据普查 | proposed / 0，只有 23 行未提交增量 | git diff [已查证] |
| 工程验收器 | TF-0029 25/25 双执行者 pass，`allowedPromotion=false` | LATEST.md L3-5（未复跑）[推断] |
| 真人验收 | 故意过不了；D6（TF-0224）已把人证档改成 engineering-simulated，但 TF-0009 守卫测试仍要求具名真人 | 守卫测试 + 记忆 [已查证] |

---

## 2. 软件熵与断点（按对收尾的伤害排序）

**P0-A 多份"当前状态"互相矛盾。[已查证]** 现在同时存在：forest（ready=0）、LATEST.md L9（"TF-0030 自动转 ready"）、STATUS.md（`engineering_verdict: accepted`、`program_status: human_acceptance_pending`）、AGENT-START.md（候选 `fac6327a2` NO-GO、不得恢复 accepted）、0921 定调文档（快照 `752b936a`、192 done）——再加上工作树里两份未提交的 QA 产物。**这已经是六份。** 处置：全部只标日期与适用范围，不改内容；本文之后不再新增。

**P0-B 差异化能力在演示里不可见。[已查证]** 三张收据表全 0。这不是缺功能，是缺一次"通电"的证据。处置见 §3.1，成本是一次重跑。

**P1-A 五条演示尾项未在当前 HEAD 复核。[已查证存在 / 是否仍在为推断]** 逐条裁定见 §5 P1。

**P1-B 大文件是修改成本断点，不是功能断点。[已查证]** `attempt.ts` 252,309 B、`chat.ts` 205,480 B、`ChatInput.tsx` 202,784 B（本会话 stat 复核）；前序报告核过另外四个。抽查未见断导入。处置：冻结，不拆。

**P1-C 有名词没接通的表面。[已查证]** `tests/e2e/compaction-artifact-viewer.spec.ts:14-17`（压缩证据入口 unwired、host 方法未注册）、`chat-checkpoints.spec.ts:131-135`（CheckpointsDialog 孤儿）。与能力表 5 条 FP-OVERCLAIM 同类。处置：写进"不承诺"，不动代码。

**P2-A 过程资产比产品大。** 前序报告量过：task-forest 导出 ~1.4 GB、codegraph.db ~790 MB。`e043cad95` 已 untrack 过一次。处置：不再导出。

**P2-B 未提交的 shadow-census 悬空。[已查证]** 唯一行为改动：`buildWireOwnerCensus(body, input.adapterId ?? input.providerId)` → `input.adapterId`，即 provider id 不能冒充 wire owner。**我复核了两个生产调用点都已传 `adapterId: model.api`**（`provider-transport-fetch.ts:867`、`stream-resolution.ts:298`），所以这个改动不会让 J-02 路径回归，只堵住"用 provider id 充数"的漏洞。处置：**提交，独立 commit，标注 TF-0030 局部增量、普查未完成、`acceptanceReady` 语义收紧。** 不因为"演示不讲收据"就搁着——它保护的是"谁序列化了最终请求可以被指认"这条可信度主张本身。

---

## 3. 两处与 QA 不同的判断（依据）

### 3.1 收据为 0 有第三条路：重跑 J-02 时把两个 flag 带上 [已查证链路 / 推断结果]

环境变量透传链，三段都查过：

1. 驱动脚本把自身 `process.env` 整体传给 Electron（`driver.mjs:65-66`，只抹掉 `SENSEAUDIO_API_KEY`）。
2. Electron 把 `process.env` 整体（去掉 `NODE_OPTIONS` 与 systemd 键）铺进 Gateway 子进程环境（`electron/gateway/config-sync.ts:1054`、`1080-1081`；`stripSystemdSupervisorEnv` 只删 systemd 键）。
3. 运行时读取：`OPENCLAW_RC02_SHADOW_CENSUS`（`shadow-census.ts:255-259`）开 WireReceipt；`OPENCLAW_RC03_SEAL`（`rc03-seal-hook.ts:110-133`）开 ContextReceipt；上下文增强 kill switch 默认不启用（`enhancement-kill-switch.ts:52-70`）。

两条路径都是**纯观测**：seal hook 注释写明"never change send behavior"，写失败只记 diagnostics（`rc03-seal-hook.ts:207-215`）；census 注释写明"Receipt writes are observational… the guarded provider request continues unchanged"（`provider-transport-fetch.ts:862-863`）。所以带 flag 重跑不会改变模型收到的请求，也不会触碰 `defaultOn`。

预期结果 [推断]：`runtime_receipts` 出现 `ContextReceipt/v1` 与 `WireReceipt/v1` 成对的行，能用 `correlation_digest` join。可能的非阻塞异常：`assertSealProducersRegistered` 报未注册 producer（记录，不阻塞）、写入失败进 `getShadowCensusDiagnostics().failures`。**这两种结果都要原样写进材料**，它们本身就是"收据链在真实调用上的行为"证据。

这一步决定叙事能不能立住：只放一段修 `calc.js` 的录像，评委必然问"503 篇 harness 规格和这次演示有什么关系"。一张非 0 的收据表加一个 correlation join 就是答案。

### 3.2 "非 fullAccess 挂起"是 ClawX 缺桥，不是 TF-0032 [已查证]

- 运行时 gateway 暴露 `exec.approval.request / waitDecision / resolve / list / get` 与 `requested / resolved` 事件（`openclaw_runtime/src/gateway/**`，grep 计数 6/5/5/5/5/3/3）。
- ClawX 的 `electron/ src/ shared/` 对 `exec.approval` **零引用**。`chat-runtime-events.ts:209` 只把 `approval` 流转成 `approval.updated` 用于显示；`permissions-api.ts` 是 ClawX 自己的审批账本（electron-store，10 分钟 TTL），与运行时的 `exec.approval` 不连通。
- 记忆里另有一条：运行时侧 RC-04 的 `approval_ledger`（17 列）和 `ExecApprovalManager durableLedger` 已经建好（TF-0032 evidence 也写了 Verifier pass），只是零行。

所以正确的定性是：**运行时两端都在，ClawX 从没接上 resolve。** 收尾窗口不建议建 UI（会碰 `ChatInput.tsx` 这种 200 KB 文件）；但演示可以不建 UI 就把边界跑通：非 fullAccess 工作区下达同一任务 → 挂在 `exec.approval.requested` → 经 host `gateway.rpc` 调 `exec.approval.list` 看到 pending → `exec.approval.resolve` 批准 → 执行继续。[推断] 一个不确定点：`decideGatewayRpc(method, permissionMode)` 可能在非 fullAccess 下拦住这两个方法本身；若拦住，就切回 fullAccess 再调，仍能证明"运行时接受了一次人的决定"。

如果材料之外还有代码预算，**ClawX 内嵌一个最小 resolve 桥**是整个 RC 链里唯一值得做的一件，因为它就是护城河第一支柱的产品入口。但它是可选项，不是收尾门槛。

---

## 4. 亮点、取舍与预期

### 4.1 最值得保留的是什么

不是 224 个节点，也不是 20 个页面。是两件事：

1. **一条跑通的路径**：Windows 桌面 → 一个真实 provider → 一个工作区 → exec→read→edit→exec，并且这条路径逼出了两个跨层真缺陷并修掉（`6760b372e`）。
2. **一套约束自己不撒谎的纪律**：TF-0007 撤回 done；`tf0009` 守卫拒绝仿真顶替真人；TF-0076 以 NO-GO 收口；TF-0131 因"不改默认值"被砍；AGENT-START 用 NO-GO 横幅覆盖旧的"已通过"；验收执行器禁止凭证环境变量、判决只从磁盘读（bash 输出曾被伪造）；`allowedPromotion=false`。对一个"Harness + LLM 工程化"的实习展示，**这套纪律就是论点，J-02 是它的演示**。

### 4.2 从叙事和后续投入里拿掉（不删代码）

与 QA 完全同向：RC-03～RC-10 串行链、M6、CodeGraph 产品面（README 首行 RETIRED、`enabledByDefault:false`）、143 个渠道扩展、第二产品面页面（Dreams/生图/账单/UiV2Showcase/ClawGraph/RemoteTasks/TaskLedger）、成熟度分数与 2026-07-05 能力表当进度、往三个 200 KB 文件里加功能。**保留但冻结**：harness 规格、VerseShell、context-engine、host-api 契约、验收器。

另加一条 QA 没提的：**定调文档 §6 提议的 tf0009 守卫迁移，明确移出收尾。** 它是状态语义变更（用户说过这类才需要拍板），而且展示不需要它。

### 4.3 预期应改成什么

评委或读者拿到：① J-02 的产物（journey.json、session.jsonl、前后哈希、截图）；② 一张非 0 的收据表和一个 correlation join；③ 一对审批 request/decision；④ 一页限制：收据默认关、非 fullAccess 无应用内审批 UI、操作者是 agent-driven、只有 Windows + 一个 provider、这不是 GA。能复述这四样，就达到了。

---

## 5. 收尾路径（最小成本，三档）

**P0｜今天就能定，不写新功能**

1. **对外叙事收成一页**，以 0921 定调文档的场景为底，出口从"完整工程产品"降为"实习展示"：Windows、一个 provider、一个工作区、一条旅程、护城河通电一次、审批边界一次。四栏：跑过 / 只证明机制 / 未完成 / 范围外。
2. **Task Forest 只改口不改状态机**：TF-0030 = proposed、依赖已满足、todo ready、未开工。LATEST/STATUS/AGENT-START 各标日期与适用范围。不改 `tf0009` 守卫。
3. **提交 shadow-census**，独立 commit，措辞："RC-02 wire owner 必须是具名 adapter；普查未完成；`acceptanceReady` 收紧"。同一提交不夹别的东西。
4. **把两份前序 QA 产物与本文一起作为 docs 提交**，工作树清空——J-02 驱动会记录 `dirty`，重跑前树必须干净。

**P1｜只修/只做演示会走到的点**

5. **重跑 J-02，带 `OPENCLAW_RC02_SHADOW_CENSUS=1 OPENCLAW_RC03_SEAL=1`**（§3.1）。收据非 0 或诊断里的失败，都原样写进材料。这是本轮唯一必须执行的验证动作。
6. **审批边界一次**（§3.2）：非 fullAccess 工作区 + `gateway.rpc exec.approval.list / resolve`。留 request/decision 对。
7. 五条尾项逐条裁定：
   - `sessions.history` 路径错位 → **不修**（聊天走 Gateway RPC 不受影响；演示不从历史回放）。
   - 非 fullAccess 挂起 → **不建 UI**，按第 6 条演示，写"无应用内审批 UI"。
   - 8 秒内 reload 被跳过 / Windows 直接重启 → **不修**，驱动已 `gateway.restart`，写进限制。
   - 工作区副作用文件 → 现码只种 `resources/workspace-harness` 模板（`workspaces-api.ts:560`），**`git init` 在当前 electron/src 已 grep 不到**，不再当现存缺陷；重跑时再看。
   - renderer 头部不刷新 → 只在演示截图里可见时修，且只修 `workspace.permissionMode` 绑定那一处；牵到 ChatInput.tsx 大改就写进限制。
8. 材料明确不承诺：渠道、Dreams/生图/账单、M6、Docker、默认开启、具名真人、全量回滚、checkpoint 全量快照、可编辑任务 DAG、压缩证据查看器、应用内审批 UI。

**P2｜刻意不做**

9. 不新建 Task Forest 节点，不导出新的百兆 HTML，不重跑 CodeGraph。
10. 不拆大文件，不恢复 CodeGraph 插件，不物理删除未承诺页面。
11. 不跑全量 Electron 套件当收尾门禁（TF-0041 自己把它放后面）。
12. 不改 STATUS.md 配合叙事，不做 tf0009 守卫迁移，不做 TF-0032。

**演示日预案**：J-02 依赖 senseaudio 可用。若不可用，用留档证据（journey.json + 收据表 dump + 截图 + session.jsonl）讲解，不现场重试长跑。

**关于前序报告的"陌生人 30 分钟复现"门槛**：不采纳为门槛。这条路径依赖代理 7897、senseaudio key、dist 三件套重建、Gateway 重启时序，作者的 agent 自己都跑了多轮才把环境对上。改为："作者能在最终 HEAD 用仓库内的 driver.mjs 重跑；读者能离线核对产物（哈希、session.jsonl、收据 dump）。"陌生人复现作为加分项写。

---

## 6. 验证方式与盲区

**本会话直读磁盘核过**：forest.json 全部计数、status_queues、TF-0028 的 14 子节点与 depends_on 链、TF-0030/0031/0131/0148/0032 节点摘要；`git diff` 全文；J-02 README、journey.json 的 receipts 块（含 82 张表名）、driver.mjs 的 launch env；`config-sync.ts` 的 sync keys 与 forkEnv 组装；`rc03-seal-hook.ts` / `shadow-census.ts` / `context-orchestrator.ts` / `extensions.ts` / `stream-resolution.ts` / `provider-transport-fetch.ts` 的 flag 读取与生产调用点；`enhancement-kill-switch.ts` 默认；运行时 `exec.approval.*` RPC 名与 ClawX 侧零引用；`gateway-api.ts:402` 的 rpc 透传与权限门；`tf0009` 守卫断言；两个 e2e skip 注释；CodeGraph RETIRED；Sidebar/App.tsx 路由；README 定位段；能力表 44 条分类；三个大文件字节数；STATUS.md / AGENT-START.md 头部；LATEST.md 头段；0921 定调文档全文；`workspaces-api.ts:560` 与 `resources/workspace-harness` 内容；`git init` 无命中。

**未做，因此不能当健康证明**：未重跑 J-02；未执行带 flag 的重跑（§3.1 的收据结果是推断）；未调用 `exec.approval.resolve`（§3.2 的 RPC 权限门是推断）；未跑 typecheck / 全量测试 / Electron；未复跑 TF-0029 的 25 门；未复计 CodeGraph 索引；未重量过程资产体积（沿用前序报告）；未逐条复核能力表 44 条。

**仍存盲区**：① 带 flag 重跑时 `assertSealProducersRegistered` 是否报未注册 producer——若报，要照实写，不要为它补注册；② `decideGatewayRpc` 在非 fullAccess 下是否放行 `exec.approval.*`；③ "头部不刷新"在当前构建是否仍在；④ 个人与 AI 协作的贡献归属未逐提交审计——建议一页说明回答"设计决策是什么、否决过哪些方案、如何审查 AI 生成的改动"，这一页比目录体积更能回答"你做了什么"。
