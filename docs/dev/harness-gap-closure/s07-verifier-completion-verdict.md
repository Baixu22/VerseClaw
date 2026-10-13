# S07：受限且可撤销的 verifier 完成裁决入口

日期：2026-10-13（Asia/Shanghai）。包码：S07（TF-0282）。真实 provider 调用：无。

## 链路（raw events → verdict → 状态转换 → 可撤销 continuation）

- 裁决：`runtime-core/verifier-completion-verdict.ts` 复用 `evaluateEvidenceVerifier(input, policy)`（既有唯一 verifier）。
- 映射：`completed`→`approved`；`insufficient_evidence`→`insufficient-evidence`；`failed/blocked/cancelled`→`rejected`；scope 外→`out-of-scope`。
- 状态转换：仅 `approved` 产生 `{ nodeId: taskId, from: priorStatus, to: "done" }`（交给既有 task ledger 的 `status_changed` 单一来源执行）。
- 可撤销：`revokeVerifierCompletionVerdict(record)` 返回 `{ from: "done", to: priorStatus }`；非 approved 无可撤销内容。

## 记录（digest-only）

`{ taskId, verdict, evidenceDigest(=sha256(decision+evidenceRefs+findingCodes)), findingCodes, priorStatus, grantsPublish:false, grantsProductLock:false }` —— **不含**原始证据正文，且显式声明不授予发布/产品锁权限。

## 实测矩阵

| 输入 | verdict | 转换 |
|---|---|---|
| 规范证据（completed） | `approved` | `{nodeId, from:'doing', to:'done'}` |
| 缺证据 | `insufficient-evidence` | 无 |
| scope 外 task | `out-of-scope` | 无 |
| approved 后撤销 | — | `{from:'done', to:priorStatus}` |

确定性：同一证据 → 相同 evidenceDigest 与相同记录（可重放）。

## 残余（residual）

- 本包只提供裁决入口与转换/撤销描述；把它接到 Electron main 的 task-ledger 服务调用点是集成层工作（不属本包 ownedPaths）。
- 不改产品默认值/锁/approval；不新增发布能力；非真人证据。
