# 恢复契约评测（TF-0710 / TF-0711 / TF-0721 / TF-0722 / TF-0723）

> `driven_by: agent` · `actor: recovery-contract-eval-driver` · `realHumanEvidence: false`

## 这是什么

用真实 Electron + 真实 Gateway 子进程 + 脚本化本地模型端点，对冻结的
五个恢复故障窗口注入**真实进程故障**，重启运行时，再从磁盘读回结果。
测量由 `tests/e2e/recovery-contract-eval.spec.ts` 产出 trial receipt，
由 `scripts/recovery-contract-eval.mjs` 合并进 TF-0709 冻结的评分器。

## 五个窗口与注入方式

| 窗口 | 注入方式 | 测量 |
|---|---|---|
| `intent-after-persist-kill` | 模型请求已发出、工具尚未产生副作用时 `taskkill /F /T` 杀掉 gateway | 恢复后副作用是否出现（未出现=工作丢失） |
| `effect-before-receipt-kill` | 副作用文件已写入、run 未结算时杀进程 | 副作用计数（>1 即重复） |
| `child-created-before-parent-advance-kill` | 子任务节点已创建、父未推进时杀进程 | 子节点是否恰好一份 |
| `store-write-failure` | 把会话状态路径替换为不可写目录 | 运行时是否仍然对外声称成功 |
| `repeated-restart` | 连续三次在副作用窗口杀进程并重启 | 副作用数与崩溃次数是否一致 |

`injectionMechanism` 字段如实区分 `real-process-kill` 与 `real-unwritable-state`。

## 结果怎么看

`report.json` 由冻结评分器产出，`evaluation.status` 只可能是：

- `PASS`：五个窗口各 ≥3 次重复，且长会话 ≥30 对，且九个指标全部达标；
- `FAIL`：样本齐备但指标未达标；
- `EVIDENCE_INSUFFICIENT`：样本不足（例如长会话对尚未测量）——**不是通过**。

指标为 `null` 表示该域样本不足，绝不补 0。

## 未测边界（诚实清单）

1. 长会话 ≥30 对（TF-0722）本轮未测量：`longSessionMeasurements` 为空，
   因此评测保持 `EVIDENCE_INSUFFICIENT`，不得据此宣称质量收益。
2. 脚本化 provider 只验证确定性恢复语义，不计入 live-provider 质量证据。
3. 仅 Windows x64 本机 wall-clock，不是跨平台 SLA。
4. 故障窗口只有五个；不是所有故障模式。
5. 本目录的 PASS 只表示评测门槛被满足，不代表任何产品默认值或产品锁被改变。

## 复算

```bash
node --experimental-strip-types scripts/recovery-contract-eval.mjs --dir D:/tmp/recovery-eval-v2
node --experimental-strip-types scripts/recovery-contract-eval.mjs --check
```

## TF-0722 长会话抽样的已知缺陷（本轮未通过）

本轮新增了 `tests/e2e/recovery-longsession-eval.spec.ts` 并在真实 Electron 上跑通了
第一对（`ls-compression-01`）。但读回面用的是 `sessions.history`，它只返回近期窗口
（观测到 `transcriptLength=2`），因此 `mustPreserveMatched` 为 0 并不代表事实真的丢失。

因此本轮**不把该抽样计入质量结论**：`report.json` 的 long-session 仍是 0/30，
评测保持 `EVIDENCE_INSUFFICIENT`。

下一轮必须先修读回面：从
`<userData>/openclaw-source-state/agents/main/sessions/<sessionFile>` 直接读
完整 transcript（其它 long-session spec 已经这么做），再重跑 ≥30 对。
