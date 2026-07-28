# 统一 Agent 系统开发日志

> 创建日期：2026-07-27
>
> 当前状态：UAS 路线已确认并登记、实现尚未开始；First Product pre-canary 工程已完成，等待真人 canary
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
| 0 | `TF-0011` | UAS-00 证据冻结与治理登记 | 冻结源码/二进制/测试基线；建立引用通信规则的 Harness task spec；修复 VToken 默认值 spec drift | 8-16h | proposed |
| 1 | `TF-0012` | UAS-01 统一 Contract 与持久事件主干 | 版本化 plan/process/observation/artifact/event schema；幂等、重放、脱敏和保留策略可验证；不创建第二 run journal | 16-32h | proposed |
| 2 | `TF-0013` | UAS-02 Context Orchestrator residual 收口 | 所有 context source 先产出候选；唯一 owner 完成去重、排序、最终预算和 lineage；私有预算与重复注入为 0 | 32-48h | proposed |
| 3 | `TF-0014` | UAS-03 VerseToken 无状态装箱化 | 移除只读生产路径的 MemStore/WAL/无关 session 状态；按 workspace 隔离 worker；estimate 不冒充 actual usage；热重载语义有明确裁决 | 24-40h | proposed |
| 4 | `TF-0015` | UAS-04 Coding 写入一致性与恢复 | `apply_patch` 纳入 mutation 协调；多文件失败无静默 partial mutation；wrapper 顺序和 recovery state 有测试证据 | 32-56h | proposed |
| 5 | `TF-0016` | UAS-05 VerseShell 进程生命周期等价 | argv/env/PATH/stdin/background/ConPTY/poll/read/write/kill/cancel 与重启 reconcile 通过 Windows 矩阵；重复/孤立进程为 0 | 80-120h | proposed |
| 6 | `TF-0017` | UAS-06 单一本地执行平面 canary | cohort 内合格本地执行 100% 经过 VerseShell；native fallback 为 0；kill switch/rollback 演练成功率 100% | 40-64h | proposed |
| 7 | `TF-0018` | UAS-07 长期 Memory 治理闭环 | candidate 经验证和批准后才进入唯一目标 store；支持 TTL、纠正、冲突、supersede、revoke；SEKB 自动写回为 0 | 40-80h | proposed |
| 8 | `TF-0019` | UAS-08 真实 ROI、soak 与毕业裁决 | 预注册 paired A/B；记录实际 provider 和运营成本；连续 14-28 天 soak；给出 continue/reduce/stop 决策 | 16-32h，另含日历 soak | proposed |

子任务估时简单相加为 288-488 工程小时，高于 `TF-0010` 当前保存的 240-400 小时组合估计。`TF-0011` 应基于冻结范围校准一次，不得把初始估计当成承诺工期。

## 4. 依赖与跨树关系

执行依赖：

```text
TF-0009
  -> TF-0011 (UAS-00)
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

- `TF-0009`：状态为 `ready`，是当前唯一可执行的 ready 任务；
- `TF-0007`：`in_progress`，作为 `TF-0009` 的全局父任务；
- `TF-0010` 至 `TF-0019`：全部为 `proposed`，没有实现授权；
- `TF-0011`：显式 `depends_on TF-0009`，不得提前启动；
- `TF-0006`：保持 `blocked`，本次登记没有修改其状态。

导出的 todo 数据会把没有 blocking dependency 的全局容器 `TF-0010` 标记为结构上的 `ready: true`，但它的正式状态仍是 `proposed`。调度时只以 `status=ready` 的可执行叶节点为会话入口；当前即 `TF-0009`。

## 6. 当前验证证据

| 验证 | 结果 | 解释 |
|---|---|---|
| `pnpm vtoken:test` | 246 passed / 1 failed | `TestHotReloadConcurrent.test_concurrent_resolve_during_reload` 未观察到最终 `v5`；不得宣称 doc-source 并发热重载可靠 |
| 热重载失败用例独立复跑 | 5/5 failed | 是稳定语义缺口，不是单次抖动 |
| OpenClaw Context/VToken/Coding focused Vitest | 11 files / 147 tests passed | 现有局部 contract 和治理行为通过 |
| 根层 Orchestrator/VToken/default tests | 3 files / 18 tests passed | 默认 OFF 与入口扫描通过 |
| Task Forest `validate` | 通过 | proposal 应用后的 canonical graph 合法 |
| Task Forest HTML 抽查 | 通过 | 新主树、串行依赖、`derived_from`、`contributes_to`、状态统计和布局控制均已导出 |

## 7. 下一会话唯一入口

`TF-0009` 当前由 `docs/dev/first-product-controlled-preview/` 落地：FP-P0 已出口，FP-P1 正在实施。下一会话应从该 program 的 `STATUS.md` 所列 active task 继续，不实施 UAS 节点。

正式交接顺序：

1. `FP-P1` 完成首产品纵向链路；
2. `FP-P2-07` 至 `FP-P2-10` 串行完成 shared patch/error、GitHub Forge read/review/readiness/受控 merge 工程闭环；
3. `FP-P2-01/02` 在同一 charter、版本和 sandbox repository 下完成 DCS + Forge 真人 canary；
4. `FP-P2-03` 对 DCS coding、Forge read、Forge review、Forge merge 分别给出 `continue` / `shrink` / `stop`，刷新 `TF-0009` 并把证据追加到本文；
5. `continue` / `shrink` 进入 FP-P3，`stop` 则保持全部 UAS 节点 proposed；
6. `FP-P3-04` 出闸，或用户正式暂停 P3 并记录原因；
7. 另提 Task Forest proposal，将 `TF-0011` 从 proposed 转为 ready；
8. 之后才按 `TF-0011` 至 `TF-0019` 严格串行。

`TF-0009` 完成只会解除 `TF-0011` 的依赖，不自动授予实现权限。

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
