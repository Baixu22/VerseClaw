# Coding Runtime P2 证据报告（2026-08-17）

> 状态：P2 实现自检完成；TF-0071=review_needed(90%)，等待独立验收。
> 本报告不是 UFTK GA / canary / 整体成熟度结论。

## 0. 起始信息

- 工作区：`D:\ClawX`（repo root）
- HEAD：`734ec877e75682861103660fbdea2bd55253ece0`
- 工作分支：`main`；未 checkout / reset / clean；工作树仍含大量既有 WIP
- 前置状态：`TF-0070`=done(100%)，child_of `TF-0010`；`TF-0071` 已创建：in_progress -> review_needed(90%)
- 验收对象：`docs/dev/coding-runtime-development-spec.md` Phase 2 + 7.2/7.4
- 产品锁：liveReady=false、productApproved=false、defaultOn=false
- 关键 flag：`runtime.coding.uftk.enabled=false`；`runtime.coding.uftk.baseVersionGuard.enabled=false`

## 1. 预检结果

1. 按提示词顺序完成只读必读：AGENTS.md、Sustained-Development-Playbook.md、coding-runtime-development-spec.md、handoffs/LATEST.md、P1 验收报告、shared/coding-runtime/*、coding-runtime/*、apply-patch-batch-lock、file-mutation-queue、session-write-lock/infra file-lock-manager、write/edit、apply-patch/preflight/agent-tools、现有测试。
2. `git rev-parse HEAD` = `734ec877e75682861103660fbdea2bd55253ece0`；`git status --short` 与启动时一致，未清理任何 WIP。
3. `TF-0070`=done(100%)；启动时无 `TF-0071`，随后按 CLI 创建。
4. `runtime.coding.uftk.enabled` 默认 false；`runtime.coding.uftk.baseVersionGuard.enabled` 默认 false；shared `DEFAULT_CODING_RUNTIME_FLAGS` 5 项全 false。
5. 未发现 P1 回归、第二套跨进程锁系统、第二套 journal、SQLite/JSONL 审计存储、新的默认开启行为。
6. `tsgo:core` 预检 exit 0；`tsgo:core:test` 预检 exit 2，错误全部位于既有未跟踪 RLG WIP 文件（详见第 5 节），无 P2 文件。

## 2. P2 交付物

| 交付物 | 路径 | 状态 |
|---|---|---|
| 文件级 RW lock | `openclaw_runtime/src/agents/coding-runtime/file-lock-manager.ts` | 已存在并有测试 |
| 读共享/写互斥队列 | `openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts` | 已扩展并有测试 |
| 乐观版本与冲突检测 | `file-transaction-service.ts` + `apply-patch-preflight.ts` + `apply-patch.ts` + `agent-tools.ts` | 已接入并有测试 |
| 增量 diff | `openclaw_runtime/src/agents/coding-runtime/turn-diff.ts` | 已存在并有测试 |
| 契约补充 | `shared/coding-runtime/types.ts` / `schema.ts` / `README.md` / `MIGRATION.md` | P2 章节已写 |
| 测试 | `coding-runtime/*.test.ts` + `file-mutation-queue.test.ts` + `tests/unit/coding-runtime-contract.test.ts` | 已存在 |

关键实现约束复核：

- `file-lock-manager.ts` 写锁复用 `acquireSessionWriteLock`（其底层为 `infra/file-lock-manager` / `createFileLockManager`）；未自造第二套跨进程锁。
- 多路径加锁使用 `normalizePatchLockPath`（Windows 小写）去重并稳定排序。
- `withFileMutationQueue(filePath, fn)` 默认行为保持为写互斥；新增 `withFileReadQueue` / `{ mode: "read" }`。
- `apply_patch` 的 `baseVersions[]` 在 `preflightPatch` 中、创建 journal 前检查，冲突时目标文件零变化。
- 冲突错误为结构化 `CodingRuntimeError`：`code=E_CONFLICT` + `baseVersion` + `currentVersion` + `diff`。
- 模型对外 TypeBox schema 未变；`baseVersion`/`baseVersions` 仅内部调用参数。

## 3. 必跑命令与 exit code

| 命令 | Exit | 结果 |
|---|---|---|
| `pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1` | 0 | 1 file / 8 tests PASS |
| runtime 定向 10 文件（显式列出）`--maxWorkers=1` | 0 | 10 files / 125 tests PASS |
| `pnpm run typecheck:node` | 0 | PASS |
| `pnpm run typecheck:web` | 0 | PASS |
| `pnpm contract:check` | 0 | Contract check passed |
| `pnpm run lint:bom` | 0 | check-no-bom: ok |
| `git diff --check -- <P2 tracked 变更文件列表>` | 0 | clean |
| `pnpm verseshell:test` | 0 | bundle 13/13 + runtime-bundle 11/11 + runtime 15 files/141 tests + MCP 11/11 |
| `pnpm --dir openclaw_runtime tsgo:core` | 0 | PASS |
| `pnpm --dir openclaw_runtime tsgo:core:test` | 2 | **residual**：全部为既有未跟踪 RLG WIP 测试类型错误，无 P2 文件（见第 5 节） |

runtime 定向 10 文件实际为：

```text
src/agents/coding-runtime/file-lock-manager.test.ts
src/agents/coding-runtime/turn-diff.test.ts
src/agents/coding-runtime/file-transaction-service.test.ts
src/agents/coding-runtime/file-transaction-service.concurrency.test.ts
src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts
src/agents/tools/write-journal.test.ts
src/agents/sessions/tools/write.test.ts
src/agents/sessions/tools/edit.test.ts
src/agents/apply-patch.test.ts
src/agents/dcs-producer-envelope.test.ts
```

补充回归（非必跑，拆分执行均通过）：

- `atomic-write.test.ts` + `rollback-preview.test.ts`：2 files / 11 tests PASS。
- `file-mutation-queue.test.ts`：6 tests PASS。
- `file-mutation-queue.test.ts` + `file-lock-manager.test.ts`：2 files / 17 tests PASS。
- 一次性 13 文件合并运行出现 Vitest 120s 无输出被终止；拆分运行全部通过，必跑 10 文件复跑通过。该合并运行不在必跑命令清单内，记录备查。

## 4. 并发矩阵（逐项实测）

| 场景 | 结果 | 证据 |
|---|---|---|
| 同文件两并发写 | PASS：一个成功后，另一个等待串行成功；最终内容为第二个写入，无丢更新/互相覆盖 | `file-transaction-service.concurrency.test.ts` "serializes same-file prepare -> commit pairs" |
| 同文件两并发读 | PASS：不互斥，能并行完成 | `file-lock-manager.test.ts` "same-file reads are shared and run concurrently" |
| 同文件读 + 写 | PASS：读只在写持锁期间等待；写等待读 drain 后获得新内容 | `file-lock-manager.test.ts` "readers are blocked while a writer holds the file" / "a writer waits for active readers to drain" |
| 不同文件并发写 | PASS：并行，无串行 convoy | `file-lock-manager.test.ts` "different files acquire write locks in parallel" + `file-transaction-service.concurrency.test.ts` "independent files prepare and commit in parallel" |
| 过期 baseVersion 写 / edit / apply_patch | PASS：E_CONFLICT + diff，目标文件零变化 | `file-transaction-service.concurrency.test.ts` + `file-transaction-service.tool-integration.flag-matrix.test.ts` |
| 跨进程同文件写 | PASS（Windows）：一个进程持锁，另一个等待或 E_LOCK_TIMEOUT；owner/stale 可诊断；持有进程退出后可获取 | `file-lock-manager.test.ts` "reports E_LOCK_TIMEOUT while another process holds the sidecar, then acquires after release"（在 Windows 上执行） |
| Linux 跨进程验证 | 未执行：本会话运行于 Windows，无 Linux 环境 | 有 Linux 环境时补验 |
| flag off | PASS：write/edit/apply_patch 行为与 P1 一致，schema 不变，DCS working_memory 语义不变 | `file-transaction-service.tool-integration.flag-matrix.test.ts` + `dcs-producer-envelope.test.ts` |
| P1 回滚矩阵回归 | PASS：单批/共享 batch 回滚、delete/move/apply_patch 回滚、previewRollback、recovery_required、非 git 目录、原子写失败注入 | `file-transaction-service.test.ts` 12 tests + `atomic-write.test.ts` 6 tests + `rollback-preview.test.ts` 5 tests |

## 5. tsgo residual

`pnpm --dir openclaw_runtime tsgo:core` exit 0。

`pnpm --dir openclaw_runtime tsgo:core:test` exit 2，错误文件与错误码如下：

- `src/gateway/session-drain-service.test.ts(134,38): TS2339 Property 'reason' does not exist on type '{ ok: false; }'.`
- `src/gateway/session-reset-service.stop.test.ts(83,7)(104,7)(123,7)(140,7)(166,9): TS2741 Property 'updatedAt' is missing in type '{ sessionId: string; sessionFile: string; }' but required in type 'SessionEntry'.`
- `src/gateway/session-reset-service.subagent-stop.test.ts(84,7)(119,7): TS2741 Property 'updatedAt' is missing in type '{ sessionId: string; sessionFile: string; }' but required in type 'SessionEntry'.`

以上 3 个文件均为本次启动前已存在的未跟踪 WIP（Runtime Lifecycle Governance 相关工作），不属于 P2 变更。按 tsgo 规则：P2 文件在错误列表中必须修复；无关既有错误不擅自修复，记 residual 并等待用户授权。

## 6. 性能证据

基准：tsx 脚本，Windows，30 次取均值，500 行 payload，临时工作区。

| 路径 | flag off | flag on | 绝对增量 | 门禁 |
|---|---|---|---|---|
| write 单文件 | 0.808 ms/op | 6.528 ms/op | +5.719 ms | <50 ms 通过 |
| edit 单文件 | 1.760 ms/op | 8.665 ms/op | +6.906 ms | <50 ms 通过 |

- 无竞争 write lock + baseVersion 检查：约 6.2 ms/op（含 prepare/commit 与 atomic write）。
- 不同文件并发锁：1 文件 1.333 ms；20 文件并行 12.123 ms；20 文件并行未出现 20 倍串行退化。
- ≥1MB apply_patch 线性证据（UFTK service prepare+commit，3 次中位）：

| 行数 | 字节 | 总耗时 |
|---|---:|---:|
| 21,000 | 483,000 | 22.255 ms |
| 42,000 | 966,000 | 30.534 ms |
| 84,000 | 1,932,000 | 56.230 ms |

  耗时随行数近线性（42k/21k=1.37x for 2x；84k/42k=1.84x for 2x），无 O(n²) 退化。P1 的 1.07MB/42000 行线性证据作为回归基线保留在 `reports/CODING-RUNTIME-P1-EVIDENCE-2026-08-16.md`。
- 锁等待有超时上限：`file-lock-manager.test.ts` 实测 80ms 超时返回 E_LOCK_TIMEOUT；跨进程等待 250ms 超时返回 E_LOCK_TIMEOUT，不无限阻塞。

## 7. 产品锁与默认关闭复核

- `runtime.coding.uftk.enabled` = false。
- `runtime.coding.uftk.baseVersionGuard.enabled` = false。
- shared `DEFAULT_CODING_RUNTIME_FLAGS` 5 项全 false。
- 全仓默认未出现新的 UFTK 默认开启路径；仅测试显式 override。
- liveReady=false、productApproved=false、defaultOn=false。

## 8. Task Forest 收尾

- `TFP-c8a8862b63`：proposal-save → validate → proposal-apply --yes → export 全通过；`TF-0071` 创建为 in_progress(10%)。
- `TFP-8ddfa816ad`：proposal-save → validate → proposal-apply --yes → export 全通过；`TF-0071` 置 review_needed(90%)。
- 当前 `TF-0071`：review_needed(90%)，child_of `TF-0010`，depends_on `TF-0070`；未置 done。
- 下一次独立验收通过且用户确认后，才允许 TF-0071 done 和讨论 P3。

## 9. 硬性禁止复核

- 未进入 P3/P4/P5 设计或实现。
- 未 flip `runtime.coding.uftk.enabled`、`baseVersionGuard` 或任何产品锁。
- 未新增第二套锁/队列/journal/SQLite/JSONL 审计存储。
- 未改变 write/edit/apply_patch 模型对外 schema。
- 未清理或提交无关 WIP。
- 未把 P1/P2 本地绿灯表述为 UFTK GA / canary / 整体成熟度结论。
