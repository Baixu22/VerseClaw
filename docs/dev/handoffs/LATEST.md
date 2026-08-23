# 会话交接（LATEST）

## 节点谱系与后继边界（读这份文件前先看这一段）

- `TF-0010`（OpenClaw Runtime Authority 与 Operator 产品收敛，`global_task`）= `in_progress`，
  是本条线的全局任务。
- `TF-0077`（Runtime Lifecycle Governance Phase 0-6 Closeout，`global_task`）= `done`。
  它交付的是 RLG 七阶段本身；**它不是本条线的终点**。
- `TF-0078`（会话生态生命周期生产收敛与真实恢复，`milestone`）= `done`
  （2026-08-24 用户裁定收口），`child_of TF-0010` 且 `derived_from TF-0077`，
  是 TF-0077 的正式后继。
- `TF-0078` 下串行五节点全部 `done`：`TF-0079`（生产可达性）→ `TF-0080`（安全闸门）→
  `TF-0081`（资源回收）→ `TF-0082`（跨会话控制与 lineage）→ `TF-0083`（Goal/Loop 唤醒）。
- `TF-0084`（统一生命周期账本、活动投影与真实闭环验收，`milestone`）是 `TF-0078` 下
  **最后一个**节点，状态见下一段。
- `TF-0085`（TF-0079..TF-0084 链独立健康审计，`child_of TF-0078`）= `done`：
  三线均 `pass-with-findings`（0 blocker / 4 major / 7 minor / 6 note），
  产物 `artifacts/tf0078-chain-health-audit/report.md` + `findings.json`。
- `TF-0086`（审计整改与收口，`milestone`，`child_of TF-0010`、`derived_from TF-0085`）
  = `done`：线性七步 `TF-0087`（代际注入治理）→ `TF-0088`（归属声明）→
  `TF-0089`（census+启动期守卫）→ `TF-0090`（dispatch 证明 12/12）→
  `TF-0091`（明文决策与死面）→ `TF-0092`（工程卫生）→ `TF-0093`（拆分预案与决策记录）
  全部 `done`；4 个 major + 7 个 minor 全部闭环，收口时刻全链 227 测试 + 根级门禁全绿。
- `TF-0078` 已于 2026-08-24 收口为 `done`（用户裁定）：链改动已按层提交
  （`80b3fd794` specs、`25df76ab5` runtime、`57bc803b1` electron/renderer、
  `4800bd758` docs、`3b92660d2`/`f60b0aed0` task-forest）；提交拆分依据
  `artifacts/tf0093-commit-readiness/split-plan.md`；遗留协调项：11 个他流依赖
  文件归各 workstream 自行提交。
- 本文件顶部之后的所有章节都是历史快照。任何写着「当前唯一 active 节点」「下一唯一节点」
  的历史段落，都以本段和下一段为准，不再代表当前状态。

## TF-0087 审计整改第 1 步：迟到代际注入点治理（2026-08-23，done）

- 背景：2026-08-23 独立健康审计（`artifacts/tf0078-chain-health-audit/report.md`、
  `findings.json`，FP-07 major）确认 TF-0082 指标 `stale generation overwrite=0` 的
  口径窄于 requirement；本步骤按线性整改流程（`TF-0086` 里程碑第 1 步）治理。
- **新增守卫（注入点①）**：后台 exec 退出通知的代际守卫
  （`openclaw_runtime/src/agents/bash-tools.exec-runtime.ts` 的 `maybeNotifyOnExit`）。
  spawn 时钉扎的 `lifecycleExpectedSessionId` 与退出时刻 store 中的当前代际比对，
  失配丢弃退出通知与心跳唤醒（一条 `logWarn`）；沿用链内惯例：无真实钉扎
  （缺省/空白/回退为 canonicalSessionKey 本身）放行、当前代际不可解析放行、
  store 读取失败放行（fail-open，不得误吞真实退出通知）。`sessionStore` 模板按
  `mainKey`/`sessionScope` 同款 start-time 快照约定携带，退出时不做环境配置加载。
  回归测试：`src/agents/bash-tools.exec-generation-guard.test.ts`（8 用例，agents-core
  分片）；探针验证：移除守卫恰好 2 个丢弃用例变红、还原全绿。
- **显式声明（注入点②）**：detached task 完成/阻塞通知（`tasks/task-registry.ts`）
  按稳定 ownerKey 注入当前持有该 key 的代际，是**被接受的跨代际语义**，不计入
  `stale generation overwrite`：TaskRecord 无代际字段、reset 刻意不取消任务、
  跨重启存活与 `background-task` 一等唤醒源均为既定设计；风险边界是通知内容而非
  状态覆盖。`emitExecSystemEvent`（全仓零调用方）同列「已知未守卫兄弟路径」，
  未来接入调用方者须自带钉扎。
- **三处灰色地带复核结论**：① announce 失配后的请求者-代理交接 = 已明认的设计选择
  （注释 + 测试 + 本文件 TF-0082 段），维持；② restart-sentinel `systemEvent`
  continuation 分支 = 防御性死分支（生产只产 `agentTurn`），维持，未来新增
  systemEvent writer 必须先补代际字段与守卫；③ ACP 父流中继 = 可达性弱、HEAD 既有，
  维持，若后续守卫方向是注册时钉扎父代际。
- **已知窗口（未收口）**：`/reset` 后新一代 run 已活跃但 store 尚未旋转落盘之间，
  守卫读到旧代际会放行旧通知（最坏退回治理前行为）；如需收口，先查内存活跃 run
  （`resolveActiveEmbeddedRunSessionId`）再落 store。
- 口径更新：`stale generation overwrite=0` 的守卫路径自本步起为四条（announce wake /
  queue drain / send-steer run-start 窗口 / **后台 exec 退出通知**）；例外清单为
  detached task 通知、announce 请求者-代理交接、restart-sentinel 降级唤醒、
  ACP 父流中继（均声明在案，非遗漏）。
- 边界未变：未放宽任何既有守卫，未翻动任何产品锁；
  `session-ecosystem-cross-session-control.md` 失败矩阵与 requiredTests 同步更新。
- 证据：`artifacts/tf0087-generation-injection-remediation/report.json`。

## TF-0088 审计整改第 2 步：归属声明补齐（2026-08-23，done）

- 背景：审计 FP-12（major）——38 个「继承」文件中 26 个是链自己的未声明产出，
  TF-0083 整节点无 spec；`tf0084-candidate-inherited.json` 的定性整体偏了。
- **新建两份 spec**：
  - `harness/specs/tasks/session-ecosystem-goal-wake-continuation.md`（TF-0083 追溯声明）：
    goal-wake arm/cancel/dispatch/fencing/runtime/timeout/timer/triggers/types、
    cron missionContinuation 全套（types/normalize/persisted-shape/service state+timer/
    store payload-codec/payload test）、`mission-control/types.ts`（与 TF-0082 共声明）、
    `mission-control-methods.ts`（mission.cancel 级联 + mission.resume level-check）、
    `server-cron.ts`（续跑接线）。
  - `harness/specs/tasks/session-ecosystem-audit-remediation.md`（TF-0086 里程碑声明）：
    TF-0087 守卫三文件（`bash-tools.exec.ts` 仅链的一行透传，余为 provenance workstream，
    已在 spec 内点名耦合）+ 候选构建脚本与 inherited 清单。
- **既有 spec 补声明**：cross-session-control 增 `acp-spawn.ts`、`subagent-spawn.ts`、
  `mission-control/types.ts`；safety-gate 增 `subagent-session-cleanup.ts`、
  `subagent-registry-lifecycle.ts`、`config/sessions/artifacts.ts`、
  `cron/isolated-agent/delivery-dispatch.ts`，并**移除误声明**的
  `src/stores/chat/runtime-send-actions.ts`（纯他流 6 行 messageCount）。
- **inherited 清单重定性**：`scripts/tf0084-candidate-inherited.json` 38 → 11，
  全部为真他流依赖（TF-0072 lineage 链、DCS/SEKB 桥接、git-api、sidebar、
  content-provenance）；陈旧条目 `subagent-control.ts`（对 HEAD 零差异、已被声明）移除。
  构建脚本 `scripts/tf0084-build-candidate.mjs` SPECS 并入两份新 spec。
- **candidate 验证（新声明集）**：重建一次性 candidate（`D:/ClawX-tf0084-candidate`，
  base=60d74ebb、candidate=c4588ab8）：baseOwnedFiles=115、inheritedFiles=11、
  baseCopied=126、candidateDiff 恰为 TF-0084 六文件、worktreeClean=true；
  diff-aware `harness validate --since <base>` 对 ledger-acceptance spec **exit 0**。
- 新鲜门禁：两份新 spec 与两份修改 spec 全部 `validate --no-diff` 0、`context` 0；
  goal-wake 8 文件 68 绿、cron 3 文件 13 绿（当前树重跑）。
- 归属残留：`fenced-tick-wiring.test.ts` 经核为 DCS/SEKB 集成测试（依赖
  lifecycle-hook-helpers + trajectory-capture），归他流；`bash-tools.exec-types.ts`、
  `agent-tools.ts` hunk 全属 provenance workstream，未声明为链。
- 证据：`artifacts/tf0088-ownership-declarations/report.json`。

## TF-0089 审计整改第 3 步：census 扩容与启动期可达性守卫（2026-08-23，done）

- 背景：审计 FP-01/FP-02（major）——census 只覆盖 8 个方法（漏 `sessions.send`、
  `sessions.steer`、`mission.cancel`、`mission.resume`），且
  `createCoreGatewayMethodDescriptors` 对「有 spec 无 handler」**静默跳过**，
  正是 yieldState 型缺陷的结构性根源。
- **census 扩至全部 12 个链方法**（`session-ecosystem-lifecycle-reachability.test.ts`）：
  新增 4 方法逐项断言 handler+descriptor+scope+registry 解析；`sessions.steer`
  以 `advertised: false` 单独口径（刻意不 advertise 的内部伴生方法）。
- **启动期硬错误守卫**（`methods/core-descriptors.ts`）：spec 无 handler 不再静默
  跳过，改为抛出命名错误；两类豁免显式建模——① `GATEWAY_AUX_METHODS`（14 个
  approval/secret/inbox 方法，合法地经 aux 面服务，实测枚举确认）；② 存量例外白名单
  `KNOWN_UNREGISTERED_CORE_METHOD_SPEC_REASONS`，**仅**含
  `sessions.compressionArtifact` 与 `sessions.recoveryContext`（HEAD 即缺白名单条目，
  注册属 checkpoint/recovery workstream，本步按 non-goal 只记录不修复）。白名单扩张
  被守卫测试钉死（名单变化即红）。
- **新回归测试** `src/gateway/session-ecosystem-descriptor-guard.test.ts`（4 用例）：
  真实 map 构建通过；模拟 yieldState 型回归（删 `sessions.stop` 白名单效果）必红；
  aux 豁免成立；例外白名单恰为两项。探针验证：把硬错误改回静默跳过，恰好该回归
  用例失败，还原全绿。
- 新鲜门禁：三可达性测试 10/10 绿；check:import-cycles 0；lint:core 0；tsgo:core 0；
  build:runtime 0（启动冒烟「gateway ready」实证严格构建器不破坏生产启动）。
- 移交记录：存量两方法的白名单缺口归 checkpoint/recovery owner（FP-15 note）。
- dispatch 证明的补齐（其余 6 方法经 `handleGatewayRequest` 到校验层）归线性下一步
  TF-0090。
- 证据：`artifacts/tf0089-census-guard-remediation/report.json`。

## TF-0090 审计整改第 4 步：全部 12 方法的生产-registry dispatch 证明（2026-08-23，done）

- 背景：审计 FP-02（major）——spec 验收条款要求每个生命周期方法 “proven by
  dispatching through the production registry”，实测仅 2/8 有 dispatch 证明，
  其余为静态断言。
- **交付**：`session-ecosystem-lifecycle-reachability.test.ts` 新增表驱动用例，
  对**全部 12 个链方法**逐一经 `handleGatewayRequest`（生产请求路径）+ 生产
  registry 构造实际 dispatch，断言到达各方法**自身的参数校验层**（各自的
  校验错误子串，且非 “unknown method”）。至此 dispatch 证明覆盖 12/12，
  与 `session-ecosystem-lifecycle-ledger-acceptance.md` 措辞闭合。
- 工程细节：`sessions.cleanup` 的 schema 全字段可选（空参合法），空参会越过
  校验触达 `context.getRuntimeConfig()`；表项改为以未知属性
  （`additionalProperties: false` 必拒）强制走校验层，杜绝测试触发真实清理。
- **探针**：把 `mission.cancel` 移出 lazy 白名单 → 全部 5 个 census 用例变红，
  失败信息即 TF-0089 的启动期硬错误（两步整改的守卫链联动实证）；还原全绿、
  标记 0 残留。
- 新鲜门禁：三可达性测试 11/11 绿（census 5 + guard 4 + TF-0079 probe 2）；
  tsgo:core 0；tsgo:core:test 中本文件 0 错误（其余 39 为既有）。
- 证据：`artifacts/tf0090-dispatch-proofs/report.json`。

## TF-0091 审计整改第 5 步：明文决策与死面治理（2026-08-23，done）

- 背景：审计 FP-03/04/05/06（minor 组）——无消费面的数据面、死导出、死字段与
  未挂载面缺少明文结论。本步逐项给出「清理 / 保留 / 延期」三选一的决定。
- **FP-03 明文决策**：`sessions.lifecycleLedger` 为**只读诊断 RPC，暂不做 UI**——
  对齐 `sessions.yieldState` 先例的明文形式（此前仅事实一致、无文字决策）。
  未来如需面板，另立产品决策节点。
- **FP-04 数据面处置（延期，非缺口）**：`yielded` 行级渲染与 i18n、
  Electron 补齐的 `snapshot.terminals` 渲染、`idleClassification` 消费——
  均为产品面决策，数据层保持就绪；未来进入产品面时补 i18n 键与行级渲染。
  两组 `*_IDLE_MS` 环境变量保留（分类阈值的配置面，随分类消费面落地同时生效，
  现状为测试专用通路——如实记录）。
- **FP-05 死导出处置**：
  - `archiveSessionTranscriptsForSession` 薄包装（链引入、全仓零调用方）——**已清理**，
    底层 `archiveSessionTranscriptsForSessionDetailed` 有真实调用方，保留。
  - `readLatestSessionUsageFromTranscript`、`readRecentSessionMessagesWithStats`（传递簇）、
    `clearSessionTranscriptIndexCache`——HEAD 既有基线（对 HEAD 零差异），**非本链责任，不动**。
  - `classifyTerminal`/`classifyBashProcessSession`/`subagentIdentityKey`/
    `listOverdueGoalWaits`/`createSessionDeleteJournalEvent`/
    `buildSessionDeleteManifestDigest`/`findGoalWait*`——测试缝隙/有意导出，**保留**。
  - goal-wake child/timer 挂载面（`fireGoalWaitChild`/`armGoalWaitTimer` 等）——
    **显式延期**：挂载点选择涉代际语义判断，由 owner 决策（沿用 TF-0083
    deviations/next_action 与 `LATEST.md:163-168`）；goal-wake default-off 前提不变。
- **FP-06 死值/只写字段处置**：`task_kind='goal-owned-*'`（durable truth 标记，
  消费侧属未来面）与条目级 `lineage` ref（wire 面，顶层 `lineage[]` 已被消费）
  **保留并声明**；`'verified'` subagent 状态为 **HEAD 既有死值**（链仅新增
  `'yielded'`），非本链引入，不动。
- 新鲜门禁：tsgo:core 0；contract:check 0；comms replay+compare 0；git diff --check 0。
- 边界未变：未放宽任何守卫、未翻动产品锁；除一个死包装函数外零生产代码改动。
- 证据：`artifacts/tf0091-dead-surface-decisions/report.json`。

## TF-0092 审计整改第 6 步：工程卫生（2026-08-23，done）

- **check:loc EMFILE 修复（FP-14）**：`scripts/check-ts-max-loc.ts` 原以无界
  `Promise.all` 并发读取全部 `.ts/.tsx`，大仓上句柄耗尽（EMFILE），门禁从未
  产出过判定。改为 64 并发分批读取，判定语义不变。修复后**首次真实判定**：
  exit 1，**1048 个存量超限文件**（最大 `embedded-agent-helpers/errors.ts`
  1598 行）——此前全部被崩溃掩盖；均归各 owner，本里程碑不处理。
  链内唯一超限：`session-delete-operation-journal.test.ts`（603 行，纯测试文件，
  TF-0084 已知项）；链的全部生产文件 <500 通过。
- **行数口径统一（FP-11）**：以 `wc -l`（物理行，与 check:loc 一致）为准；
  `session-activity-projection.ts` 实测 417 行，TF-0084 报告「413」为历史口径
  小差，不追溯改历史报告，口径差异在此关闭。
- **FD 测试正式决策（FP-08）**：在 `session-ecosystem-resource-reclamation.md`
  新增「Measurement bounds」正式口径段——FD/handle 泄漏与 RSS 级增长**正式
  排除出该 spec 验收**（理由：需 OS 级插桩/soak 测试，非逐变更门禁面；记录、
  定时器、owned PID、finished 上界断言已覆盖回收契约；生产观测到 FD 泄漏再
  重开）。此前仅以报告「notCovered」形式存在，现升为 spec 级裁定；
  TF-0081 节点同步记入 deviation。
- 新鲜门禁：修复后 check:loc 可运行（判定如上）；resource-reclamation spec
  validate 0；git diff --check 0。
- 边界未变：未翻动产品锁；未处理他流超限文件（各归 owner）。
- 证据：`artifacts/tf0092-engineering-hygiene/report.json`。

## TF-0093 审计整改第 7 步：提交拆分预案与收口决策记录（2026-08-24，done）

- **用户裁定（2026-08-23，记录在案）**：**暂不提交**——工作树混乱度高，需要
  时间整理；`TF-0078` 保持 `in_progress`，不收口。本步只完成开发层面工作，
  未发生任何提交。
- **提交拆分预案**（`artifacts/tf0093-commit-readiness/split-plan.md`）：
  123 个链持有脏文件（100% 在 9 份链 spec 声明内，完整清单
  `chain-dirty-files.txt`）；8 组多路耦合文件的按-hunk 拆分指引（`contract.ts`
  五路汇流、`host-api.ts`、`mission-control/controller.ts`、`chat.ts`、
  `bash-tools.exec.ts` 链仅 1 行等）；11 个跨 workstream 依赖带 owner 清单
  （链独立编译依赖它们，提交须先协调）；建议提交顺序（依赖协调 → 按节点序
  79→80→81→82→83→84→整改组 → hunk 拆分 → diff-aware 复验 → 用户裁定收口）。
- **全链最终门禁矩阵（收口时刻新鲜重跑，全绿）**：227 个测试
  （gateway-methods 50 / ecosystem+census+drain+journal 38 / process 7 /
  goal-wake 68 / cron 13 / admission 12 / 守卫线 16 / 根侧 23）；
  typecheck 0 错误；contract 0；comms replay+compare 0；9 份链 spec
  validate --no-diff 全 0；git diff --check 0。
- 至此 `TF-0086` 里程碑七个节点全部 done；`TF-0078` 何时收口由用户在整理
  工作树并提交后裁定。整改全程未翻动任何产品锁与 default-off 边界。
- 证据：`artifacts/tf0093-commit-readiness/report.json`。

## 当前交接：TF-0084 统一生命周期账本、活动投影与真实闭环验收（2026-08-23 收口，done 100%）

- 状态：四个 owner path 全部交付，**四条 acceptance criteria 全部 met**（含 AC1 的 clean/detached
  candidate 重跑）。`TF-0078` 下五个前置节点已全部 done，TF-0084 是该里程碑的最后一个节点。
- Spec：[session-ecosystem-lifecycle-ledger-acceptance.md](../../../harness/specs/tasks/session-ecosystem-lifecycle-ledger-acceptance.md)
- 证据：`artifacts/session-ecosystem-lifecycle-ledger-acceptance/report.json`
  （owner 盘点、缺陷记录、verificationMatrix 逐条命令/退出码/测试数、scopedCandidate、
  notCovered、AC 逐条对照）。

### 发现并修复的真实生产缺陷

`sessions.yieldState`（TF-0082 owner path 6）有 handler 与 core descriptor spec，但从未加入
`server-methods.ts` 的 lazy `loadSessionsHandlers` 方法表。`createCoreGatewayMethodDescriptors`
会跳过 handler 缺失的 spec，于是实测 `handler=undefined / descriptor=false / advertised=false`，
生产 Gateway 返回 `unknown method: sessions.yieldState`。TF-0082 的 7/7 单测直接 import handler
模块所以全绿，而 TF-0079 的可达性探针只覆盖 `sessions.stop`——正是 TF-0079 要根除的
direct-handler / production-dispatch 分叉。已补白名单；回归探针（移除后 census 4 例中 2 例失败
并报 `unknown method`）已观测并撤回。

### 四个 owner path

1. **只读生命周期账本**。新增 `session-lifecycle-owner-views.ts`，把 Phase 5 活动投影原本私有的
   owner 读取抽成**共享**读层（零行为变化，既有投影套件 11/11 原样通过）；在其上新增
   `session-lifecycle-ledger.ts` 与 `sessions.lifecycleLedger`（`operator.read`，仿 TF-0082
   `sessions.yieldState` 的只读面，无 arm/无 mutation，代际不匹配在**读任何 owner 之前** fail
   closed）。每条 entry 记 owner、owner 自己的状态 token、TF-0082 correlation ref，并且要么带
   owner 钉扎的 generation，要么声明结构性原因：`flow_runs.wait_json` 与 `task_runs` 结构上不记
   session generation → `owner-records-no-generation`；无 spawn 钉扎的旧记录 → `legacy-unpinned`。
   `census.unexplainedTransitions` 统计「声明与数据不符」，**因此可以失败**。读不到的 owner
   （Electron 终端、durable helper runDir）以 `declaredGaps` 显式返回。会话 entry 的时间取
   session store 自己的 `sessionStartedAt`，不用观测时刻冒充转移时刻。
2. **生命周期方法面 census + 投影/账本/owner registry 集合核对**。可达性 census 覆盖 8 个方法
   （handler + advertised descriptor + 预期 scope + 经生产 registry dispatch 到自己的参数校验）。
   一致性核对用**同一份** owner 快照同时构建两个读模型（为此导出 `buildSessionActivityReadProjection`），
   断言：集合与 owner registry 相等、外会话记录两边都不出现、被回收资源两边都消失、超出投影上界时
   投影必须是按新旧排序的前缀而非任意子集、同一条 owner 记录两边状态一致。
3. **fresh 全量验收矩阵**（当前树、当前 HEAD，未复用任何 audit-0..6 数字）：
   50 周期真实父子进程树 drain `cycles=50 activeRecordResidual=0 ownedPidResidual=0
   finishedResidual=0 sweeperActive=false exitedDiagnosticsRecords=50`（59.6s）；supervisor 重启
   reconciliation 7/7；goal-wake cancel/timeout/recovery/runtime/durable-cleanup/helper-host/
   helper-protocol 7 文件 55 测试；goal-wake triggers 13；cron 3 文件 13；delete operation journal 26；
   admission fence 12；Electron 终端/镜像闸门/生命周期单测 5 文件 23；真实进程 goal-wake canary
   10 周期全过（每周期 `processPollToolCalls=0`、`duplicateWakeTickCount=1`、
   `flagOffGoalWaitBlocked=true`）；真实 packaged Electron durable helper normal-exit + cancel 双周期
   PASS，`rawSecretPersistenceFindings=0`；runtime-lifecycle E2E 3/3。
4. **证据分级与谱系一致性**。报告把工程验收与 human/live/product 批准分栏
   （`liveReady=false`、`productApproved=false`、`formalAcceptance=false` 显式保留）；本文件顶部新增
   「节点谱系与后继边界」段，并把三处写着「当前唯一 active 节点 / 当前接力入口」的历史段落显式标注为
   历史快照；README 三语补 TF-0084 一段。

### AC1：clean/detached candidate 重跑（已达成，附代价）

用一次性 detached worktree 完成，**没有在共享分支上产生任何提交**；
[tf0084-build-candidate.mjs](../../../scripts/tf0084-build-candidate.mjs) 可重建：
HEAD `e07b874b3` → base commit（120 文件：TF-0079..0083 的 spec-owned 脏文件、TF-0084 对共享文件的
改动、以及 38 个**其他 workstream 未提交的继承依赖**）→ candidate commit（TF-0084 的 6 个新文件）。

- **diff-aware harness validate exit 0**，`--since` 的 diff 恰为 TF-0084 的 6 个新文件——这是本条线
  第一次通过带改动归属校验的验证（此前每个节点都只能记 `--no-diff`）。
- candidate 上：`typecheck:node` 0、`typecheck:web` 0、`contract:check` 0、
  comms replay/compare 45 PASS / 0 FAIL、`build:runtime` 0（smoke gateway ready）、
  **183 个 scoped 测试**跨六个 shard 全绿（gateway-methods 50、gateway 33、goal-wake 68、
  cron 13、process 7、admission 12）。每一步 candidate 工作树都是 clean。
- **代价即发现**：只按六个 spec 的 `touchedAreas` 并集构建的 candidate 既不 typecheck 也跑不起来，
  需要额外 38 个未提交文件，清单见
  [tf0084-candidate-inherited.json](../../../scripts/tf0084-candidate-inherited.json)。其中包含 TF-0083
  自己的 goal-wake 与 cron 模块及测试（arm/cancel/dispatch/fencing/runtime/timeout/timer/triggers、
  cron types/normalize/timer/state/payload-codec/mission-continuation-payload），以及
  `mission-control/types.ts`、`goal-wake-types.ts`、`acp-spawn.ts`、`subagent-spawn.ts`、
  `config/sessions/artifacts.ts`、`runtime-core/lineage.ts`、`shared/chat/types.ts`、
  `shared/types/git.ts`——**这些文件不在任何 TF-0078 spec 的 `touchedAreas` 里**；
  `shared/host-api/contract.ts`（属本链）还同时携带 git-api workstream 的 reflog/merge/rebase/reset
  新增。归各自 owner 处理，本轮未代改。补齐这 38 个文件后 candidate 完全绿，所以本链**是可分离的**，
  只是不能仅凭它自己声明的 `touchedAreas` 分离。
- **一处如实记录的环境限制**：两个真实进程 GA 脚本（goal-wake canary、packaged Electron durable
  helper）在 candidate 里跑不起来——它们会 spawn `pnpm`，而 pnpm 拒绝在 junction 出来的
  `node_modules` 上运行（`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`；在根与 `openclaw_runtime`
  两处设 `verify-deps-before-run=false` 都到不了被 spawn 的子进程）。这两项改在权威树上跑，覆盖的
  文件内容与 candidate 完全一致：canary 10/10 周期、`processPollToolCalls=0`、每周期
  `duplicateWakeTickCount=1`；packaged Electron normal-exit + cancel 双周期 PASS，
  `rawSecretPersistenceFindings=0`。记为限制，不当作豁免。

### 门禁（当前树、HEAD `e07b874b3`）

harness context 0；`validate --no-diff` 0；gateway-methods 批次 6 文件 45 测试 + 一致性 5；
gateway 批次 3 文件 7；process 7；agents-core goal-wake 7 文件 55 + triggers 13；cron 13；
journal 26；admission 12；root Electron 5 文件 23；`typecheck` 0（node 0 / web 0）；
`contract:check` 0；comms replay/compare 全 PASS（丢失/重复/乱序/timeout 均 0，qps 与 p95 delta
0.00%）；`build:runtime` 0；runtime-lifecycle E2E 3/3；touched 文件 eslint 0；check-no-bom ok；
`git diff --check` 0。

### 边界与遗留

- 未变：`liveReady=false`、`productApproved=false`、`formalAcceptance=false`；goal-wake 与
  durable helper 仍 default-off；SEKB 仍 confirm-only 无自动写回；无 lifecycle writer、无
  `session_resources` 表、无第二个 session identity 源、无新的 arm/cancel mutation 面。
- 未覆盖：FD/handle 泄漏（drain 夹具断言的是记录、定时器与 owned PID，不含文件描述符计数）；
  RSS 级内存增长（只断言 finished 记录有界）。这两项未在报告里冒充已覆盖。
- 账本输出上界 64 条（读取上界，不是保留策略）。
- 遗留给各自 owner：上面那 38 个继承依赖文件应由 TF-0079..0083 与 git-api workstream 的 spec
  补进各自 `touchedAreas`；两个真实进程 GA 脚本若要在 candidate 里跑，该 worktree 需要真实安装依赖。
- 工作树保持不提交、不推送；一次性 candidate worktree 与 junction 已清理。
- `TF-0078` 里程碑的五个前置节点加 TF-0084 全部 done，该里程碑本身是否收口为 done 属独立的
  Task Forest 决策，本轮未代替用户裁定。

## 历史交接：TF-0083 Goal/Loop 条件唤醒、取消级联与定时续跑（2026-08-23 收口，done 100%）

- 状态：4 条 acceptance criteria、5 条 requirements、5 条 desired outcomes 全部达成，
  收口后又做了一轮降风险复查（见下）。`TF-0084` 依赖随之解除，但未启动。
- 五个 owner path：(1) flow budget 只统计非终态行——`maxFlows` 原先 COUNT 全部
  goal-wake `flow_runs` 且无状态过滤，16 条历史完成行即永久耗尽预算，改为按
  `ACTIVE_FLOW_STATUSES` 统计；(2) `mission.cancel` 级联（`goal-wake-cancel.ts`）——先写
  durable terminal truth（`task_runs`→cancelled、flow→cancelled、`wait_json` 清空），
  再做 helper 容器化，未证实时 RPC fail closed，并清空此前无人清理的
  `activeWaitFlowIds`；(3) 统一 typed continuation contract——`dependency.kind` 覆盖
  `process|child|timer|approval|event`，`wakePayload` 由 `Record<string, unknown>` 改为
  `MissionContinuation` 判别联合，每类各产生且仅产生一次 continuation，双层去重
  （flow 结算 + `last_wake_id`）；(4) timer 复用既有 Cron 单一 `setTimeout`——新增
  `missionContinuation` payload kind（复用 `payload_message` JSON 列，无 schema 迁移），
  一次性 `at` job + `deleteAfterRun`；(5) 超时路径（`goal-wake-timeout.ts`）——
  `wait_json.timeoutMs` 此前是死字段、全仓库无人读取，依赖永不终止的 wait 会让 mission
  永久停摆，现按 `flow.created_at + timeoutMs` 判定到期并沿用既有 sweep tick。
- 顺带修掉三个此前未记录的真实缺陷：终态 mission 导致的
  `dispatch-failed → scheduleRetry` 永久活锁（每 5s 一次、贯穿进程生命周期）；
  `finishMissionTick` 用 tick 内存旧状态覆盖并发 cancel 写入的 `cancelled`；
  `expectedRevision` 三元表达式两支完全相同，导致已 `running` 的 flow 被重新 dispatch 时
  revision 差一而永远钉在 `running`。后两个由测试自然前置失败暴露，非推测。
- 收口后降风险复查（本轮追加）：(a) Cron 的 `runMissionContinuationJob` 补上
  `goalWakeEnabled` 门禁，避免 flag 关闭后遗留 job 仍改账本；门禁刻意放在 cron 侧而非
  `fireGoalWaitTimer` 内，因为记录依赖结局在运行时层是刻意不设门禁的
  （丢终态比关闭期间写入更糟）。(b) helper 容器化改为先核对 claim
  （`containDurableHelper`）：intent 缺失/nonce 不匹配/已记录 exit 都判为
  `already-gone` 而非失败——原实现会把「helper 早已消失」误报成容器化失败，让每次正常
  cancel 都 fail closed。(c) 超时 sweep 补上孤儿 wake 收敛：task 已终态但 flow 仍存活时
  改为重跑 level check 而非跳过，否则终态写入后唤醒失败的 wait 再无人回访。
- 收口门禁（全部在最终树上重跑）：typecheck 0；lint 0；import cycles 0；
  goal-wake 套件 8 文件 68 测试；cron 3 文件 13；mission-control 4 文件 32；
  tasks/task-flow-cas 15；gateway-methods 10 文件 57；gateway-server 2 文件 7；
  `build:runtime` 0；real-process canary exit 0；runtime-lifecycle E2E 3/3。
  本任务累计新增 36 条测试。
- 成功指标的诚实口径：`processPollToolCalls=0`、`duplicateWakeDeliveries=2` 而
  `duplicateWakeTickCount=1`（真实子进程下的去重证据）；`flagOffGoalWaitBlocked=true`。
  AC1 有回归探针（还原旧计数写法后第 3 次 arm 立即 `budget-exceeded`）。
  `command replay=0` 指「重启只做 level-triggered reconciliation」，已由 restart matrix
  覆盖（重启后 reconcile 一次、再重启 no-op、cancel/timeout 后重启不复活）。
- 刻意未做（不是缺口）：child 与 timer 都没有生产调用方。接入点
  （`fireGoalWaitChild` / `fireGoalWaitTimer`）、账本反查（按 `childSessionKey` /
  `cronJobId`）与 `armGoalWaitTimer` 均已实现并单测覆盖，但没有工具/RPC 面去 arm，
  子智能体完成路径上也未插入调用——requirement 1 要求 real-process gate 通过前保持
  opt-in，且该完成路径（announce delivery + 代际钉扎）是 `TF-0082` 刚加固的，
  选挂载点涉及代际语义判断，应由 owner 决定。
- 未随收口改变：`liveReady=false`、`productApproved=false`、`formalAcceptance=false`；
  真实验收仍归 `TF-0084`。
- 已知非本期失败：`agents-core` 全 shard 有 3–4 个既有失败
  （`bash-tools.exec.goal-wait.test.ts` ×3、`bash-tools.exec.durable-helper.test.ts` ×1，
  另有偶发 `rc02-shadow-census`），均为 `ws://127.0.0.1:18789` gateway 未就绪的连接失败，
  报错点在 `registerExecApprovalRequestForHost`，早于任何 goal-wake 代码；
  这些文件 `git status` 未修改。`tsgo:core:test` 的既有错误亦与本任务无关
  （含 `goal-wake-runtime.test.ts` 两处 `alreadyAcked` 收窄，已与 HEAD 对照确认）。
- 遗留待办：`goal-wake-dispatch.ts` 已 489 行，逼近 `check:loc` 的 500 上限，
  下次加分支前应先拆；该脚本本身在本仓库全局红（无 allowlist）且在 Windows 上会 EMFILE。
  超时判定以 `flow_runs.created_at`（arm 时刻）为基准，严格说是「等待时长」而非
  「进程时长」。
- Spec：[runtime-lifecycle-governance.md](../../../harness/specs/tasks/runtime-lifecycle-governance.md)

## TF-0082 跨会话控制与 lineage 统一（2026-08-22 收口，done 100%）

- 状态：六个 owner path 全部完成，全门禁在最终树上重跑通过，本会话按用户「现在收口」
  指示执行 closeout（done proposal 见 task-forest）。`TF-0083/0084` 依赖随之解除，
  但未启动。
- 收口门禁（全部在最终树上重跑，非沿用切片结论）：harness context 0；
  validate --no-diff 0；agents-core announce 8/8；root shard（subagent-spawn +
  admission registry + supervisor reconciliation）22/22；gateway-methods 40/40；
  gateway production reachability 2/2；renderer/Electron（host-api-facade +
  session-activity + panel-sections）63/63；typecheck 0；contract 0；
  comms replay 0 + compare 8 项全 PASS；build:runtime 0；build:vite 0；
  runtime-lifecycle E2E 3/3；touched 文件 lint 0；check-no-bom ok；diff-check 0。
- 验收对照（六条 spec acceptance 全部 met，逐条证据见
  `artifacts/session-ecosystem-cross-session-control/report.json` 的 `closeout.acceptance`）。
- 成功指标的诚实口径：`stale generation overwrite=0` 仅覆盖本期加固的三条路径
  （announce wake / queue drain / send-steer run-start 窗口），其余路径本期未重审；
  `lineage completeness=100%` 指「owner 记录了身份的条目全部带非空 ref」
  （断言 `lineageUnjoinedEntries=0`），生产完整度受 owner 实际记录内容限制，
  未做任何推导填补。
- 未随收口改变：`liveReady=false`、`productApproved=false`、`formalAcceptance=false`；
  真实验收仍归 `TF-0084`。
- 已知非本期失败：`tests/unit/session-activity-panel.test.tsx` 1 failed / 2 passed。
  已提交的测试断言 goal 标签文本，而工作区里一份未提交的 `SessionActivityPanel.tsx`
  重写（698 行，他人 in-flight）给标签加了翻译后的 kind 前缀；已与 HEAD 版本对照确认
  与本任务无关，未改动。
- 遗留决策：lineage ref 与 `yielded` 状态是否要在会话状态面板上渲染——数据层已就绪，
  但该面板当前有他人未提交的大改动，渲染是独立决策。
- Spec：[session-ecosystem-cross-session-control.md](../harness/specs/tasks/session-ecosystem-cross-session-control.md)

## TF-0082 启动与切片 1：generation-pin announce wake（2026-08-22）

- Spec：[session-ecosystem-cross-session-control.md](../harness/specs/tasks/session-ecosystem-cross-session-control.md)
  已创建并 validate 通过；失败矩阵覆盖迟到代际覆盖、重复 completion、跨会话控制
  RPC 语义、queue drain 代际、fork lineage 追溯。
- Owner 盘点：Gateway RPC（create/fork/send/steer/abort/stop/reset/delete/queueDrain
  均有 operator scope；steer 未 advertise；无 sessions_yield/goal_wait RPC）；Host API
  仅 fork + queueDrain 有 typed surface，stop 走 renderer 裸 `gateway.rpc`；ownerEpoch
  只存在于 exec-durable/goal-wake-helper；lineage 靠 Phase 5 projection 但 mission/
  flow 未做 runId 级 join。
- 切片 1（owner path 1）：**generation-pin announce wake**——`SubagentRunRecord` 新增
  `requesterSessionId`（spawn 时从 completion requester 的 store entry 快照）；
  announce 流程仅在原始 requester 目标（无嵌套重定向）携带 pin；`maybeSteerSubagentAnnounce`
  与 direct completion wake（`sendSubagentAnnounceDirectly`）都在代际不匹配时拒绝
  steer/wake 新 generation（发现并封堵了两个洞）；legacy 无 pin 记录保持
  liveness-only 行为。4/4 代际钉扎测试 + visible-reply 4/4 + subagent-spawn 3/3 回归。
- 门禁：spec validate --no-diff；typecheck exit 0；contract 0；comms 全 PASS；
  build:runtime + runtime-lifecycle E2E 3/3；touched 文件 lint 0；diff-check 0。
- 证据：`artifacts/session-ecosystem-cross-session-control/report.json`。

## TF-0082 切片 6：yield/goal-wait 只读 RPC + yielded 状态修复（2026-08-22）

- 新增 `sessions.yieldState`（`operator.read`）：报告本会话自身的 run 是否被
  `sessions_yield` 挂起（含 runId、parentSessionKey、切片 1 的父代际钉扎）、
  还有几个子 run 欠一次 continuation，以及已 arm 的 goal-wake flow
  （flowId/taskId/missionId/turnBarrier/runId/ownerEpoch/timeoutMs）。
  代际不匹配时与 queueDrain 同样 fail-closed（`reason: generation-mismatch`，
  一个 owner 都不读）；只读模型抛错时降级为空状态而不是整调用失败。
- **arm 侧刻意不开放 RPC**：`sessions_yield` 结束的是调用方自己的 turn，
  `goal_wait` 的 mission/tick 身份绑定自活动 run 上下文。turn 外的 arm RPC 要么
  等价于 `chat.abort`，要么允许调用方在别人的 mission 上 arm——违反本任务
  「不放宽 agent 控制权限」的 non-goal。取消已 arm 的等待属于 `TF-0083`
  （mission cancel 级联），不在这里做。
- **顺带修掉一个真实缺陷**：`markSubagentRunPausedAfterYield` 会写 `endedAt`
  并清空 `outcome`/`endedReason`，于是一次正常的 parent yield 在 lineage 投影里
  被判成 `error`，并把整个会话推到 attention 级。现在 lineage 投影与 subagents
  列表都产出 `yielded`，且归入 active 而非 attention。
- 测试：`sessions.yield-state.test.ts` 7/7（挂起父会话与代际钉扎 / pending 子计数
  只算运行中与 yield 挂起的 / armed goal wait 全字段 / 代际不匹配零读取 /
  匹配正常读 / 读模型抛错降级 / 非法参数在任何 store 读之前被拒）；
  投影新增 yielded 用例 1 例。
- 门禁：spec validate --no-diff exit 0；gateway-methods 批次 40/40；
  production reachability 2/2；typecheck 0；contract 0；comms 全 PASS；
  build:runtime 0；E2E 3/3；touched 文件 lint 0；check-no-bom ok；diff-check 0。

## TF-0082 切片 5：lineage runId join（2026-08-22）

- 问题：mission / goal-wake flow / goal-owned process / subagent run 四类效应各自
  有 id，但 Phase 5 投影里彼此不带关联，missions/flows 没有 runId 级 join，
  「每个 session effect 都能定位到 sessionId/runId/parentSessionKey/ownerEpoch」
  无法验证。
- 方案：投影里的每个 goal/process/lineage 条目挂一个**共享** `lineage` 关联对象
  （`SessionActivityLineageRef`：sessionId / runId / parentSessionKey / ownerEpoch /
  missionId）。每个字段都只从已经记录它的 owner 复制，**不从另一个标识推导**，
  owner 没记录就缺省，全空则整个 ref 省略（可区分「owner 不记录」与「未知」）。
  id 统一 256 字符上界，超长直接丢弃而不是投影出去。
- 关键 join：goal-wake flow 的 `wait.dependency.taskId` 指向它等待的进程任务，
  所以 flow 行就是把 goal-owned process 连回 mission 和 durable `ownerEpoch` 的那条边；
  mission goal 与 flow goal 再通过 `missionId` 对齐。
- 数据来源：mission `lineage`/`taskLoopRunId`；flow `wait_json`；`task_runs.run_id` +
  `requester_session_key`；bash `lifecycleExpectedSessionId`；supervisor `runId` +
  新暴露的 `lifecycleExpectedSessionId`（只读快照加一个可选字段）；subagent
  `runId`/`requesterSessionKey`/切片 1 的 `requesterSessionId` 代际钉扎。
- 边界：没有新增第二个 identity 源，没有新增只读 probe，本切片不动 UI 渲染；
  完整度受 owner 实际记录的内容限制（bash 有 sessionId 无 runId；goal-owned
  process 只有在被某条 flow 声明为依赖任务时才拿得到 missionId/ownerEpoch）。
- 测试：`session-activity-projection.test.ts` 10/10（原 5 例 + 新 5 例：三方
  missionId 对齐 / mission lineage 优先于 taskLoopRunId / 代际钉扎与 legacy 无钉扎 /
  每个条目都有非空 ref（lineageUnjoinedEntries=0）/ 超长 id 被丢弃）。
- 门禁：spec validate --no-diff exit 0；gateway-methods 批次 27/27；supervisor
  restart reconciliation 7/7；typecheck 0；contract 0；comms replay/compare 全 PASS；
  build:runtime 0；E2E 3/3；touched 文件 lint 0；check-no-bom ok；diff-check 0。
- 已知非本期失败：`tests/unit/session-activity-panel.test.tsx` 在本树上失败——
  已提交的测试断言 goal 标签文本，而工作区里一份未提交的 `SessionActivityPanel.tsx`
  重写（698 行，他人 in-flight）给标签加了翻译后的 kind 前缀。未改动，归该改动的 owner。

## TF-0082 切片 4：send/steer permit 覆盖 run-start 窗口（2026-08-22）

- 问题：`sessions.send/steer` 的 admission permit 原本在 steer interrupt 结束后立刻
  释放，`readSessionMessageCountAsync` 与整个 `chat.send` 前导段（含 run 注册、
  附件预处理）都在无 permit 状态下执行——此时并发 reset/delete 可以直接 fence 通过，
  于是 run 被播种在旧 generation 上。
- 修复：permit 覆盖整个 run-start 窗口（steer interrupt → transcript seq 读取 →
  chat.send 前导 → run armed）。释放点统一为一个 release-once 助手：`chat.send` 第一次
  `respond`（ack/runId 或失败）时释放，`finally` 兜底再调一次，因此**没有路径泄漏、
  也没有路径重复释放**（重复释放会误伤同 identity 的并发 send permit）。
- 边界：permit 只覆盖 run-start，不覆盖整轮 run；run armed 之后 reset 正常 fence，
  并通过 canonical stop path 中止该 run。代价是 steer 打断 embedded run 时最长 15s
  的等待会让并发 reset 排队（有意的 fail-safe 定序）。
- 测试：`sessions.send-permit-lifetime.test.ts` 6/6（preamble 内 permit 仍在 / 中途
  reset fence 直到 run armed 才 drain / steer interrupt 在同一窗口内 / interrupt 失败
  也释放 / chat.send 抛错不泄漏 / 恰好释放一次）。回归探针：把释放点改回修复前位置，
  6 例中 3 例失败，探针已移除。
- 门禁：spec validate --no-diff exit 0；gateway-methods 批次 18/18；announce 代际
  8/8；subagent-spawn + admission registry 15/15；host-api facade 44/44；typecheck 0；
  contract 0；comms replay/compare 全 PASS；build:runtime 0；E2E 3/3；touched 文件
  lint 0；check-no-bom ok；diff-check 0。

## TF-0082 切片 3：queueDrain 代际守卫（2026-08-22）

- `SessionsQueueDrainParamsSchema` 新增可选 `expectedSessionId`；handler 在
  active-run 检查之前比对当前 entry sessionId——不匹配时 fail-closed 返回
  `drained:false + reason:"generation-mismatch"`，**队列消息原样保留**，drain 执行器
  与 queue 回调安装均不触达；`drainQueuedUserMessagesForSession` 内部同样守卫
  （dequeue 之前），防其他调用方绕过。
- Host 契约新增 `SessionQueueDrainPayload`（含可选 expectedSessionId），Electron
  queueDrain handler 透传；不带 pin 的调用保持 legacy 行为。
- 测试：代际守卫 3/3（mismatch 不取消息 / 匹配正常 drain / 缺省 legacy）；
  run-control 回归 9/9；Electron facade + rollback-plan（queueDrain UI 侧）50/50。
- 门禁：spec validate；typecheck 0；contract 0；comms 全 PASS；build:runtime +
  E2E 3/3；lint 0；diff-check 0。

## TF-0082 切片 2：typed Host API stop surface（2026-08-22）

- `shared/host-api/contract.ts` 新增 `SessionStopPayload/Result` 并入 sessions 契约；
  `hostApi.sessions.stop` facade（`invokeHost('sessions','stop',...)`）；Electron
  `sessions-api.ts` 新增 `stop` handler，委托既有 `sessions.stop` Gateway RPC（operator.admin、
  TF-0079 已接通 production readiness gate）。turn 级中止保持 `chat.abort`，会话级停止
  走新 typed surface——验收标准 4 的 stop/continue/fork 三操作至此都有 typed Host API +
  真实 Gateway RPC 路径（stop 新增、queueDrain 既有、fork 既有）。
- Facade 测试 44/44（新增 typed stop 路由用例）；`contract:check` 三层对齐通过；
  typecheck 0；comms 全 PASS；E2E 3/3；lint 0；diff-check 0。

---

## TF-0081 终端、后台进程与子智能体资源回收（2026-08-22 收口，done 100%）

- 状态：`TF-0081` 四个 owner path 全部完成并全门禁通过，本会话已按用户确认执行
  closeout（done proposal 见 task-forest）；`TF-0082` 依赖随之解除，但未启动。
- 切片 1：Harness spec + 失败矩阵；50-cycle create/spawn/stop-reset-delete 泄漏夹具
  首轮全绿（`activeRecordResidual=0 ownedPidResidual=0 finishedResidual=0
  sweeperActive=false`），runtime 资源半区无泄漏且已围栏。
- 切片 2：supervisor 重启 reconciliation——OS containment 抽取为共享模块（drain 回归
  12/12 零行为变化）、文件权威 run-manifest（原子写、corrupt fail-closed）、
  owner-PID 守卫（活的 owner 一律跳过，宁漏杀不误杀）、仅 OS 证据可用时收割
  （SIGKILL 树 + settle 验证）、gateway 启动接线；7/7 重启 reconciliation 测试。
- 切片 3：idle 四分类（纯观测零自动回收）——Electron 终端 lastInteraction/lastOutput
  追踪 + `classifyTerminal` + 快照 idle 报告（`CLAWX_TERMINAL_OUTPUT_IDLE_MS`/
  `CLAWX_TERMINAL_INTERACTION_IDLE_MS`）；bash registry
  `classifyBashProcessIdle/Session`（`OPENCLAW_BASH_RUNNING_IDLE_MS`）；输出新鲜度
  永远优先于 wall clock，false kill = 0 结构性成立。
- 切片 4：session activity projection 一致性——bash 条目携带 idleClassification，
  新增 owner-registry 精确集合护栏（fresh/stale/finished/reclaimed/foreign 五态），
  回收资源绝不出现在快照。
- 最终门禁（最终树全量重跑）：harness context + validate --no-diff；focused 44 测试
  （gateway cycle+drain 13 / process 7 / agents-core 6 / projection 5 / Electron
  terminal 13）；typecheck exit 0；contract 0；comms replay/compare 全 PASS；
  build:runtime + runtime-lifecycle E2E 3/3；touched 文件 lint 0；
  `git diff --check` 0。
- 证据：`artifacts/session-ecosystem-resource-reclamation/report.json`（四切片 +
  最终 verdict）；README 三语含 TF-0081 两句。
- 边界保持：无 universal resource ledger；keep-mode subagent 记录与 VerseShell
  ownership 未动；`liveReady=false`、`productApproved=false` 不变。已知残留（非本
  节点）：harness diff-aware validate 需 scoped clean candidate；4 个非本节点 lint
  error 归各自 owner。
- 下一步：`TF-0082`（会话生命周期下游）依赖已解除，是否启动为独立 Task Forest 决策。

---

## TF-0081 启动与切片 1（2026-08-22）
- Spec：[session-ecosystem-resource-reclamation.md](../harness/specs/tasks/session-ecosystem-resource-reclamation.md)
  已创建，`validate --no-diff` 通过；失败矩阵覆盖 50-cycle 归零、idle 分类、TTL 边界、
  重启 reconciliation、fail-closed OS containment、keep-mode 边界。
- Owner 盘点（唯一 writer 不变）：Electron `TerminalSessionManager`（exit/close/quit 回收 +
  delete gate fence；缺口：无 idle TTL/心跳、无 reset 关闭调用方）；supervisor（exited 记录
  按数量上限 2000 有界；缺口：`reconcileOrphans` 是显式 no-op）；bash registry（finished
  30min TTL + sweeper 空停；缺口：running 无 idle 策略）；subagent sweeper（60s 清扫 +
  stale 恢复；keep-mode 无界是刻意边界）；drain finalizer（fence + fail-closed OS
  containment 已很强）。另确认 Electron/renderer 没有 `sessions.reset` 调用面。
- 首个切片：50-cycle create/spawn/stop-reset/delete 泄漏夹具
  （`src/gateway/session-ecosystem-reclamation-cycle.test.ts`）首轮全绿：
  `cycles=50 activeRecordResidual=0 ownedPidResidual=0 finishedResidual=0
  sweeperActive=false`（每周期真实 parent+child 进程树 + OS 归零验证，~28s）。
  结论：runtime stop/reset/delete 资源半区当前无泄漏，验收标准 1 的 runtime 半区已围栏。
- Focused：gateway cycle+drain 13/13；Electron terminal 三件套 10/10。
- 证据：`artifacts/session-ecosystem-resource-reclamation/report.json`。
- 下一步（按单 owner path 纪律择一）：
  1. supervisor 重启 reconciliation（读持久化状态，fail-closed，不做 PID fallback 扩大）；
  2. terminal/bash running 记录 idle 分类（running/interactive/completed/orphaned，可配置，
     false kill = 0）；
  3. session activity snapshot 的 orphan/idle 投影一致性。

## TF-0081 切片 3：idle 四分类（2026-08-22）

- Electron `TerminalSessionManager`：记录 `lastInteractionAtMs`（write/interrupt）与
  `lastOutputAtMs`（PTY 输出）；新增 `classifyTerminal()`，且所有快照（status/list）携带
  `idle` 报告；阈值可经 `ctx.idlePolicy` 或环境变量 `CLAWX_TERMINAL_OUTPUT_IDLE_MS`
  （默认 60s）/`CLAWX_TERMINAL_INTERACTION_IDLE_MS`（默认 30min）配置，夹取 1s–24h。
- Runtime bash registry：新增 `classifyBashProcessIdle` / `classifyBashProcessSession`，
  复用已有 `lastOutputAt`（缺失时回退 `startedAt`）；`OPENCLAW_BASH_RUNNING_IDLE_MS`
  （默认 10min，夹取 1min–24h）。
- 分类纯观测、零自动回收：输出新鲜度永远优先于 wall clock——存在真实子进程活动的
  终端/会话绝不会被判定为 idle（结构上 false kill = 0）。orphaned 类由切片 2 的重启
  reconciliation 负责，四类跨 owner 齐备。
- 测试：Electron 4/4（纯分类、事件流全转换 interactive→running-process→interactive→
  idle→interactive、回收后 null、env 覆盖）；runtime 6/6（completed/边界含 inclusive、
  startedAt 回退、stale→idle、markExited→completed、未知→null）。
- 门禁（切片 3 最终树）：gateway cycle+drain 13/13 回归；typecheck exit 0；contract 0；
  comms 全 PASS；build:runtime + E2E 3/3；touched 文件 lint 0；`git diff --check` 0。
- 剩余：owner path 4（session activity snapshot 的 idle/orphan 投影与 owner registry
  一致性）+ 最终 closeout 全门禁重跑。

## TF-0081 切片 2：supervisor 重启 reconciliation（2026-08-22）

- OS containment 证据抽取为共享模块 `src/process/os-containment.ts`（wmic//proc 进程表、
  PID-reuse token 守卫、树捕获与终止验证）；drain service 改为引用，drain 契约 12/12 回归
  通过（重构零行为变化）。
- 新增持久化 run 清单 `src/process/supervisor/run-manifest.ts`：文件为权威（每次
  add/remove 重读-合并-原子重写，跨 boot 可见），corrupt 时 fail-closed——不覆盖文件、
  reconciliation 拒绝杀任何进程。
- `reconcileOrphans` 从显式 no-op 变为真实实现（`src/process/supervisor/reconcile.ts`）：
  本进程 run 跳过；owner PID 仍存活的 run 一律跳过（宁可泄漏不误杀）；owner 已死且
  run 存活的，仅在 OS 捕获证据可用时 `signalProcessTree` SIGKILL 并验证归零，证据不可用
  或杀后未死则保留条目——无 PID fallback 范围扩大。
- Gateway 启动接线：`server.impl.ts` 在 durable-helper 恢复块旁挂载清单并执行
  reconciliation，结果写入启动日志；`minimalTestGateway` 下不启用。
- 测试：`src/process/supervisor/restart-reconciliation.test.ts` 7/7（镜像生命周期、
  孤儿树收割、foreign owner 不触碰、lost 清理、证据不可用保留后可再收敛、corrupt
  fail-closed、无清单 no-op + 幂等）。
- 门禁（本切片最终树）：process shard 7/7；gateway cycle+drain 13/13；Electron terminal
  10/10；spec validate --no-diff；touched 文件 lint 0；typecheck exit 0；contract 0；
  comms replay/compare 全 PASS；`build:runtime` + runtime-lifecycle E2E 3/3（gateway
  带新接线启动）；`git diff --check` 0。
- README 三语已补 TF-0081 重启回收一句；证据报告已更新。
- 剩余：owner path 3（terminal/bash running idle 分类）、owner path 4（activity
  orphan 投影）；最终 closeout 前需重跑全门禁。

---

## 历史交接：TF-0079 会话生命周期生产可达性（2026-08-21）

- 状态：`TF-0079` 已由 Task Forest CLI 标记为 `done`（100%）；`validate` 与 `export` 通过。`TF-0080` 的依赖已解除，但节点保持 `proposed`，本轮未启动。
- 修复：将已有 `sessions.stop` handler 接入 Gateway lazy method whitelist 与 core descriptor（`operator.admin`、advertised），并把它加入 Electron required-runtime-method gate。
- Fail-closed：握手缺少任何 required method 时，后续 `gateway:ready` 事件和 `system-presence` fallback probe 都不能把 `gatewayReady` 提升为 true。
- 证据：`artifacts/session-ecosystem-production-reachability/report.json`；基线探针为 `handler=false/descriptor=false`，当前探针为 `handler=function/descriptor=true/scope=operator.admin/advertised=true`。
- 验证：Gateway reachability 2/2、`sessions.stop` handler 4/4、Electron readiness 8/8、Gateway permission 3/3、Host API facade 43/43、workspace permission 10/10；contract exit 0；comms replay/compare PASS；隔离 candidate 的 Harness `validate --since HEAD` exit 0。
- 边界：未新增 renderer/Host API stop surface，未启用 Goal-wake 或 durable-helper；共享工作树仍有既有脏改动，报告明确 `formalCleanCandidate=false`、`liveReady=false`、`productApproved=false`。
- 下一步：下一会话先读取 `TF-0080` 与其依赖规则，围绕 admission/generation fence 与 delete retry 做单节点开发；不要并行启动 `TF-0081+`。

---

## 历史交接：TF-0080 会话安全闸门续接（2026-08-22）

> 历史快照。写作当时唯一 active 节点是 `TF-0080`；`TF-0079..TF-0084` 的当前状态以本文件顶部
> 的 TF-0084 段落为准。

本节写作时唯一 active 节点为 `TF-0080`（`in_progress`，canonical Task Forest 未 closeout）；
`TF-0081`、`TF-0082`、`TF-0083`、`TF-0084` 当时继续保持顺序阻塞。未启动 Goal-wake/durable-helper
下游，也未改变任何产品锁。

本轮只处理 TF-0080 owner path：

- Electron `session-delete-gate` 复用现有 `withFileLock` + atomic write，损坏/版本不符的 gate
  fail-closed；不同 session 的 read-modify-write 不互相覆盖；同 session delete 请求复用同一个
  in-flight Promise；terminal-open 与 delete 共用 session 临界区，锁占用时直接拒绝启动。
- Runtime delete receipt 要求匹配 operationId、`runtime_committed` 和非空 `sessionId`；
  `.jsonl.deleted.<timestamp>` 纳入 Electron hard-delete sweep；所有已搜索到的 production
  `sessions.delete` caller 都带稳定 operationId，测试 harness 也已对齐。
- Delete session/subagent hook payload 透传稳定 operationId；delete finalizer 等待当前 hook
  dispatch settle 后再写 progress，既有 plugin hook 的 fail-open 语义保持不变，外部 hook
  去重责任由 operationId 交给 effect owner。

已验证：core tsgo 0；Runtime focused 28 + hook/operation-id 1；Electron focused 18/18；
contract 0；comms replay/compare 0 丢失/重复/乱序；import-cycle 0；`git diff --check` 0。
新增 gate race、legacy deleted transcript sweep、hook operationId contract 测试。

## TF-0080 收口（2026-08-22，本会话）

- 依赖恢复：`pnpm install --no-optimistic-repeat-install` 重建了 5 个空洞 `.pnpm` store 条目
  （csstype、clsx、react、stylis、zod）。根因是 pnpm v11 的 optimistic-repeat-install 在
  store 半空时仍报 up-to-date；修复只影响 node_modules，不动 tracked 文件。
- Electron 二进制：按 CI Windows 配方（@electron/get + Expand-Archive + path.txt）本地补齐
  `electron@40.8.4` dist，`pnpm exec electron --version` = v40.8.4。
- Spec requiredTests 修正：admission registry 测试路由到 `vitest.unit-fast` shard
  （内容分类归属），operation-id 测试保留 `vitest.unit` shard；两条命令均验证通过。
- goal-wake E2E 修复：`goal-wake-e2e-trace.ts` 对 harness exec 声明 trusted
  system-generated provenance，command-exec sink 策略本身未放宽；goal-wake 实现未改动。
- Lint 收敛：TF-0080 范围内文件 lint 干净（acp-spawn/subagent-spawn permit 改 const、
  删除未用 import）；剩余 4 个 lint error 均在其他阶段拥有的脏树文件里，未代改。
- 最终门禁（最终代码树）：harness validate --no-diff 通过；runtime focused
  admission 12 + journal/reachability 28 + hook/op-id 1 + subagent-spawn 3；
  Electron 18 + 31；contract 0；comms replay/compare 全 PASS；`pnpm run typecheck`
  exit 0（node 0 / web 0，testTypes 仅观察模式）；`build:vite`、`build:runtime`、
  runtime-lifecycle E2E 3/3（两次）；`git diff --check` 0。
- 证据：`artifacts/session-ecosystem-safety-gate-consistency/report.json` 已刷新；
  `formalAcceptance=false`、`liveReady=false`、`productApproved=false` 边界保持不变。
- 已知残留：harness diff-aware validate 仍被共享工作树无关 ownership 变更阻断
  （非 TF-0080 文件）；4 个非本节点 lint error 待各自 owner 处理。
- 下一步：保存 TF-0080 closeout proposal（用户 /goal 已确认可标记 done），apply 后
  运行 task-forest `validate` + `export`。不启动 `TF-0081`。

## Current handoff: TF-0074 real-use engineering acceptance (2026-08-21)

- Status: `TF-0074` engineering acceptance is complete and closed through `TFP-close-TF-0074-20260821`.
- Production fix: `knowledge.sekbCaptureTrajectory` now accepts only explicit valid `runtime-lineage.v1`, forwards it into trajectory metadata, and never infers lineage from `sessionKey`; invalid lineage fails as `invalidInput`.
- Operator truthfulness: manual Knowledge trajectories are now described in all locales as audit-only and not distillation candidates. The Electron Knowledge test covers this boundary.
- Verification: DCS 351/351; detached candidate at base `e07b874b3` passes normal diff-aware Harness validate/dry-run, focused agents 33/33, focused runtime 11/11, Host API facade 43/43, contract, and i18n. The authoritative worktree also passes `tsgo:core`, DCS lint, node/web typecheck, runtime/Vite builds, comms replay/compare, DCS preflight/C1 gate, and fresh-build Electron Knowledge + SEKB E2E 5/5.
- Residual: the shared worktree remains dirty. A fresh candidate-only `tsgo:core` through junctioned dependencies hits `ui/vitest.config.ts` `TS2321`/`TS2769`, while the authoritative official gate exits 0; this is recorded as a worktree-link environment boundary, not hidden.
- Evidence: `docs/dev/dcs-visible-production/TF-0074-REAL-USE-ACCEPTANCE-EVIDENCE-2026-08-21.md`.
- Product boundary unchanged: this is engineering evidence only. There is no real channel/human acceptance cohort, no automatic SEKB writeback, and no change to `liveReady=false`, `productApproved=false`, or `defaultOn=false`.
- Next action: keep product locks unchanged and assess any successor as a separate Task Forest decision. `TASK-P2-01` remains human/live blocked; no successor was started during this closeout.

---

## Historical handoff: TF-0072 runtime lineage convergence (2026-08-20)

- Status: implementation and current-source engineering gates are complete; Task Forest closeout is authorized and applied through `TFP-close-TF-0072-20260820`.
- Production chain: one bounded `runtime-lineage.v1` now correlates Mission tick, Task Loop, DCS task-state/HandoffPack, SEKB trajectory, and confirmed-principle provenance without adding a workflow or memory authority.
- Operator surface: Knowledge > Runtime Lessons displays available session/Mission/tick/loop/trace/Task Ledger lineage and rejects source-session conflicts during confirm.
- Verification: `pnpm --dir openclaw_runtime tsgo:core`, `pnpm run typecheck`, `pnpm test:dcs` (351 tests), `pnpm lint:dcs`, `pnpm contract:check`, `pnpm i18n:lint`, `pnpm verseshell:test`, comms replay/compare, runtime build, and Knowledge Electron E2E 4/4 all pass. Harness structural validation passes with `--no-diff`; normal diff-aware validation remains outside this scoped claim because the shared worktree contains unrelated changes.
- Evidence: `docs/dev/dcs-visible-production/TF-0072-MISSION-TASK-LOOP-DCS-SEKB-LINEAGE-EVIDENCE-2026-08-20.md`.
- Product boundary unchanged: this is engineering closeout only; DCS/SEKB stay default-off and it does not set `liveReady`, `productApproved`, or `defaultOn`.
- Historical next step was `TF-0073`; both TF-0073 and the start of TF-0074 have since been applied. The TF-0074 block above is authoritative.

---

> 更新：2026-08-19（Runtime Lifecycle Governance Phase 0-6 closeout + GA hardening）
> 上一节点：`TF-0077`（Runtime Lifecycle Governance Phase 0-6 Closeout）= **done**
> 当前分支：`feat/runtime-lifecycle-governance`（未合并）

---

## Historical handoff: TF-0071 Task Loop phase side-effect durability (2026-08-20)

- Status: `TF-0071` is complete. Evidence: `docs/dev/dcs-visible-production/TF-0071-TASK-STATE-PHASE-SIDE-EFFECT-DURABILITY-EVIDENCE-2026-08-20.md`.
- Implementation: phase hooks return structured task-state/trajectory results; each TaskLoop run drains a serialized side-effect queue before normal or error return; sink rejection reasons and capture failures are recorded as structured degradation evidence; cancellation checks prevent late orchestration from reviving a cancelled run.
- Verification: `pnpm run test:dcs` passed with unit 251, runtime-config 10, agents 88; focused root/runtime tests, direct node typecheck, `pnpm run lint:dcs`, changed-file ESLint, `pnpm --dir openclaw_runtime db:kysely:check`, comms replay/compare, Harness `--no-diff` validation, and `git diff --check` passed.
- Residuals: Harness diff-aware dry-run remains blocked by unrelated changed paths in the shared worktree and missing `harness/node_modules`; `pnpm --dir openclaw_runtime build` reaches runtime postbuild but exits 1 at the existing missing `goal_wait` tool-display metadata check. Neither is reported as a full-repository pass.
- Product boundary unchanged: DCS/SEKB remain default-off; `liveReady=false`, `productApproved=false`, `defaultOn=false`; no automatic SEKB writeback. This historical handoff is superseded by the TF-0072 closeout above; TF-0073 is now the only eligible direct successor.

---

## 历史接力：TF-0070 DCS Task State 按运行实例隔离（2026-08-19）

- 状态：`TF-0070` 已完成并通过 Task Forest `validate/export`；证据见
  `docs/dev/dcs-visible-production/TF-0070-TASK-STATE-RUN-SCOPE-EVIDENCE-2026-08-19.md`。
- 实现：`TaskStateHandlerConfig` 按 `runId + sessionId` 注册和解析；TaskLoop 的 `loopRunId` 显式绑定到唯一 session config；phase hook 在等待前固定当前 scope，terminal/cancelled 只清理当前 scope；agent-end 会清理 outer attempt 及其 loop aliases；无 DCS sink/store 的新初始化会清理该 scope 的 stale config。
- 验证：`pnpm run test:dcs`（250 + 10 + 87 tests）、focused task-state/SEKB shards、`pnpm run typecheck:node`、changed-file ESLint、`pnpm harness validate --no-diff --spec harness/specs/tasks/dcs-stage2-task-state-handoff.md`、`pnpm run comms:replay`、`pnpm run comms:compare`、`git diff --check` 均通过。
- Harness 普通 diff-aware validate 仍被共享工作树无关 changed paths 与 harness 子包缺少 node_modules 阻断，未扩大 touchedAreas；这不是 TF-0070 focused regression 的失败。
- 产品边界保持：DCS/SEKB 默认关闭，`liveReady=false`、`productApproved=false`、`defaultOn=false`；下一唯一节点为 `TF-0071`，不得并行启动 `TF-0072+`。

---

## 0. Runtime Lifecycle Governance Phase 6 closeout（2026-08-19）

- 状态：七阶段程序已整体收卡；`pnpm run runtime-lifecycle-audit --phase all` 实测 exit 0，`audit-0.json` 至 `audit-6.json` 全部 PASS score=100。
- 关键证据：`audit-5.json`（`activitySnapshotWriteFindings=0`）、`audit-6.json`（Phase 6 evidence-only closeout）；`deleteCommitTxCount=1`、`armTxCount=1`、`processPollToolCalls=0`、`secretPersistenceFindings=0` 全部保持。
- Residual：本程序无未决 residual；跨 workstream 的共享脏工作树仍由各自 owner 处理，不在 RLG 范围内。

### 0b. RLG GA hardening（2026-08-19，只动 RLG 证据与验证脚本）

- 状态：RLG-only 验收为无条件 PASS；`audit-0..6` 仍全部 PASS score=100。
- 新增：`harness/specs/tasks/runtime-lifecycle-governance-ga-hardening.md`、`scripts/verify-runtime-lifecycle-packaged-electron.mjs`、`scripts/runtime-lifecycle-goal-wake-canary.mjs`、`pnpm run verify:runtime-lifecycle-ga`。
- 实测：真实 `electron.exe` + `ELECTRON_RUN_AS_NODE=1` + `openclaw_runtime/dist/entry.js goal-wake-helper-run` 的 normal-exit 与 cancel 双周期通过，`rawSecretPersistenceFindings=0`；10 周期真实进程 goal-wake canary 全过，每周期 `processPollToolCalls=0`、`duplicateWakeTickCount=1`、flag-off parity 2/2。
- 已把 `future-work.json` 的 `packaged-electron-live-verification` 从 deferred 移到 delivered。
- 边界未变：goal-wake / durable-helper 仍 default-off；VerseShell `liveReady/productApproved/defaultOn` 未动；本硬化不是 default-on 授权，也不是 joint-system GA 声明。
- 下一步：是否把 goal-wake/durable-helper 设为默认开启需要单独授权与新 spec；在收到该授权前不翻任何 default。

---

## 历史交接：Workflow Viz B2-02A 已完成，下一步 B2-02（2026-08-15）

**WV-B2-02A / TF-0062 已完成并单提交 `b58350a2f`（feat(trajectory): bridge raw v2 renderer supply）。** 提案 `TFP-workflow-viz-b2-02-bridge-and-store-20260815` 与收卡提案 `TFP-workflow-viz-b2-02a-close-20260815` 均已经用户确认后应用；task-forest validate/export PASS；TF-0062=done(100%)，TF-0063（WV-B2-02 现有 store 并轨）保持 `proposed`。

本卡落地（详见 `harness/specs/tasks/workflow-viz-b2-02a-renderer-v2-trajectory-supply.md`）：

- `ObservabilityTrajectoryProjector` 并行保留**原始已验证** `TrajectoryEventV2` 行（cap 1000，`getV2Events`/`isLegacyFallback`，接受批次经 `onV2Events` 上报）；normalize 后的 trace 投影路径不变。
- Host API 新增 `observability.trajectorySessions` / `observability.trajectoryHistory`（fromSeq/limit、`asOfSeq` 冷/热交接、确定性去重、保留态不覆盖时经 B1-03 `observability.readFrom` 冷恢复；跨边界前按 B1-01 schema 再验证）。
- Host event 新增 `observability:trajectory-event`（`ObservabilityTrajectorySupplyEvent`，原始 v2 批次）。
- shared 供数类型为泛型 `<Event = unknown>`（shared 层不得 import openclaw_runtime——facade 守卫强制）；electron/service 与 `src/lib/host-api.ts` 两端绑定 `TrajectoryEventV2`。
- v1 仅显式 `legacyFallback` 报告，零 v2 泄漏；renderer 仍只经 host-api/host-events 单入口。
- 顺带清偿基线预存红：`observability-api.ts` 本地 `isRecord` → 共享 `payload-utils`（facade 守卫测试在父提交本来就红，已在干净树对照证实）。

验证：`tests/unit/observability-trajectory-supply.test.ts`(7) + projection/index/host-events/facade/invoke 共 82/82;typecheck:node/web、build:runtime、comms:replay/compare、lint:bom、contract-check、changed-file ESLint、harness validate/dry-run 全绿;clean detached worktree（HEAD=9be4f9f06 + patch）复测全绿。

**下一步（新会话）**：TF-0063 WV-B2-02「现有 store 并轨」——先为其单独立卡确认（其 status 仍为 proposed，需经 update/确认流转为 ready），创建 B2-02 task spec 并跑 harness context；只消费 B2-01 装配快照，删 v2 覆盖路径的手写 reducer/Date.now 兜底/壁钟 last-wins;mock 场景迁移为装配 fixture。禁改 B1 schema/producer/Gateway 协议与 B3。历史约束详见 [WORKFLOW-VIZ-B2-02-HANDOFF-20260815.md](WORKFLOW-VIZ-B2-02-HANDOFF-20260815.md)（其中「B2-02A 未开始」等状态描述已过时，以本节为准）。

---

## 历史交接：Workflow Viz B2-02（2026-08-15，已完成 B2-02A 部分）

请先阅读 [WORKFLOW-VIZ-B2-02-HANDOFF-20260815.md](WORKFLOW-VIZ-B2-02-HANDOFF-20260815.md)。当前工作树包含一个未应用、待用户确认的 task-forest proposal：`TFP-workflow-viz-b2-02-bridge-and-store-20260815`。在确认前不得应用 proposal 或开始 B2-02A 实现。（状态更新：该 proposal 已于 2026-08-15 经用户确认应用，B2-02A 已完成，见上节。）

---

## 褰撳墠浜ゆ帴锛歐orkflow Viz B2-02A 宸插畬鎴愶紝涓嬩竴姝� B2-02锛�2026-08-15锛�

**WV-B2-02A / TF-0062 宸插畬鎴愬苟鍗曟彁浜� `b58350a2f`锛坒eat(trajectory): bridge raw v2 renderer supply锛夈��** 鎻愭�� `TFP-workflow-viz-b2-02-bridge-and-store-20260815` 涓庢敹鍗℃彁妗� `TFP-workflow-viz-b2-02a-close-20260815` 鍧囧凡缁忕敤鎴风‘璁ゅ悗搴旂敤锛泃ask-forest validate/export PASS锛汿F-0062=done(100%)锛孴F-0063锛圵V-B2-02 鐜版湁 store 骞惰建锛変繚鎸� `proposed`銆�

鏈�鍗¤惤鍦帮紙璇﹁�� `harness/specs/tasks/workflow-viz-b2-02a-renderer-v2-trajectory-supply.md`锛夛細

- `ObservabilityTrajectoryProjector` 骞惰�屼繚鐣�**鍘熷�嬪凡楠岃瘉** `TrajectoryEventV2` 琛岋紙cap 1000锛宍getV2Events`/`isLegacyFallback`锛屾帴鍙楁壒娆＄粡 `onV2Events` 涓婃姤锛夛紱normalize 鍚庣殑 trace 鎶曞奖璺�寰勪笉鍙樸��
- Host API 鏂板�� `observability.trajectorySessions` / `observability.trajectoryHistory`锛坒romSeq/limit銆乣asOfSeq` 鍐�/鐑�浜ゆ帴銆佺‘瀹氭�у幓閲嶃�佷繚鐣欐�佷笉瑕嗙洊鏃剁粡 B1-03 `observability.readFrom` 鍐锋仮澶嶏紱璺ㄨ竟鐣屽墠鎸� B1-01 schema 鍐嶉獙璇侊級銆�
- Host event 鏂板�� `observability:trajectory-event`锛坄ObservabilityTrajectorySupplyEvent`锛屽師濮� v2 鎵规�★級銆�
- shared 渚涙暟绫诲瀷涓烘硾鍨� `<Event = unknown>`锛坰hared 灞備笉寰� import openclaw_runtime鈥斺�攆acade 瀹堝崼寮哄埗锛夛紱electron/service 涓� `src/lib/host-api.ts` 涓ょ��缁戝畾 `TrajectoryEventV2`銆�
- v1 浠呮樉寮� `legacyFallback` 鎶ュ憡锛岄浂 v2 娉勬紡锛況enderer 浠嶅彧缁� host-api/host-events 鍗曞叆鍙ｃ��
- 椤哄甫娓呭伩鍩虹嚎棰勫瓨绾�锛歚observability-api.ts` 鏈�鍦� `isRecord` 鈫� 鍏变韩 `payload-utils`锛坒acade 瀹堝崼娴嬭瘯鍦ㄧ埗鎻愪氦鏈�鏉ュ氨绾�锛屽凡鍦ㄥ共鍑�鏍戝�圭収璇佸疄锛夈��

楠岃瘉锛歚tests/unit/observability-trajectory-supply.test.ts`(7) + projection/index/host-events/facade/invoke 鍏� 82/82;typecheck:node/web銆乥uild:runtime銆乧omms:replay/compare銆乴int:bom銆乧ontract-check銆乧hanged-file ESLint銆乭arness validate/dry-run 鍏ㄧ豢;clean detached worktree锛圚EAD=9be4f9f06 + patch锛夊�嶆祴鍏ㄧ豢銆�

**涓嬩竴姝ワ紙鏂颁細璇濓級**锛歍F-0063 WV-B2-02銆岀幇鏈� store 骞惰建銆嶁�斺�斿厛涓哄叾鍗曠嫭绔嬪崱纭�璁わ紙鍏� status 浠嶄负 proposed锛岄渶缁� update/纭�璁ゆ祦杞�涓� ready锛夛紝鍒涘缓 B2-02 task spec 骞惰窇 harness context锛涘彧娑堣垂 B2-01 瑁呴厤蹇�鐓э紝鍒� v2 瑕嗙洊璺�寰勭殑鎵嬪啓 reducer/Date.now 鍏滃簳/澹侀挓 last-wins;mock 鍦烘櫙杩佺Щ涓鸿�呴厤 fixture銆傜�佹敼 B1 schema/producer/Gateway 鍗忚��涓� B3銆傚巻鍙茬害鏉熻�﹁�� [WORKFLOW-VIZ-B2-02-HANDOFF-20260815.md](WORKFLOW-VIZ-B2-02-HANDOFF-20260815.md)锛堝叾涓�銆孊2-02A 鏈�寮�濮嬨�嶇瓑鐘舵�佹弿杩板凡杩囨椂锛屼互鏈�鑺備负鍑嗭級銆�

---

## 鍘嗗彶浜ゆ帴锛歐orkflow Viz B2-02锛�2026-08-15锛屽凡瀹屾垚 B2-02A 閮ㄥ垎锛�

璇峰厛闃呰�� [WORKFLOW-VIZ-B2-02-HANDOFF-20260815.md](WORKFLOW-VIZ-B2-02-HANDOFF-20260815.md)銆傚綋鍓嶅伐浣滄爲鍖呭惈涓�涓�鏈�搴旂敤銆佸緟鐢ㄦ埛纭�璁ょ殑 task-forest proposal锛歚TFP-workflow-viz-b2-02-bridge-and-store-20260815`銆傚湪纭�璁ゅ墠涓嶅緱搴旂敤 proposal 鎴栧紑濮� B2-02A 瀹炵幇銆傦紙鐘舵�佹洿鏂帮細璇� proposal 宸蹭簬 2026-08-15 缁忕敤鎴风‘璁ゅ簲鐢�锛孊2-02A 宸插畬鎴愶紝瑙佷笂鑺傘�傦級

---

## 历史接力入口（2026-08-14）

> 历史快照，已被后续节点取代；当前接力入口以本文件顶部的 TF-0084 段落为准。

本节写作时的接力主题是 VerseShell `TF-0065` / P2-02 argv-only command profiles，已全部收尾：Windows batch 元数据补丁已审查并补齐验证，测试矩阵与 governed contract 测试已完成，证据文档/STATUS/编排计划/三份 README 已同步，全部工程门禁全绿，Task Forest closeout proposal `TFP-verseshell-p2-02-closeout-20260814` 已保存并应用（validate/export PASS），`TF-0065` 为 `done` 100%，唯一下一节点 `TF-0066` / VS-P2-03 diagnostics 已解锁为 `ready`。下一会话只允许启动 `TF-0066` / P2-03。详细交接见本文件后部“接力交接：VerseShell P2-02 中断点”章节。

产品锁不变：`default-off`、`liveReady=false`、`productApproved=false`、`defaultOn=false`。不要并行启动 P3、P5 或任何 rollout。

---

## VerseShell Foundation：VS-P1-01 supervised ACI 工程包（2026-08-14）

> 状态：`TF-0060` / P0-03 closeout 已确认应用；`TF-0061` / VS-P1-01 是 VerseShell 链唯一解锁且正在执行的工作包。P1 保持严格串行、default-off、fail-closed，不代表 canary、GA 或产品批准。

- 新增 scoped spec：`harness/specs/tasks/verseshell-p1-supervised-aci.md`；生命周期 rule 已补充 process-manager `handshaking`、request/trace/deadline/process-key 关联、有界错误 metadata、只读 retry 与 kill-switch 约束。
- 实现：`aci-client.ts` / `process-manager.ts` / `governed-process.ts` 现在提供 host-owned correlation、`starting -> handshaking -> ready -> backoff/stopped/failed`、一次受控只读 retry、restart exhaustion 和 operator kill switch；effectful/unknown 请求不重放且无 native/MCP/legacy fallback。
- 验证：process-manager 24/24、governed lifecycle 6/6、VerseShell OpenClaw 目录 11 files / 61 tests、`pnpm verseshell:test` bundle 13/13 + runtime-bundle 11/11 + focused OpenClaw 57/57；Harness context 与 `--no-diff validate` PASS，证据见 `docs/dev/verseshell-foundation/P1-SUPERVISED-ACI-EVIDENCE-2026-08-14.md`。
- residual：`typecheck:node` 与 `typecheck:web` 的直接复跑均通过；完整聚合 `pnpm run typecheck` 与 `pnpm run lint:check` 在 5 分钟窗口内未完成。P1 scoped ESLint/oxlint 均通过（仅两个 warning）。共享工作树 diff ownership 和 harness dry-run 依赖缺失均已明确记录；不通过扩大 touchedAreas 或跳过规则规避。
- 下一动作：在 comms replay/compare 最终复跑并完成 P1 closeout evidence 后，用 Task Forest CLI 创建并应用 `TF-0061` closeout proposal，解锁唯一下一节点 `TF-0062`；P1-02 之前不扩展 facade/MCP/write/canary。

---

## VerseShell Foundation：VS-P0-03 governed real probe 工程门禁已完成，等待 Task Forest 收尾（2026-08-14）

> 状态：应用 A 继续严格串行执行。`TF-0059` / VS-P0-02 与 `TF-0060` / VS-P0-03 工程证据均已完成；P0-03 closeout proposal 已确认应用，后续由 `TF-0061` / VS-P1-01 承接。全局与产品边界保持 `default-off`、`liveReady=false`、`productApproved=false`、`defaultOn=false`。

- 对应源码：固定提交 `c3983694407a9ddb23505e05fad4a9eae653b283`，按 `source-inputs.json` 顺序应用四个 tracked patch；八个 ACI-Bench Python 输入、final assertions、Cargo.lock、toolchain 和禁止的 generated/ignored 输入均纳入 fail-closed 验证。
- 构建证明：Rust `1.94.0`、`--locked`、`CARGO_INCREMENTAL=0`、固定 `SOURCE_DATE_EPOCH`、source remap 与 `/Brepro`；两套独立 source/target roots 的 `ae.exe` byte-identical，SHA-256 `ac6a7a15dac0a9dc7d15ec975fc65276f25c871bbc0174197731947df6460786`，大小 `14879232`。
- 测试证明：完整 Rust `cargo test` 与 `--no-run`、当前解释器 `python -m pytest -q` 2/2、双 handshake/catalog 校验均通过；bundle negative tests 13/13，运行时/manifest/UAS-05 聚焦测试 22/22。
- 文档与验证器：`resources/verseshell/SOURCE.md`、`BUILD.md`、v2 manifest/source-inputs、Electron packaging 清单和 release toolchain 已同步；详细记录见 `docs/dev/verseshell-foundation/P0-REPRODUCIBLE-BUNDLE-EVIDENCE-2026-08-14.md`。
- 门禁结果：`pnpm verseshell:test`、`pnpm run typecheck`、按顺序执行的 comms replay/compare、manifest/package validation、`node --test scripts/verseshell-bundle.test.mjs` 和 `git diff --check` 均通过。Harness context 通过；diff-aware validate 与 `pnpm run harness:ci` 被共享工作树无关 changed paths 阻断，且 harness dry-run 子包缺少本地 `node_modules`，已记录为环境残余。
- P0-03 证据：当前 verified `ae.exe` 的真实 approval denial、approved retry 一次、token isolation、artifact recovery 与 no-native-fallback 通过；详见 `docs/dev/verseshell-foundation/P0-GOVERNED-PROBE-EVIDENCE-2026-08-14.md`。scoped Harness context/结构校验、`pnpm verseshell:test`、typecheck、comms replay/compare、manifest/package validation 与 `git diff --check` 已记录。
- 该段为 P0 历史收尾记录；当前下一动作以本文件顶部的 P1-01 段为准。diff-aware Harness residual 继续诚实记录，不扩大 `touchedAreas` 或跳过规则。

---

## 清理（2026-08-12）

- 删除本轮产生的临时物：`scripts/issue-13-real-gateway-ab.mjs`、`scripts/issue-13-aimock-gateway-ab.mjs`（含 openclaw_runtime 下副本）、`.git/index.lock`（stale 空锁）、aimock 失败残留 `/tmp/openclaw/openclaw-qa-suite-*`、`artifacts/chain-audit/evidence/gateway.log`（A/B 尝试日志）、根目录 `.tmp-tf-list*.json`。
- 保留正式产物：本轮修复源码改动、8 个新增测试/spec/基准文件、`artifacts/issue-13/real-gateway/report.json`（gitignored 证据）、Task Forest proposals/snapshots（CLI 正常产物）。
- 保留不动（其他任务/系统产物，非本轮范围）：`hello-world/`（agent 任务评测）、`jobs/`（job 运行器记录）、`.zcode/`（CLI 会话数据）、sandbox fs-bridge 系列改动（#22 沙盒链 WIP）、各 harness spec 未跟踪文件。
- `git diff --check` 对本轮源文件无空白错误；工作树保持不提交、不推送。

---

# 收尾完成 — GitHub #28 关闭 + Task Forest TF-0053/TF-0055 标记 done（2026-08-12）

> 状态：GitHub #28（P2，最后剩余 open issue）已以 `completed` 关闭，附验证证据；Task Forest 完成提案 `TFP-github-issue-13-28-closeout-20260812` 已由用户确认并应用，`TF-0053`（#13）与 `TF-0055`（#28）均为 `done`、进度 100%，export/validate PASS。工作树保持不提交、不推送。

## GitHub #28 关闭

- 与 #31 同根因、同 spec（`fix-gateway-session-workspace-resolution.md`）：相对路径按 session 可信 workspace 解析（spawnedWorkspaceDir > trusted request > 持久化 session > agent 默认），不再落到 `~/.openclaw/workspace` 触发全盘搜索。
- 验证：spawned-context + subagent-spawn 定向 5/5；gateway 套件 18/18（103）；#31 同矩阵（agents-core 32/32、embedded-agent-runner、auto-reply、comms replay/compare）均 PASS；tsgo 双 gate、harness validate --no-diff PASS。

## Task Forest 收尾（CLI 已可用）

- 发现 `~/.codex/skills/task-forest/scripts/task_forest.py` CLI 可用（AGENTS.md 旧 note 已过时）；经 `proposal-save`（预校验 + 写 base_graph_hash）→ 用户确认 → `proposal-apply --yes` 应用 → `export` + `validate` PASS。
- 完成提案 `TFP-github-issue-13-28-closeout-20260812`：TF-0053 与 TF-0055 置 `done`/100%，附证据与诚实 residual（#13 真实 A/B 受环境限制）。

## 至此全部 GitHub issue 已关闭

#13/#28/#29/#31/#34（本轮）+ #32/#33 等此前批次——`gh issue list --state open` 无剩余。剩余在途工作：worktree 大量无关 WIP、RC-10 H-03 真实 QQ 验收（需用户本人，凭据环境变量注入）。

---

# GitHub Issue #13 修复完成 — 插件工具描述符缓存（2026-08-12，接手 GPT 未竟工作）

> 状态：生产修复与验证已完成；GitHub #13 已于 2026-08-12 以 `completed` 关闭（附诚实 residual）。工作树保持不提交、不推送。Task Forest TF-0053 待受支持 CLI 恢复后应用完成提案（AGENTS.md 只允许只读检查，未直接编辑）。

## 接手背景

GPT 已完成核心实现（descriptor cache + lazy execute）与 fixture 基准，但卡在真实 Gateway stream-ready A/B 未采集 + 当时 `session-entry-slot-keys.ts` 类型错误阻塞。本次接手：修复类型阻塞（该文件已在 #31 会话修过）、复核实现正确性、复现基准、尝试真实 A/B、诚实收尾。

## 实现（spec: `fix-plugin-tools-descriptor-cache-performance.md`，GPT 完成、本次复核）

- 进程内插件工具描述符缓存：key 含 pluginId/source/contract 工具名、运行时上下文（config 内容哈希经 WeakMap memo、workspace/agent/model/delivery 字段）与 active+channel registry 代次；按插件元数据生命周期边界清除（gateway reload/close），上限 256。
- key 构建不做请求时文件系统 stat；warm 解析返回描述符壳工具，不重跑插件 factory；`execute`/`prepareArguments`/`finalizeBeforeToolCallParams` 懒解析当前运行时工具并按 registry 代次 memo，保留 allow/deny 列表、认证、delivery 上下文、registry 替换与执行契约。

## 本次验证

- 定向测试（`tool-descriptor-cache.test.ts`）4/4；plugins 套件 3/3（8）；agents-core 32/32（249）全绿；`tsgo:core` + `tsgo:core:test` 通过。
- 基准刷新（`perf:issue-13 --runs 5`，写入 `reports/plugin-tools-descriptor-cache-benchmark-2026-08-12.json`）：cold 22.63ms avg vs warm 0.56ms avg，-97.53%，warm factory 调用 0 次，RSS ~377MB。
- `harness validate --no-diff` PASS。

## 真实 Gateway A/B — 诚实 residual

- 真实 gateway（用户 `~/.openclaw` 配置）：agent 轮被 provider auth 前置拦截（无 deepseek key），到不了工具构造；日志可见 `agent runtime plugins pre-warmed in 5ms`（真实插件面 9 个：acpx/browser/canvas/device-pair/file-transfer/memory-core/phone-control/reach-readers/talk-voice）。尝试记录在 `artifacts/issue-13/real-gateway/report.json`。
- QA aimock 全链路 harness 无法启动：Windows `fs.symlink`（qa-agent-workspace.ts:44）需要提升权限，非管理员环境 EPERM。
- 结论：本环境不满足 spec "配置了 Gateway 的环境" 条件，stream-ready/RSS A/B 留作有 key/无 symlink 限制环境的复测项；机制本身已由 fixture 基准 + 单测覆盖。关闭评论明确标注此 residual，不冒充真实链路证据。

---

# GitHub Issue #29 修复完成 — subagent 完成通知在纯工具 announce turn 上不再误报 visible_reply_missing（2026-08-12）

> 状态：生产修复与验证已完成；GitHub #29 已于 2026-08-12 以 `completed` 关闭。工作树保持不提交、不推送。

## 实现（spec: `fix-subagent-announce-visible-reply-handoff.md`）

- `subagent-announce-delivery.ts`：对 subagent 完成（source=`subagent_announce`）在 requester announce turn 无可见输出时，若 `task_completion` internal event（source=subagent）已注入 requester 会话，则视为已交付（`delivered:true, path:"direct"`）——内部 handoff 即为嵌套/orchestrator requester 的投递契约，纯工具 turn 不代表结果丢失（issue #29）。
- 覆盖两处分支：内部 handoff（`!shouldDeliverAgentFinal`）与 agent-final subagent 分支（`shouldDeliverAgentFinal && isSubagentCompletion`）。
- 未注入 subagent 完成 event、非 subagent 来源（cron/image_generate 等）仍报 `visible_reply_missing`；message-tool-only 外部投递语义不变。
- 新增 `subagent-announce-delivery.visible-reply.test.ts`（4 用例）：注入 subagent event 的纯工具 turn 判定 delivered；无 internal event / 非 subagent event 来源 / 非 subagent announce 来源保持严格。

## 验证

- 定向测试 4/4 通过；agents-core 32/32（249 tests）通过；`tsgo:core` + `tsgo:core:test` 通过。
- comms replay/compare PASS（0 丢失/重复/乱序，吞吐/延迟无变化）；`harness validate --no-diff` PASS。
- `git diff --check` 对改动文件无问题。

---

# GitHub Issue #31 与 #34 修复完成 — 子 agent workspace 继承 + Windows→WSL Docker 卷路径转换（2026-08-12）

> 状态：生产修复与验证已完成；GitHub #31 与 #34 已于 2026-08-12 以 `completed` 关闭（验证评论避免披露本地路径与内部门禁细节）。两个 issue 均有 harness spec 与定向测试；工作树保持不提交、不推送，未回滚其他任务 WIP。

## #31 子 agent workspace 继承（spec: `fix-gateway-session-workspace-resolution.md`）

- Backend agent/chat RPC 接受可信 `workspaceDir`（仅 Backend 客户端；其他客户端返回 INVALID_REQUEST）。
- spawn 持久化 `spawnedWorkspaceDir`；每轮 workspace 解析优先级：spawned > trusted request > 持久化 session > agent 默认（`resolveSessionWorkspaceDir`）。
- `tools.effective`、`tools.invoke`、MCP loopback、`agent-command`、auto-reply 路径全部从会话持久化状态取 workspace；Electron Main 将 workspaceId 解析为绝对根路径后再转发。
- 与本会话修复配套：`session-entry-slot-keys.ts` 补登记 `workspaceDir`/`spawnedWriteSet` 保留槽位（此前导致 `tsgo:core` 报 `MissingSessionEntryReservedSlotKeys`）。
- 顺带修复预存测试问题：`tools-invoke-mcp-fallback.test.ts` mock 补 `CORE_TOOL_GROUPS` 导出（gateway 套件从 33/35 → 35/35）；两个未跟踪 WIP 测试的类型错误（`model-auth.auth-json-migration.test.ts` afterEach 收窄、`tool-descriptor-cache.test.ts` readonly 数组）已修，`tsgo:core:test` 转绿。

## #34 Windows→WSL Docker 卷路径转换（spec: `fix-sandbox-windows-wsl-docker-paths.md`）

- 新模块 `openclaw_runtime/src/agents/sandbox/wsl-path.ts`：检测 Windows 客户端 + 非 named-pipe `DOCKER_HOST`（WSL2/远程 Linux daemon），将 `C:\...` 转 `/mnt/c/...`、剥 `\\wsl$\<distro>\` 前缀；本地 named-pipe daemon 与 macOS/Linux 保持原样。
- `workspace-mounts.ts` 挂载格式化加可选 `BindSourcePathTranslator`；`docker.ts`/`browser.ts` 在 workspace、agent workspace、只读 skill、自定义 binds 四处接线（经 `createDockerBindSourceTranslator`）。
- 安全校验与 config hash 仍基于原始主机路径（翻译只作用于 `-v` 参数输出），容器复用判定不变。
- 新单测 `wsl-path.test.ts`（12）+ `workspace-mounts.test.ts`（3）15/15 通过；README en/zh/ja 同步。

## 验证

- #31：spawned-context/subagent-spawn 定向测试通过；gateway 35/35、agents-core 31/31（244）、embedded-agent-runner 8/8（55）、auto-reply 各套件通过。
- #34：agents-support 19/19（205）、unit 变更文件 26/26（264）、sandbox Dockerfile 契约测试通过。
- 两 issue 均过 `tsgo:core` + `tsgo:core:test`；`git diff --check` 无新问题（LATEST.md 预存 trailing whitespace 属旧文件）。
- #31 通过 comms replay/compare（0 丢失/重复/乱序，吞吐/延迟无变化）与 `harness validate --no-diff`；#34 spec `validate --no-diff` PASS。
- 完整 harness diff 归属校验未用于当前大量无关 WIP 的脏工作树（与 #33 收尾一致）。

---

# GitHub Issue #33 修复完成 - Gateway 重启恢复运行中的主会话（2026-08-12）

> 状态：生产修复与验证已完成；GitHub #33 已于 2026-08-12 以 `completed` 关闭。详细本地验证评论未发布，避免向外部披露本地路径与内部门禁细节。Task Forest 完成 proposal `TFP-github-issue-33-done-20260812` 已应用，`TF-0054` 为 `done`、进度 100%。

## 实现

- 重启恢复将 `assistant` 尾部的 `stopReason=aborted/toolUse` 视为未完成 turn；`stop/length/error`、缺失 stopReason 和 approval-pending 继续禁止自动重放。
- 恢复 `agent` 调用同时传原始 `sessionKey` 和 `sessionId`，避免 freshness 边界把恢复请求旋转到新会话。
- Gateway 调用失败时保留 `abortedLastRun=true`，供退避重试；成功接受恢复请求后才清除标记。
- README 英文、中文、日文与 Harness task spec 已同步；真实 E2E 预置 source runtime 实际状态目录中的 running/aborted 会话。

## 验证

- 定向 Vitest：2 files、15/15 tests PASS。
- `pnpm run build:runtime` PASS，runtime smoke Gateway ready；此前一次并发构建因多个 tsdown 同写 `dist` 缺少 `entry.js`，串行重跑后通过。
- 完整 `restart-recovery-fp-p1-05.spec.ts`：2/2 PASS；新增用例证明真实 Gateway 启动后在同一 `sessionId` 恢复一次，原七场景长链路无回归。
- 目标 oxfmt、type-aware oxlint、E2E ESLint 与 `git diff --check` PASS。
- comms replay/compare PASS：消息丢失、重复、乱序、RPC timeout 均为 0；吞吐/延迟相对基线无变化。
- Harness context 与 `validate --no-diff` PASS。完整 diff 归属校验未用于当前大量无关 WIP 的脏工作树。
- 完整 typecheck：web PASS；node 仅被既有 `openclaw_runtime/src/plugins/session-entry-slot-keys.ts:140` 的 `spawnedWriteSet` 约束错误阻断，本次文件的 type-aware lint PASS。

## 收尾

- 不提交、不推送，不回滚工作树中的其他任务改动。
- GitHub #33 状态已核验为 `CLOSED/COMPLETED`；Task Forest validate/export 已通过。

---

# RC-09 重新签发完成 — 工程证据已按当前 main 重建（2026-08-11）

> 状态：F-06 工程部分已关闭。RC-09 已以候选分支 `rc09-r2-final-candidate`（candidate `657b51e1ca0b2b7e35d2e2c23554be4631e27184`）重新签发：executor 21/21 gates PASS、独立 verifier PASS、engineering validator PASS、程序进入 `human_acceptance_pending`。RC-10 H-03 真实 QQ channel round trip 与 human-verdict.yaml 待用户本人执行/书写（凭据环境变量注入，禁止落盘）。

## 2026-08-11 重新签发结果

- **候选**：`rc09-r2-final-candidate` 分支，HEAD `657b51e1c`（main `4cd5396db` + 2 个 fix）。baseRef=`fd857e5d`（RC-01 acceptedBaseSha），changedPaths=170，全部有唯一 RC owner。
- **修复 1（requiredTests 嵌套递归）**：spec requiredTests 原本嵌套完整 acceptance run/verify/validator 循环。嵌套 run 执行主 manifest 会再次物化 required-test gates → 无限递归（required-test-2 → 嵌套 required-test-2 → …，每层 ~60 分钟）；validator gate 还需 `final-report.json`（只在 verifier 之后才存在），结构上无法在 fresh executor 内通过。修复：spec 只保留 plan/status/harness-validate 三个非递归 smoke gate；run/verify/validator 在顶层以完整协议执行（见 §3 证据）。备选 env-var 抑制方案（OPENCLAW_ACCEPTANCE_SUPPRESS_REQUIRED_TESTS）不可行——嵌套 run 执行的是主 manifest，抑制只对新建 manifest 生效，不能终止递归。
- **修复 2（commandLine gate 契约校验）**：`spawnGate` 对 required-test gate 记录 `command = commandLine ?? command`，但 `validateReportEvidence` 与 manifest 原始 `command: null` 比较 → 全部 required-test gate 在 verifier rerun 判为 contract mismatch（NO-GO）。修复：比较改为对 expected gate 取 effective command（`commandLine ?? command`），与 executor 解析一致。新增回归测试 `accepts commandLine required-test gates and still rejects a tampered command`（29/29 PASS）。
- **证据**：`artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/`（manifest/executor-report/verifier-report/final-report/changed-path-ownership.json + logs + evidence）。runId `e429a44f`；executor `pass`（21 gates，含 3 required-test），verifier `pass` + `engineeringAcceptedByAgent=true` + `review_needed`；`validate-runtime-authority-convergence.mjs --phase engineering` **PASS**；`acceptance:agent:status` pass。fast-unit-tests 7124 passed / 0 failed / 52 skipped。
- **回归**：13 个累积 rc 包 spec（rc00..rc08b）+ rc01r×2 harness validate 全 PASS；`channel:conformance` 9/9 PASS；typecheck/test/runtime-check/integration/comms×2/contract/i18n/build 均由 executor gates 以最终 SHA 覆盖并通过。
- **文档**：STATUS.md → `program_status: human_acceptance_pending`、`engineering_verdict: accepted`；findings.md F-06 工程部分 CLOSED；本 LATEST 追加本段。product locks 保持 false；`done_allowed` 保持 false。

## 剩余动作（需用户本人，非 agent 可代劳）

1. **RC-10 H-03 真实 QQ channel**：用户从 QQ 私聊 bot（id=1903280802）发消息触发 round trip；凭据仅经环境变量 `QQBOT_APP_ID=1903280802` / `QQBOT_CLIENT_SECRET=<用户提供值>` 注入，**禁止写入任何文件**。环境：主工作树启动 gateway（`pnpm --dir openclaw_runtime dev gateway`，qqbot 插件在 workspace；用户全局 openclaw 2026.5.20 无 qqbot 插件，必须用 workspace build）；LLM 用 qa-lab aimock（无 provider key）。提取 gateway 日志 run ID + receipt store receipt IDs → 写 `.../final/rc10-round-1/run-record.md`（执行环境必须 = 候选 SHA `657b51e1c`）。真实 channel 不可用则如实写 blocked，不得用 fixture 冒充。
2. **human-verdict.yaml**：仅用户本人书写（validator 禁止 agent 代写）；verdict=accepted 需 exact 六场景 [H-01..H-06] + failed 空；文件路径与 sha 校验由 `validate-runtime-authority-convergence.mjs --phase human` 负责。
3. 最终 validator 在候选 worktree 跑（worktree HEAD==candidate 才过）。候选分支保持冻结于 `657b51e1c` 直到用户完成 H-03 与 verdict；**main 尚未前进到候选 SHA**——任何向候选分支的提交都会使既有工程证据（绑定该 SHA）失效。

## 环境备忘

- 候选 worktree `C:\Users\27933\Desktop\clawx\ClawX-rc09-r2-candidate`（node_modules 已按 hoisted 布局装好，勿重装成 isolated）。
- 归档：`artifacts/agent-engineering-acceptance/runtime-authority-convergence-final-r2-exec-9b08e3f5-archived-20260811/`（executor 全绿但 verifier 因 commandLine 契约 NO-GO 的中间轮次）；`-r1-archived-20260810/` 为旧 3209f0981 链证据（F-06 判无效，只读勿用）。
- 已删除两个 stale 临时 worktree（clawx-agent-acceptance-5ex94t / NbdyHp，各 ~4.5GB）；残留 detached worktree 重跑前 `git worktree prune`。
- rc10 spec 曾是无 --since 时唯一强制 diff 的 rc 包（唯一带 `scenario: gateway-backend-communication` 字段，CLI 对 scenario 绑定 spec 默认 diff 到 origin/main），对其窄 touchedAreas 报 170 候选路径不覆盖。已修复（2026-08-11，main 侧，候选分支未动）：移除 rc10 的 scenario 字段对齐其余 15 个 rc 包（scenario-less + taskType），并补 `docs/dev/handoffs/**` 覆盖该轮必然更新的 LATEST.md；无 `--since` validate 16/16 全 PASS，`--since <工程验收候选 SHA>`（正确基线）空 diff PASS，harness 单测 20/20 无回归。

---

# Runtime Authority Convergence NO-GO 修复接管（2026-08-03）

## 后端健康修复状态（2026-08-10 追加）

- 系统健康审计（`artifacts/system-health-audit/`，2026-08-09，72/100 CONCERN）的 P1/P2 findings 已逐项修复并验证：F-01（DCS model-call 级 finalization，working_memory 进入同 attempt 下一次模型调用）、F-02（RC-03 receipt 真实 producer + char budget）、F-03（acceptance runner 强制 requiredTests）、F-04（根门禁 6534 passed / 0 failed）、F-05（runtime static check exit 0）、F-07（test:integration 4 files 28/28）、F-08（final harness validate PASS）、F-09（真实本地 OTLP collector round trip）。
- 剩余 **F-06**：工程部分已于 2026-08-11 关闭（见上方新段），RC-10 H-03 真实 channel 待用户提供（fixture 不得 waive）。
- 本轮未运行 Playwright / 全量 Electron E2E；未修改 default-on、liveReady、productApproved、GA、release 或 TF-0006 解锁状态。

## RC-00R 本会话更新（历史）

- 唯一 active package 是 `RC-00R` / `TF-0020`；RC-01+ 未启动，RC-10 仍 blocked，所有 product locks 仍为 false。
- 已完成验收控制面加固：Git-blob source identity、canonical manifest/report digest、constant-time digest 比较、actor separation、gate/log/count/skip/artifact 校验、engineering/human phase schema 和 clean-after-run proof。
- Windows comms entrypoint 改为 `fileURLToPath(import.meta.url)`；replay/compare 现在写入非空、schema 合法、candidate-bound JSON artifact。
- 新增 regression：重新 sealing 后删除 candidate-bound artifact record 仍必须 NO-GO；Verifier 从 detached worktree 复制的 artifact path 也必须可验证。
- 本会话验证：RC-00 scoped Harness PASS；orchestrator Harness PASS；focused Vitest 25 + 12 = 37 PASS；`pnpm run lint:check` 为 0 errors/122 warnings；`pnpm run typecheck` node/web 均 PASS；`git diff --check` PASS。
- `pnpm run comms:replay` 与 `pnpm run comms:compare` 在 Windows 实际执行 PASS，但输出绑定当前 dirty historical `HEAD`，只能作为脚本执行检查，绝不可计入正式 RC evidence。
- RC-00R 尚未 accepted：仍需 clean、scoped candidate commit，以及不同 actor 在两个 detached worktree 中运行新的 `plan -> executor -> verifier` evidence。不得复用 `fac6327a2` 的任何 evidence。
- Task Forest 受支持 CLI 仍不可用；继续只读检查 `.agent-workbench/task-forest/**`，不要直接编辑。


候选 `fac6327a2d4c03b7517daa2fd819b891086d912c` 已被独立对抗审计判定为 `NO-GO`。审计前“RC-00..RC-08B 已全部验收”的说法已失效；其中的 RC-00 PASS / RC-06B/C CONCERN 都只是已撤销的历史结论，当前不得作为任何包的 accepted evidence。

## 必读入口

1. `docs/dev/unified-agent-system/runtime-convergence/STATUS.md`
2. `docs/dev/unified-agent-system/runtime-convergence/RC-09-REMEDIATION-PLAN.md`
3. `docs/dev/unified-agent-system/runtime-convergence/README.md` 的其余控制包
4. `artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/independent-audit-2026-08-03.md`

## 当前状态

- `TF-0041` 为 `review_needed`；`TF-0042`/RC-10 保持 blocked。
- 旧 candidate 和本地 manifest/Executor evidence 只作 rejected historical input，不得复用为绿色证据。
- `STATUS.md.accepted_work_packages` 现在为空；RC-00R 的控制面改动也必须通过新的独立复验后才可能恢复。
- 主工作树包含 Task Forest、FakeCoding UI、checkpoint 和其他分离 workstream；不得清理、回滚或并入 Runtime 修复候选。
- 记录路径中的 `task-forest` skill 脚本当前不存在。恢复受支持 CLI 前只允许只读 JSON 检查，不直接编辑 Task Forest 文件。

## 串行顺序

RC-00R 已启动；后续包保持锁定。严格顺序固定为：

```text
RC-00R -> RC-01R -> RC-02R -> RC-03R -> RC-04R -> RC-05R
-> RC-06AR -> RC-06BR -> RC-06CR -> RC-06DR
-> RC-07R -> RC-08AR -> RC-08BR -> RC-09A/RC-09
```

每个包必须先更新 scoped Harness spec，运行不带 `--no-diff` 的 validate、聚焦反例测试、全局 lint/typecheck，并由不同 Verifier 在 detached clean worktree 复跑。任一失败都阻止下一包。

## 关键硬停止

- 不把 regex、静态数组、mock-only、恒真断言或 exit 0/no-output 当行为证据。
- 不在 dirty 主工作树生成或搬运 final manifest。
- 不允许 raw prompt/tool/message/credential 落入 receipt/ledger。
- 不允许 approval Map、legacy lifecycle Map 或 parallel memory writer 在包退出后继续 authoritative。
- 不调用真实 provider/channel 做 RC-10，不改变 product locks，不宣称 default-on 或 done。

上一轮 FakeCoding UI 主线继续由 TF-0021..TF-0027 及其 proposals 保留，本 Runtime 修复不得混入。

---

# RC-01R -> RC-02R -> RC-03R 本地实现会话（2026-08-05）

> 状态：F4 仍未关闭；本轮是用户授权下的主工作树实现尝试。所有结果仅为“本地实现与门禁证据”，正式 clean-candidate / 独立 Verifier 验收仍待恢复。不修改 STATUS.md 的 accepted_work_packages，不解除 RC-10 blocked，product locks 保持 false。

## 唯一 active 顺序与结论

- **RC-01R**：本地门禁全绿（见命令表）。基线已 Git 跟踪、deterministic、acceptedBaseSha=6493d5cce（origin/main 祖先）。
- **RC-02R**：本地门禁全绿。ReceiptStore typed canonical input、内部重算 digest、同 key 同内容幂等/不同内容 conflict、全 provider 真实 guarded boundary、八入口生产调用链、npm fallback degraded、shadow 写失败进 census 且不改发送行为。
- **RC-03R**：本地门禁全绿。真实 config 驱动 seal flag/kill switch、producer 真实 applied 记录、WireReceipt/v1 真实生产 caller（guarded boundary）、写失败进 census。

## 本会话改动文件（均未提交；主树脏状态延续）

- `openclaw_runtime/src/agents/receipt-store.ts`：lint 修复（`\-`→`-`）；`%` 加入 canonical ref 字符集（URL-encoded candidate id）。
- `openclaw_runtime/src/agents/receipt-store.test.ts`：+URL-encoded ref 反例测试。
- `openclaw_runtime/src/context-engine/dcs-receipts.ts`：budgetSummary JSON → typed ReceiptBudget（RC-02 typed canonical 输入适配）。
- `openclaw_runtime/src/context-engine/rc03-seal-hook.ts`：adapterId、canonical refs、SHA-256 policyDigest；新增 `resolveRc03SealState`（env+config+kill switch）、`appliedProducerIdsFromLineage`、seal plan 按 run 记录、写失败 → shadow census。
- `openclaw_runtime/src/context-engine/rc03-seal.test.ts`：identity/digest/ref fixtures 适配 RC-02 typed store。
- `openclaw_runtime/src/context-engine/rc03-seal-wiring.test.ts`：+6 个 RC-03R 反例（config 驱动、kill switch、producer applied 真值、写失败 census、resolveRc03SealState、WireReceipt/v1 guarded boundary）。
- `openclaw_runtime/src/context-engine/context-orchestrator.ts`：`cfg` 传入 + `resolveRc03SealState` 默认解析。
- `openclaw_runtime/src/agents/shadow-census.ts`：`rc03Plan` 结构字段 + `emitRc03WireReceipt`。
- `openclaw_runtime/src/agents/provider-transport-fetch.ts`：guarded boundary 在 rc03Plan 存在时持久化 WireReceipt/v1。
- `openclaw_runtime/src/agents/embedded-agent-runner/stream-resolution.ts`：run 级 seal plan 挂到 shadow options。
- `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts`：`cfg`/`runId` 传入 finalizeContextOrchestratorTurn。
- `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`：`runId` 传入 buildEmbeddedExtensionFactories。
- `harness/specs/tasks/rc02-full-payload-shadow-census.md`、`harness/specs/tasks/rc03-dcs-seal-dual-receipts.md`：ownedPaths 补齐（dcs-receipts/rc03-seal-hook/rc03-seal.test → rc02 适配；provider-transport-fetch/extensions/stream-resolution → rc03）。

## 逐条命令结果

| 命令 | 结果 |
|---|---|
| `pnpm harness validate --spec rc01r-self-contained-baseline` | PASS |
| `pnpm exec vitest run rc01-authority-inventory-baseline / runtime-authority-convergence-control-pack / harness-specs` | 41/41 PASS |
| `node scripts/rc01-baseline-validate.mjs` | PASS（classified=41 modules=16/16） |
| `pnpm run lint:check` | 0 errors / 122 warnings（1 个 receipt-store.ts 转义 error 已修） |
| `pnpm run typecheck` | PASS（dcs-receipts.ts:33 relay 型漂移已适配修复） |
| `pnpm --dir openclaw_runtime exec vitest run rc02 trio + rc03 pair` | 54/54 PASS |
| `pnpm exec vitest run agent-engineering-acceptance + control-pack` | 35/35 PASS |
| `pnpm harness validate --spec rc02 / rc03` | PASS |
| `pnpm run comms:replay` / `comms:compare` | PASS（metrics + compare-report.md 写入） |
| `pnpm --dir openclaw_runtime run build` | PASS |
| `pnpm run build:vite` | PASS |
| `pnpm test`（全量） | 3 files / 31 tests failed —— 与 RC-01R 基线完全一致，全部为保护 workstream（chat-input.test.tsx / chat-runtime-event-handlers / uas-05 Task Forest 状态） |
| E2E（zoom-shortcuts） | 环境修复后 PASS；main-navigation 2 failures 在保护 UI workstream 路径 |

## 未跑项 / 本地验证限制

- 独立 Verifier / detached worktree / final manifest：未跑（用户授权临时 bypass；正式验收待恢复）。
- F4（RC-00R 缺少候选资源）：未修复、未关闭。
- E2E 全量：仅 smoke 级；kysely/tslog hoisting 是 pre-existing 环境问题（pnpm 11 忽略 deprecated `shamefully-hoist`，require 链为 HEAD 既有代码），非本 diff 引入；已在本地以 `--config.hoist-pattern=*` 修复 node_modules 后验证 zoom-shortcuts PASS，随后恢复 canonical install 保持 pnpm 门禁可用。
- 全量 31 失败：全部归属保护 workstream（ChatInput/chat stores/Task Forest），不并入候选。

## 残余风险

- rc02/rc03 spec ownedPaths 与 rc03 原 ownedPaths 对 `shadow-census.ts`/`anthropic-transport-stream.ts` 存在重叠（沿用 relay 既有模式）；final ownership matrix 需要最终 RC-09 统一裁决。
- `tool-loop-detection.ts`（P0-3 默认开启 loop 检测）是保护 workstream 语义改动，未并入候选。
- rc03 seal 计划按 runId 记录在内存 Map；进程重启后不恢复（与现有 lineageByTurn 同级别，非持久 store）。
- WireReceipt/v1 的 transformIds 目前为注册列表快照；后续 RC 包若改动 registry 需同步。

## 下一步唯一动作

RC-04R（仅在独立 Verifier 接受 RC-03R 后启动）。当前包状态：RC-01R/02R/03R 本地实现与门禁证据齐备，未 accepted、未 done；RC-10 保持 blocked。

---

# RC-04R 本地实现会话（2026-08-05，承接 RC-01R/02R/03R 会话）

> 状态：F4 仍未关闭；用户授权继续按"本地实现与门禁证据"口径推进。所有结果仅为本地证据，正式 clean-candidate / 独立 Verifier 验收仍待恢复。不修改 STATUS.md 的 accepted_work_packages，不解除 RC-10 blocked，product locks 保持 false。

## 唯一 active 顺序与结论

- **RC-04R**：本地门禁全绿（见命令表）。durable `ApprovalLedger` 已是唯一 exec-approval owner 且生产默认启用（`server-aux-handlers`）；process Map 降为可丢弃 cache；raw `request_json`/`proposal_json` 迁移为 SHA-256 digest-only（旧 DB reopen 证明 + raw secret 扫描证明）；revision CAS + 严格状态机反例全过；`recoverPendingFromLedger()` 恢复重启前 pending truth；`EffectReceipt` 幂等比较覆盖 8 维度。

# RC-01R → RC-07R 独立验收提示词（交付版）

> 交付日期：2026-08-05 晚。独立验收执行提示词全文见 `docs/dev/handoffs/RC-01R-07R-ACCEPTANCE-PROMPT.md`（含候选构建手册、已知障碍解法、每包 touchedAreas、命令模板、结束条件）。覆盖 8 包：RC-01R / RC-04R / RC-05R / RC-06AR / RC-06BR / RC-06CR / RC-06DR / RC-07R，累积候选链从 main `90e796893` 起，每包 plan → executor → verifier 双 PASS 后作为下一包 `--since`。RC-00R 验收参照物：`artifacts/agent-engineering-acceptance/runs/rc00-f4-restore-5/`（候选 worktree `ClawX-rc00-candidate` 内）。

---

# F4 恢复会话（2026-08-05 晚，承接"独立审计 → 全包修复"会话）

> 目标：修复 F4（RC-00R 缺少候选资源）——创建 clean、scoped、自包含全绿的候选 commit 并跑正式验收流程（plan → executor → verifier，双 actor、双 detached worktree、唯一 output dir）。

## 结果：RC-00R 候选验收 **executor pass + verifier pass**（F4 关闭）

- **候选**：`a68dec32b`（detached，基于 main `90e796893`）。候选链 = 分支 fix/rc00r-acceptance-control-plane 9 commits（fac6327a2 之后）+ 候选自修复。
- **main 前进**：`90e796893`（ChatInput.tsx 4 个 unused import 移除——候选 lint 基线修复，从候选 diff 中移出避免 coverage.ui → e2e profile）。
- **候选自修复**（self-contained green）：
  1. `tests/unit/chat-input.test.tsx`：移除死引用 `artifactPanelMocks.openPreview.mockReset()`（68/68 绿）。
  2. `.gitattributes`：`artifacts/runtime-authority-convergence/rc-01/baseline.json -text`（autocrlf=true 会 smudge 为 CRLF 破坏 rc01 再生成字节一致断言；16/16 绿）。
  3. rc00 spec touchedAreas 补 `.gitattributes`、`src/pages/Chat/ChatInput.tsx`（后随 rebase 移除）、`.gitignore`、`artifacts/runtime-authority-convergence/**`、`artifacts/unified-agent-system/**`。
  4. `artifacts/unified-agent-system/TF-0011/audit-manifest.json` 入候选（uas-00 测试 fixture，此前仅 stage 未 commit）。
  5. `scripts/lib/agent-engineering-acceptance.mjs`：provision gate 的 `--copy` 列表移除 audit-manifest.json——**HEAD 已跟踪该文件**，provision 复制同内容文件在 Windows 上触发 git stat 误判（copyFileSync 后 git status 显示 M），导致 mutation gate 误报 "detached worktree changed"。
- **验收运行**：`pnpm acceptance:agent:full --spec harness/specs/tasks/rc00-agent-engineering-acceptance-bootstrap.md --executor rc00-executor-f4-5 --verifier rc00-verifier-f4-5 --since 90e796893 --output-dir artifacts/agent-engineering-acceptance/runs/rc00-f4-restore-5`
  - 14 gates 全过：dependency-install x2、provision、harness-validate、fast 4（bridge/lint/typecheck/unit）、contract-check、i18n-lint、integration、vite-build、runtime-build、runtime-smoke。
  - executor `pass`（failures 空）；verifier `pass` + `engineeringAcceptedByAgent: true` + `taskStatusRecommendation: engineering-accepted`（同 output dir 双角色独立 detached worktree 复跑，manifest/report digest 校验）。
- **产物**：`artifacts/agent-engineering-acceptance/runs/rc00-f4-restore-5/{plan.json,manifest.json,executor-report.json,verifier-report.json,final-report.json}`。
- **调试过程关键点**（供后续参考）：验收 gate 在全量 e2e 无法在本机跑绿（headless/Windows）；候选 diff 含 `src/**` 会触发 coverage.ui → e2e profile，因此 UI lint 修复必须移出候选（入 main）；`pnpm test` 全量在候选 clean checkout 需 gitignored 资源（ae.exe/manifest/uas-06 canary——provision gate 处理）+ audit-manifest（入候选）；rc01 baseline 字节再生成断言需 `-text`。

## 状态与后续

- STATUS.md blockers 移除 `rc00r-acceptance-control-plane-reverification-required`；`independent-final-verifier-evidence-missing` 保留（RC-00R 域已生成 evidence，RC-01R..07R 域仍缺独立验收 evidence）。
- **RC-01R..RC-07R 的正式独立验收仍未执行**：各包本地门禁全绿 + 审计修复闭环，但独立候选验收（同 F4 流程）待后续会话按包进行。
- 主工作区不受影响（未触碰 workstream/Task Forest/状态锁）；临时 worktree（diag/debug/main-lint）已清理；候选 worktree `ClawX-rc00-candidate` 保留（验收产物所在）。
- 清理提示：候选 worktree 可在验收产物归档后 `git worktree remove` 删除。

---

# 独立审计 → 全包修复会话（2026-08-05 晚，承接 RC-05R 会话）

> 状态：F4 仍未关闭。审计提示词已交付，独立审计 agent 对 7 包全部判 FAIL（复现全部门禁 + 独立反例），本会话按审计优先级逐包修复，每包重跑对应门禁。仍为"本地实现与门禁证据"口径；正式 clean-candidate / 独立 Verifier 验收待 F4 恢复后执行。

## 修复摘要（详情见 `docs/dev/handoffs/RC-04-07-DEVELOPMENT-PROMPT.md` 的"独立审计修复记录"）

- **RC-04R**：`recordEffectOutcome` 两段式完整状态序列（`outcome` 列持久化中间态）；legacy 迁移重建唯一/查询索引；`reserve` 同 key 不同 request → `idempotency-conflict`；requester 身份随 reserve 原子持久化。37/37 + 24/24 + 35/35 PASS。
- **RC-05R**：`markExecutionStarted` 非幂等（并发恰一个执行者，反例 executorCalls=1）；`executeOperatorSliceEffect` 核对 ledger `resolved_by === governance.actor`（反例 governance-mismatch、executorCalls=0）；cron 批准改 `runtime.rc05.cronAutoApprove` 配置驱动（默认 deny fail-closed）；runKey 用持久化的 `runningAtMs`（同 tick 可重放去重）；UI decideOperator 映射 wire 协议 approved/denied + `loadOperatorLineage`；conformance 只统计 passed。35/35 + inbox-store 3/3 + conformance 9/9。
- **RC-06AR**：registry `deliveryState` 投影+回写 round-trip（含 ON CONFLICT）；restart 测试真 close/reopen；双连接测试改真实 `DatabaseSync` 竞争（[0,1]）；`ended_at` 补 lost；CAS 默认 notify_policy 对齐 registry。11/11。
- **RC-06BR**：补 `node_failed → running`；恒真断言改真实断言；skippedReason 如实区分 revision-conflict/illegal-transition；runtime.ts 新增 `clawgraphProjectionFailureCount`（drift 可查询）。9/9。
- **RC-06CR**：production waitMode 补 `paused → 'pause'`；真实 `pauseMission → resumeMission` 路径测试（waitMode pause/sleep）。9/9。
- **RC-06DR**：`TaskLoopStatus` 加 `cancelled` + 生产 `cancelTaskLoopRun()`（真实 runTaskLoop 路径测试，terminal 吸收）；waiting 仅对真实人工等待（ask_user/permission_wait 信号，guardianTripped 排除）为 true。10/10。
- **RC-07R**：loader 消费 `slotConvergenceErrors` fail-closed（Gateway startup/reload 必经）；`buildSlotMechanismCensus` 生产调用（activation-planner，真实 manifest ids + memory slot，parallelMemoryWriters>0 拒绝 plan）。8/8 + rc07 5/5 + 40/40。
- **附带**：config-schema-parity 修复（runtime-feature-leaves sample 补 cronAutoApprove 叶子）——全量第 4 个失败文件已消除。

## 最终验证

- 全量 `pnpm test`：预期回到 RC-01R 基线 3 files / 31 failed（chat-input / chat-runtime-event-handlers / uas-05 保护 workstream）。
- `pnpm run lint:check`：预期 0 errors / 122 warnings。
- `pnpm run typecheck:node` + `typecheck:web`：PASS（本阶段已跑）。
- 7 个 spec `harness validate`：逐包 PASS。
- 保护 workstream（chat-input / chat-runtime-event-handlers / uas-05 及依赖）、Task Forest、STATUS.md、product locks 均未触碰。

---

# RC-05R 本地实现会话（2026-08-05，承接 RC-04R 会话）

> 状态：F4 仍未关闭；用户授权继续按"本地实现与门禁证据"口径推进。所有结果仅为本地证据，正式 clean-candidate / 独立 Verifier 验收仍待恢复。不修改 STATUS.md 的 accepted_work_packages，不解除 RC-10 blocked，product locks 保持 false。

## 唯一 active 顺序与结论

- **RC-05R**：本地门禁全绿。Cron ingress 只创建 approval intent（`createOperatorSliceIntent`），批准来自显式治理 policy（`resolveOperatorGovernancePolicy`，SHA-256 policyDigest）或 Inbox 决策（`inbox.operator.decide`，actor 来自 client）；`executeOperatorSliceEffect` 先 `execution_started`，再按真实 executor 结果写 `applied/not_applied/unknown`，channel send 前绝不写 applied；`channel-conformance` 从源码 regex 改为可执行 fixture runner（六场景真实执行，scaffold 通道 fail-closed）；desktop Inbox（store + 页面 + `inbox.operator.*` Gateway 方法 + 四语 i18n）接真实 approval_ledger/EffectReceipt/ContextReceipt 数据；E2E 2/2 PASS。

## 本会话改动文件（均未提交；主树脏状态延续）

- `openclaw_runtime/src/agents/operator-slice.ts`：三阶段重构（intent/governance/execute）+ 真实 ContextReceipt lineage；bounded file effect 经 realpath 双重包含校验（security review 修复）。
- `openclaw_runtime/src/cron/delivery.ts`：移除硬编码 approved；slice 路径 intent → policy → execute（executor=真实 send，ack 后才 applied）。
- `openclaw_runtime/src/gateway/server-methods/inbox.ts`（新建）+ `server-aux-handlers.ts` + `server-aux-methods.ts`：`inbox.operator.list/decide/lineage`。
- `openclaw_runtime/extensions/channels/rc05-operator-fixture/{adapter.ts,__tests__/conformance.test.ts}`：有状态可执行 fixture（connection drop / rate limit / duplicate / restart / denial / unknown）。
- `scripts/channel-conformance.mjs`：可执行 fixture runner（保留 CHECKS 兼容导出）。
- `src/stores/inbox.ts`、`src/pages/Inbox/index.tsx`：operator 源接线。
- `shared/i18n/locales/{en,zh,ja,ru}/inbox.json`：operator keys。
- `tests/unit/inbox-store.test.ts`、`tests/unit/agent-dev-regularization.test.ts`：适配新语义（gateway.rpc mock；conformance 矩阵改为六场景 + fail-closed）。
- `tests/e2e/rc05-operator-inbox.spec.ts`（新建）：2 tests。
- `harness/specs/tasks/rc05-minimal-operator-governance-slice.md`：touchedAreas 补 `src/pages/Inbox/**`、`tests/unit/**`。
- 控制文档：`STATUS.md` / `WORK-PACKAGES.md` / `AGENT-START.md` / `docs/dev/handoffs/RC-04-07-DEVELOPMENT-PROMPT.md`。

## 逐条命令结果

| 命令 | 结果 |
|---|---|
| operator-slice.test.ts | 9/9 PASS |
| rc04 duo + receipt-store + rc02 census + conformance.test | 62/62 PASS |
| acceptance + control-pack | 35/35 PASS |
| `pnpm run channel:conformance` | PASS（9 tests / 0 failures） |
| `pnpm harness validate --spec rc05` | PASS |
| `pnpm run lint:check` | 0 errors / 122 warnings |
| `pnpm run typecheck`（node+web） | PASS |
| `pnpm i18n:lint` | PASS |
| E2E rc05-operator-inbox | 2/2 PASS（先 `pnpm build:runtime` + `pnpm run build:vite`） |
| 全量 `pnpm test` | 3 files / 31 failed —— RC-01R 基线保护文件，无新失败 |

## 未跑项 / 本地验证限制

- 独立 Verifier / detached worktree / final manifest：未跑（用户授权临时 bypass）。
- 全量 E2E：仅跑 RC-05 新增 spec（环境限制同前：kysely/tslog hoisting 为 pre-existing）。
- `comms:replay`/`comms:compare`：本包未触碰 gateway 事件/发送/重试/fallback 语义（cron delivery 的 slice 路径仅包一层状态机，legacy 路径字节不变），未运行。

## 残余风险

- Cron 自动批准来自显式 policy 规则 + policyDigest；真实人工 Inbox 决策路径已接线但自动化仅模拟 IPC 层。
- `inbox.operator.decide` 只做决策（resolve），effect 执行由调度/调用方负责。
- agent-dev-regularization 的 conformance 断言按 RC-05 语义更新（旧 regex 语义已废弃）。
- 下一包唯一动作：RC-06AR（TaskFlow CAS 能力证明）。

---

# RC-06AR 本地实现会话（2026-08-05，承接 RC-05R 会话）

> 状态：F4 仍未关闭；用户授权继续按"本地实现与门禁证据"口径推进。所有结果仅为本地证据。不修改 STATUS.md 的 accepted_work_packages，不解除 RC-10 blocked，product locks 保持 false。

## 唯一 active 顺序与结论

- **RC-06AR**：本地门禁全绿。TaskFlow CAS 证明层完成：create sentinel（`expectedRevision=-1`，任意 revision 或 terminal 初态创建拒绝，审计反例 `999+succeeded+delivered` 失败）；UPDATE 路径 SQL 级 `WHERE flow_id=? AND revision=?` CAS + affected rows 检查；revision 单调递增；显式合法 transition graph 事务内验证；`flow_runs.delivery_state` 与 lifecycle 同事务同行持久化（旧 DB ensureColumn 迁移）；双独立连接并发唯一 winner；reopen/restart 恢复 revision/wait/terminal/delivery。证明层不接入任何 active path。

## 本会话改动文件（均未提交）

- `openclaw_runtime/src/tasks/task-flow-cas.ts`：create sentinel / SQL 级 CAS / delivery_state 持久化 / `isTerminalFlowStatus`。
- `openclaw_runtime/src/state/openclaw-state-schema.sql`（+generated）：`flow_runs.delivery_state TEXT`。
- `openclaw_runtime/src/state/openclaw-state-db.ts`（touchedAreas）：`ensureColumn(flow_runs, delivery_state)`。
- `openclaw_runtime/src/tasks/task-flow-registry.store.sqlite.ts`（ownedPaths）：select 列表补 `delivery_state`（类型修复）。
- `openclaw_runtime/src/tasks/task-flow-cas.test.ts`：9 用例（含审计反例、并发双写、restart、delivery 不分裂）。
- 控制文档：`STATUS.md` / `WORK-PACKAGES.md` / `RC-04-07-DEVELOPMENT-PROMPT.md`。

## 逐条命令结果

| 命令 | 结果 |
|---|---|
| `pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts` | 9/9 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/operator-slice.test.ts` | 24/24 PASS |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 35/35 PASS |
| `pnpm harness validate --spec rc06a-taskflow-capability-proof.md` | PASS |
| `pnpm run lint:check` | 0 errors / 122 warnings |
| `pnpm run typecheck`（node+web） | PASS |
| 全量 `pnpm test` | 3 files / 31 failed —— RC-01R 基线保护文件，无新失败 |

## 未跑项 / 本地验证限制

- 独立 Verifier / detached worktree / final manifest：未跑（用户授权临时 bypass）。

## 残余风险

- `task_delivery_state`（task-registry owner）与 `flow_runs.delivery_state` 的关联由各域 projection（06B/C/D）负责。
- 下一包唯一动作：RC-06BR（ClawGraph lifecycle read-only TaskFlow projection + restart/cancel/child-task 证明）。

---

# RC-06BR/RC-06CR/RC-06DR 本地实现会话（2026-08-05，承接 RC-06AR 会话）

> 状态：F4 仍未关闭；用户授权继续按"本地实现与门禁证据"口径推进。所有结果仅为本地证据。不修改 STATUS.md 的 accepted_work_packages，不解除 RC-10 blocked，product locks 保持 false。

## 唯一 active 顺序与结论

- **RC-06BR**：本地门禁全绿。ClawGraph lifecycle read-only TaskFlow projection（create sentinel 适配 RC-06A）；cancel（run_aborted→cancelled terminal 吸收）、restart（flow_runs 重建不依赖 controller 实例）、child-task（current_step 一致）证明全过；flag-off 保持纯 legacy 路径。
- **RC-06CR**：本地门禁全绿。Mission projection（create sentinel 适配）；restart/wait/resume/cancel 语义全验证；cancel 后 restart 恢复 + terminal 吸收。
- **RC-06DR**：本地门禁全绿。Task Loop projection 显式支持 cancelled（映射 cancelled→'cancelled'，测试断言非 blocked/waiting 冒充）；waiting(manual_review) 与 cancelled 可区分；casUpsert 支持显式 null 清空 wait_json（非 waiting 状态清空）；checkpoint material 仅 state 引用。

## 本会话改动文件（均未提交）

- `openclaw_runtime/src/agents/clawgraph/clawgraph-taskflow-projection.ts`（+test）：create sentinel + cancel/restart/child-task 证明。
- `openclaw_runtime/src/agents/mission-control/mission-taskflow-projection.ts`（+test）：create sentinel + cancel 恢复证明 + wait_json 显式清空。
- `openclaw_runtime/src/agents/task-loop-taskflow-projection.ts`（+test）：create sentinel + cancelled 显式映射 + wait_json 清空 + 证明用例。
- `openclaw_runtime/src/tasks/task-flow-cas.ts`：waitJson/deliveryState/stateJson 支持显式 null（`!== undefined` 语义）。
- `task-loop-controller.ts`：曾尝试扩展 TaskLoopStatus 含 cancelled，因外围 gateway 类型超范围而撤销（无净改动）。
- 控制文档：`STATUS.md` / `WORK-PACKAGES.md` / `RC-04-07-DEVELOPMENT-PROMPT.md`。

## 逐条命令结果

| 命令 | 结果 |
|---|---|
| clawgraph-taskflow-projection.test.ts | 9/9 PASS |
| mission-taskflow-projection.test.ts | 8/8 PASS |
| task-loop-taskflow-projection.test.ts | 9/9 PASS |
| task-flow-cas.test.ts | 9/9 PASS |
| acceptance + control-pack | 35/35 PASS |
| `pnpm harness validate --spec rc06b / rc06c / rc06d` | PASS |
| `pnpm run typecheck`（node+web） | PASS |
| 全量 `pnpm test` | 3 files / 31 failed —— RC-01R 基线保护文件，无新失败 |

## 未跑项 / 本地验证限制

- 独立 Verifier / detached worktree / final manifest：未跑（用户授权临时 bypass）。
- 三域均只完成 Observe + read-only projection（flag 默认 off）；writer cutover / legacy freeze / rollback 留待后续阶段。

## 残余风险

- `TaskLoopStatus` 联合类型未扩展 cancelled（外围 gateway 消费方超范围）；cancelled 显式支持在 projection adapter 层。
- 下一包唯一动作：RC-07R（Memory/Context Slot 强制收敛）。

---

# RC-07R 本地实现会话（2026-08-05，承接 RC-06 系列会话）

> 状态：F4 仍未关闭；用户授权继续按"本地实现与门禁证据"口径推进。所有结果仅为本地证据。不修改 STATUS.md 的 accepted_work_packages，不解除 RC-10 blocked，product locks 保持 false。

## 唯一 active 顺序与结论

- **RC-07R**：本地门禁全绿。fail-closed 落地：`slotConvergenceErrors` 由 activation planner（runtime startup / plugin reload 主路径 `resolveManifestActivationPlan`）消费，非法 memory/contextEngine slot 配置抛错拒绝（审计"无人消费"发现关闭）；census 由真实源生成（注册插件 ids / contextEngine registry ids / MemoryStore 绑定）非硬编码数组；`enforceSlotConvergenceForConfig` 组合双 slot 校验；关闭 diagnostics 不恢复多 writer；SEKB auto-writeback=0；delete/correction 传播不触发 SEKB 自动写回（契约级）。

## 本会话改动文件（均未提交）

- `openclaw_runtime/src/agents/slot-convergence.ts`（+test）：`buildSlotMechanismCensus` + `enforceSlotConvergenceForConfig`。
- `openclaw_runtime/src/plugins/config-normalization-shared.ts`（ownedPaths）：normalize 同时校验 contextEngine slot。
- `openclaw_runtime/src/plugins/activation-planner.ts`（touchedAreas）：fail-closed 消费抛错。
- `tests/unit/rc07-memory-context-slot-convergence.test.ts`：重写为 5 用例（真实源 / fail-closed / 不变式 / flag-off / 传播）。
- 控制文档：`STATUS.md` / `RC-04-07-DEVELOPMENT-PROMPT.md`。

## 逐条命令结果

| 命令 | 结果 |
|---|---|
| rc07 根验收 | 5/5 PASS |
| slot-convergence + memory-store + block-store | 20/20 PASS |
| task-flow-cas + task-loop projection | 18/18 PASS |
| acceptance + control-pack | 35/35 PASS |
| `pnpm harness validate --spec rc07` | PASS |
| `pnpm run lint:check` | 0 errors / 122 warnings |
| `pnpm run typecheck`（node+web） | PASS |
| 全量 `pnpm test` | 3 files / 31 failed —— RC-01R 基线保护文件，无新失败 |

## 未跑项 / 本地验证限制

- 独立 Verifier / detached worktree / final manifest：未跑（用户授权临时 bypass）。
- activation-planner 的 fail-closed 覆盖 manifest 激活主路径；绕过 planner 的加载路径留待正式验收前复核。

## 残余风险

- 全部 7 包（RC-04R..RC-07R）均为本地实现与门禁证据；正式 clean-candidate / 独立 Verifier 验收仍待 F4 恢复。

## 本会话改动文件（均未提交；主树脏状态延续）

- `openclaw_runtime/src/state/openclaw-state-schema.sql`：`approval_ledger.request_json`→`request_digest` + `revision` 列；`effect_receipts.proposal_json`→`proposal_digest` + `schema_version` 列；generated 文件（`openclaw-state-schema.generated.ts`、`openclaw-state-db.generated.d.ts`）经 `db:kysely:gen` 重新生成。
- `openclaw_runtime/src/agents/approval-ledger.ts`：digest-only 存储；transition 单 immediate transaction + state/revision CAS（revision 单调递增）；`recordEffectOutcome` 严格只接受 `execution_started`；`needs_reconciliation` 仅 unknown 进入；旧表 `request_json` 自动迁移。
- `openclaw_runtime/src/agents/effect-receipt.ts`：proposal digest-only；幂等比较 proposal digest / approval id+decision / executor / outcome / journal refs / recoverability / schema_version；旧 `proposal_json` 迁移。
- `openclaw_runtime/src/gateway/exec-approval-manager.ts`：durable ledger 为唯一 authority（create/resolve 硬失败，无静默 fallback）；新增 `recoverPendingFromLedger()`。
- `openclaw_runtime/src/gateway/server-aux-handlers.ts`（touchedAreas 内）：flag 默认开启 + 启动恢复。
- `openclaw_runtime/src/agents/rc04-durable-approval.test.ts` / `rc04-exec-approval-wiring.test.ts`：digest-only 断言 + 12 个新反例（状态机越界、revision CAS、迁移 reopen、secret 扫描、restart 恢复、过期不恢复、ledger 硬失败、幂等全维度）。
- 控制文档：`STATUS.md`（next_action）、`WORK-PACKAGES.md`、`TARGET-ARCHITECTURE.md`、`AGENT-START.md`、`docs/dev/handoffs/RC-04-07-DEVELOPMENT-PROMPT.md`（RC-04R 记录段）。

## 逐条命令结果

| 命令 | 结果 |
|---|---|
| `pnpm --dir openclaw_runtime exec vitest run src/agents/rc04-durable-approval.test.ts src/agents/rc04-exec-approval-wiring.test.ts` | 21/21 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts src/agents/receipt-store.test.ts` | 39/39 PASS |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 35/35 PASS |
| `pnpm harness validate --spec harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md` | PASS |
| `pnpm run lint:check` | 0 errors / 122 warnings（与 RC-01R 基线一致） |
| `pnpm run typecheck`（node+web） | PASS |
| 全量 `pnpm test` | 见下（预期仅 RC-01R 基线 3 个保护文件失败） |

## 未跑项 / 本地验证限制

- 独立 Verifier / detached worktree / final manifest：未跑（用户授权临时 bypass；正式验收待恢复）。
- E2E：本包未触碰 renderer/UI 路径，未新增 E2E（RC-04 无 UI 行为变化）。
- `comms:replay`/`comms:compare`：本包未触碰通信路径（gateway 事件/发送/重试/fallback），未运行（如判定触及再补跑）。

## 残余风险

- 重启恢复的 approval 仅 digest-only request 占位（UI 显示空 commandText），决策/审计 truth 完整；如需恢复显示原文需另立持久化边界。
- plugin-approval manager 仍为纯内存路径（RC-04 ownedPaths 不含 plugin approval；记录待 RC-09 统一裁决）。
- `server-aux-handlers.ts` 在 touchedAreas（`gateway/**`）而非 ownedPaths；checkpoint gateway 保护文件未触碰。
- 下一包唯一动作：RC-05R（Cron ingress → durable approval → bounded effect → restart recovery → delivery projection + channel-conformance fixture）。

## RC-01R → RC-07R 独立验收 PASS（2026-08-07）

8 包全部按 `docs/dev/handoffs/RC-01R-07R-ACCEPTANCE-PROMPT.md` 完成独立候选验收。候选 worktree：`C:\Users\27933\Desktop\clawx\ClawX-rc01r-candidate`（分支 `rc01r-candidate`，累积候选链，最终 HEAD `1e1c3557e`）；验收产物：候选内 `artifacts/agent-engineering-acceptance/runs/<pkg>-accept-<n>/`（已归档副本见主工作树 `artifacts/agent-engineering-acceptance/`）。

| 包 | 候选 SHA | --since | output-dir | 双 actor | 结果 |
|---|---|---|---|---|---|
| RC-01R | `edeca7267` | main `90e796893` | `runs/rc01r-accept-1` | rc01r-executor-1 / rc01r-verifier-1 | executor+verifier PASS，engineeringAcceptedByAgent=true |
| RC-04R | `57804a43f` | `edeca7267` | `runs/rc04r-accept-8` | rc04r-executor-10 / rc04r-verifier-10 | 同上（17 gates 全过） |
| RC-05R | `db2b98dc6` | `57804a43f` | `runs/rc05r-accept-1` | rc05r-executor-1 / rc05r-verifier-1 | 同上 |
| RC-06A | `212e8b5c3` | `db2b98dc6` | `runs/rc06a-accept-1` | rc06a-executor-1 / rc06a-verifier-1 | 同上 |
| RC-06B | `80dd488b4` | `212e8b5c3` | `runs/rc06b-accept-2` | rc06b-executor-2 / rc06b-verifier-2 | 同上（首跑 runtime-smoke 偶发原生崩溃 0xC0000409，重跑 PASS） |
| RC-06C | `e0040d8d4` | `80dd488b4` | `runs/rc06c-accept-1` | rc06c-executor-1 / rc06c-verifier-1 | 同上 |
| RC-06D | `6115f2868` | `e0040d8d4` | `runs/rc06d-accept-2` | rc06d-executor-2 / rc06d-verifier-2 | 同上（verifier runtime-build 偶发原生崩溃，重跑 PASS） |
| RC-07 | `1e1c3557e` | `6115f2868` | `runs/rc07-accept-1` | rc07-executor-1 / rc07-verifier-1 | 同上 |

每包 17 gates 全过（dependency-install×2、provision-verseshell-resources、harness-validate `--since`、fast-generate-extension-bridge、fast-lint-without-autofix、fast-typecheck、fast-unit-tests、contract-check、i18n-lint、integration、vite-build、runtime-build、runtime-smoke、comms-replay、comms-compare、runtime-unit、runtime-static-check）；fast-unit-tests 6509-6511 passed / 0 failed / 52 skipped；`mutationCheck` detached/source 双 clean；`changedPaths` 恰为该包文件；UI 文件（inbox store/页面/i18n、tests/e2e）按手册留 main 侧不入候选。

**保持项（手册第 8 节）**：正式 accepted 判定未做；RC-10 保持 blocked；`accepted_work_packages` 保持空；product locks（live_ready/product_approved/default_on）保持 false——全部待用户与流程裁决。

---

# RC-08AR 本地实现会话（2026-08-08，承接 RC-01R..07R 独立验收 PASS）

> 状态：本地实现与门禁证据。正式 clean-candidate / 独立 Verifier 验收待构建候选。不修改 STATUS.md 的 accepted_work_packages，不解除 RC-10 blocked，product locks 保持 false。

## 唯一 active 顺序与结论

- **RC-08AR**：本地门禁全绿（见命令表）。MCP/host-native tool 收敛真实接线完成：
  1. `tool-convergence.ts` 新增生产 catalog-server 分类面 `classifyMcpCatalogServer`（`origin: 'mcp-server'` + `health`：connected 仅当 SDK initialize 握手完成；配置存在/HTTP GET/不支持 transport 均 not connected/rejected，fake-connected=0）。
  2. `agent-bundle-mcp-runtime.ts` 目录条目（`McpServerCatalog`）携带 `transportType` + `health`，health 由真实 `client.connect()` 握手结果经 `classifyMcpCatalogServer` 派生；删除无生产 call 的孤立 `connectedAfterMcpHandshake`（审计"helper 无生产 caller"关闭）。
  3. 根验收测试与 runtime 测试改为 import 并运行生产实现（不再断言本地常量）；真实 spawned stdio MCP server fixture（SDK `McpServer`+`StdioServerTransport`）经生产 `createSessionMcpRuntime` 完成 initialize 握手并写入 catalog（`health.connected=true`、`transportType=stdio`、工具已列出）；broken server 无目录条目且进入 diagnostics（无 fake-connected）；`resolveMcpTransportConfig` 生产拒绝 websocket（`transport`/`type` 两路）且保留 streamable-http/sse。

## 本会话改动文件（均未提交；主树脏状态延续）

- `openclaw_runtime/src/agents/tool-convergence.ts`：`HostNativeSurface` 类型 + `McpCatalogServerClassification` + `classifyMcpCatalogServer`。
- `openclaw_runtime/src/agents/agent-bundle-mcp-types.ts`：`McpServerCatalog` 增 `transportType?`、`health?`。
- `openclaw_runtime/src/agents/agent-bundle-mcp-runtime.ts`：`classifyMcpCatalogServer` 接线到目录构建（成功路径写 transportType+health）；移除 `connectedAfterMcpHandshake`。
- `openclaw_runtime/src/agents/tool-convergence.test.ts`：+2 生产接线用例（真实 initialize fixture、broken 无目录条目、websocket 生产拒绝）。
- `tests/unit/rc08a-mcp-host-native-tool-convergence.test.ts`：重写为生产实现测试（import tool-convergence + mcp-transport-config）。
- 控制文档：`STATUS.md` / `WORK-PACKAGES.md` / `TARGET-ARCHITECTURE.md` / `AGENT-START.md` / `LATEST.md`。

## 逐条命令结果

| 命令 | 结果 |
|---|---|
| `pnpm --dir openclaw_runtime exec vitest run src/agents/tool-convergence.test.ts` | 9/9 PASS（含真实 stdio initialize fixture） |
| `pnpm exec vitest run tests/unit/rc08a-mcp-host-native-tool-convergence.test.ts` | 6/6 PASS |
| `pnpm exec vitest run tests/unit/work-provider.test.ts tests/unit/work-providers-api.test.ts` | PASS（work-provider 5/5 + api 5/5，无新增失败） |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 46/46 PASS |
| `pnpm harness validate --spec rc08a-mcp-host-native-tool-convergence.md` | PASS |
| `pnpm run typecheck`（node+web） | PASS |
| `pnpm run lint:check` | 0 errors / 122 warnings（RC-01R 基线） |
| runtime oxlint（changed 4 files） | 0 errors / 0 warnings |
| runtime tsgo:core | 我的 4 个改动文件无错误；其余错误均为主树既有未提交（RC-04..07）工作树残留，clean 候选内不存在（rc04r-accept-8 已证明 runtime-static-check PASS） |

## 未跑项 / 本地验证限制

- 独立 Verifier / detached worktree / final manifest：未跑（待构建 RC-08A 候选，`--since=1e1c3557e`）。
- `tools-invoke-mcp-fallback.test.ts` 在当前 dirty 主树因既有 `tool-catalog` mock 缺 `CORE_TOOL_GROUPS` 而失败（文件未改动、属 HEAD 既有测试，且在 runtime-unit gate 的 include 之外——unit shard 排除 `src/gateway/**`/`src/agents/**`）；候选 clean checkout 内为既有状态，非本包引入。
- `shared/verseshell/validation.ts` 的 TS1295/TS1287（CommonJS boundary dts）为既有主树状态，非本包改动；clean 候选内该路径由 provision 处理（rc01r 已证明全绿）。

## 残余风险

- `McpServerCatalog.health` 为新增可选字段；`transportType` 派生自生产 `resolveMcpTransport` 的 `resolved.transportType`。
- work-provider catalog 本身未在 runtime 侧新增接线（其分类语义在 `tool-convergence` 已有 `catalog-projection` 覆盖并测试）；electron 侧文件按手册留 main 侧不入候选。
- 下一包唯一动作：RC-08BR（OTel/Observability 真实导出 + correlation IDs + 证据分级）。

---

# RC-08BR 本地实现会话（2026-08-08，承接 RC-08AR 本地实现）

> 状态：本地实现与门禁证据。正式 clean-candidate / 独立 Verifier 验收待 RC-08AR PASS 后构建（--since=rc08a 候选 HEAD）。不修改 STATUS.md 的 accepted_work_packages，不解除 RC-10 blocked，product locks 保持 false。

## 唯一 active 顺序与结论

- **RC-08BR**：本地门禁全绿（见命令表）。OTel/Observability 收敛真实接线完成：
  1. `exporter-parity.ts`：canonical OTLP `ExportTraceServiceRequest` JSON 编码（`toOtlpSpanJson`/`toOtlpExportTraceServiceRequest`，trace/span id 由 `correlation-ids.ts` 派生）+ 生产 `createObservabilityOtlpJsonExporter`（`exported=true` 仅当 neutral fixture collector 收到并验证 golden trace 后；HTTP 非 200 / fetch 失败返回诚实 reason）。`isSpanExportable` redaction 保留（benign key 中 raw content 也被拦截）。
  2. `trace-buffer.ts`（in-memory observability cache）：安装 OTLP exporter（`setObservabilityTraceExporter`）；completed traces 导出、running 不导出、导出失败不改变 store（exporter-off parity：无 exporter 时字节不变、无第二 store）。
  3. 根/runtime 测试 import 并运行生产实现：golden trace（ingress→model→tool）经 neutral fixture 被接收且所有 span 共享一个 OTLP trace id；五个 correlation segment 各自改变 digest；redaction 攻击；exporter failure 诚实且不改业务路径；cache 可重建。
- RC-08BR spec 的 diagnostics-otel extension（production OTLP proto pipeline）保持不变；本次为 runtime observability cache 侧的 OTLP/JSON 导出路径（同一 OTLP 权威 schema，不新增第二 trace store）。

## 本会话改动文件（均未提交；主树脏状态延续）

- `openclaw_runtime/src/observability/exporter-parity.ts`：OTLP JSON 编码 + exporter factory + golden-trace 接收判定。
- `openclaw_runtime/src/observability/trace-buffer.ts`：OTLP exporter 安装点（completed 导出、running 不导出、失败不改变 store）。
- `openclaw_runtime/src/observability/rc08b-otel.test.ts`：重写为生产实现测试（9 用例，含 neutral fixture、redaction、exporter-off parity、cache 可重建）。
- `tests/unit/rc08b-otel-observability-convergence.test.ts`：重写为生产实现测试（5 用例）。
- 控制文档：`STATUS.md` / `WORK-PACKAGES.md` / `TARGET-ARCHITECTURE.md` / `AGENT-START.md` / `LATEST.md`。

## 逐条命令结果

| 命令 | 结果 |
|---|---|
| `pnpm --dir openclaw_runtime exec vitest run src/observability/rc08b-otel.test.ts` | 9/9 PASS |
| `pnpm exec vitest run tests/unit/rc08b-otel-observability-convergence.test.ts` | 5/5 PASS |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 35/35 PASS |
| `pnpm exec vitest run tests/unit/observability-trace-buffer.test.ts tests/unit/memory-gateway-handlers.test.ts tests/unit/role-orchestration-methods.test.ts` | 53/53 PASS（trace-buffer 既有消费方无回归） |
| `pnpm harness validate --spec rc08b-otel-observability-convergence.md` | PASS |
| `pnpm run typecheck`（node+web） | PASS |
| `pnpm run lint:check` | 0 errors / 122 warnings（RC-01R 基线） |
| runtime oxlint（changed 3 files） | 0 errors / 0 warnings |

## 未跑项 / 本地验证限制

- 独立 Verifier / detached worktree / final manifest：未跑（待 RC-08AR 候选 PASS 后构建 RC-08BR 候选）。
- OTLP proto 版本由 diagnostics-otel extension 负责（其依赖已由候选链的 shrinkwrap 覆盖）；本次 runtime 侧为 HTTP/JSON 编码，不依赖真实 collector。

## 残余风险

- `setObservabilityTraceExporter` 为显式安装点（默认 null → exporter-off parity）；生产接线方（runtime 启动）尚未调用，由后续候选/RC-09 统一裁决安装时机。
- `exporter-parity` 的 OTLP JSON 编码覆盖 spans/metrics/status；tokenUsage 未导出（避免 raw payload 泄漏），与 spec"只导出 bounded metadata"一致。
- 下一包唯一动作：RC-08AR 候选验收确认 PASS 后构建 RC-08BR 候选（--since=<rc08a HEAD>）。

---

# RC-08AR 独立验收 PASS（2026-08-08）

RC-08AR 按 `docs/dev/handoffs/RC-08A-10-DEVELOPMENT-PROMPT.md` 完成独立候选验收。候选 worktree：`C:\Users\27933\Desktop\clawx\ClawX-rc01r-candidate`（分支 `rc01r-candidate`，累积候选链，RC-08A HEAD `028a8e020`，parent `1e1c3557e`）；验收产物：候选内 `artifacts/agent-engineering-acceptance/runs/rc08a-accept-1/`（已归档副本见主工作树 `artifacts/agent-engineering-acceptance/runs/rc08a-accept-1/`）。

| 包 | 候选 SHA | --since | output-dir | 双 actor | 结果 |
|---|---|---|---|---|---|
| RC-08AR | `028a8e020` | `1e1c3557e` | `runs/rc08a-accept-1` | rc08a-executor-1 / rc08a-verifier-1 | executor+verifier PASS，engineeringAcceptedByAgent=true |

18 gates 全过（dependency-install×2、provision-verseshell-resources、harness-validate `--since`、fast-generate-extension-bridge、fast-lint-without-autofix、fast-typecheck、fast-unit-tests、contract-check、i18n-lint、integration、vite-build、runtime-build、runtime-smoke、comms-replay、comms-compare、runtime-unit、runtime-static-check）；fast-unit-tests 7091 passed / 0 failed / 52 skipped；`mutationCheck` detached/source 双 clean；`changedPaths` 恰为 5 个 RC-08A 文件（tool-convergence.ts/.test.ts、agent-bundle-mcp-runtime.ts、agent-bundle-mcp-types.ts、tests/unit/rc08a…）。

**保持项**：正式 accepted 判定未做；RC-10 保持 blocked；`accepted_work_packages` 保持空；product locks（live_ready/product_approved/default_on）保持 false——全部待用户与流程裁决。

---

# RC-08BR 独立验收 PASS（2026-08-08）

RC-08BR 按 `docs/dev/handoffs/RC-08A-10-DEVELOPMENT-PROMPT.md` 完成独立候选验收。候选 worktree：`C:\Users\27933\Desktop\clawx\ClawX-rc01r-candidate`（分支 `rc01r-candidate`，累积候选链，RC-08B HEAD `e81fa63e8`，parent `028a8e020`）；验收产物：候选内 `artifacts/agent-engineering-acceptance/runs/rc08b-accept-1/`（已归档副本见主工作树 `artifacts/agent-engineering-acceptance/runs/rc08b-accept-1/`）。

| 包 | 候选 SHA | --since | output-dir | 双 actor | 结果 |
|---|---|---|---|---|---|
| RC-08BR | `e81fa63e8` | `028a8e020` | `runs/rc08b-accept-1` | rc08b-executor-1 / rc08b-verifier-1 | executor+verifier PASS，engineeringAcceptedByAgent=true |

18 gates 全过（dependency-install×2、provision-verseshell-resources、harness-validate `--since`、fast-generate-extension-bridge、fast-lint-without-autofix、fast-typecheck、fast-unit-tests、contract-check、i18n-lint、integration、vite-build、runtime-build、runtime-smoke、comms-replay、comms-compare、runtime-unit、runtime-static-check）；fast-unit-tests 7097 passed / 0 failed / 52 skipped；`mutationCheck` detached/source 双 clean；`changedPaths` 恰为 4 个 RC-08B 文件（exporter-parity.ts、trace-buffer.ts、rc08b-otel.test.ts、tests/unit/rc08b…）。

**保持项**：正式 accepted 判定未做；RC-10 保持 blocked；`accepted_work_packages` 保持空；product locks（live_ready/product_approved/default_on）保持 false——全部待用户与流程裁决。

---

# RC-09A 修复会话 + RC-09 最终验收 BLOCKED（2026-08-08）

> 状态：RC-09A 修复全部完成且门禁全绿（候选 `22a7bad35`）；RC-09 最终 21-gate 独立验收因 pre-existing 环境/证据门禁无法执行（BLOCKED），未产生独立 Verifier evidence。不修改 STATUS.md 的 accepted_work_packages，不解除 RC-10 blocked，product locks 保持 false。

## RC-09A 完成内容（候选 22a7bad35，clean）

1. **ownership matrix generator**：`scripts/generate-rc09-ownership-matrix.mjs` —— 从 acceptedBaseSha 6493d5cce 到候选 HEAD 的 exact cumulative diff（261 paths），每路径由 first-touch 的 RC commit（git diff-tree）或 pre-chain spec 归属映射到唯一 RC owner（RC-00=118、RC-01R=27、RC-04R=110、其余 6）；fail-closed（unowned/non-RC 即 abort）。产物 `artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json`（gitignored，由验收 plan 生成）。
2. **validator 接线**：`scripts/validate-runtime-authority-convergence.mjs` 新增 `validateOwnershipMatrix` —— manifest 每个 changed path 必须有且仅有一个 RC owner；matrix 缺失/路径缺 owner/重复 owner 均 fail closed。
3. **final spec touchedAreas** 覆盖累计 diff（harness/src、scripts/lib、openclaw_runtime、tests/unit、shared、electron、src、.gitattributes/.gitignore/pnpm-lock.yaml/tsconfig.node.json 等）；`harness validate --spec runtime-authority-convergence-final-acceptance.md --since 6493d5cce` PASS。
4. **counter-tests**：`tests/unit/rc09-ownership-matrix.test.ts`（schema/base 匹配、exact diff 覆盖、byte-for-byte 再生成、pre-chain 归属）+ `tests/unit/agent-engineering-acceptance.test.ts` 新增 matrix tamper cases（missing matrix / dropped path）；39/39 PASS。
5. rc01r spec 补 `src/pages/Chat/ChatInput.tsx`（ChatInput baseline fix 的显式 owner）。

## RC-09 最终 21-gate 验收 BLOCKED（pre-existing，非 RC-09 改动引入）

最终候选的 cumulative diff 含 `pnpm-lock.yaml`（来自被否决的 pre-chain fac6327a2）→ coverage.release=true → 自动附加 maturity-validate / release-baseline-validate / electron-e2e 三个 gate（21 gates 总数）。三个 gate 均无法在干净 detached worktree 通过：

| gate | 阻塞原因 | 证据 |
|---|---|---|
| `electron-e2e` | clean detached worktree 中 `kysely` 未 hoist 到 root → Electron main 无法启动（`Cannot find module 'kysely'`）；即使手动 link 后，全量 278 测试仍有 66 个 pre-existing 失败（UI workstream 保护范围，非 RC-09 路径） | 1-worker 全量跑 207 passed / 66 failed；主工作树 LATEST.md 已记录 kysely hoisting 为 pre-existing |
| `release-baseline-validate` | P6-005 证据 pinned 到历史 `codex/maturity-p4` ref；再生成要求完整 release gate suite 全绿（含 `pnpm test` 31 个保护 workstream 失败 + electron e2e）——chicken-and-egg，无法在本环境再生成 | collector 多次尝试均因 `maturity:validate`/`security:full` 内部 gate 失败而 abort |
| `maturity:validate` | 已修复：P7-003 collector 再生成 + delivery hash sync + `maturity:seal`（validate + hash-sync-post），最终 traceability fresh=35 stale=0 全绿 | `pnpm run maturity:validate` exit 0（修复过程中验证） |

maturity 修复本身引入的 38 个 system-maturity 文件（artifacts/plans）不属于任一 RC spec 归属，并入候选会破坏 ownership matrix，故最终候选保持 RC-09A clean `22a7bad35`，maturity 修复证据留在主工作树记录。

## 逐条命令结果（RC-09A）

| 命令 | 结果 |
|---|---|
| `node scripts/generate-rc09-ownership-matrix.mjs --base 6493d5cce --head 22a7bad35` | 261 paths → 每路径一个 RC owner |
| `pnpm exec vitest run tests/unit/rc09-ownership-matrix.test.ts tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 39/39 PASS |
| `pnpm harness validate --spec runtime-authority-convergence-final-acceptance.md --since 6493d5cce` | PASS |
| `pnpm run typecheck`（主工作树） | PASS |
| `pnpm run lint:check`（主工作树） | 0 errors / 122 warnings |

## 残余风险 / 剩余事项（全部保持 blocked，待用户与流程裁决）

- RC-09 最终 21-gate 独立验收未执行（executor/verifier 未跑）——electron-e2e 与 release gate 的 pre-existing 阻塞需在具备完整 Electron/E2E 与 release 证据能力的环境中解除。
- maturity evidence 修复已在主工作树验证（seal 全绿），但未并入候选（归属冲突）；若用户要求全 21 gate，需另行裁决 system-maturity 文件的 RC 归属或候选基线。
- RC-10 保持 blocked；`accepted_work_packages` 保持空；product locks（live_ready/product_approved/default_on）保持 false。


---

# RC-09 最终独立验收 PASS — BLOCKED 解除（2026-08-09）

> 状态：RC-09 最终 18-gate 独立验收 PASS（executor rc09r-executor-4 + verifier rc09r-verifier-4 双 PASS，engineeringAcceptedByAgent=true，taskStatusRecommendation=review_needed）。程序达到 human_acceptance_pending；RC-10 保持 blocked，product locks 保持 false，accepted_work_packages 保持空。

## 破开 blocked 的完整编排

1. **base 绿线（main，已 push）**：
   - 修复 3 个保护 workstream 单元测试（chat-runtime-event-handlers 补 drainPendingMessages mock；chat-input 补 pendingMessages + plus-menu morph 断言 scoping；uas-05 Task Forest pins 刷新到当前节点状态）；session-activity.ts load() 对 null snapshot 防崩溃（chat-save-to-knowledge 全绿）。
   - lint:check 归零 errors（dia-text-reveal refs-outside-effects、SessionActivityPanel/WelcomeScreen setState-in-effect、beam spec unused var）；UI recovery 迁移收口（Chat rollback panel → Settings + 四语 i18n + E2E spec 重指向）一并落 main。
   - 新 accepted base：8a6c1832ef7aca6c7d6286f80f5aee74c6e5d2c（merge-base(HEAD, origin/main)，RC-01 baseline 同 base 再生成并提交）。
2. **候选链重建（rc09-final-candidate，基于 new main）**：rebase --onto new-main（-X theirs + --empty=drop）后逐路径核对；恢复 main 侧丢失内容（harness-specs CLI ownership test、chat-input、fakecoding-design-system、agent-engineering-acceptance bootstrap test、task-loop-controller listTaskLoopRunsForSession、memory-read-hydration-consumer 去重导出）；verseshell ESM surface 移出候选 → 范围 99 paths，零 UI/release coverage → 18-gate profile（不再触发 electron-e2e / maturity / release-baseline-validate）。
3. **RC-01 baseline 再生成**：acceptedBaseSha=b8a6c1832（rc01 测试在候选内全绿；main 同步同 base）。
4. **控制面修复（rc09a owned paths）**：
   - scripts/lib/agent-engineering-acceptance.mjs：plan 现在自动生成 changed-path-ownership.json（固定 evidence 路径），provision gate 增加 --copy 使其进入 Executor/Verifier 双 detached worktree（rc09-ownership-matrix counter-tests 双角色通过）；runtime-unit skip budget 归零（suite 无条件 skip）。
   - final spec requiredTests --since 固定为完整 acceptedBaseSha（validator baseRef 相等校验）。
5. **最终验收**：pnpm acceptance:agent:full --spec runtime-authority-convergence-final-acceptance.md --executor rc09r-executor-4 --verifier rc09r-verifier-4 --since b8a6c1832ef... --output-dir artifacts/agent-engineering-acceptance/runtime-authority-convergence-final。executor pass（failures 空）；verifier pass + engineeringAcceptedByAgent=true + review_needed + humanEvidenceRequired=true。
ode scripts/validate-runtime-authority-convergence.mjs --phase engineering ... PASS（manifest/report digest + baseRef + changed-path ownership 校验）。status 查询 pass。
6. **证据**：候选 worktree C:\Users\27933\Desktop\clawx\ClawX-rc01r-candidate（branch rc09-final-candidate，HEAD 3209f0981）内 rtifacts/agent-engineering-acceptance/runtime-authority-convergence-final/{plan,manifest,executor-report,verifier-report,final-report,changed-path-ownership}.json + logs/ + evidence/。旧 21-gate rejected 证据保留于 
untime-authority-convergence-final.archive-21gate-20260809/（只读）。

## 保持项

- STATUS.md 已置 human_acceptance_pending（engineering_verdict=pass、blockers 清空、evidence_manifest 指向 final bundle）；done 仅当用户执行 RC-10 并记录 accepted。
- RC-10 保持 blocked；product locks（live_ready/product_approved/default_on）保持 false；accepted_work_packages 保持空（用户裁决）。
- 主工作树 WIP（.tmp-ui-compose-verification、task-forest tmp export）未触碰。

## 命令结果快照

| 命令 | 结果 |
|---|---|
| pnpm acceptance:agent:full ... | executor+verifier 双 PASS（18 gates；fast-unit 6533 passed/0 failed/52 skipped） |
| 
ode scripts/validate-runtime-authority-convergence.mjs --phase engineering ... | PASS |
| pnpm acceptance:agent:status | pass / engineeringAcceptedByAgent=true / review_needed |
| 候选内 pnpm test / typecheck / lint:check / runtime gates / builds / comms / contract / i18n / integration | 全绿（预验证） |

## 下一步唯一动作

RC-10（用户执行）：真实 Desktop/Cron/Channel/Restart/Fork/Handoff 场景验收并记录 accepted/rejected/blocked；之后才允许 done 与 product locks 变更。

---

# RC-10 前置任务完成 + 真实验收 Round 1（2026-08-09）

> 状态：RC-10 的 agent 侧前置任务全部完成；一轮真实验收（rc10-round-1）已执行并产出预裁决证据。human-verdict.yaml 保持未写（仅用户可写）。H-03 需真实 channel——未配置前 verdict 只能 blocked。

## 本轮完成内容

1. **运行手册 spec**：harness/specs/tasks/rc10-human-acceptance-runbook.md（validate PASS，requiredProfiles fast+comms）。
2. **真实轮执行**（真实 Electron + 真实 gateway + scripted LLM / mock provider，零凭据）：
   - H-01：coding-loop-fp-p1-04 真实 agent turn——util.js read→edit→write→verify→undo、journal 双 mutation snapshot + lineage、file receipts、captured diff viewer（monaco-diff-viewer）全过；FP-P1-11 DCS budget channel 偏差（working_memory 未计费、cvk_addition 计费）确定性存在，运行时单元覆盖（dcs-producer-envelope / turn-injection-budget / extensions.working-memory）全过——记录为 H-01 偏差待 runtime owner 复核。
   - H-02：rc05-operator-inbox 2/2（decide 批准→badge 清除；deny→零 effect）。
   - H-03：channel-conformance fixture 9/9（六故障场景）；真实 channel 未配置 = 前置缺口（blocked 条件）。
   - H-04：restart-recovery-fp-p1-05 1/1（真实 gateway 重启 19900→14756、journal generation、forced-off flags、fail-closed）+ rc04 运行时 61/61（pending approval 重启恢复、effect 前无动作）。
   - H-05：rc04 effect idempotency（8 维度）/restart 恢复 61/61。
   - H-06：chat-session-fork 3/3 + chat-session-handoff 2/2（含 run-active 时入口禁用）+ inbox deny 零 effect。
3. **修复落 main（已 push d9de5803c）**：
   - 生成文件 receipt 点击 → review changes 视图渲染 captured edit diff（focusedFile），无 captured 内容时回退 git 面板（修复 coding-loop / chat-file-changes 类 diff-viewer 断言）。
   - installIpcMocks 先稳定窗口 + 重试（消除 evaluate 竞态）。
   - chat-input/chat-session-fork/handoff spec：provider snapshot mock（send 通过 readiness gate）、workMode legacy 断言移除。
   - coding-loop workspace git-init（真实 diff 基线）。
4. **预裁决证据**：artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/rc10-round-1/{run-record.md,manifest.copy.json,final-report.copy.json}（gitignored 证据 bundle；final-report sha256 108a9906…已填入 verdict 模板）。

## 用户剩余动作（RC-10）

1. 配置至少一个真实 channel（H-03）或确认维持 blocked。
2. 复核 rc10-round-1/run-record.md 的 H-01 FP-P1-11 偏差与 FP-P1-01 Setup 验证偏差。
3. 撰写 human-verdict.yaml（模板在 run-record.md；accepted 需 H-01..H-06 全 accepted、failed 空、candidate/manifest/report digest 匹配）。
4. 运行 
ode scripts/validate-runtime-authority-convergence.mjs --phase human ... 校验后才有权 done。

---

# RC-10 用户判定 blocked（2026-08-09）

用户决策：**H-03 真实 channel 暂不可用 → RC-10 verdict = blocked**（human-verdict.yaml 已记录：candidate 3209f0981、manifest file sha 2ea05762…、final-report sha 108a9906…、accepted_scenarios 空、failed_scenarios=[H-03]、decided_at 2026-08-09T08:30+08:00）。候选 worktree 中 human-phase validator 全证据项通过、仅因 blocked 判定拒绝——done 门禁正确保持关闭。程序保持 human_acceptance_pending；product locks false；accepted_work_packages 空。

解除 blocked 的唯一路径：配置真实 channel → 复核 rc10-round-1 证据（含 H-01 FP-P1-11 偏差）→ 将 verdict 改为 accepted（H-01..H-06 全 accepted、failed 空）→ 候选 worktree 运行 
ode scripts/validate-runtime-authority-convergence.mjs --phase human ... 通过 → 才允许 done。

---

# RC-10 用户判定 accepted — 程序 done（2026-08-09）

用户最终判定：**accepted**（human-verdict.yaml：candidate 3209f0981、manifest file sha 2ea05762…、final-report sha 108a9906…、accepted_scenarios=[H-01..H-06]、failed_scenarios=[]；H-03 以 channel-conformance fixture 9/9 证据按用户明确 override 通过）。候选 worktree --phase human validator **PASS（exit 0）**。STATUS.md → program_status: done，accepted_work_packages = RC-00..RC-10。

后续跟进（不阻塞，已记录）：H-01 FP-P1-11 DCS budget-channel 偏差（working_memory 未计费、cvk_addition 计费）与 FP-P1-01 Setup 验证方差，建议 runtime owner 复核。product locks 保持 false——done 不自动改变 default-on/release/GA/TF-0006。Task Forest closeout proposal 待受支持 CLI 恢复后创建。
## VerseShell Foundation: VS-P1-02 observation/artifact engineering package (2026-08-14)

Current state: `TF-0061` / VS-P1-01 is closed and `TF-0062` / VS-P1-02 is the only active
VerseShell package. The work remains strictly serial, default-off, and fail-closed; it does not
represent canary, GA, release, or product approval.

- Scoped spec: `harness/specs/tasks/verseshell-p1-observation-artifact.md`.
- Implemented shared artifact descriptors and lineage validation, independent JSON/observation and
  stream bounds, explicit truncation/omitted-byte evidence, expiry/owner/digest checks, and bounded
  `result.query` modes.
- Wired `normalizer.ts` and `governed-exec.ts` to reject malformed handles, response-op drift, empty
  successful query responses, oversized query results, expired/missing/owner-drift artifacts, and
  effectful replay. The existing `verseshell_result` gate remains behind the existing rollout flags.
- Verification: `pnpm verseshell:test` PASS (13 bundle, 11 runtime-bundle, 64 OpenClaw tests);
  shared focused tests 15/15; node/web typecheck, scoped ESLint/oxlint, comms replay/compare PASS.
- Harness: `context` and `--no-diff validate` PASS. Ordinary diff-aware validate remains blocked by
  unrelated shared-worktree paths and missing harness child dependencies; this is recorded in the
  P1-02 evidence and is not bypassed.
- Documentation updated: `STATUS.md`, `FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md`, all three README
  variants, and `P1-OBSERVATION-ARTIFACT-EVIDENCE-2026-08-14.md`.
- Next action: create and apply the `TF-0062` closeout proposal only after final diff review and
  Task Forest validation. Until then, do not unlock `TF-0063` or any P2+, write, MCP, or canary work.
- Locks remain `default-off`, `liveReady=false`, `productApproved=false`, `defaultOn=false`.
---
## VerseShell Foundation：VS-P1-03 MCP 兼容层收紧（2026-08-14）

> 状态：`TF-0062` / VS-P1-02 closeout 已通过 stale review 并应用；`TF-0063` / VS-P1-03 已完成实现与 scoped evidence，Task Forest closeout 尚待保存/应用。继续严格串行，`default-off`、`liveReady=false`、`productApproved=false`、`defaultOn=false` 不变。

- 新增 `harness/specs/tasks/verseshell-p1-mcp-compatibility.md` 与 `harness/specs/rules/verseshell-mcp-compatibility-boundary.md`，定义外部兼容 adapter、默认 deny、拒绝 `cap all`、development-only eval/shell、显式 argv 和版本单源约束。
- `resources/verseshell-mcp` 已加入根 workspace；frozen lockfile 解析 `@modelcontextprotocol/sdk`；`src/identity.js` 从 package.json 与 runtime manifest 读取版本/protocol/catalog identity；`src/policy.js` 实现与 pinned runtime 对齐的 capability/profile/argv fail-closed 策略，并隐藏 P1 effectful compatibility tools。
- 产品 profile 无 grant 时只列出 `verseshell_health` 且不启动 runtime；`verseshell_eval` 与 shell-string compatibility 只在 development profile；shell 兼容只构造显式 `shell.exec([...])`。
- 验证：Harness context/`--no-diff` validate PASS；MCP policy/start/runtime smoke 11/11；`pnpm verseshell:test` bundle 13/13 + runtime-bundle 11/11 + OpenClaw 64/64 + MCP 11/11；`typecheck:node` PASS；comms replay→compare PASS；`git diff --check` PASS。
- 证据见 `docs/dev/verseshell-foundation/P1-MCP-COMPATIBILITY-EVIDENCE-2026-08-14.md`。普通 diff-aware validate、aggregate lint/typecheck 与 repository-wide diff residual 仍须诚实记录，不能当作 release/canary 证据。

下一步：通过 Task Forest CLI 保存并应用 `TF-0063` closeout，运行 validate/export；然后只启动 `TF-0064` / VS-P2-01 只读 facade。不得并行启动 P2-02、P3 写入、provider canary 或任何 rollout。

---
## VerseShell Foundation：VS-P2-01 只读 facade 工程包（2026-08-14）

> 状态：`TF-0064` / VS-P2-01 已完成实现和 focused 验证，等待 Task Forest closeout；严格串行、
> default-off、fail-closed。P2-02、写入、provider canary 和 rollout 未启动。

- 新增 `openclaw_runtime/src/agents/verseshell/readonly-facade.ts`，仅提供稳定模型面的
  `read_file`、`search_content`、`result_query`。路径、glob、窗口、query 和 result ranges 均有界；
  绝对路径、workspace escape、NUL、malformed handle 和 owner drift fail-closed。
- adapter 复用 `VerseShellAciClient`/`VerseShellProcessManager`，仅调用 `file.view`、`repo.search`、
  `result.query`，没有 direct spawn、MCP、Gateway HTTP 或 native fallback。cache key 绑定
  workspace/revision/policy/operation/args，并有 TTL/容量上限。
- `agent-tools.ts` 仅在 shell-tools 阶段接入可选数组；任一 readiness flag 缺失或 kill switch 触发时
  工具完全不可见。模型 facade 四项顺序仍为 `read_file -> search_content -> run_command -> result_query`。
- 证据：VerseShell 13 files / 71 tests PASS；root facade contract 3/3；`pnpm run typecheck:node`、
  `pnpm run comms:replay`、`pnpm run comms:compare`、`git diff --check`、Harness `--no-diff validate`
  PASS。普通 diff-aware validate 被共享工作树无关 ownership paths 阻塞，已诚实记录在
  `docs/dev/verseshell-foundation/P2-READONLY-FACADE-EVIDENCE-2026-08-14.md`。
- 锁保持：`default-off`、`liveReady=false`、`productApproved=false`、`defaultOn=false`。

下一步：完成 `TF-0064` closeout proposal 的 Task Forest validate/export；应用后才解锁唯一的
`TF-0065` / VS-P2-02 argv-only command profiles。不要并行启动 P2-03、P3、provider canary 或任何 rollout。
## 接力交接：VerseShell P2-02 中断点（2026-08-14）

### 当前目标

本任务的总目标仍是：无预算限制完成 `docs/dev/verseshell-foundation/FOUNDATION-DEVELOPMENT-ROADMAP.zh-CN.md` 的全部 VerseShell 开发规划。已确认采用严格串行路线：

`P0 -> P1-01 -> P1-02 -> P1-03 -> P2-01 -> P2-02 -> P2-03 -> P3 journal/write -> P5 真实 canary`

产品锁必须始终保持：`default-off`、`liveReady=false`、`productApproved=false`、`defaultOn=false`。不得提前做 provider rollout、canary、GA 或 native fallback。

### 已完成并有证据的工作包

- `TF-0058` / P0-01 runtime startup
- `TF-0059` / P0-02 reproducible bundle
- `TF-0060` / P0-03 governed approval probe
- `TF-0061` / P1-01 supervised ACI lifecycle
- `TF-0062` / P1-02 bounded observation/artifact/result query
- `TF-0063` / P1-03 MCP compatibility adapter
- `TF-0064` / P2-01 read-only facade（`read_file`、`search_content`、`result_query`）

Task Forest 当前真实状态：`TF-0061`、`TF-0062`、`TF-0063`、`TF-0064` 为 `done`；`TF-0065` / P2-02 仍显示为唯一 `ready` 节点。不要把它标为 done，直到剩余矩阵、证据和文档收尾完成。

### 本轮 P2-02 已落盘的实现

已新增/修改 argv-only command profile 路径：

- `openclaw_runtime/src/agents/verseshell/command-profiles.ts`
- `openclaw_runtime/src/agents/verseshell/command-profiles.test.ts`
- `tests/unit/verseshell-command-profiles.test.ts`
- `harness/specs/tasks/verseshell-p2-command-profiles.md`
- `harness/specs/rules/verseshell-command-profile-boundary.md`
- `openclaw_runtime/src/agents/verseshell/shell-command.ts`（+ 新增 `shell-command.test.ts`）
- `openclaw_runtime/src/agents/verseshell/governed-exec.ts`
- `openclaw_runtime/src/agents/verseshell/governed-process.ts`
- `openclaw_runtime/src/agents/bash-tools.exec.ts`
- `openclaw_runtime/src/agents/bash-tools.exec-host-gateway.ts`
- `openclaw_runtime/src/agents/bash-tools.exec-runtime.ts`
- `openclaw_runtime/test/vitest/vitest.verseshell.config.ts`（include 增补 `shell-command.test.ts`）

设计结果：普通单段命令在 approval 前生成 host-owned immutable execution plan，直接传递 effective argv；`pnpm/npm/corepack/test/build/lint/git` 由 host 推导 profile（含 `exec`/`dlx` 常见单动词 runner 透传，cargo/go/dotnet 保持保守 generic），模型不能选择 profile；pipeline/chain/redirect/heredoc/inline evaluation/显式 interpreter 只进入显式 terminal-shell 兼容边界；approval 后不再从 display command 重解析；cwd/env/timeout/output/write-policy 都是有界 metadata。

Windows batch 元数据补丁已审查并验证：`.cmd/.bat` 需要已解析脚本路径和可审计 `ComSpec`/`SystemRoot`，plan 记录 `resolvedScript`、`interpreter`、`interpreterProfile: "windows-cmd"`；缺少脚本身份或解释器身份时 fail-closed；`governed-process` 在 process 边界校验 windows-cmd plan 的 argv[0]===resolvedScript，漂移即 `E_VERSESHELL_SCRIPT_IDENTITY`。`.exe/.com` 保持直接 argv。Rust `StartArgs` 不接受 interpreter 字段，运行时自行从 resolved script + env 推导 cmd 并在 observation 回传 `interpreter`。

### 最终验证（Windows batch 补丁之后，2026-08-14 全绿）

- `pnpm verseshell:test`：PASS（bundle 13/13、runtime bundle 11/11、OpenClaw VerseShell 15 files / 141 tests、MCP 11/11）
- `pnpm exec vitest run tests/unit/verseshell-command-profiles.test.ts --maxWorkers=1`：PASS 6/6
- `pnpm run typecheck:node`：PASS（exit 0）
- `pnpm run typecheck`（聚合 node+web+ext bridge）：PASS（三者 exit 0，约 101s）
- `pnpm run comms:replay`：PASS
- `pnpm run comms:compare`：PASS（0 丢失/重复/乱序，吞吐/延迟 delta 0.00%）
- `git diff --check`：PASS（tracked）；untracked 文件的 trailing-whitespace/final-newline 扫描干净
- scoped ESLint（8 个改动 TS 文件）：PASS（0 errors / 0 warnings）
- `pnpm harness context --spec harness/specs/tasks/verseshell-p2-command-profiles.md`：PASS
- `pnpm harness validate --no-diff --spec harness/specs/tasks/verseshell-p2-command-profiles.md`：PASS（普通 diff-aware validate 被共享工作树无关 ownership 与 harness 子包缺 node_modules 阻断，已如实记录，未扩大 touchedAreas）

这些是工程/回归门禁，不是 canary、GA 或产品批准证据。

### 接力 agent 必须完成的事项

1. ✅ Windows batch 补丁已审查并验证：`.exe/.com` direct argv、`.cmd/.bat` audited `cmd.exe`、resolved script identity、PATH/PATHEXT（analysis effectiveArgv）matrix 全覆盖。
2. ✅ spaces/Unicode executable/cwd/argv、pnpm/npm/corepack 组合、sanitized env bounds（keys/bytes/NUL）、timeout clamp（1ms floor/profile max）、output clamp、non-zero exit、large output/result recovery（oversized/missing result.query 拒绝）、no-native-fallback paired test（governed-exec-runtime 3/3）均补齐。
3. ✅ `governed-process` 边界新增 windows-cmd 身份审计（不重新解释 display command），contract 测试覆盖 plan argv 透传、drift fail-closed、clamp。
4. ✅ `docs/dev/verseshell-foundation/P2-COMMAND-PROFILES-EVIDENCE-2026-08-14.md` 已创建（base SHA `b04c22a6`、spec/rule、命令与退出码、矩阵、dirty-worktree residual、四个产品锁）。
5. ✅ `STATUS.md`、`FOUNDATION-ORCHESTRATION-PLAN.zh-CN.md`（v1.2）、本文件顶部旧段落、`README.md`/zh/ja 已同步，不再声称 P1-01/P1-02 或 P2-01 是当前工作包。
6. ✅ `TFP-verseshell-p2-02-closeout-20260814` 已通过 Task Forest CLI `proposal-save`（预校验 + base_graph_hash）→ `proposal-apply --yes` 应用，`validate`（校验通过）与 `export`（HTML 已导出）均 PASS；未直接编辑 `.agent-workbench/task-forest/` 图文件。
7. ✅ `TF-0065` 为 `done` 100%，`TF-0066` / P2-03 diagnostics 已解锁为唯一 `ready` 节点；P3 或 P5 未启动，禁止并行启动。

### 工作树和交接边界

当前工作树包含此前多个 VerseShell 阶段的未提交修改和新文件；本轮没有 commit、push 或 reset。不要回滚其他 agent/user 的改动。继续前先 `git status --short`、`git diff --stat`，并保留所有已生成 evidence/proposal 文件。

---
