---
id: versegit-planning-correction-matrix
title: VerseGit planning correction matrix
type: guide
appliesTo:
  - versegit-validation-layer-extension
---

# VerseGit planning correction matrix

> 状态：TF-0481 已关闭；MC0-MC5、WP0-WP6 已按本矩阵收口，MC6 裁定 `sidecar-only`，MC7 并入 WP6。
> 历史输入：`D:\tmp\versegit-plan-review-6.1-sol.md` 的初版规划验收结论 **FAIL**；修正后由后续节点证据逐项闭合。
> 目标：先把规划修到可执行、可验证、不可绕过，再允许任何实现节点开工。

## 1. 目标

本 guide 不实现 VerseGit adapter、harness profile 或 VerseShell bridge。它只做四件事：

1. 修正统一任务 DAG；
2. 建立 M1 纯诊断效果审计；
3. 定义宿主清理屏障和执行回执绑定；
4. 把 P1 问题转化为可执行节点或明确执行期验证边界。

## 2. 统一 DAG

规划修正后的执行顺序必须是：

```text
TF-0481 planning correction
  -> MC0 freeze baseline
  -> MC1 sidecar contract
  -> MC2 behavior fingerprint
  -> MC3 sidecar delivery
  -> WP0 identity/profile contract
  -> MC5 differential framework
  -> WP1 observation bridge
  -> WP2 read-only harness profile
  -> WP3 VerseShell receipt bridge
  -> WP4 behavior coverage
  -> WP5 replay/soak
  -> WP6/MC7 closeout
```

约束：

- MC0/MC1/MC2/MC3 必须先于 WP0-WP3；
- MC5 差分框架必须先于任何 adapter 实现节点；
- MC6 selective extraction 不在 M1-M3 必经链上；
- WP6 和 MC7 合并为最终收口；
- TF-0481 完成前，不允许 WP0/MC0 进入 ready。

## 3. P0 修正矩阵

| Finding | 修正 | 证据 |
| --- | --- | --- |
| P0-1 WP/MC 双链可绕过 | 建立统一 DAG，并把 MC0/MC1/MC2/MC3/MC5 前移为 WP0-WP3 的 depends_on 门禁 | Task Forest proposal + 本 guide |
| P0-2 M1 非只读 | 建立逐入口 effect matrix，禁止 CLI 名称白名单 | `versegit-migration-control-plan.md` + 新增 M1 effect matrix |
| P0-3 清理顺序冲突 | 定义唯一宿主清理屏障：stop -> drain -> seal -> detach -> verify -> delete | `verseshell-and-behavior-observability.md` |

## 4. M1 纯诊断效果矩阵

M1 必须逐入口声明以下效果：

| 入口 | 文件读 | 文件写 | DB 读 | DB 写/建 | Git 对象写 | 物化 | 执行 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `capabilities` | yes | no | yes | no | no | no | no |
| `doctor` | yes | no | yes | no | no | no | no |
| `conflicts` | yes | no | yes | no | yes/no | yes/no | yes/no |
| `session show` | yes | no | yes | no | no | no | no |
| `verdict --facts` | yes | no | yes | no | no | no | no |

当前 `conflicts` 不能直接作为 M1 只读入口，必须拆出：

- `provider status`：只读 identity/capabilities；
- `provider doctor`：只读 ledger/schema/derived health；
- `provider conflicts-plan`：只读列出分析计划和输入，不执行；
- `provider session-status`：只读会话投影。

## 5. 宿主清理屏障

唯一清理顺序：

```text
stop accepting work
  -> drain/cancel in-flight
  -> seal evidence
  -> detach VG session
  -> verify owner/epoch/reference
  -> delete disposable worktree
```

规则：

- VG 不删除宿主 worktree；
- 宿主 cleanup 不得在 VG 引用未释放前删除；
- 证据保留优先于目录清理；
- 任何一步失败，保留资源并进入 `recovery_required`。

## 6. Execution receipt 绑定

回执必须绑定：

- `planId`
- `candidateId`
- `checkId`
- `ownerId`
- `epoch`
- `executionInputDigest`
- `requiredScope`
- `artifactDigests`
- `cleanupStatus`

必须拒绝：

- 错 candidate；
- 旧 epoch；
- plan/check 不匹配；
- 输入 digest 漂移；
- 权限撤销；
- 伪造或缺失 artifact；
- scope 不是 `full` 时宣称满足 full gate。

## 7. P1 修正矩阵

| Finding | 处理 |
| --- | --- |
| P1-1 回执绑定不足 | 修 receipt schema，见第 6 节 |
| P1-2 状态建立/共享/升级回滚缺失 | 新增 provider state contract 节点 |
| P1-3 provider 交付门禁缺失 | 新增 provider package contract 节点 |
| P1-4 输入冻结缺失 | 新增 input freeze algorithm 节点 |
| P1-5 验收不可机器化 | 每个节点必须有 task spec + fixture + artifact + verifier |
| P1-6 证据保留矛盾 | 区分 disposable resource 和 evidence，定义原子封存 |
| P1-7 soak 不可判定 | 定义有限 soak recipe、资源上限、三方 case 和性能容差 |
| P1-8 无唯一下一步 | TF-0481 为唯一 ready，完成后 MC0 才可 ready |

## 8. Definition of done

TF-0481 关闭条件：

1. 统一 DAG 已应用；
2. P0 三项全部有盘上修正；
3. P1 八项全部有修正或明确边界；
4. M1 effect matrix、cleanup barrier、receipt contract 已落盘；
5. guide/scenario/rule/task spec 一致；
6. 独立复验至少 `PASS_WITH_GAPS`；
7. 剩余 gaps 只能是执行期验证项。
8. 任务 spec 在干净树上通过不带 `--no-diff` 的完整 harness validate。

2026-10-22 收口事实：上述条件由 TF-0481、MC0-MC5、WP0-WP5 与 WP6 的盘上证据共同满足；WP6 明确保留 release、live VerseShell、conflicts-plan、语言/平台/读面和 M4 残余边界。

## 9. 非目标

- 不实现 adapter；
- 不启动 VG；
- 不运行 VG 命令；
- 不修改 VerseGit 源码；
- 不改变产品默认值或发布状态。