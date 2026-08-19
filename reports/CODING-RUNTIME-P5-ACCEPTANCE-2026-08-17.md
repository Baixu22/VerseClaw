# Coding Runtime P5 独立验收报告（2026-08-17）

> 验收对象：`docs/dev/coding-runtime-development-spec.md` Phase 5 + 7.2/7.4。
> 验收性质：独立复跑 P5 必跑命令与矩阵复核；不使用开发自检结论。
> Verdict：**ACCEPT_WITH_RESIDUAL**（仅提示词第 2.5/2.6 条允许的预存 residual；无 P5 文件错误）。
> TF-0074 状态：验收通过但用户尚未明确确认，因此 **未置 done**。本报告不构成 UFTK GA / canary / 整体成熟度结论。

## 0. 起始信息

- 工作区：`D:\ClawX`（repo root）
- HEAD：`734ec877e75682861103660fbdea2bd55253ece0`
- 工作分支：`main`；脏工作树大量既有 WIP，未 checkout/reset/cleanup
- 前置状态：`TF-0070`=done(100%)；`TF-0071`=done(100%)；`TF-0072`=done(100%)；`TF-0073`=done(100%)（用户已确认）
- 待验收节点：`TF-0074`=review_needed(90%)，child_of `TF-0010`，depends_on `TF-0073`，未 done
- 产品锁：liveReady=false、productApproved=false、defaultOn=false
- 关键 flag：`runtime.coding.uftk.enabled=false`；`runtime.coding.uftk.auditLog.enabled=false`；`runtime.coding.uftk.gitCheckpoint.enabled=false`；`runtime.coding.uftk.execSideEffects.enabled=false`；`runtime.coding.uftk.commandApproval.enabled=false`；`runtime.coding.uftk.baseVersionGuard.enabled=false`；shared 6 个 UFTK flag 全 false

## 1. 预检结果

- `git rev-parse HEAD` = `734ec877e75682861103660fbdea2bd55253ece0`。
- 6 个运行时 UFTK flag 实测全 false；shared `DEFAULT_CODING_RUNTIME_FLAGS` 6 项全 false。
- `TF-0070..TF-0073` 均 done(100%)；`TF-0074`=review_needed(90%)，未 done。
- 未发现第二套审计 sink/锁/队列/journal；`git-checkpoint.ts` 只复用 `session-write-lock`。
- `git-checkpoint.ts` 中无 `git reset --hard` / `git clean -f` 危险命令。
- `agent-tools.ts` 中无 gitCheckpoint 工具接线，未新增模型可见 schema。

## 2. 必跑命令 exit code（独立复跑）

| 命令 | Exit | 结果 |
|---|---:|---|
| `pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1` | 0 | 1 file / 8 tests PASS |
| runtime 定向 20 文件（P5 列表）`--maxWorkers=1` | 0 | 20 files / 170 tests PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1` | 0 | 1 file / 4 tests PASS |
| `pnpm run typecheck:node` | 0 | PASS |
| `pnpm run typecheck:web` | 0 | PASS |
| `pnpm contract:check` | 0 | Contract check passed |
| `pnpm run lint:bom` | 0 | check-no-bom: ok |
| `git diff --check -- <P5 tracked 变更文件列表>` | 0 | clean；新文件无行尾空白 |
| `pnpm verseshell:test` | 0 | bundle 13/13 + runtime-bundle 11/11 + runtime 15 files/141 tests + MCP 11/11 |
| `pnpm --dir openclaw_runtime tsgo:core` | 0 | PASS |
| `pnpm --dir openclaw_runtime tsgo:core:test` | 2 | **residual**：仅既有 RLG WIP 测试（session-drain-service.test.ts / session-reset-service.stop.test.ts / session-reset-service.subagent-stop.test.ts）；错误列表中无 P5 文件 |

执行注记：首次启动 20 文件连跑时 Vitest 在 `git-checkpoint.test.ts` 后出现一次 120s 无输出 stall（无失败断言，进程组被终止）；随后单独复跑 `git-checkpoint.restore.test.ts` 通过，完整 20 文件连跑两次均 exit 0 / 170 PASS。未见可复现失败，判定为环境瞬态，不计入 P5 缺陷。

`tests/unit/config-schema-parity.test.ts` 独立复跑 exit 1：失败项仍仅为预存 `runtime.memory.candidateGeneration`（zod 有、type/leaves 无）；新增 `runtime.coding.uftk.gitCheckpoint.enabled` 未出现在 unknown 列表，非 P5 引入，未修。

## 3. P5 矩阵复核（基于独立复跑测试）

- [x] git 项目 checkpoint 创建：temp-index `git stash create` 风格私有 ref；创建后 index/worktree 零变化；返回 checkpoint id；可列查。
- [x] git 项目 restore：修改 / 删除 / 新增 / 嵌套路径均恢复；恢复后 worktree 与 index 一致。
- [x] 非 git 项目：create/list/restore 结构化 `unsupported`，不抛异常破坏既有行为。
- [x] 并发 restore：两个并发 restore 串行，两者均成功，最终工作区为某一 checkpoint 完整状态，未出现混合态。
- [x] restore 冲突/失败：目标文件被目录阻挡返回 `conflict` + `E_GIT_CHECKPOINT_CONFLICT` + diagnostic；阻挡内容保留，不静默丢失。
- [x] 嵌套 .git / submodule：显式 warning + `unsupported`；root `.git` 文件同样降级。
- [x] flag off：`runtime.coding.uftk.gitCheckpoint.enabled=false`；service 默认 disabled；无工具路径接线；不新增模型可见 schema。
- [x] 与 journal 回滚区分：git-checkpoint 模块不导入 write-journal / FTS rollback；相关文件未改。
- [x] P1/P2/P3/P4 回归矩阵：包含在 20 文件定向测试中，170 tests PASS。

## 4. 结论

P5 独立验收 verdict = **ACCEPT_WITH_RESIDUAL**。Residual 仅限提示词预存的既有 RLG WIP `tsgo:core:test` 类型错误与 `config-schema-parity` 的 `runtime.memory.candidateGeneration` 预存 mismatch；错误列表中无任何 P5 文件。产品锁与全部 UFTK flags 保持 false。

在用户明确确认本 verdict 前，`TF-0074` 保持 review_needed(90%)，不置 done。
