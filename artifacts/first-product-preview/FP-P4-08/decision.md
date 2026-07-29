# FP-P4-08 多平台与 PR 依赖图扩围裁决

> 裁决级别：`engineering-validation-only`
> 实现授权：无
> 远端副作用：无

## 结论

| 能力面 | 裁决 | 当前保留范围 | 主要原因 |
|---|---|---|---|
| GitLab | `shrink` | 仅保留未来 read-first 候选研究 | 上游 API 覆盖与 ClawX 共享 contract 有复用价值，但没有具名需求、目标仓库、权限或真人流程证据 |
| Gitee | `stop` | 不保留活跃 backlog，只保留安全约束和复审条件 | 无需求证据；审计快照使用 query token；协议缺口和凭据风险相对价值过高 |
| stacked PR dependency DAG | `shrink` | 仅保留只读候选语义 | 上游存在有界算法，但 ClawX 没有真实 stacked PR 需求；错误图可能误导 merge 顺序 |
| Merge Queue/Train | `shrink` | 仅保留只读状态候选 | 上游能区分 GitHub Queue/GitLab Train/Gitee 不支持，但没有启用队列的目标仓库或状态消费证据 |

本轮没有 `continue` 项，因此不创建 Task Forest implementation proposal。任何后续实现仍必须先形成独立 proposal，并经用户确认后才可 apply。

## 证据边界

- P2-08/09/10 证明 GitHub 路径的 bounded read、action-bound approval、head SHA/readiness fail-closed 和默认 Agent merge OFF 可以作为设计基线。
- P2-02 的真人计数仍为 0；GitLab、Gitee、stacked PR、Queue/Train 的真人运行也全部为 0。
- P3-04 仍是 `engineering-validation-only`，未完成真实 clean VM 出闸和产品批准。
- MergeBeacon 只作为冻结源码证据：commit `14a17c7ecb821af4bdb645d5f492e7cf72bcd293`、tree `95fddba4593a879352a59de157db92c63afa819f`。它证明“可以参考什么”，不证明 ClawX “应该实现什么”。

所以当前证据最多支持保留低成本、只读、需重新举证的候选，不能支持实现级 `continue`。

## 平台复核

### GitLab — shrink

冻结快照显示 GitLab 具备 compare、discussion、metadata、Merge/Squash 和 Merge Train 状态能力；ClawX 已有 provider-neutral patch/error/completeness/readiness/action binding，可降低未来 contract 设计成本。缺口是没有具名用户、目标 namespace/repository、PAT scope、自托管 host 策略或 live API 验证。

仅当以下证据包同时存在时复审：

1. 具名需求 owner 提供至少一个目标 GitLab namespace/repository、代表性 read/review 工作流、频率及 GitHub-only 不足。
2. 提供 disposable sandbox 和最小权限 PAT 方案；只读 spike 覆盖分页、完整性、head SHA、discussion、approval、private-host 脱敏，且远端 mutation 为 0。

### Gitee — stop

冻结快照中 Gitee 缺少 Draft 切换、thread resolution、remote viewed-file state 和原生 queue；更关键的是审计实现把 `access_token` 放入 query。ClawX 禁止 query token 进入通用 URL、日志、trace、错误、遥测或 support bundle。没有明确需求时，不承担这组凭据和平台差异成本。

仅当以下证据包同时存在时复审：

1. 具名需求 owner 提供至少一个真实 Gitee 部署/仓库及 GitHub 路径无法覆盖的工作流。
2. 专用 Main transport 或平台认证方式证明 token 不进入通用 URL；负向测试覆盖日志、trace、错误、遥测和 support bundle；disposable sandbox 完成最小权限只读验证。

### stacked PR dependency DAG — shrink

冻结快照的图算法有 page/query/candidate 上限并显式记录 truncation，但 ClawX 没有真实 stacked PR 流程。未来候选只能只读，并必须保留：

- repository identity；
- cycle；
- truncated；
- blocking parent；
- incomplete fail-closed。

它不能获得 branch create/checkout/rebase/push 或 PR mutation authority，也不能把不完整或有环图展示为安全 merge 顺序。

仅当具名用户提供真实 stack 决策需求，并且只读 contract fixtures 覆盖同仓、fork、cycle、truncated、missing/blocking parent 时复审。

### Merge Queue/Train — shrink

冻结快照区分 GitHub Merge Queue、GitLab Merge Train 和 Gitee 无原生队列，但 ClawX 没有 queue-enabled 目标仓库或真人状态消费。候选只允许读取 bounded status；unknown/stale 必须保持 unknown。

禁止 `enqueue`、`dequeue`、`reorder`、`retry`、`approve` 和 `merge`。仅当具名 queue/train 仓库形成反复状态查看需求，且 provider-specific spike 能在无 mutation 权限下区分 current/stale/unknown/unavailable/complete 时复审。

## 冻结边界

- `liveReady=false`
- `productApproved=false`
- `defaultOn=false`
- Agent merge OFF
- 不新增 adapter、Host API、Renderer、MCP、凭据、分支、PR 或 queue mutation
- 不把 fixture、源码审计或 GitHub 工程测试解释为多平台真实需求/产品价值

机器可读真源为 `artifacts/first-product-preview/FP-P4-08/decision.json`。
