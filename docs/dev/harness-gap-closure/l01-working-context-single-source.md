# L01：Working Context 账本作为唯一活任务读写源

日期：2026-10-13（Asia/Shanghai）。包码：L01（TF-0283）。真实 provider 调用：无。

## 链路（write → ledger → read → projection）

- 写：`appendTaskLedgerWorkingContextEvents(workspaceId, inputs, batchIdempotencyKey)` → `appendTaskLedgerEvents` → JSONL `events.jsonl`（`<configDir>/task-ledgers/workspaces/<key>/events.jsonl`）。
- 读：`readTaskLedgerWorkingContext(workspaceId)` → `readTaskLedgerEvents` → `projectTaskLedgerWorkingContext(events)`。
- **无第二来源**：适配器头注释即声明“复用既有 workspace Task Ledger JSONL appender 和 read path；不新增 table/snapshot/daemon/second store”。

## 实测（真实文件系统）

| 断言 | 结果 |
|---|---|
| append → read → projection 一致（pending 含写入的 proposal） | ✅ |
| ledger 文件恰好 1 行（事件落盘，非第二存储） | ✅ |
| 同 batchIdempotencyKey 重放 → 不追加、projection 完全一致 | ✅ |
| ledger 目录被同路径文件占用 → append **抛错**（不误报成功） | ✅ |
| 不同 workspaceId 隔离（另一个 workspace 读到空视图） | ✅ |

Stage 3 投影/合并语义（确定性、重复 accept fail-closed、过期、冲突集、merge copyFields、malformed 决策 fail-closed）由既有 `tests/unit/context-control-plane-stage3-contracts.test.ts` 覆盖，本包不重复。

## 残余（residual）

- 读取时 ledger 文件缺失返回空视图（`{events:[],warnings:[]}`）；**损坏行**由既有 parser 以 warnings 表达，本包不新增“unknown vs empty”区分。
- 本包只核验 JSONL 单源路径；不改 Stage 3 事件契约、不接线新 UI/模型入口。
- 无第二 DB/daemon/迁移；不改产品默认值/锁/approval；非真人证据。
