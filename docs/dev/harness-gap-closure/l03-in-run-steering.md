# L03：运行中安全接收修订与取消指令（steering）

日期：2026-10-13（Asia/Shanghai）。包码：L03（TF-0285）。真实 provider 调用：无。

## 链路

`agents/agent-steering-queue.ts` 用 **lease → ack / release** 协调子代理完成结果回注请求者会话，避免父回合重复注入：

- `leasePendingAgentSteeringItemsFromSubagentRuns`：选 pending/suspended（或陈旧 in_progress）项，标记 `in_progress + steeringLeaseId`，产出有界合并 prompt。
- `ackLeasedAgentSteeringItemsFromSubagentRuns`：仅当 `steeringLeaseId === leaseId` 才把项置 `delivered` 并清 payload。
- `releaseLeasedAgentSteeringItemsFromSubagentRuns`：失败回合把项放回 `pending`。

## 实测矩阵

| 断言 | 结果 |
|---|---|
| lease → in_progress + leaseId + prompt 含结果 | ✅ |
| 错 lease ack → 0 更新（不可劫持） | ✅ |
| 匹配 lease ack → delivered；重复 ack → 0（幂等，无重复注入） | ✅ |
| release → 回 pending；旧 lease 不能再 ack；再次 lease 恰好一次 | ✅ |
| delivered/discarded/failed → 不再 pending、不再 lease（取消后无新效果） | ✅ |
| 陈旧 lease（>5min）→ 被新 lease 接管（重启安全） | ✅ |
| 其它 requesterSessionKey → 不串会话 | ✅ |

## 残余（residual）

- lease 是**进程内**协调提示；陈旧 lease 依据时间阈值（5min）重新入队，不依赖持久锁。
- 本包只核验 steering 队列语义；UI 层“修订/取消”入口与 Electron E2E 属集成层。
- 不改默认值/产品锁/approval；非真人证据。
