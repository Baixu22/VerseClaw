# L04：持久化挂件 = 可恢复的最小检查点

日期：2026-10-13（Asia/Shanghai）。包码：L04（TF-0286）。真实 provider 调用：无。

## 界定

挂件只允许五类**受限引用**：`task-attachment` / `recovery-instruction` / `context` / `external-artifact-ref` / `ledger-checkpoint`。每个绑定 = `{ attachmentRef, kind, hash(sha256 hex), owner, expiresAt }`；不含任意光标、blob 或平台外部控制。

## 恢复（纯函数）

`recoverCheckpointAttachments(bindings, { now })`：

| 输入状态 | 结果 |
|---|---|
| hash 缺失 | state `missing-hash`，排除出 recovered |
| hash 非法 | state `invalid-hash`，排除 |
| owner 缺失 | state `missing-owner`，排除 |
| TTL 过期（expiresAt ≤ now） | state `expired`，排除 |
| 同 ref 不同 hash | state `conflict`，保留首个为 recovered |
| 同 ref 同 hash | 去重为一条（无重复恢复） |
| 全部有效 | recovered 按 ref 排序，`repaired=false` |

- **纯函数**：不改输入；重复调用 → 相同 `digest`；不重跑任何副作用。
- 结果带 `states` + `diagnostics` + `digest`，缺失/冲突不被静默接受。

## 实测

| 断言 | 结果 |
|---|---|
| 有效绑定去重 + 确定性排序 + digest 一致 | ✅ |
| missing/invalid hash、missing owner、expired 分别记状态并排除 | ✅ |
| 同 ref 冲突 → conflict 且保留首个 | ✅ |
| 纯函数：输入不变、重复 digest 相同、五类受限 | ✅ |

## 残余（residual）

- 本包提供绑定校验/恢复；把它接到具体持久化挂件写入点属集成层。
- 不新建 store、不插台驻留、不自动写回；不改默认值/产品锁/approval；非真人证据。
