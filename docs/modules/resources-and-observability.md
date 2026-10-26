# 资源治理、可观测性与恢复

> 面向问题：系统怎样限制进程、终端、端口、消息和 token 资源？后台任务在 CPU/RSS 压力下怎样降载？Trace、Problem、Session Activity、Doctor、backup 和 support bundle 各能证明什么？

## 1. 设计原则

当前资源治理是**合作式**的：

- 不引入 Job Object、cgroup、ACL、restricted token 等内核级沙箱；
- 不承诺 OS 强制 QoS；
- 由 Main/runtime 的队列、lease、采样和 policy 共同约束；
- foreground/user-initiated work 不能被后台 shed 静默终止；
- 资源观测以 shadow envelope 为主，未证明的数值保持 unknown；
- 不新增外部 APM 或 metrics 服务。

## 2. ResourceFabric

实现：

- `electron/services/resource-fabric.ts`
- `shared/resources/`

当前 admission account 只有两个：

| Account | 用途 | min | initial | max | queue | timeout |
|---|---|---:|---:|---:|---:|---:|
| `workspaceExec` | terminal/workspace exec | 1 | 2 | 4 | 64 | 30 s |
| `chatHistory` | chat history RPC | 1 | 2 | 4 | 64 | 30 s |

这不是“全系统唯一调度器”，而是两个已经接入的并发资源账。

Fabric 组成：

- `AdaptiveLimit`：Gradient2 风格自适应并发；
- `PriorityQueue`：interactive / background / opportunistic QoS；
- `DrfShare`：进程槽与并发额的 DRF-lite；
- `Singleflight`：同 key chat history 请求合并；
- Resource envelope ledger：记录 limit history、排队、拒绝和 active slots。

特征：

- 有 min-change dead zone，避免 limit 抖动；
- opportunistic 有过期/晋升策略，避免永久饥饿；
- acquire 超时会返回 typed error；
- Chat history 同 key 并发只打一次真实请求；
- 资源事件写 shadow envelope，不自动升级为外部 metrics。

## 3. BackgroundWorkGate

实现：`openclaw_runtime/src/resources/background-work-gate.ts`。

高水位：

| 条件 | 高水位 | 低水位 |
|---|---:|---:|
| queue depth | 16 | 4 |
| process tree RSS | 3 GiB | 2 GiB |
| tree CPU | 300% | 120% |

其他：

- min dwell：10 秒；
- shed signal 可来自窗口隐藏、display sleep、power saver；
- 进入 deferring 后，background task 暂存；
- 只有所有观测回到低水位并满足 dwell 才恢复；
- 缺少当前导致 defer 的观测时，不盲目 resume；
- foreground priority 永不 defer。

Gate 是 backpressure，不是 kill switch。它延迟/排队后台工作，不杀死正在交互使用的前台工作。

## 4. Efficiency / Power Policy

实现：

- `electron/services/efficiency-sampler.ts`
- `efficiency-power-policy.ts`
- `efficiency-orchestrator.ts`
- `efficiency-api.ts`

每 5 秒采样：

- process tree CPU；
- process count；
- tree RSS；
- active/queued slots；
- Main/aggregate resource envelope；
- active timers/watchers；
- spawn counts。

Shed 原因：

1. window hidden/minimized；
2. display sleep；
3. power saver / OS speed limit <100%。

优先级：window-hidden > display-sleep > power-saver。

发生 transition 时：

- 更新 TimerAligner shedding；
- 写日志；
- 更新 BackgroundWorkGate；
- 只影响 background 周期任务和 opportunistic work。

这不是电池管理结论；它是本地 resource policy。

## 5. 资源原语

`shared/resources/` 当前提供：

| 原语 | 用途 |
|---|---|
| `BoundedCache` | LRU + TTL + invalidate |
| `Singleflight` | 同 key 并发请求合并 |
| `AdaptiveLimit` | 自适应并发 |
| `TokenBucket` | 令牌桶限速 |
| `PriorityQueue` | 优先级/老化/QoS |
| `DrfShare` | dominant-share 记账 |
| `TimerAligner` | 周期任务对齐与 shed-aware 降频 |
| `WatcherHub` | 按 root 合并文件 watcher |
| `WriteCoalescer` | 写入合并 |

已见生产使用：

- Git status：BoundedCache + Singleflight；
- read-only renderer query：BoundedCache + per-call cache + Singleflight；
- ACP event ledger：WriteCoalescer；
- ResourceTracker / efficiency / cron maintenance / SQLite WAL：TimerAligner；
- runtime fs watch/footer：WatcherHub；
- terminal/chat history：ResourceFabric。

不是所有 20+ 定时器、9 路 watcher 或全部网络请求都已统一池化。路线图中的 P3/P4/P5 仍有未完成部分。

## 6. ResourceTracker 与端口/进程

实现：`electron/services/resource-tracker.ts`。

策略：

- 30 秒 TCP heartbeat；
- 单 probe timeout 3 秒；
- session 无活动 10 分钟 → `idle`；
- 30 分钟无活动 → 自动清理；
- 新 listening ports 在 1/5/15/30 秒窗口扫描；
- 只登记扫描前不存在的端口；
- 忽略 Main 自身 PID；
- ownership 可为 managed/observed；
- session delete/stop/reset/workspace delete 时执行 `unregisterBySession`；
- shutdown 时 stop all。

风险：

- TCP reachability 是本地端口事实，不等于服务业务健康；
- 自动清理只应针对已登记的资源；
- 不应通过全局 kill-all 清理未知进程；
- 端口复用可能造成 PID/端口身份变化，必须保留 owner/session 关联。

## 7. Long-session 资源回收

`electron/services/long-session-resource-reclamation.ts` 协调：

- terminal sessions；
- web preview dev server；
- browser sessions；
- managed ports；
- session generation 不匹配的残留；
- workspace switch/delete、permission change、session stop/reset/delete。

恢复失败不是静默成功：

- 先返回 `recovery_required` 或等价错误；
- 保留 owner/evidence；
- stop 后再次尝试；
- task/Task Ledger 真相不因清理失败而被重置。

## 8. 会话/渲染资源上限

`shared/agent-resource-limits.ts`：

| 维度 | 默认 |
|---|---:|
| 最大 retained messages | 300 |
| history page size | 200 |
| max DOM render messages | 120 |
| max tool result chars | 80,000 |
| max session total tokens | 1,000,000 |
| max session cost | 100 USD |
| turn timeout | 30 min |

行为：

- 超出 token/cost budget：Host 在发送前拒绝新 turn；
- 超出消息内存上限：保留最新消息；
- tool result 超长：保留头尾并插入截断标记；
- DOM 只渲染窗口，避免大历史挂满节点；
- turn timeout 到点后应 abort 并释放 run state。

这些上限可通过显式配置/测试覆盖，但默认值是产品保护而不是建议。

## 9. Resource Envelope

Schema：`openclaw.resource-envelope/v1`，当前 `mode:"shadow"`。

Entry 形状包含：

- id/workspaceKey；
- kind；
- priority；
- owner；
- activeSlots/queuedCount/queueWaitMs；
- processCount/treeRssBytes/treeCpuPercent；
- pids；
- limits；
- limitHistory；
- updatedAt/reason。

ResourceKind 包括：

- agent-turn；
- terminal-exec；
- runtime-bash；
- workspace-search/writer；
- subtree/file mutation；
- browser session；
- PTY；
- MCP process；
- provider sidecar；
- background index；
- chat history；
- network pool。

Snapshot 汇总 totals 与 exceeded，但 shadow 不自动 enforcement。`resourceEnvelope.getState` 只读当前状态。

## 10. Observability

实现：

- `electron/services/observability-api.ts`
- `observability-service.ts`
- `observability-trajectory.ts`
- `observability-trajectory-index.ts`
- `observability-graph.ts`
- `observability-issues.ts`
- `observability-problems.ts`
- `openclaw_runtime/src/observability/`

Trace 包含：

- trace id/name/status/run/session/task/mode；
- started/ended/duration；
- spans/events；
- token usage；
- metrics；
- tags；
- error。

Span kinds：

- orchestrator / role-router / team；
- subagent；
- model；
- tool；
- memory / context-pack / gatekeeper；
- verifier / security-intercept / verification；
- input-mode；
- custom。

Graph node/edge 提供因果和执行投影，不自动成为完整审计链。

## 11. Scorecard 与 issues

Scorecard：

- 0–100 score；
- A/B/C/D/F；
- weighted items + reason。

ContextHealth 可以投影成 synthetic `ctx-health-<turnId>` scorecard，但 synthetic 标识必须保留。

Issue categories 包括：

- error-root-cause；
- aborted；
- stalled-running；
- slow-node；
- token-hotspot；
- tool-retry；
- approval-wait；
- artifact；
- command-failed；
- missing-verifier；
- orphan-trajectory；
- missing-output。

Issue 是诊断建议，不是自动修复命令。

## 12. Cross-run Problems

`pnpm observability:problems` 是**显式 agent batch**，不是 resident auto-remediation service。

规则：

- 从 sanitized trace index 聚合；
- signature 由 category + normalized title + model/agent + optional tool 构成；
- seven-day window；
- 每条 trace 对同 signature 最多贡献一次；
- 第二次 occurrence 或 critical occurrence → `open`；
- state：`pending / open / mitigated / closed`；
- 重新出现可 reopen；
- 导出 manifest/evidence/resolution，内容 redacted；
- 不自动修改代码或任务状态。

## 13. Session Activity

`SessionActivitySnapshot` 是只读读模型：

- session/run 状态；
- git status；
- tasks；
- subagents；
- completion batches；
- terminals；
- goals；
- processes；
- lineage；
- effective policy。

它明确区分：

- `known` vs `unknown` 的 background read；
- retained facts vs fresh facts；
- run 完成 vs 后台进程仍运行；
- task completion vs activity row；
- generation mismatch/fenced。

Session Activity 不是任务状态 authority，也不是资源清理 authority。

## 14. Diagnostics / Doctor / Logs

相关服务：

- `diagnostics-api.ts`
- `logs-api.ts`
- `app.openClawDoctor`
- `gateway.health`
- `gateway-control`
- `support-bundle.ts`
- `performance-metrics.ts`

可观察：

- Gateway 状态/pid/restart；
- local control plane status/reports/correlations；
- Doctor JSON；
- logs recent/memory/files；
- process tree sample；
- spawn counts/active intervals/watchers；
- support bundle。

Doctor/Doctor Fix：

- Doctor 是只读诊断；
- Doctor Fix 是显式修复操作；
- 二者不能混写为“发现问题并已自动修复”；
- packaged/headless/环境差异可能让 Doctor 失败，不等于产品功能失败。

## 15. Backup / Restore

`backup-restore.ts` 设计与边界：

- 读取 archive manifest；
- 校验 schema、createdAt、assets；
- preview 输出 create/skip-existing/rejected；
- restore 仅创建不存在路径，不覆盖当前数据；
- 拒绝路径遍历/越出 manifest root；
- 中途失败时回滚本次已创建文件；
- 结果包含 written/skipped/rejected/errors/rolledBack。

这是保守恢复，不是“完整灾难恢复无风险”。若用户当前数据损坏而目标路径已存在，restore 会跳过而不是覆盖；需要人工/agent 另行判断。

## 16. 当前限制

- ResourceFabric 只正式接管 workspaceExec 与 chatHistory，不是全局进程调度器。
- 合作式资源治理不等于内核沙箱。
- emulator/sampler 观测值不是业务吞吐或用户体验 SLA。
- BackgroundWorkGate 只延迟 background；不能阻止 bug 导致持续前台过载。
- ResourceTracker 只清理已登记资源。
- Resource envelope 是 shadow，不代表运行时已验证 enforcement。
- Trace 缺失/零项是 `not-runnable/partial`，不能因页面存在宣称完整 trace。
- Cross-run Problems 是批次工具，不是自动运维机器人。
- Backup restore 不覆盖现有数据；不能代替离线备份策略。
- Named platform acceptance 仍以 Windows x64 controlled workflow 为主。

## 17. 源码与命令索引

关键源码：

- `shared/resources/`
- `shared/types/resources.ts`
- `shared/types/resource-tracker.ts`
- `shared/agent-resource-limits.ts`
- `openclaw_runtime/src/resources/`
- `openclaw_runtime/src/observability/`
- `electron/services/resource-fabric.ts`
- `electron/services/resource-tracker.ts`
- `electron/services/resource-envelope.ts`
- `electron/services/efficiency-*.ts`
- `electron/services/long-session-resource-reclamation.ts`
- `electron/services/observability-*.ts`
- `electron/services/session-activity-api.ts`
- `electron/services/backup-restore.ts`
- `electron/services/support-bundle.ts`
- `electron/services/diagnostics-api.ts`

常用入口：

```bash
pnpm observability:problems
pnpm runtime:perf
pnpm runtime:event-log:inspect
pnpm runtime:memory:inspect
```

实际脚本名以根 `package.json` 为准；不存在或需要 provider/凭据的命令必须明确报告，而不是临时拼一个替代步骤。

延伸阅读：[运行时控制平面](../dev/runtime-control-planes.md)、[Windows 运行时效率观测](../dev/windows-runtime-efficiency-observability.md)、[资源调度规划](../dev/resource-scheduling-plan-20261018.md)。