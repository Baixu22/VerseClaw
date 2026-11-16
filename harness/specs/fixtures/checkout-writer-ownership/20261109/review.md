# Checkout writer 当前实现只读复核（修复后）

## 结论

原报告的 P1 已由当前实现修复。只针对本轮 holder 身份与零 operation maintenance 回收路径复核，未发现新的确证 P1/P2；本 writer 子叶可冻结。真实子进程“prepare 后退出、重启 cleanup”回归仍在运行，本次未把该结果写成通过，也未重跑测试。

## 原 P1 的修复证据

- `openclaw_runtime/src/agents/worktree-writer.ts:26-27`：writer state 持久化 `holderPid` 和 `holderIncarnation`。
- `openclaw_runtime/src/agents/worktree-writer.ts:45-64`：读取时校验 holder 字段、epoch、operation/request 唯一性及 current request 一致性；损坏记录不会被猜测恢复。
- `openclaw_runtime/src/agents/worktree-writer.ts:91-102`：自动 retire 仅接受非 released、`owner.kind === "maintenance"` 且 `operations.length === 0`。run writer、running、unknown 和已结算但未释放的 operation 都不会进入该路径。
- `openclaw_runtime/src/agents/worktree-writer.ts:93-97`：先用 `process.kill(pid, 0)` 判断原 PID 是否结束；PID 仍存在时再由 `taskLedgerOwnerWasReplaced` 比较原生 process incarnation，探针未知时返回 false，不会按死亡处理。
- `shared/task-ledger-process.ts:18-47,53-80`：incarnation 来自 OS 进程身份；Windows 使用进程 start FILETIME，Linux 使用 boot id + start tick；探针失败保持 unknown，而不是推定 PID 已换代。
- `openclaw_runtime/src/agents/worktree-writer.ts:113-130`：旧 state 的读取、死 holder 的 retire 和新 epoch 的 claim 在同一个 SQLite `BEGIN IMMEDIATE` 事务中完成；退休 request 历史继续保留。

## 回归落点

- `tests/unit/checkout-writer-ownership.test.ts:129-134`：run writer 留有 running operation 时，agent 进程退出后仍被拒绝自动回收。
- `tests/unit/checkout-writer-ownership.test.ts:136-143`：maintenance prepare 保存 `cleaning` 后以退出码 23 退出，重启 cleanup 可回收零 effect claim 并继续清理。
- `tests/unit/fixtures/checkout-writer-worker.mts:12-17`：真实子进程持有同一原生 worktree lock，在 prepare 回调内持久化 `cleaning` 后直接 `process.exit(23)`，覆盖了此前缺失的 prepare→begin 崩溃窗口。
- `tests/unit/checkout-writer-ownership.test.ts:98-104`：有 running/unknown operation 的 maintenance 仍保留，不会被自动释放或重放。

本轮定向范围内没有 P1/P2。