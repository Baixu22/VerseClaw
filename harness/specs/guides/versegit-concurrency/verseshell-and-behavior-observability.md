---
id: versegit-verseshell-behavior-observability
title: VerseGit VerseShell and behavior observability contract
type: guide
appliesTo:
  - versegit-validation-layer-extension
---

# VerseShell 耦合与行为层观测契约

> 状态：设计基线。
> 目标：让 VG 成为语义控制面，让 VerseShell 保持唯一执行面，并把“行为监控”做成覆盖可解释的事实流，而不是日志堆积。

## 1. 所有权拆分

```text
ClawX host
  |-- decides task graph, worktree, approval, journal
  |-- owns user-visible verdict
  v
VerseShell
  |-- executes immutable argv
  |-- owns process lifecycle, PTY, timeout, cancellation, artifacts
  v
VerseGit
  |-- observes repository/session facts
  |-- computes conflicts, candidate identities, verdict facts
  |-- records receipts and reports
```

VG 在 standalone 模式可以自己执行检查；在 ClawX host mode 中，这一能力必须被替换为“生成/消费执行事实”，否则会与 VerseShell 的进程、审批和回收权威冲突。

## 2. 跨层调用规则

### 2.1 ClawX -> VerseGit

只通过 host-owned `VerseGitService` / typed adapter：

- 输入是结构化参数；
- 输出是带 schema/version/digest 的 JSON；
- 禁止 renderer 直接调用 CLI、MCP 或 Gateway HTTP；
- 禁止把模型生成的 shell 字符串直接交给 VG；
- VG 的只读查询可以作为工具暴露；
- VG 的写/候选命令默认 host-only，不对模型开放。

### 2.2 VerseGit -> VerseShell

VG 产生执行计划，VerseShell 执行：

```json
{
  "schema": "clawx.versegit.command-plan/v1",
  "runId": "vg-run-...",
  "candidateId": "candidate-...",
  "owner": {
    "agentId": "agent-...",
    "sessionId": "session-...",
    "worktreeId": "worktree-..."
  },
  "commands": [
    {
      "checkId": "pnpm-test",
      "argv": ["pnpm", "test"],
      "cwd": "D:\\tmp\\candidate-...",
      "env": {
        "CI": "1"
      },
      "timeoutMs": 120000,
      "effect": "execute",
      "retry": "never-when-effect-unknown",
      "expectedArtifacts": ["stdout", "stderr", "exit"]
    }
  ]
}
```

VerseShell 返回：

```json
{
  "schema": "clawx.verseshell.execution-receipt/v1",
  "requestId": "host-...",
  "traceId": "trace-...",
  "runId": "vg-run-...",
  "checkId": "pnpm-test",
  "processKey": "process-...",
  "status": "exited",
  "exitCode": 0,
  "signal": null,
  "durationMs": 1234,
  "output": {
    "stdoutSha256": "...",
    "stderrSha256": "...",
    "artifactRef": "artifact://..."
  },
  "cleanup": {
    "status": "clean",
    "survivors": 0
  },
  "policy": {
    "profile": "governed-exec",
    "catalogDigest": "..."
  }
}
```

VG 只消费回执。没有回执 = `unmeasured`，不是 passed。

### 2.3 禁止事项

- VG host mode 不直接 `child_process` / `std::process::Command` 执行验证；
- VG 不自行解释 shell 字符串；
- VG 不创建第二套超时/审批/进程回收；
- VerseShell 失败时不回退 native shell；
- VG 不把 stdout 文本或调用方自报的 exit 0 当作可信执行事实；
- 任何 effectful 命令不得因 transport 不确定而自动重放。

## 3. 模式与命令权限

| VG 能力 | M1 diagnostic | M2 advisory | M3 candidate |
| --- | --- | --- | --- |
| `capabilities` | 允许 | 允许 | 允许 |
| `doctor` | 允许 | 允许 | 允许 |
| `conflicts` | 允许 | 允许 | 允许 |
| `session show` | 允许 | 允许 | 允许 |
| `verdict --facts` | 允许 | 允许 | 允许 |
| `mcp` 只读工具 | 白名单 | 白名单 | 白名单 |
| `declare_intent` | 拒绝 | 拒绝 | host-only 显式授权 |
| `observe` 写事件 | 仅 adapter | 允许 | 允许 |
| `verify run` | 拒绝 | 拒绝 | 禁止由 VG 自跑；由 VerseShell 执行 |
| `verify candidate` | 拒绝 | 可生成计划 | 宿主执行计划 |
| `land` / `admit` | 拒绝 | 拒绝 | 默认拒绝 |

`vg mcp` 的只读 filter 至少保留：

- `vg_capabilities`；
- `verdict`；
- `integration_status`；
- `who_touches`；
- `explain_conflict`；
- `basis_status`；
- `basis_watermark`。

`declare_intent` 是写事件，默认不得出现在 ClawX 模型可见的只读 profile 中。

## 4. MCP 与 VerseShell MCP 的区别

- `verseshell-mcp` 是 VerseShell 的外部兼容 adapter，不能变成任意 MCP 代理。
- VG 有自己的 stdio MCP server；若 ClawX 需要模型可见的 VG 工具，应通过 host MCP policy 暴露筛选后的只读目录。
- 不应把 VG 嵌套进 `verseshell-mcp` 的 tool catalog，否则 capability、catalog digest 和审批 owner 会混在一起。
- 两条 adapter 可以同时存在，但必须共享：
  - host workspace identity；
  - session/run/trace id；
  - approval/owner policy；
  - evidence schema。

## 5. 与 ClawX worktree service 的关系

当前 ClawX 的 `openclaw_runtime/src/agents/worktree-service.ts`：

- 默认 `inprocess`，Git backend 为 opt-in；
- Git backend 使用 hardened `git worktree add/remove`；
- merge queue 只按路径重叠与文件内容做复制级判断；
- 失败时存在回退到 inprocess 的路径；
- cleanup 有 lock/retry，但仍需宿主记录真实 fallback。

VG 的正确接入点：

1. ClawX 继续拥有 worktree create/merge/cleanup；
2. 每个 worker worktree 创建后，将 `repo_id/worktree_id/agent_session_id/base_oid` 传给 VG；
3. VG 只读观察该 worktree 和相应 session；
4. 在 ClawX merge queue 之前提供语义风险事实；
5. 在 worktree 清理前确认 VG report/evidence 已完成；
6. 清理后发 `SessionEnded`/detach 事实。

VG 不应自己创建 ClawX worker worktree，也不应接管 ClawX 的 merge queue。

## 6. 行为层事件模型

“完整监控”在本设计中表示：

- 所有进入宿主执行边界的工具/进程/文件效果都有一个规范化事件；
- 每个事件都带 coverage/effect/owner；
- 未经过宿主边界的通道被显式标为 `unobserved`；
- 不允许把事件缺失推成“没有发生”。

### 6.1 标准事件

```json
{
  "schema": "clawx.versegit.behavior-event/v1",
  "eventId": "evt-...",
  "traceId": "trace-...",
  "requestId": "req-...",
  "agentSessionId": "agent-session-...",
  "vgSessionId": "vg-session-...",
  "repoId": "repo-...",
  "worktreeId": "worktree-...",
  "actor": "agent:codex",
  "surface": "file.read | file.write | repo.search | exec | test | mcp | network | browser | control",
  "operation": "read | search | write | execute | poll | kill | ...",
  "effect": "none | read | write | process | network",
  "status": "started | succeeded | failed | cancelled | timed-out | unknown",
  "coverage": "direct | host-event | inferred | partial | unobserved | dropped",
  "evidence": {
    "grade": "direct-receipt | normalized-event | polling-inference | none",
    "ref": "artifact://..."
  },
  "inputDigest": "sha256:...",
  "outputDigest": "sha256:...",
  "startedAt": "2026-10-21T00:00:00Z",
  "endedAt": "2026-10-21T00:00:01Z",
  "reason": null
}
```

### 6.2 事件来源与优先级

| 来源 | 例子 | 默认等级 |
| --- | --- | --- |
| host tool boundary | runtime edit/write/read/exec | normalized-event |
| VerseShell process receipt | `process.start/poll/write/kill` | direct-receipt |
| VG hook | Claude Code Read/Edit hook | normalized-event |
| VG fs-watch | dirty path polling | polling-inference |
| VG basis | 显式 read/search receipt | direct-receipt |
| network/browser | 外部 MCP、浏览器 | partial/unobserved |

同一动作若有多个来源：

- direct receipt 优先；
- host event 可补 owner/trace；
- polling 只能补“观察到的写”，不能补读；
- 冲突的输入哈希让事件变为 `unknown`，不能择一覆盖。

## 7. 观察覆盖向量

每个 session/report 必须声明：

```json
{
  "coverage": {
    "fileRead": "partial",
    "fileWrite": "host-event",
    "search": "partial",
    "shellRead": "unobserved",
    "shellWrite": "inferred",
    "mcpRead": "partial",
    "mcpWrite": "unobserved",
    "network": "unobserved",
    "browser": "unobserved",
    "directFs": "unobserved"
  },
  "knownGaps": [
    "bash cat is outside structured read hook",
    "external MCP calls are not observable"
  ]
}
```

VG 现有真实会话测量显示 hook 可见读取只占一部分读面；该事实不能因 ClawX 接入而消失。宿主模式的目标是提高覆盖并准确声明，而不是伪造 100%。

## 8. 反馈送达等级

VG 的提示不能只证明“生成了文本”：

| 等级 | 事实 | 能说明什么 |
| --- | --- | --- |
| produced | VG 生成 additionalContext/hook 输出 | 已产出 |
| host-delivered | 宿主接收并注入工具结果/上下文 | 已送达边界 |
| transcript-confirmed | transcript 在下一次模型调用前出现 | 进入模型上下文 |
| behavior-shift | 有对照实验显示决策/结果改变 | 可能产生收益 |

前两层可作为 harness 辅助证据；第三层需要 transcript；第四层需要配对实验。任何层级都不能凭空外推。

## 9. 可观测指标

建议先测基线，再设阈值：

- attach/discover latency；
- event ingestion lag p50/p95；
- observation coverage 比例；
- queued/dropped/truncated 事件数；
- stale session/worktree 数；
- conflict produced / host-delivered / transcript-confirmed 数；
- candidate materialization time；
- verification plan -> receipt completion rate；
- cleanup survivor/lost/recovery_required 数；
- sidecar memory/CPU/进程数；
- VG unavailable/degraded 次数。

这些指标进入 ClawX Observability 或 harness artifact，不另建第三个用户可见仪表盘。

## 10. 安全与隐私

- 事件默认使用 repo 相对路径；
- 环境只保存白名单摘要，不保存 secret；
- stdout/stderr 大结果落 artifact，report 只存 hash/ref；
- 不把 approval token、cookie、provider key 写入 VG ledger；
- external hook 安装不自动修改用户配置，必须显式 opt-in；
- sidecar owner、workspace、repo、session 任一不匹配即拒绝；
- 候选物化目录必须位于受控临时根，不能与主 worktree 互相污染；
- mcp/catalog/policy digest 不符时 fail-closed。

## 11. 最小可接受闭环

M1 只读闭环：

```text
ClawX detects 2 worktrees
  -> host starts VG diagnostic adapter
  -> VG returns capabilities + doctor + conflicts
  -> harness writes report as observed/partial
  -> host verdict unchanged
  -> adapter detaches
```

该闭环不得写用户工作树、不得启动验证命令、不得改变默认策略。

M3 验证闭环：

```text
VG proposes checks
  -> host policy approves
  -> VerseShell executes fixed argv
  -> host returns receipts
  -> VG composes verdict facts
  -> harness consumes host verdict and VG residual
  -> evidence sealed
```

只有 M3 闭环真实通过后，才允许讨论 VG 的 candidate/landing 权威。