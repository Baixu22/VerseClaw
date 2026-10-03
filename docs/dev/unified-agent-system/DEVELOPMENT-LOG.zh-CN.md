# 统一 Agent 系统开发日志

> 2026-10-01 TF-0013 已完成节点级干净候选验收并自动收口（done/100）：18门、233测试、7次native请求通过，Codex package类型错误清零。见 `docs/dev/tf0013-authority-closeout-20261001.md`。不是新的全量RC、发布或GA，产品锁和默认值不变。

> 2026-10-01 TF-0013 原生请求接力：修复 source/built SDK 跨模块预算作用域丢失，以及 stale thread resume 后新线程遗漏已准入 bootstrap。真实 Codex 0.137.0、本地 scripted provider、RPC/最终请求证据见 `docs/dev/tf0013-native-wire-20261001.md`。10 项 SDK 回归和 7 次 native 请求通过；插件 package 的 8 条既有类型诊断有 HEAD 对照。节点保持 in_progress，下一步干净候选四项验收；不重签 RC 或改产品锁。

> 2026-09-30 TF-0013 原生预算接力：原生分发与公开 SDK 组装共用 attempt ledger，覆盖 COMPASS、原子消息替换、system addition、重复启动重试及 embedded 子运行隔离。开发证据见 `docs/dev/tf0013-native-budget-20260930.md`；外部 app-server 最终请求/持久线程证据与干净候选四项验收仍待补齐，节点保持 in_progress/60%。

> 2026-09-30 TF-0013 接力：embedded ContextEngine 消息替换纳入既有候选仲裁与 turn 预算，新增/改写内容整组准入，超额保留原历史；补齐 quarantine 回退的输入修改隔离。开发测试及原生插件后续边界见 `docs/dev/tf0013-message-budget-20260930.md`。TF-0013 保持 in_progress/60%，不重签旧 RC verdict 或解除 D7 冻结。

> 创建日期：2026-07-27
>
> 当前状态：UAS-06 工程路由与证据矩阵已完成，资格仍为 engineering-only；真实 cohort/provider/人工恢复/soak 证据均为 0，Task Forest 当前为 `TF-0017=in_progress/35%`
>
> Task Forest proposal：`TFP-unified-agent-system-roadmap-20260727`

## 1. 记录范围与权威顺序

本文记录统一 Agent 系统的长期开发决策、正式任务编号、阶段门禁、验证结果和下一步。它不替代 Task Forest：

1. 任务状态和依赖以 `.agent-workbench/task-forest/` 为准；
2. 架构边界以 `DEVELOPMENT-STRATEGY.zh-CN.md` 为准；
3. 源码审计和外部对标以 `CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md` 为准；
4. 当前会话入口以 `docs/dev/handoffs/LATEST.md` 为准。

Task Forest 只能通过 `task_forest.py` 修改，不得直接编辑其 canonical data。

## 2. 2026-07-27 架构与治理裁决

已确认的目标是：**统一 contract 和主路径，不统一 authority 或进程。**

- Coding 保留模型工具面和文件 mutation authority；
- ClawX/OpenClaw 保留 policy、approval 和 workspace authority；
- VerseShell 负责本地进程创建、生命周期、bounded observation 和 artifact；
- Context Orchestrator 负责最终候选选择、去重、排序、预算和 lineage；
- VerseToken 收口为无业务状态的 packer/renderer；
- BlockStore、Runtime Memory、SEKB 分别保留 Working Context、长期事实、人工确认工程经验的 authority。

明确拒绝：增加 LLM router、隐式 governed native fallback、第二套 context budget、第二个 write journal、第二个长期 Memory authority，以及把 Job Object/workspace jail 称为 OS sandbox。

## 3. 正式开发任务

`TF-0010` 是全局治理容器“统一 Agent 基础设施主路径收口（非 GA）”。其子任务按以下顺序严格串行：

| 顺序 | Task Forest | 阶段 | 主要交付与退出门槛 | 工程估时 | 当前状态 |
|---:|---|---|---|---:|---|
| 0 | `TF-0011` | UAS-00 证据冻结与治理登记 | 冻结源码/二进制/测试基线；建立引用通信规则的 Harness task spec；消费已由 `FP-P4-06` 修复并守卫的 VToken 默认值 spec drift 证据 | 8-16h | done |
| 1 | `TF-0012` | UAS-01 统一 Contract 与持久事件主干 | 版本化 plan/process/observation/artifact/event schema；幂等、重放、脱敏和保留策略可验证；不创建第二 run journal | 16-32h | done |
| 2 | `TF-0013` | UAS-02 Context Orchestrator residual 收口 | 所有 context source 先产出候选；唯一 owner 完成去重、排序、最终预算和 lineage；私有预算与重复注入为 0 | 32-48h | done |
| 3 | `TF-0014` | UAS-03 VerseToken 无状态装箱化 | 移除只读生产路径的 MemStore/WAL/无关 session 状态；按请求隔离内存 graph；estimate 不冒充 actual usage；热重载语义有明确裁决 | 24-40h | done |
| 4 | `TF-0015` | UAS-04 Coding 写入一致性与恢复 | `apply_patch` 纳入 mutation 协调；多文件失败无静默 partial mutation；wrapper 顺序和 recovery state 有测试证据 | 32-56h | done |
| 5 | `TF-0016` | UAS-05 VerseShell 进程生命周期等价 | argv/env/PATH/stdin/background/ConPTY/poll/read/write/kill/cancel 与重启 reconcile 通过 Windows 矩阵；重复/孤立进程为 0 | 80-120h | done |
| 6 | `TF-0017` | UAS-06 单一本地执行平面 canary | cohort 内合格本地执行 100% 经过 VerseShell；native fallback 为 0；kill switch/rollback 演练成功率 100% | 40-64h | 工程矩阵完成，待真实 canary；current `in_progress/35%` |
| 7 | `TF-0018` | UAS-07 长期 Memory 治理闭环 | candidate 经验证和批准后才进入唯一目标 store；支持 TTL、纠正、冲突、supersede、revoke；SEKB 自动写回为 0 | 40-80h | proposed |
| 8 | `TF-0019` | UAS-08 真实 ROI、soak 与毕业裁决 | 预注册 paired A/B；记录实际 provider 和运营成本；连续 14-28 天 soak；给出 continue/reduce/stop 决策 | 16-32h，另含日历 soak | proposed |

子任务估时简单相加为 288-488 工程小时，高于 `TF-0010` 当前保存的 240-400 小时组合估计。`TF-0011` 应基于冻结范围校准一次，不得把初始估计当成承诺工期。

## 4. 依赖与跨树关系

执行依赖：

```text
TF-0009 review_needed
  -- derived_from（non-blocking engineering evidence）-> TF-0011 (UAS-00)
  -> TF-0012 (UAS-01)
  -> TF-0013 (UAS-02)
  -> TF-0014 (UAS-03)
  -> TF-0015 (UAS-04)
  -> TF-0016 (UAS-05)
  -> TF-0017 (UAS-06)
  -> TF-0018 (UAS-07)
  -> TF-0019 (UAS-08)
```

其他正式关系：

- `TF-0011` 至 `TF-0019` 均为 `TF-0010` 的 `child_of`；
- `TF-0013 derived_from TF-0002`，只闭合历史 residual，不改写 `TF-0002` 的 done 状态；
- `TF-0019 contributes_to TF-0006`，只提供候选证据，不自动解除阻塞；
- `TF-0010 related_to TF-0007`，现有受控内测为改造前基线，不是同一个全局任务。

## 5. 当前调度状态

- `TF-0009`：`review_needed/50%`，语义为 `degraded-agent-complete`；agent 工程流完成，真人/live residual 未完成；
- `TF-0007`：`in_progress`，作为 `TF-0009` 的全局父任务；
- `TF-0010`：统一 Agent 全局容器，正式状态仍为 `proposed`；
- `TF-0011`：`done/100%`；其非阻塞 `derived_from TF-0009` 只消费 agent 工程证据，不改变 TF-0009 真人 residual；
- `TF-0012`：`done/100%`；工程实现、聚焦验收和正式 closeout 均已完成，数据库/Harness 基线 deviation 保持显式；
- `TF-0013`：`done/100%`；UAS-02 工程实现、全部门禁与正式 closeout 已完成；
- `TF-0014`：`done/100%`，UAS-03 closeout 已应用；
- `TF-0015`：`done/100%`，closeout proposal 已经用户确认并应用；
- `TF-0016`：`done/100%`；UAS-05 工程实现、本地门禁和 closeout 均已完成；
- `TF-0017`：UAS-06 工程实现已启动并完成本地矩阵；Task Forest proposal 已确认并应用，当前为 `in_progress/35%`，真实 canary residual 未完成；
- `TF-0018` 至 `TF-0019`：保持 `proposed/0%`，继续按依赖链串行阻塞；
- `TF-0006`：保持 `blocked`，本次登记没有修改其状态。

导出的 todo 数据会把没有 blocking dependency 的全局容器 `TF-0010` 标记为结构上的 `ready: true`，但它的正式状态仍是 `proposed`。调度时只以可执行叶节点为会话入口；当前仍只有 `TF-0017`，其工程工作已开始但不能在真实 cohort 证据前 closeout。`TF-0009` 虽然结构上无前置依赖，但正式状态是 `review_needed`，不是第二个执行叶节点。

## 6. 当前验证证据

| 验证 | 结果 | 解释 |
|---|---|---|
| `pnpm vtoken:test` | 246 passed / 1 failed | `TestHotReloadConcurrent.test_concurrent_resolve_during_reload` 未观察到最终 `v5`；不得宣称 doc-source 并发热重载可靠 |
| 热重载失败用例独立复跑 | 5/5 failed | 是稳定语义缺口，不是单次抖动 |
| OpenClaw Context/VToken/Coding focused Vitest | 11 files / 147 tests passed | 现有局部 contract 和治理行为通过 |
| 根层 Orchestrator/VToken/default tests | 3 files / 18 tests passed | 默认 OFF 与入口扫描通过 |
| Task Forest `validate` | 通过 | proposal 应用后的 canonical graph 合法 |
| Task Forest HTML 抽查 | 通过 | 新主树、串行依赖、`derived_from`、`contributes_to`、状态统计和布局控制均已导出 |
| UAS-00 聚焦回归 | 5 files / 35 tests passed | manifest、TF-0009 evidence boundary、agent-surrogate、VToken default OFF 和默认矩阵通过 |
| UAS-00 Harness | pass | rules、extension bridge、lint、typecheck、全量 unit、comms replay/compare 全绿；正式报告 `artifacts/harness/latest.md` |
| UAS-00 manifest | generate + stale check 通过 | 明确标记 dirty engineering baseline；旧 Task Forest workspace metadata 与 canonical root 的差异可机器读取 |
| UAS-01 聚焦回归 | 6 files / 59 tests passed | contract family、SQLite reopen、幂等副作用、在线/重放一致性及既有 event-log 回归通过 |
| UAS-01 类型/静态/通信 | typecheck、targeted ESLint、comms replay/compare、UAS-01 diff check 通过 | 没有 renderer/Main/Gateway 行为变化；README 三语已审阅且无需修改 |
| UAS-01 Harness structural validate | pass | `--no-diff` 证明 spec/rule 结构合法；完整 diff-aware validate 受共享脏工作树的大量无关 touched areas 阻断，不扩大 ownedPaths 伪造通过 |
| UAS-01 数据库基线门禁 | fail（既有基线） | `db:kysely:check` 报两个 generated 文件 stale；`lint:kysely` 报既有 FactStore/raw `node:sqlite` guardrail；UAS-01 未改 schema 或这些 owner，缺口保留并在 closeout proposal 中显式披露 |
| UAS-02 聚焦回归 | runtime 4 files / 71 tests；agent 3 files / 20 tests；root scan 1 file / 6 tests passed | ContextCandidate/v1、稳定 authority 去重、声明 precedence、单账本、before-provider system/message 投影、无 DCS 场景、组合六通道与 compact/attempt 生产入口通过 |
| UAS-02 类型与静态检查 | root typecheck、targeted type-aware oxlint、root ESLint 通过 | production attempt/compact 均带 turn identity；legacy 无 turnId 路径不作为生产入口；README 英/中/日已审阅，无用户行为、公共接口或产品流程变化，因此无需修改 |
| UAS-02 Harness 与通信门禁 | structural validate `--no-diff`、隔离工作树 diff-aware validate（`--since HEAD`）、Harness dry-run boundary scan、comms replay/compare 全部通过 | 默认 `origin/main...HEAD` 会吸收当前分支已提交的历史 P4 差异；隔离 clone 仅承载 15 个 UAS-02 文件，未扩大 ownedPaths，证明范围与任务所有权一致 |
| UAS-03 聚焦回归 | VToken `251 passed`；runtime `3 files / 34 tests`；root `3 files / 14 tests` | stateless pack 无文件副作用、重复 candidate 拒绝、并发请求隔离、真实 Node→Python worker 响应关联、stateful diagnostics 回归和 hot-reload completion barrier 均有证据 |
| UAS-03 类型、静态与通信 | root typecheck、targeted type-aware oxlint、root ESLint、Ruff format/check、comms replay/compare 全部通过 | `VtokenPackResult/v1` 只报告 `estimatedTokens` 与 `chars_div_4`；默认 OFF、kill switch 和产品锁未改变 |
| UAS-03 Harness | structural validate `--no-diff`、隔离 clone diff-aware validate（`--since HEAD`）和 dry-run boundary scan 全部通过 | 隔离 clone 仅承载 19 个 task-owned 文件；共享脏工作树不作为范围通过证据，也未扩大无关 touched area 隐藏 |
| UAS-04 工程收口 | runtime `6 files / 96 tests`、root `1 file / 3 tests`、typecheck、静态检查、comms 与隔离 Harness 均通过 | closeout 已确认应用，`TF-0015=done/100%`，仅释放 UAS-05 工程节点 |
| UAS-05 lifecycle 与供应链 | Rust lifecycle `3/3`、operation protocol `9/9`、focused runtime `8 files / 47 tests`、root manifest/UAS `2 files / 12 tests`、bundle `8/8`、release build/package validation 通过 | 真实 Windows binary 覆盖 PATH/PATHEXT、pipe/ConPTY、cursor、owner、kill/timeout、整树清理、crash reconcile；closeout 已确认应用 |

## 7. 下一会话唯一入口

`TFP-tf0016-verseshell-process-lifecycle-closeout-20260730` 已确认并应用，正式状态为 `TF-0016=done/100%`、`TF-0017=ready/0%`。UAS-05 已按 `harness/specs/tasks/uas-05-verseshell-process-lifecycle.md` 完成；UAS-06 只能在新的明确指令下读取 cohort/canary 边界并建立对应 Harness task spec，本次 closeout 未启动 canary。

`TF-0009` 并未完成。当前只通过独立治理 proposal 将其 agent 工程基线与真人 residual 解耦；TF-0011 的工程权限不构成 TF-0009 done，也不授予任何产品权限。FP-P4-03 仍必须等待 TF-0014 done；FP-P4-04 的 diagnostics-only 守住态也不在 TF-0011 内实施。

每个 UAS 节点开始前必须：

1. 运行 `pnpm harness context --spec <对应 task spec>`；
2. 冻结该节点的输入证据、NO-GO、测试和回滚条件；
3. 只推进一个 ready 节点；
4. 完成后更新 Task Forest、本文和 `docs/dev/handoffs/LATEST.md`；
5. 涉及 backend communication 时引用 `gateway-backend-communication`，并运行相应 Harness 和 comms 门禁。

## 8. First Product 证据消费映射

| Preview 产物 | 统一 Agent 消费方 | 边界 |
|---|---|---|
| `FP-P2-03` canary 裁决 | `TF-0011/UAS-00` | 冻结真实基线和停止条件，不直接启动实现 |
| `FP-P2-07` 来源、patch/error contract 与 DCS diff consumer 证据 | `TF-0011/UAS-00`、`TF-0012/UAS-01` | UAS-00 冻结来源/许可证/测试基线；UAS-01 复用版本化 contract，不建立第二 patch/error 真源 |
| `FP-P2-08`–`FP-P2-10` GitHub Forge read/review/merge 证据 | `TF-0011/UAS-00`、`TF-0012/UAS-01` | 冻结 provider capability、完整性、OCC、审批和 hard-veto 语义；不把远端 Forge 变成本地 Git 或 Coding mutation authority |
| `FP-P2-06` 逐通道预算证据 | `TF-0013/UAS-02` | Preview 只补可解释记账；唯一候选/去重/预算 owner 由 UAS-02 收口 |
| `FP-P3-04` clean release evidence | `TF-0011/UAS-00` | clean SHA、manifest、安装/回滚和 support bundle 进入 evidence manifest |
| `FP-P4-03` VToken 产品毕业 | `TF-0014/UAS-03` | UAS-03 先完成无状态基础设施，本任务再完成 opt-in 产品门禁 |
| `FP-P4-04` RM diagnostics-only | `TF-0018/UAS-07` | 只提供守住态证据；长期 Memory authority 仍归 UAS-07 |
| `FP-P4-08` 多平台/PR DAG 扩围裁决 | 待确认 Task Forest proposal | 仅在 P3 后决定 GitLab/Gitee/DAG/Queue 是否另立任务；本映射不授权实现 |

本映射只建立证据消费和调度边界，不改变 `TF-0006`、default-on、liveReady、productApproved 或 GA 状态。

## 9. First Product pre-canary engineering 证据

| 日期 | Preview slice | 状态 | UAS 消费边界 |
|---|---|---|---|
| 2026-07-28 | `FP-P2-07` slice 1：来源/许可证 manifest + Remote Forge Harness spec | `in_progress`；262-file snapshot root SHA-256 `4e8255d3...152a4`；Apache-2.0；exact parent SHA 未解析，源码复制 fail closed；isolated Harness validate/contract/i18n 通过 | `TF-0011/UAS-00` 后续只消费冻结后的 source/license/test 基线；`TF-0012/UAS-01` 只消费 Verse Claw 自有 contract，不复制第二 patch/error 真源。此记录不解除 `TF-0009` 依赖，也不启动 UAS |
| 2026-07-28 | `FP-P2-07` slice 1 可交付性复核 | `artifacts/*` 当前忽略 source manifest、evidence 与 gate log，且三者未跟踪；本轮只登记风险，不改 ignore policy、不 stage | UAS 后续不得把仅存在于本机 ignored artifact 的证据当成已交付输入；正式 change set 必须显式纳入并复核完整性，此记录不启动 UAS |
| 2026-07-28 | `FP-P2-07` slice 2：shared patch/error v1 与兼容策略 | `in_progress`；唯一 shared contract + strict decoder + producer migration matrix 落地；10 focused tests、standalone strict TS、contract、i18n、Harness structural validate 通过；consumer/runtime/UI 未迁移 | `TF-0012/UAS-01` 后续复用该版本化 observation/error contract，不再建立第二真源；`TF-0011/UAS-00` 只冻结最终来源与测试证据。此记录不解除 `TF-0009` 依赖，不启动 UAS，也不授权远端副作用 |
| 2026-07-28 | `FP-P2-07` slice 3：标准化 unified diff parser/adapter | `in_progress`；clean-room adapter、固定安全上限和 corpus 落地；完整输入由既有 Pierre parser 严格校验，truncated 只保留可信前缀；12 focused / 22 contract+adapter tests、targeted ESLint、standalone strict TS 通过；consumer/runtime/UI 未迁移 | `TF-0012/UAS-01` 只复用唯一 `GitPatchArtifact/v1` 与该 adapter，不建立第二 patch/error schema；local Git 与 Coding write journal authority 不变。此记录不解除 `TF-0009` 依赖，不启动 UAS，也不授权远端副作用 |
| 2026-07-28 | `FP-P2-07` slice 4：Git/Code Review/DCS edit consumer migration | `in_progress`；共享 adapter 接入三个既有 consumer；producer 超限/truncated、malformed、Git status drift 与 journal request/path drift 均 fail closed；48 root + 54 runtime tests、build、Code Review E2E、contract/i18n/comms/Harness 全绿 | `TF-0012/UAS-01` 后续只消费同一 contract/adapter 与 authority-preserving lineage；diff extension 保持发布包边界，未复制 parser/schema。此记录不解除 `TF-0009` 依赖，不启动 UAS，也不授权远端副作用 |
| 2026-07-28 | `FP-P2-07` slice 5：journal-backed edit/write rich diff + text fallback | `in_progress`；full-file write 只以 journal before snapshot 与 verified after bytes 生成真实 diff；Gateway/Renderer 仅接受严格 complete、request/journal/path 一致的 artifact；26 root + 50 runtime tests、runtime/Vite build、真实 Gateway Electron E2E、contract/i18n/comms/Harness 全绿 | `TF-0012/UAS-01` 后续只消费同一 contract/adapter/render projection，不建立第二 mutation、journal、parser 或 renderer authority。此记录不解除 `TF-0009` 依赖，不启动 UAS，也不授权远端副作用 |
| 2026-07-28 | `FP-P2-07` slice 6：canonical error envelope / redaction / negative tests | `done`；所有 patch consumer 统一 `RemoteForgeError/v1`；canonical code/retryability/status/message 与安全 request id 强校验；nested/cyclic sensitive payload 和 malformed/unknown/oversize 反向测试通过；真实 Electron 路径全绿 | `TF-0012/UAS-01` 后续复用唯一错误 envelope 和安全投影，不建立第二 error schema。此记录不解除 `TF-0009` 依赖，不启动 UAS，也不授权远端副作用 |
| 2026-07-28 | `FP-P2-08`：GitHub Remote Forge 只读控制面 | `done`；Main-owned bounded PR/detail/commits/files/diff/checks/reviews/content/readiness、typed host-api/MCP、四语 UI 与 fake-provider Main-path E2E 全绿；未观测能力保持 unknown | `TF-0011/UAS-00` 与 `TF-0012/UAS-01` 后续只消费 capability/completeness/readiness 和唯一 patch/error contract 证据；不建立第二 transport/local Git authority，不授权真实 review/metadata/merge |
| 2026-07-28 | `FP-P2-09`：受控 review/comment/metadata mutation | `done`；Main-owned draft-first mutation、head/version OCC、一次性 action-bound approval、最小 snapshot、partial/unknown reconciliation、四语 UI 与 fake-provider Main-path E2E 全绿 | `TF-0011/UAS-00` 后续只消费同一 Main policy、approval binding 与 reconciliation 证据；不建立第二 approval/execution authority，不授权真实 remote effect |
| 2026-07-28 | `FP-P2-10`：readiness hard-veto 与受控 merge | `done`；Main 即时重读、五分钟单次 approval、expected-head sandbox merge、生产空 allowlist、Agent default-off、partial reconciliation、四语 UI 与 fake-provider Main-path E2E 全绿 | `TF-0011/UAS-00` 后续只消费同一 Main policy、readiness/policy digest、approval binding 与 reconciliation 证据；不建立第二 merge/approval authority，不授权真实 remote effect |
| 2026-07-28 | `FP-P2-05`：post-write auto verify | `done`；default-off；runner detection 只产生命令，最终 effective exec 继承现有 policy/approval/sandbox/timeout；真 child 两次 pass、后续非零退出、可见 bounded tail 与 write-journal 保留均有证据 | `TF-0011/UAS-00` 后续复用同一 exec 与 mutation authority；不建立第二 process/approval/sandbox/timeout 平面。工程绿不冒充真人 canary |
| 2026-07-28 | `FP-P2-06`：DCS 注入预算逐通道归因 | `done`；knowledge/working_memory/tool_registry 在真实 assembler 投影点 charge 同一 turn ledger；固定 6000 总额内用不记账 reservation 保留既有 2000 DCS 容量；真 Electron 证据中 CVK 4000/8000 显式截断，三通道 provider 实测 284/162/1554 与账目一致 | `TF-0013/UAS-02` 后续消费真实逐通道 attribution 与多次 charge 事件时间线；不得复制第二预算 owner。6000/0.1 仍待真人分布驱动 FP-P2-04，本工程证据不启动 UAS、不提升默认值 |

上述切片属于 engineering-only 时序偏差下的 pre-canary 工作，不包含真实凭据、远端写操作或真人证据。P2-06 至 P2-10 证据分别见 `artifacts/first-product-preview/<taskId>/` 对应目录；这些证据不解除 `FP-P2-01/02` 的真人边界。

## 10. TF-0009 工程证据审计（2026-07-29）

- 用户选择严格链方案 `1A`：保留 TF-0009 的真实 canary AC，不把既有 engineering-validation-only 授权外推到 Task Forest。
- 三 profile 合格记录均为 `0/10`；fixture、synthetic、Electron E2E 和 Harness 只作工程证据。
- FP-P1-05 的 `6980ms` 真 Electron kill 保留为机制证据；TF-0009 canary 期 operator kill/rollback 仍未执行。
- 旧 L0/L1 `continue` 和 fixture verdict 均不构成具名 owner 的退出裁决。
- Day-1 L0/L1/L2 已真实执行并归档：DCS lint、`35 files / 314 tests`、P0 `8 files / 120 tests`、packaging/C1/corpus、runtime/Vite build 与最终 Windows Electron `9/9` 通过；这些仍为工程门禁，三 profile 合格记录保持 `0/10`。
- 首次冷构建 L2 暴露 SEKB `runtimeUnavailable`：完整 `build:runtime` 清理了 `dist`，却没有恢复 Host/CLI 依赖的 `knowledge/sekb/index.js`。现由完整构建调用既有 `--sekb-only` 目标，runtime smoke 强制导入四个必需导出，并有冷构建契约测试。
- `scripts/dcs-ops-preflight.mjs` 现区分 L2 自动化与 L3 启动授权，并校验 Day-1 内容而非只看文件存在。当前 `l3Ready=false`，唯一 blocker 为缺少具名 owner/operator/safety 与 bounded cohort 的 `profiles.json`。
- 审计：`docs/dev/tf0009-engineering-evidence-audit.md`；机器证据：`artifacts/first-product-preview/TF-0009/evidence-audit.json`。
- 结论保持 `TF-0009=ready, 0%`，不得启动 TF-0011。用户另选 `2A`，FP-P4-04 后续按 diagnostics-only guard closure 处理，但本会话不越过唯一 ready 叶节点实施。

## 11. TF-0009 agent-surrogate 降级工程收口（2026-07-29）

- 用户明确将当前不可承担的真人测试成本降级为 agent 代理执行；无法等价的真人/live/product 证据留给后续开发。
- `pnpm run tf0009:agent-surrogate` 通过：DCS、SEKB、Browser 各 `10/10` agent 记录，agent kill/rollback drill 通过。
- DCS 调用真实 context tool；SEKB 只执行 capture/suggest/reject/retrieve，agent 不冒充 positive human confirm；Browser 调用真实 approval state machine 与 supervised executor，但页面运行时和 DNS 为隔离工程环境。
- 三 profile 真人合格计数仍为 `0/10`；`humanEquivalent=false`、`liveEvidence=false`；裁决为 `deferred-human-validation`。
- Task Forest 无 `degraded` 枚举，因此证据语义为 `degraded-agent-complete`，正式状态为 `review_needed`，严禁 `done`；TF-0009 报告不得自行释放下游。
- `TFP-tf0009-agent-surrogate-degraded-20260729` 已获用户明确确认并通过 CLI apply；随后独立的 `TFP-tf0011-engineering-chain-release-20260729` 也已确认并应用，正式图为 `TF-0009=review_needed, 50%`、`TF-0011=ready`，二者通过非阻塞 `derived_from` 关联。
- 导出仍携带旧 workspace metadata `ClawX-maturity-p0`；`record_alignment` 也把本轮摘要投影到 TF-0011 alignment。两者均未影响状态/依赖，但需另提 proposal/迁移授权处理，不在本次 apply 中静默修正。
- 旧的 alignment-only proposal `TFP-tf0011-restore-alignment-after-tf0009-20260729` 未应用，其修复已被已应用的工程链解耦 proposal 覆盖；旧 workspace metadata 仍保持原状。
- TF-0011 已建立 `uas-00-evidence-freeze-governance` Harness task spec、`uas-00-evidence-freeze-boundary` rule 与 dirty baseline manifest 生成/检查入口；只做工程证据冻结，不实施 TF-0012/13/14 或 P4-03/04。
- P4-03/04 继续 deferred，三个 false 产品锁、C1 keep-off、TF-0006 blocked 和 Runtime Memory diagnostics-only 均未改变。

## 12. TF-0012/UAS-01 工程实现与待确认收口（2026-07-30）

- 已建立 `harness/specs/tasks/uas-01-unified-contract-event-spine.md`，引用 `gateway-backend-communication`；`harness context` 和 structural validate 通过。
- 新增 `AgentRunEvent/v1`、`ExecutionPlan/v1`、`ProcessHandle/v1`、`Observation/v2`、`ArtifactRef/v1`，并补充 `PolicyDecision/v1` 与纯 replay state；所有 contract 都带 schema guard、redaction 和 14 天 bounded retention。
- `.cmd/.bat` 计划必须显式标记 `windows_batch` 并保存 interpreter identity；observation 固定 bounded stdout/stderr cursor、truncation 和 dropped bytes；artifact 固定 `memoryEligible=false`。
- 持久化只投影到现有 `RuntimeTaskEventLogStore` / `runtime_task_event_log_records`；`long_task_checkpoints` 继续是默认恢复真源，trajectory JSONL 继续只作 support-bundle flight recorder，`runtime-spine/event-bus` 继续 diagnostics-only。
- 同 task 重复 `idempotencyKey` 返回首事件且不再次调用注入副作用；重放只还原状态，不执行工具、进程、文件、Gateway 或其他外部副作用；过期事件不进入 active replay，因果缺口与 identity mismatch 有显式诊断。
- 最终验证：`6 files / 59 tests`、`pnpm run typecheck`、targeted ESLint、`pnpm run comms:replay`、`pnpm run comms:compare`、UAS-01 scoped diff check 全部通过。README 三语经审阅无需修改。
- 两项必需数据库门禁仍暴露既有仓库基线问题：generated Kysely 文件 stale，以及 FactStore/raw `node:sqlite` guardrail 违规；本节点未改数据库 schema/owner，未重生成或改写这些无关文件。完整 diff-aware Harness 也因共享脏工作树纳入大量无关 touched areas 而失败，未通过扩张 ownership 隐藏问题。
- `TFP-tf0012-unified-contract-event-spine-closeout-20260730` 已获用户明确确认并通过 CLI apply；随后 Task Forest validate/export 通过，正式状态为 `TF-0012=done/100%`、`TF-0013=ready/0%`。P4-03/04、三个 false 产品锁、C1 `4.5x/keep-off`、TF-0006 blocked 与 Runtime Memory diagnostics-only 均未改变。

## 13. TF-0013/UAS-02 工程实现与最终门禁（2026-07-30）

- `ContextCandidate/v1` 以 authority object id、authority version 和确定性 content digest 形成稳定 dedupKey；candidateId 另含 source/channel/target，保证跨 provider 去重时仍保留逐候选 lineage。
- Memory、VToken、CVK 和 DCS context-block 只产出候选；最终 `knowledge -> working_memory -> tool_registry -> cvk_addition -> vtoken -> memory_pilot` 排序、去重、预算扣费、system/message 投影与 lineage 由 Context Orchestrator 一次完成。
- `before_agent_start` 在 Agent 请求快照前完成 system prompt 仲裁，`context` 钩子只复用已冻结的 message projection；无 DCS flag 时仍注册 finalizer。Tool registry producer 先写后收集，组合测试覆盖同 turn 六通道、重复 authority、逐通道账目和 lineage。
- VToken 的 DCS memory input 改为 flag/kill-switch 通过后的惰性读取；DCS 已直接投影时不再把同一 BlockStore memory/tool schema 二次送进 VToken。Memory pilot 与 role-memory DCS 重叠时只保留 DCS authority。
- attempt 与 compaction 生产路径都携带 turn identity，并在 finally 清理候选集合和共享账本；旧的无 turnId 私有预算只保留为显式兼容行为，不再是这两条生产入口。
- 最终工程验证：runtime `4 files / 71 tests`、agent `3 files / 20 tests`、root authority scan `1 file / 6 tests`、root typecheck、targeted type-aware oxlint、root ESLint、comms replay/compare、Harness structural validate、隔离工作树 diff-aware validate 与 dry-run boundary scan 全部通过。共享工作树默认 diff base 吸收无关历史 P4 差异，未通过扩大 ownership 隐藏；Task Forest closeout 尚未应用，因此本节仍不宣称 done。
- README 英/中/日已审阅；本节点不改变用户可见行为、公共接口或产品流程，无需修改。三个 false 产品锁、C1 `4.5x/keep-off`、TF-0006 blocked、Runtime Memory diagnostics-only、SEKB 零自动写回均未改变。
- `TFP-tf0013-context-orchestrator-authority-closeout-20260730` 已通过 Task Forest CLI apply；随后 canonical `validate` 与 HTML/JSON `export` 通过，正式状态为 `TF-0013=done/100%`、`TF-0014=ready/0%`。本次只释放下一叶节点，没有启动 UAS-03。

## 14. TF-0014/UAS-03 工程实现与最终门禁（2026-07-30）

- 生产 Working Context 从 `vt.open -> vt.ingest* -> vt.assemble` 收口为每 turn 一次 `VtokenPackRequest/v1 -> VtokenPackResult/v1`；请求不携带 `sessionDir/session`，不创建生产 `MemStore`、WAL 或 lock。
- 每个 `vt.pack` 请求构造独立内存 graph。Python worker 以固定四线程并发处理 pack，允许响应乱序；TypeScript client 继续用 JSON-RPC id 关联响应，不再使用全局 `runExclusive` 尾队列。
- Context Orchestrator 显式提供最终 `allowanceTokens`。候选使用稳定 SHA-256 id 并在 TypeScript 侧去重，worker 对重复 id fail closed；VToken 不建立第二预算或 Memory authority。
- 结果字段改为 `estimatedTokens` 和 `estimateMethod=chars_div_4`，DCS observability 同步使用 estimate 语义，不再将启发式字符计数描述为 provider actual usage、计费或成本事实。
- `UnifiedStore.refresh_doc_sources()` 是同步热重载 completion barrier；生产 pack 无业务状态，既有 stateful `open/ingest/assemble` 仍保留给 package consumer 和默认关闭的 Electron diagnostics。
- 最终本地证据：VToken `251 passed`、runtime `3 files / 34 tests`、root `3 files / 14 tests`、root typecheck、targeted type-aware oxlint、root ESLint、Ruff format/check、comms replay/compare、Harness structural validate 均通过。真实 Node→Python worker 并发试跑返回两个互不污染的 `VtokenPackResult/v1`，均由显式 allowance 驱动。
- 隔离 clone `C:\uas03v-c3309527a74345e6a3860dbf6c896526` 只投影 19 个 UAS-03 task-owned 文件；diff-aware Harness validate（`--since HEAD`）通过，dry-run 的 backend communication boundary scan 通过并选择 `fast + comms`，无 failure。
- README 英/中/日已审阅。此节点改变内部 Gateway-owned runtime bridge，不改变用户可见流程、公共产品接口或默认启用状态，因此无需修改三语 README；host contract 说明已更新于 `packages/vtoken/README.HOST.md`。
- `liveReady=false`、`productApproved=false`、`defaultOn=false`、C1 `4.5x/keep-off`、`TF-0006=blocked`、`TF-0009=review_needed`、Runtime Memory diagnostics-only 与 SEKB 零自动写回均未改变。
- closeout proposal `TFP-tf0014-vtoken-stateless-packing-closeout-20260730` 已应用；它只关闭 TF-0014 并释放 TF-0015，没有授予产品毕业或默认开启权限。

## 15. TF-0015/UAS-04 工程实现与本地门禁（2026-07-30）

- `apply_patch` 先解析并解析所有源/目标路径，再按规范化路径排序获取批次租约；租约覆盖原始内容读取、全部 hunk 预计算、文件 mutation、回滚和 journal 状态落盘，重叠 patch 不再在租约外读取同一旧版本。
- 预检用内存虚拟文件状态计算整个 patch，支持同批次连续 hunk；任一路径缺失、上下文不匹配或读取失败时尚未发生业务文件写入。
- 批次状态为 `prepared -> committed | rolled_back | recovery_required`。后段写入、删除或 move 失败时，按反向唯一触碰路径恢复预检原像；完整恢复返回 `rolled_back`，恢复失败返回 `recovery_required`、全部触碰文件和可定位既有 write journal sidecar 的 `recoveryRef`。
- `write-journal.ts` 仍是唯一恢复证据 owner。`apply_patch` 在内部租约中只创建一组 snapshot，sidecar 记录 batch id/state；重启后可识别 `prepared` 条目，成功提交仍可 undo，完整回滚清理本批证据，未完整回滚保留证据。
- post-write verify 仍在成功 mutation 之后运行，verify 失败不会回滚或重分类已 committed 的批次；Coding destructive tier、write-journal flag、symbol-lease flag 和所有产品锁均未改变。
- 当前证据：runtime 聚焦回归 `6 files / 96 tests`、root contract `1 file / 3 tests`、root typecheck、targeted type-aware oxlint、root ESLint、comms replay/compare 和 Harness structural validate 均通过。runtime import-cycle 检查只报告既有 SEKB 二节点循环，UAS-04 新模块无循环。
- 隔离 clone `C:\uas04v-100730b39e9e4a3b9600a98fa0804a5d` 以当前 HEAD 为显式基线，只投影 UAS-04 task-owned 文件；diff-aware Harness validate（`--since HEAD`）通过，dry-run 的 backend communication boundary scan 通过并选择 `fast + comms`，无 failure。共享脏工作区的默认 diff-aware ownership 拒绝保持为真实基线结果，未通过扩大 `ownedPaths` 隐藏。
- README 英/中/日已审阅。本节点改变内部 Coding mutation 失败语义，不改变 renderer/UI、公共产品接口或默认启用状态，因此无需修改三语 README。
- `liveReady=false`、`productApproved=false`、`defaultOn=false`、`TF-0006=blocked`、`TF-0009=review_needed`、Runtime Memory diagnostics-only、SEKB 零自动写回和 TF-0018 ownership 均未改变。closeout proposal `TFP-tf0015-coding-mutation-consistency-closeout-20260730` 已获确认并应用，只释放 TF-0016，不授予任何产品权限。

## 16. TF-0016/UAS-05 工程实现与本地门禁（2026-07-30）

- VerseShell catalog 从 26 增至 31，新增内部 `process.start/poll/write/kill/list`；MCP 注册明确过滤全部 `process.*`，模型仍只使用现有 `exec/process`。
- `process.start` 接收显式 argv、canonical cwd、有界 env、stdin/PTY、timeout/output budget 和 agent/session identity。Windows resolver 支持 PATH/PATHEXT、`.exe/.com/.cmd/.bat`，batch shim 使用可审计的显式 `cmd.exe`。
- lifecycle owner 为 `process_id + runtime_id + workspace_id + agent_id + session_id`。poll/write/kill/list owner mismatch 失败关闭；状态为 `starting -> running -> exited | killed | lost`，重复 kill 幂等。
- 输出采用单调 byte cursor，返回 `retained_start_cursor/lost_bytes/truncated`；输出和 terminal record 有界保留 24 小时，结束时保留 stdout/stderr artifact lineage。重启不 replay start，不可重获 owner 的旧 running record 显式变为 `lost`。
- Windows pipe stdin 支持 write/submit/EOF，EOF 仅在 lifecycle owner 确认成功后回报关闭，退出或 owner mismatch 会返回显式错误；ConPTY 交互输入通过。Job Object 在手动 kill、timeout、shutdown 和 runtime crash 时清理父子进程树；真实测试确认 orphan/respawn 为 0。
- OpenClaw governed exec 已切到 lifecycle owner，现有 `process` tool 继续负责输入、轮询和取消；VerseShell PID 禁止 native PID fallback。旧 `executeGovernedVerseShell()` 仅保留 compatibility-contract helper，生产路径无调用。
- 供应链身份为 base commit `c3983694407a9ddb23505e05fad4a9eae653b283` + patch SHA-256 `cabfb192f6f9688156f5a3ab5a19307fcd1af3fb2ee2c59b2d494a557d417098`；`ae.exe` 为 `14880256` bytes、SHA-256 `19ca598916077f677722b4f82d8dfc1c24c4e88ace9809abe681255370702699`；catalog digest 为 `sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7`。
- README 英/中/日已审阅。本节点改变内部 default-off runtime bridge 和供应链，不改变 renderer/UI、公共配置或用户流程，因此无需修改三语 README。
- 三个 false 产品锁、C1 `4.5x/keep-off`、`TF-0006=blocked`、`TF-0009=review_needed`、Runtime Memory diagnostics-only、SEKB 零自动写回和 TF-0018 ownership 均未改变。Task Forest closeout `TFP-tf0016-verseshell-process-lifecycle-closeout-20260730` 已确认应用，正式状态为 `TF-0016=done/100%`、`TF-0017=ready/0%`；本次未启动 TF-0017/UAS-06。

## 17. TF-0017/UAS-06 工程路由与真实 canary residual（2026-07-30）

- 已建立 `uas-06-single-local-exec-canary` Harness task 与 `verseshell-single-local-exec-canary-boundary` rule。`tools.exec.host=verseshell` 现在可由操作员在 global、agent 或 session scope 选择；模型侧 `exec` host enum 仍只有 `auto/sandbox/gateway/node`，不存在 per-call LLM routing。
- 合格的非 sandbox、非 node、非 elevated 本地执行固定进入 governed VerseShell lifecycle。sandbox、node、remote/provider-native 与 elevated 路径保留原 owner 且不进入 eligible-local 分母；governed 失败、outage、timeout、protocol mismatch 或 lifecycle loss 均不得隐式 native fallback。
- `exec.process.completed` 新增 selected host、actual execution host、lifecycle owner、cohort route、native fallback 与 recovery state；diagnostic stability 行为测试确认这些字段被保留而 command 内容不被保留，OTEL 同步投影低基数字段。
- `artifacts/uas-06-single-local-exec-canary/report.json` 固定为 `engineering-only`。工程矩阵覆盖 short/long/background/stdin/PTY/cancel/timeout/restart/rollback 九个场景，governed coverage 为 100%，native fallback 为 0，engineering hard veto 为 0，状态仍为 `needs-real-canary`，`productGraduationAuthorized=false`。
- 新增独立 `live-observations.json` 与 `real-cohort-report.json`：只有零丢失、脱敏的 diagnostics route window、外部 provider receipt digest、人工 recovery/rollback attestation 同时存在时才接受 live record。该导入器不启动 Gateway、不读取 credential、不发起 provider call，且即使报告达到 closeout-review 候选也不自动关闭 Task Forest。
- 真实 internal cohort observation、paired native/VerseShell task、actual provider usage、human recovery minute 与 soak day 均为 0。工程 rollback 场景不能替代操作员审核的 kill/rollback drill；因此 TF-0017 不得 closeout，TF-0018/UAS-07 与 TF-0019/UAS-08 不得启动。
- 本地门禁包括 UAS-06 evidence generate/check、VerseShell focused matrix、配置与诊断行为测试、root typecheck、comms replay/compare。三语 README 已同步 operator scope 和证据限制。diff-aware Harness 仅接受 task-owned 隔离投影，不使用共享脏工作区扩大 ownership。
- Task Forest proposal `TFP-tf0017-single-local-exec-engineering-20260730` 已获用户确认并 apply，canonical 为 `TF-0017=in_progress/35%`，但不构成 closeout。`liveReady=false`、`productApproved=false`、`defaultOn=false`、`TF-0006=blocked`、`TF-0009=review_needed`、Runtime Memory diagnostics-only 与 SEKB 零自动写回均未改变。
