---
id: versegit-harness-lifecycle-contracts
title: VerseGit harness lifecycle and authority contracts
type: guide
appliesTo:
  - versegit-validation-layer-extension
---

# Harness 生命周期、权威与宿主契约

> 状态：设计基线。没有实现或验收声明。
> 适用：ClawX harness 中的 VerseGit M1-M3 模块模式。

## 1. 设计不变量

1. **一域一权威。** 任务、执行、仓库事实、验收、项目历史分别拥有明确 owner。
2. **一事实一身份。** 任何结论必须能追到 repo/worktree/session/snapshot/candidate/run。
3. **一模式一权限。** M1 不能因为配置升级自动获得 M2/M3 权限。
4. **fail-open 不等于 fail-silent。** VG 失败不改变宿主 verdict，但必须在报告中可见。
5. **partial 不等于 empty。** 未观测、未支持、超时和失败都不得当作零冲突。
6. **host mode 不产生第二执行器。** 外部命令统一经 VerseShell。
7. **land/admit 不在默认宿主路径。** 未来若要改变，必须另立所有权更替任务。
8. **清理不是删除证据。** 临时目录可清，账本、回执、报告和身份不可无证据丢失。
9. **single green light 禁止。** VG 的六维结果不能被压缩成宿主的一个布尔值。

## 2. 权威平面

```text
User intent / approval
        |
        v
ClawX orchestrator ---> Task Ledger / ClawGraph
        |                         |
        +--> VerseShell <---------+ execution facts
        |         |
        |         +--> command / process / file receipts
        |
        +--> VerseGit adapter ---> repository facts / candidates / verdict facts
        |
        +--> Harness -------------> acceptance contract + evidence index

Project development DAG: Task Forest (local, not runtime)
```

| 平面 | owner | 持久对象 | 关键问题 |
| --- | --- | --- | --- |
| 项目开发 | Task Forest | node/proposal/evidence | 这项工作为什么存在，何时关闭 |
| 运行时任务 | Task Ledger / ClawGraph | task/run/graph | 这次执行做到哪一步 |
| 用户审批 | ClawX approval plane | approval/decision | 谁授权了什么效果 |
| 执行 | VerseShell | process/request/artifact | 命令如何执行、如何回收 |
| 变更一致性 | ClawX write journal | prepared/committed/recovery | 文件修改是否原子、可恢复 |
| 仓库语义 | VG ledger | session/event/receipt/candidate | 谁基于什么读写了什么 |
| 验收 | harness | spec/profile/report/evidence | 当前候选满足哪些契约 |
| Git/JJ 图 | 宿主 Git / VG 内部适配 | ref/commit/operation | 内容如何组合、如何恢复 |

VG 的结论可以驱动“下一步建议”，但不能替代其他平面的事实。

## 3. 组件生命周期

```text
absent
  -> discovered
  -> verified
  -> attached
  -> active
  -> degraded | draining
  -> detached
  -> absent | upgrade_pending
```

| 状态 | 进入条件 | 允许效果 |
| --- | --- | --- |
| absent | 未配置或 M0 | 无 |
| discovered | 找到 binary/adapter | 只读版本探测 |
| verified | binary hash、version、schema、协议均匹配 | 可注册组件 |
| attached | repo/worktree/owner 固定 | 可观察 |
| active | 并发触发且状态健康 | 按模式工作 |
| degraded | 超时、部分覆盖、资源压力 | 只输出显式降级事实 |
| draining | 会话结束或切换 | 封存/等待 in-flight |
| detached | 证据封存完成 | 清理临时资源 |
| upgrade_pending | 版本不兼容 | 拒绝新工作，不切换旧事实 |

**禁止状态跳变：**

- `verified -> active` 必须经过 `attached`；
- `degraded -> active` 只能在健康恢复且新 run 身份下发生；
- `draining` 不接受新候选；
- `upgrade_pending` 不得把旧账本事实升级成新 schema 结论。

## 4. 运行时 stage 与进入/退出条件

| Stage | 触发 | 进入产物 | 退出条件 | 失败姿态 |
| --- | --- | --- | --- | --- |
| `discover` | harness profile 或 host service 启动 | binary/adapter identity | 可解析版本或 unavailable | `unavailable`，不改 verdict |
| `eligible` | worktree>1 或多 VG session | trigger evidence | 明确 active/not-applicable | `not_applicable` |
| `attach` | 统一 repo/workspace/owner | repo_id/worktree_id/session_id | 身份一致 | `identity_mismatch` |
| `observe` | 工具事件、hook、fs-watch | normalized event | 有覆盖声明 | `partial/unknown` |
| `evaluate` | 观察或显式查询 | conflict/impact facts | 输入哈希稳定 | `stale/failed` |
| `candidate` | 宿主请求候选事实 | candidate_id + parents + tree | 候选有效/拒绝 | `invalid_candidate` |
| `verify_facts` | 宿主交付执行回执 | required checks + run_id | 全部有执行事实 | `unmeasured` |
| `decide` | facts + harness policy | verdict facts | host 收到结果 | VG 不替换宿主 |
| `land` | 仅现行宿主 Git 路径 | commit/ref audit | host 完成 | VG 默认不写 ref |
| `report` | 会话或候选终止 | report/evidence pack | digest 封存 | `report_incomplete` |
| `retain` | 清理前 | retention plan | 引用可达 | 不得静默删证据 |
| `detach` | 会话结束 | SessionEnded/cleanup fact | 无 in-flight 引用 | `lost/recovery_required` |

## 5. 触发与激活

### 5.1 eligible 条件

以下任一成立才算并发：

- 同一 Git common-dir 下有一个以上 worktree；
- 同一 repo 有一个以上活跃 Agent/VG session；
- ClawX orchestration plan 显式请求 `isolation=worktree`；
- 宿主调用显式请求 VG 分析。

仅凭“安装了 VG”不构成触发。

### 5.2 激活条件

- 显式 profile / feature gate；
- workspace canonical root 可解析；
- repo 不是 unsupported incomplete clone；
- binary/version/schema 匹配；
- owner identity（agent/session/run）可用；
- 状态目录可写且不位于受限临时目录；
- 资源预算未耗尽；
- kill switch 未激活。

### 5.3 不激活

- 单 worktree 单 session；
- profile 未选择；
- 只有 VG 历史数据但没有当前 repo；
- owner 不明；
- schema/协议不匹配；
- binary 缺失或 digest 不符；
- 用户拒绝或宿主策略禁止。

`not_applicable` 与 `unavailable` 必须是不同状态，不能合并成“成功但没有问题”。

## 6. 身份与 fencing

推荐的标准身份链：

```text
repo_id
  = canonical git common dir + VCS backend identity

worktree_id
  = repo_id + canonical worktree root + per-worktree VCS identity

agent_session_id
  = host agent/session owner id

vg_session_id
  = repo_id + worktree_id + agent_session_id + created epoch

snapshot_id
  = repo_id + tree_oid/commit_oid + input digest

candidate_id
  = repo_id + base_oid + ordered parent/head set
    + materialized tree_oid + input digest + tool/schema version

run_id
  = candidate_id + environment identity + toolchain + start timestamp

evidence_id
  = run_id + artifact digest set
```

### 必须存在的 fencing 字段

- `session_epoch`：会话重启或 worktree 重建后单调递增；
- `lease_epoch`：并发 ownership 或等待队列的 fencing；
- `generation`：派生分析/next tree 的输入版本；
- `expected_head`：落地/CAS 前的期望目标；
- `request_id` / `trace_id`：宿主到执行器的关联；
- `input_digest`：候选/验证输入的可重算摘要。

规则：

- 不能只凭路径识别 session；
- 不能只凭 branch 名识别候选；
- 同一 candidate_id 不允许对应不同 tree；
- 迟到的旧 epoch 结果只能进入“历史/过期”区，不能覆盖当前结论；
- 清理动作必须带 lease/epoch，且在执行前再次验证 owner。

## 7. Harness 合约

### 7.1 profile

建议新增 opt-in profile（名称可最终调整，例如 `concurrency` 或 `vg-aux`）：

```yaml
profile: concurrency-aux
mode: diagnostic | advisory | candidate
eligibility: multiple-worktrees-or-sessions
effects:
  writesUserWorkspace: false
  ownsHarnessVerdict: false
  runsExternalCommands: via-verseShell-only
  defaultOn: false
```

该 profile 不得加入 `fast`、`comms` 或任何任务的默认 profile。任务若显式需要它，必须在 task spec 中声明。

### 7.2 harness 运行顺序

```text
context
  -> component identity
  -> eligibility
  -> attach
  -> read-only facts / advisory
  -> candidate facts (M2+)
  -> execution receipts (M3)
  -> write evidence pack
  -> cleanup/deregister
```

### 7.3 输出语义

harness 报告中的 VG 区域只允许以下状态：

- `not_applicable`：没有并发触发；
- `unavailable`：组件/身份不可用；
- `partial`：有事实但覆盖不完整；
- `observed`：事实完整到声明覆盖范围；
- `candidate_ready`：候选身份完整，验证未必完成；
- `degraded`：超时、资源预算或执行回执不完整；
- `rejected_by_policy`：宿主策略拒绝，不是 VG 自行判定。

这些状态不能直接转换为 harness pass/fail。宿主可以基于自己的 `requiredTests` 和 policy 产生最终 verdict。

### 7.4 报告最小结构

```json
{
  "schema": "clawx.versegit.module-report/v1",
  "mode": "diagnostic",
  "authority": {
    "harnessVerdict": "host",
    "execution": "verseshell",
    "land": "host-git"
  },
  "component": {
    "version": "0.1.0",
    "binarySha256": "<sha256>",
    "ledgerSchemaVersion": 1,
    "capabilitiesDigest": "<sha256>"
  },
  "trigger": {
    "reason": "multiple-worktrees",
    "worktreeCount": 2,
    "activeSessionCount": 2
  },
  "repository": {
    "repoId": "<opaque-id>",
    "worktrees": []
  },
  "sessions": [],
  "coverage": {
    "fileRead": "observed",
    "shellRead": "unobserved",
    "mcpRead": "partial",
    "directFs": "unobserved"
  },
  "facts": {
    "conflicts": [],
    "warnings": [],
    "unknowns": []
  },
  "candidate": null,
  "verification": {
    "status": "not_run",
    "executor": "verseshell"
  },
  "result": {
    "status": "observed",
    "reasons": []
  },
  "timings": {},
  "digests": {}
}
```

### 7.5 evidence pack

建议路径：

```text
artifacts/versegit/<run-id>/
  report.json
  events.jsonl
  observations.jsonl
  candidate.json
  verdict.json
  cleanup.json
  SHA256SUMS
  manifest.json
```

`manifest.json` 至少记录：

- profile/task spec；
- component/binary digest；
- repo/worktree/session 身份；
- command/argv、cwd、环境摘要（不含秘密）；
- exit、timeout、cleanup；
- 输入与输出文件 digest；
- `driven_by: agent` 和 agent actor；
- 失败/未知/未运行边界。

## 8. Task Forest、Task Ledger 与 VG ledger

| 记录 | 回答 | 时间尺度 | 是否提交 |
| --- | --- | --- | --- |
| Task Forest | 为什么开发、如何分阶段、何时收口 | 项目开发 | 本地，不提交 |
| Task Ledger | 当前运行任务/节点的状态 | 用户工作流 | 由 ClawX 管理 |
| ClawGraph | 执行图/工作流状态 | 运行时 | 由 ClawX 管理 |
| VG ledger | 哪个会话对仓库做了什么、依据是否新鲜 | 仓库历史 | VG 状态/证据 |
| harness evidence | 当前候选是否满足契约 | 验收 | curated evidence 提交 |

禁止映射：

- VG `CandidateProposed` -> Task Ledger 任务完成；
- VG `admitted` -> harness pass；
- Task Forest `done` -> VG session landed；
- VG 账本事件 -> 自动修改 Task Forest；
- 用 VG report 取代 Task Ledger 或 harness evidence。

允许映射：

- Task Forest 节点引用 harness evidence 和 VG report；
- Task Ledger 节点引用 VG candidate/session id；
- harness 报告引用 VG 的辅助事实；
- 所有映射都保留原 owner 和原始引用。

## 9. 失败矩阵

| 场景 | 可见状态 | 宿主动作 | 禁止动作 |
| --- | --- | --- | --- |
| binary 缺失 | unavailable | 继续宿主流程 | 用旧 binary/静默 fallback |
| digest 不符 | rejected_by_policy | 禁用模块 | 继续执行 |
| schema 不兼容 | incompatible | 禁用/升级 | 写入新事件 |
| 无 `.vg` 状态 | uninitialized | 默认只读不可用 | 自动修改用户仓 |
| worktree 不明的 session | unknown | 保留原 verdict | 模糊归属 |
| hook 读不到 | partial | 报告覆盖缺口 | 记为空读集 |
| Bash 读/写未观测 | unobserved | 报告边界 | 推断无冲突 |
| 候选 tree 不同 | stale | 重建候选 | 复用旧验证 |
| 执行回执缺失 | unmeasured | 保持未验证 | 把 exit 0 文本当回执 |
| VerseShell 不可用 | unavailable | 不执行/不验证 | 回退 native shell |
| sidecar crash | lost/degraded | reconcile/清理 | 自动 adopt 进程 |
| 清理不安全 | recovery_required | 保留目录和证据 | 强制删除用户工作 |
| 旧 epoch 迟到 | stale | 归档 | 覆盖当前结果 |

## 10. 保留、清理和恢复

- 临时候选 worktree、sandbox 输出和日志有明确 TTL；
- 删除前先确认 candidate/session/evidence 引用；
- 未提交用户改动永不因 VG 清理删除；
- worktree 清理只使用 host worktree service；所有入口必须经过 stop -> drain -> seal -> detach -> verify -> delete 屏障，并保留 recovery identity；VG 不得删除 host worktree；
- ledger/receipts/report 按证据保留策略管理；
- 恢复后必须重新检查 freshness；旧报告不能自动变为当前通过；
- 进程崩溃后的 running 记录只能记为 `lost` 或 `recovery_required`，不能伪造完成。

## 11. 版本兼容

需要同时校验：

- VG binary version + SHA-256；
- VG event/verdict schema version；
- ClawX host adapter contract version；
- VerseShell ACI / operation catalog version；
- harness evidence schema version；
- 操作系统/架构和 VCS backend；
- 工作区是否 shallow/partial/untrusted。

未知都 fail-closed 或 fail-open，取决于边界：

- 读取/分析不可确定 -> `unavailable/partial`，不改 verdict；
- 写入/落地不可确定 -> 拒绝执行；
- 不能证明 owner 的请求 -> 拒绝；
- 不能证明候选身份 -> 不生成 admitted。

## 12. 明确非目标

- 不在本轮实现 VG module adapter；
- 不新增默认开启的 profile；
- 不把 VG daemon 作为 ClawX 默认后台服务；
- 不使 harness 依赖 VG 才能通过；
- 不改变 ClawX write journal、审批、产品锁或发布策略；
- 不宣称跨平台完整支持；
- 不宣称 VG 在真实 ClawX 并发工作中有净收益，直到 replay/soak 完成。