# Coding Runtime P1 独立验收报告（2026-08-17，最终修订：直接 ACCEPT）

> Verdict：**ACCEPT**
> Residual：**无**。先前记录的 `P1_RESIDUAL_TSGO_BASELINE` 已获用户授权修复并清零。
> 验收依据：`reports/CODING-RUNTIME-P1-ACCEPTANCE-PROMPT.md` + `docs/dev/coding-runtime-development-spec.md` Phase 0/1 + 7.2
> 产品锁：`liveReady=false`、`productApproved=false`、`defaultOn=false`；本报告不是 UFTK GA / canary / 整体成熟度结论。

## 0. 起始信息

- 工作区：`D:\ClawX`（repo root）
- HEAD：`734ec877e75682861103660fbdea2bd55253ece0`
- 分支：`main`；未 checkout / reset / stash / 清理
- 验收对象：`docs/dev/coding-runtime-development-spec.md` Phase 1
- 待验收节点：`TF-0070`（验收开始时为 `review_needed`，90%；closeout 后 `done`，100%）
- 工作树：验收开始时 `git status --short` 105 条；期间存在既有/并发 WIP（含 `openclaw_runtime/src/agents/mission-control/fenced-tick-wiring.test.ts` 等），本次验收未清理、未提交。

## 1. 预检结果

1. 只读必读项按提示词顺序完成。
2. P1 允许路径内的 tracked diff 全部为 P1 相关内容。
3. `.agent-workbench/task-forest/graph/nodes.json` 仅新增 `TF-0070`；首个 proposal 为 applied。
4. 未发现第二套写路径、第二套 journal、SQLite/JSONL 审计存储，或 P1 新默认开启行为。
5. `runtime.coding.uftk.enabled` 默认仍为 `false`；全仓仅测试代码显式 override `true`。shared `DEFAULT_CODING_RUNTIME_FLAGS` 5 项全为 `false`。
6. `git diff --check` 与 untracked whitespace 扫描无错误；`lint:bom` 通过。

## 2. 全部命令与 exit code（最终复跑，均 exit 0）

| 命令 | Exit | 结果 |
|---|---|---|
| `pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1` | 0 | 8/8 PASS |
| `pnpm run typecheck:node` | 0 | PASS |
| `pnpm run typecheck:web` | 0 | PASS |
| `pnpm contract:check` | 0 | Contract check passed |
| `pnpm run lint:bom` | 0 | check-no-bom: ok |
| `git diff --check`（P1 tracked + tsgo 修复文件） | 0 | clean |
| runtime 定向 9 文件（显式列出）`--maxWorkers=1` | 0 | 9 files / 105 tests PASS |
| `pnpm verseshell:test` | 0 | bundle 13/13 + runtime-bundle 11/11 + runtime 15 files/141 tests + MCP 11/11 |
| `pnpm --dir openclaw_runtime tsgo:core` | 0 | PASS |
| `pnpm --dir openclaw_runtime tsgo:core:test` | 0 | PASS |
| 受影响文件定向回归（agents/boundary/gateway/verseshell/plugin-sdk） | 0 | 全部 PASS |

## 3. tsgo 基线修复（用户授权，仅类型/测试类型修复）

先前的 `P1_RESIDUAL_TSGO_BASELINE` 已获用户授权修复，修复文件如下：

- `shared/verseshell/extraction.ts`：相对 import 显式 `.js`；`SuggestedAction` 类型标注。
- `shared/verseshell/facade.ts`：相对 import 显式 `.js`。
- `openclaw_runtime/src/agents/mission-control/goal-wake.test.ts`：`getMissionRun(...)` 非空断言。
- `openclaw_runtime/src/agents/mission-control/fenced-tick-wiring.test.ts`：mock `runTaskLoop` 类型收窄。
- `openclaw_runtime/src/agents/openai-transport-stream-responses-input.test.ts`：移除 `SimpleStreamOptions` 不存在的 `runId` 实参。
- `openclaw_runtime/src/agents/verseshell/governed-process.test.ts`：`start.args.argv` 局部收窄为 `string[] | undefined`。
- `openclaw_runtime/src/gateway/trajectory-gateway.test.ts`：移除 `toMatchObject` 非法泛型实参。
- `openclaw_runtime/src/plugin-sdk/provider-stream-shared.test.ts`：测试桩调用参数类型收窄。
- `openclaw_runtime/test/extension-import-boundaries.test.ts`：`.mjs` import 显式期望 + 回调参数标注。
- `openclaw_runtime/test/vitest-extensions-config.test.ts` / `vitest-unit-paths.test.ts` / `web-provider-boundary.test.ts`：`.mjs` path manifest import 显式期望。

修复后 `tsgo:core` 与 `tsgo:core:test` 均 exit 0；受影响测试全绿；未修改 P1 业务代码。

## 4. 验收矩阵

### 4.1 功能

- [x] `FileTransactionService` 实现 P0 接口并有测试覆盖
- [x] flag on 时 write / edit / apply_patch / delete / move 全部进入统一 journal
- [x] 每个 mutation 可按 batchId 单回滚；共享 batchId 可批量回滚
- [x] `previewRollback(batchId)` 返回 unified diff 且不改磁盘/journal
- [x] 非 git 目录完整回滚
- [x] 原子写失败不留半文件
- [x] `listAudit` fail-closed，不返回伪造空页

### 4.2 回滚强制场景

- [x] 写入 -> 修改 -> 回滚，与写入前字节一致
- [x] 删除文件后可恢复
- [x] 移动文件后可恢复原路径与内容（含 destination 原先存在）
- [x] apply_patch 提交后可回滚
- [x] 回滚失败返回结构化 `recovery_required` + `recoveryRef`，journal 保留

### 4.3 Fail-closed 与兼容

- [x] flag on 时 snapshot/journal 失败 -> mutation 失败，目标文件零变化
- [x] flag off 时现有 write-journal fail-open 行为不回退
- [x] write / edit / apply_patch 对外 TypeBox schema 不变
- [x] DCS `details.working_memory` 成功/失败语义未被吞掉或改写
- [x] `isCodingUftkEnabled()` 默认 false；shared 默认 flag 仍全 false

### 4.4 性能证据复核

- [x] write 单文件绝对增量 < 50ms（实现证据：+3.88ms）
- [x] edit 单文件绝对增量 < 50ms（实现证据：+3.99ms）
- [x] ≥1MB apply_patch 无 O(n²) 退化（实现证据：1.07MB / 42000 行线性耗时）

## 5. Closeout 落地

1. Task Forest：
   - `TFP-coding-runtime-p1-closeout-20260817`：save → validate → apply → export 全通过；`TF-0070` 置 `done` / 100%。
   - `TFP-coding-runtime-p1-accept-direct-20260817`：记录直接 ACCEPT 与 tsgo 基线修复证据。
   - `TF-0070` 当前：`done`，100%，child_of `TF-0010`。
2. `docs/dev/handoffs/LATEST.md` 顶部已更新为最终直接 ACCEPT 状态。
3. 本报告已生成：`reports/CODING-RUNTIME-P1-ACCEPTANCE-2026-08-17.md`。

## 6. 最终口径

- 最终 verdict：**`ACCEPT`**（无 residual）。
- 未 flip `runtime.coding.uftk.enabled` 或任何产品锁。
- P1 代码未修改；tsgo 基线文件修复均为类型/测试类型修复，且经用户授权。
- P2 / P3 / P4 / P5：未解锁、未讨论。是否进入 P2 由用户另行决定。
