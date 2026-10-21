---
id: versegit-module-implementation-roadmap
title: VerseGit module implementation roadmap and acceptance
type: guide
appliesTo:
  - versegit-validation-layer-extension
---

# VerseGit 模块化实施路线与验收

> 状态：工程证据链已生成，Task Forest 收口按独立 proposal 同步（非 GA、默认关闭、landed-unwired）；不是发布、默认开启或 M4 授权。
> 前置：现存 Task Forest 有独立 active lane；本路线不得在未建立新节点前直接并行开工。

## 0. 当前状态与下一步

2026-10-22：WP6 已回读 MC0-MC5、WP0-WP5 的 12 个必需门禁，复算 12 份 tracked evidence manifest / 78 条摘要记录（77 个唯一文件），并在本地存在时额外核对 12 份 artifact mirror manifest；credential pattern scan 覆盖 85 个 retained files，0 hits；以证据裁定 MC6 为 `sidecar-only`、源码提取未触发。当前模块为非 GA、默认关闭、landed-unwired：provider source 仍 dirty，只有 debug sidecar，`releaseEligible=false`；没有 live VerseShell receipt，`conflicts-plan` seam 仍 unavailable，M4 未授权。

## 1. 总体策略

先证明“观察和报告正确”，再证明“候选事实有用”，最后才讨论“执行和落地权威”。

```text
WP0 契约与身份
  -> WP1 观测桥
  -> WP2 只读 harness profile
  -> WP3 VerseShell receipt / candidate facts
  -> WP4 行为观测与反馈送达
  -> WP5 真实并发 replay / soak
  -> WP6 收口与可选 broker 决策
```

任何阶段失败都不能用“代码已存在”跳过。每一阶段必须有可回读报告、负向样例和明确未跑边界。

## 2. WP0：契约与身份

### 交付

- 固定 VG binary、version、SHA-256、schema version、capabilities digest；
- 修正 VG 仓 `.mcp.json` 指向不存在 release binary 的问题，或在文档中明确只支持 dev override；
- 定义 `clawx.versegit.module-report/v1` 与 `clawx.versegit.command-plan/v1`；
- 定义 host adapter 的 `diagnostic|advisory|candidate` 模式；
- 建立 VG/ClawX/VerseShell/harness 版本矩阵；
- 明确 `not_applicable`、`unavailable`、`partial`、`observed`、`degraded` 的语义。

### 验收

- binary 缺失、digest 不符、schema 过高、capabilities 不匹配均显式失败；
- 不初始化用户仓库；
- 不启动 daemon；
- 不修改工作树；
- report 可机器解析；
- `git status` 无变化。

### 停止条件

- 无法获得可重复构建的 VG 二进制；
- module contract 需要依赖宿主私有内部类型而无法版本化；
- 任何失败路径会退回 native shell 或旧 binary。

## 3. WP1：宿主身份与观察桥

### 交付

- ClawX 在 worktree/session 创建时生成 `repo_id/worktree_id/agent_session_id`；
- 将 tool boundary 事件映射为 VG `ReadObserved` / `WriteObserved` / session facts；
- 为 trace/request/process id 建立关联；
- 对 Bash/MCP/network/direct-fs 等未观察面保留 `unobserved`；
- session 结束时写入 `SessionEnded`/detach 事实；
- 处理迟到事件、重复事件、epoch 变化。

### 验收

- 两个 worktree 的两个 session 不会串仓或串 owner；
- 重复事件不会重复计入冲突/读集；
- 旧 epoch 事件不能覆盖当前 session；
- hook 不可用时报告 `partial`，不是 `clean`；
- VG 进程不可用时宿主继续运行；
- 事件文件有 schema、timestamp、trace、input digest。

### 停止条件

- 需要修改 ClawX write journal 才能接入；
- 需要 VG 自己推断 owner；
- 观测事件无法与 worktree/session 稳定绑定。

## 4. WP2：只读 harness profile

### 交付

- 新增显式 opt-in profile，例如 `concurrency-aux`；
- profile 仅运行经验证的 target provider seams（不得按现有 CLI 名称推断只读）：
  - `provider.status`；
  - `provider.doctor`（仅既有状态）；
  - `provider.conflicts-plan`（只生成计划，不物化、不执行）；
  - `provider.session-status`；
  - report schema validation；
  - evidence digest / cleanup；
- 触发条件：多 worktree 或多活跃 session；
- 单 worktree 单 session 完全不执行；
- 输出 `artifacts/versegit/<run-id>/`。

### 验收

- `fast` / `comms` 的行为和耗时不变；
- 单 worktree 场景 VG command count = 0；
- 多 worktree 场景有报告且 host verdict 不变；
- VG 失败只写 residual，不 fail harness；
- `partial` 不被写成 `pass`；
- report 不包含秘密或绝对用户路径；
- cleanup 后无 disposable sidecar、子进程、临时候选目录残留；成功、失败与 unknown 证据必须保留。

### 停止条件

- 只读查询本身改变工作树；
- 报告无法区分 observed/partial/unavailable；
- 触发条件误报导致每次普通开发都启动 VG。

## 5. WP3：VerseShell receipt 与 candidate facts

### 交付

- VG 只生成 verification plan / candidate facts，不在 host mode 运行自己的 verifier；
- VerseShell 接收 immutable argv、cwd、timeout、effect、owner；
- 回执包含 request/trace/process/run、exit、timeout、artifact digest、cleanup；
- VG 将回执转换为 six-dimension verdict facts；
- selected 永不填满 required full scope；
- 无回执为 `unmeasured`。

### 验收

- 同一 candidate 的 verification facts 绑定同一 candidate identity；
- 缺失 required check 时不能产生 admitted；
- VerseShell 超时/取消/进程崩溃产生明确状态；
- effectful 请求 transport 不确定时不重放；
- VG 的 verify 内部执行路径在 host mode 被机械拒绝；
- candidate temp root 不污染 primary worktree；
- 不调用 `vg land` / `vg admit` 完成 harness 任务。

### 停止条件

- 必须保留第二套进程/审批/超时逻辑；
- 无法把 STS/requiredTests 的执行事实映射成 host receipt；
- 需要把 `declare_intent` 或 `land` 暴露给模型才能完成闭环。

## 6. WP4：行为观测与反馈送达

### 交付

- 统一 `behavior-event/v1`；
- 事件 source precedence；
- 覆盖向量；
- feedback `produced -> delivered -> transcript-confirmed -> behavior-shift` 证据层级；
- 观测指标接入现有 Observability；
- 红action/截断/丢失/重试计数；
- artifact retention 与敏感字段清理。

### 验收

- 每个宿主工具动作至少有一个规范化事件，或明确 `dropped/unobserved`；
- 事件可从 trace 追溯到 process/artifact；
- 同一动作不会因多来源重复执行；
- 提示交付有回执，不把“打印了 warning”当模型已收到；
- 报告能量化未观测面；
- 无 secret/path 泄漏；
- 事件日志有上限，不存在无限内存缓冲。

### 停止条件

- 需要新建第二个 Observability 真源；
- 覆盖状态会被宿主自动升级为 `complete`；
- hook 接入必须默认改写用户配置。

## 7. WP5：真实并发 replay / soak

### 测试夹具

至少创建：

1. **单 worktree / 单 session**：VG 零执行；
2. **双 worktree / 两 session**：无冲突，报告 observed；
3. **producer-consumer**：一个改接口，一个保留旧假设，组合 candidate 才能发现；
4. **unsupported language**：`.mjs` / `.jsx` / `.sh` 显式 partial；
5. **stale epoch**：旧 session 事件晚到；
6. **VerseShell unavailable**：验证为 unmeasured，无 native fallback；
7. **sidecar crash**：session lost/degraded，可恢复；
8. **worktree cleanup during run**：必须拒绝/保留证据，不能误删；
9. **candidate cleanup**：无临时目录和子进程残留；
10. **report tamper**：digest 不符即拒绝。

### 验收

- 三次重复结果一致，除时间等测量字段；
- 真实 positive 与 negative control 均保留；
- 失败样例不被删；
- host verdict 与 VG residual 分开；
- `driven_by: agent` 与 actor 如实记录；
- 用盘上 report/event/receipt 验证，不以命令打印代替；
- 记录实际 exit、超时、count、artifact digest、清理结果；
- 性能和资源有基线，不虚构通用收益。

### 停止条件

- 只有构造数据/注入读写集，没有真实并发触发；
- 只有 `clean` 没有 negative control；
- VG 的 true positive 无法由组合 candidate 或读依据解释；
- 接入导致默认回归、错误 owner 或持久残留。

## 8. WP6：收口与可选 broker 决策

### 模块完成定义

以下全部存在并可回读，才能称“VG 已作为 ClawX harness 模块完成”：

- 版本化 contract；
- host adapter；
- opt-in harness profile；
- component identity + report schema；
- observation bridge；
- VerseShell receipt bridge；
- 10 类并发/故障测试；
- 当前候选的 curated evidence；
- docs/rule/scenario 一致；
- default-off 和 fail-open 的回归；
- 清理、恢复、保留策略；
- 未跑平台/语言/读面显式列出。

### 阶段产物

- `artifacts/versegit/<run-id>/manifest.json`
- `report.json`
- `events.jsonl`
- `observations.jsonl`
- `candidate.json`
- `verdict.json`
- `cleanup.json`
- `SHA256SUMS`
- Task Forest evidence lines + harness validation output

### 当前收口结果

- `artifacts/versegit/wp6/final-report.json` 与 `manifest.json`：12/12 必需门禁、12 份 tracked manifest、78 条摘要记录（77 个唯一文件）；另有 12 份 ignored artifact mirror manifest 仅在本地存在时复核；final report 内置凭证模式扫描，85 个 retained files、0 hits。
- `artifacts/versegit/mc6/decision.json`：`sidecar-only`，`sourceExtractionTriggered=false`；
- `hostVerdict=unchanged`、`singleGreenLight=false`、`defaultOn=false`、`ga=false`、`releaseEligible=false`；
- `liveVerseShellReceiptExecuted=false`、`conflictsPlan=unavailable`、`M4=not_authorized`；
- provider source dirty、debug binary、release binary absent 仍是发布阻塞，不可被 evidence closeout 覆盖。

### broker 讨论的前置

只有 WP0-WP5 全部完成且满足以下条件，才可另立 M4 决策：

- VerseShell 回执能独立重建验证事实；
- host Git 路径与 VG candidate identity 一致；
- 有跨 process crash / CAS conflict / stale head 的恢复证据；
- 有明确的产品锁与 owner 变更决定；
- 不把 `vg admitted` 写成 harness verdict；
- 不把默认 `land` 接入普通开发。

在此之前，`land` / `admit` 继续是 VG standalone 能力，不是 ClawX 模块能力。

## 9. Migration Control Nodes

WP0-WP6 处理 harness 接入本身；迁移控制还需要 MC0-MC7，避免源码污染和 LLM 重写。

| Node | 目标 | 核心产物 |
| --- | --- | --- |
| MC0 | 冻结 VG source/binary/schema 基线 | `migration-inventory.json` + golden fixtures |
| MC1 | 定义 anti-corruption sidecar contract | module-report / command-plan / execution-receipt schema |
| MC2 | 建立 behavior fingerprint | characterization tests + golden JSON |
| MC3 | 固化 sidecar 交付 | binary manifest + startup/recovery contract |
| MC4 | 实现 ClawX module adapter | host-owned `VerseGitModule` adapter |
| MC5 | 建立 differential migration gate | golden diff + diff budget + behavior-change report |
| MC6 | 裁定 sidecar-only 或 selective extraction | architecture decision + provenance + rollback |
| MC7 | 迁移收口与临时层退役 | retirement record + curated evidence |

详细规则见
[`versegit-migration-control-plan.md`](versegit-migration-control-plan.md)。

## 10. Task Forest 落地建议

不要直接在当前 active lane 中插入 ready 节点；应先按仓库 policy 保存 proposal。建议分成两个森林：

### ClawX Task Forest

- 全局目标：并发工作区控制面模块化；
- WP0：契约与身份（proposed/ready 由当前主线决定）；
- WP1：观测桥；
- WP2：diagnostic profile；
- WP3：VerseShell receipt；
- WP4：行为观测；
- WP5：并发 replay/soak；
- WP6：收口；M4 决策另立。

### VerseGit Task Forest

- 全局目标：ClawX host module adapter；
- 只承载 VG 侧代码、schema、plan-only verify、MCP filter、binary packaging；
- 与 ClawX 节点通过 contract/evidence 引用，不复制双方状态。

两边的节点标题可以不同，但必须引用同一版本化 contract 和同一 evidence run-id。

## 10. 当前残余缺口

WP6 收口不会把这些事实升级成成功：

| 残余缺口 | 当前事实 | 授权状态 |
| --- | --- | --- |
| live VerseShell receipt | 只有 structural bridge 与拒绝矩阵，未执行 host-authoritative receipt | `unmeasured`；不得产生 full verification |
| `conflicts-plan` seam | 当前 CLI 没有纯只读 seam，WP2 记录 `provider_seam_unavailable` | `unavailable`，不得用 effectful 命令替代 |
| shell/direct-fs/arbitrary-MCP/network/browser | 读面仍为 `unobserved`、`inferred` 或 `partial` | 不得写成零冲突或完整覆盖 |
| 语言覆盖 | Python 仅限 MC2 fixture；`.mjs/.jsx/.sh` partial；其他语言 unverified | 不得声明全语言覆盖 |
| 非 Windows 平台 | 只有 `win32-x64` 执行证据，Linux/macOS 未跑 | 不得声明跨平台等价 |
| 发布交付 | source dirty、debug binary、release binary absent，MC0/MC3 明确 rejected | `releaseEligible=false`；证据收口不是产品批准 |
| 真实 agent→VG invocation | WP1 使用 host-injected events，WP5 明确 0 次 VG process call | 不声明真实模型工具闭环 |
| M4 broker | 没有 CAS/crash/stale-head recovery 证据或所有权更替决定 | `not_authorized`，`land/admit` 不接入默认路径 |

## 11. 最终判定

本项目的生命周期不是“从独立产品降级成一个插件”，而是：

> **VG 保持完整 standalone 产品，同时在 ClawX 中获得一个窄的、版本化、可撤销的 host module profile。**

它的最高默认权威是：

- M1/M2：仓库语义事实、候选风险和辅助证据；
- M3：由宿主执行、由 VG 解释的验证事实；
- M4：只有在单独所有权更替决策后，才可能获得 CAS 落地权威。

这是既能吸收 VG 已完成的系统，又不会破坏 ClawX harness 现有信任模型的唯一合理落点。
