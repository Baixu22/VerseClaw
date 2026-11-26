# TF-0950 r5 独立代码审查

- candidate: c86fcf909c0953822d6a31df3363b92a72b36725
- base: 2aa116861
- driven_by: agent
- actor: tf0950_r5_acceptance
- workspace: D:/ClawX-work/session-task-review-fixes-20261125-01a21019
- HEAD: c86fcf909c0953822d6a31df3363b92a72b36725

结论：NO_GO，存在 1 个会影响新工作区行为的可行动问题。

## 可行动问题

### P1：execution state 目录未创建时会跳过新工作区 Git 初始化

触发条件：首次初始化一个无 Task authority、无 .git、且 resolveExecutionStatePath() 所在目录尚未存在的全新工作区。withExecutionTaskBarrier() 在 execution-task-barrier.ts:14-15 先对 state 文件父目录执行 realpathSync.native(dirname(stateFile))；父目录不存在时直接抛出 ENOENT。workspace.ts:801-814 的 ensureGitRepo() 将域解析、屏障进入和 execFileSync("git", ["init"]) 全部包在宽泛 catch 中，因此异常被吞掉，函数返回成功但没有创建 .git。

影响：ensureAgentWorkspace({ ensureBootstrapFiles: true }) 对新工作区不能保持任务规范要求的“无任务时自动 Git 初始化”。该路径也使新增 tests/unit/session-task-workspace-bootstrap.test.ts:45-48 的第二用例依赖外部 state 目录已预先创建；在隔离的临时 state 根目录下会失败。修复应保证屏障路径的父目录先创建，或让屏障在 state 目录不存在时使用可创建的规范路径，并保留初始化失败的可诊断信息。

## 逐项核对依据

- 根修：openclaw_runtime/src/agents/workspace.ts:787-815 已按 Task domain 检查数据库、复查域 ID，并在 withExecutionTaskBarrier 内同步执行 Git 初始化；已有数据库时跳过 git init 的意图与规则一致。
- 单测：tests/unit/session-task-workspace-bootstrap.test.ts:27-43 覆盖已有任务域保持原域、恢复同一 task、旧 generation/owner 拒绝；:45-48 覆盖无任务新工作区应创建 Git。
- E2E：tests/e2e/session-task-review-fixes.spec.ts:128-130 核对任务工作区 bootstrap 后 git.status 为非仓库；:154-165 核对 archive/restore 回执成功、generation 变化及同一 taskNodeId 恢复；:167-170 核对旧 credential 拒绝。
- Chat 合并：src/pages/Chat/index.tsx:706-724 按 workspace/session scope 保存草稿并通过 useSyncExternalStore 订阅；:2458-2510 在 handoff 回执 accepted/sent 且目标草稿版本未变化时清理目标草稿；:1848-1920 的卸载保存闭包保留原 workspace/session。迟到响应通过 ownsView() 的 workspace、session、viewRevision、generation 检查后才更新视图。knowledge scope 状态仍独立于 composer/bookmark 状态，未见合并丢失。

## 验证状态

- git rev-parse HEAD：通过，实际 HEAD 与候选一致。
- git diff --check 2aa116861..c86fcf909：通过。
- 定向单测：pending。尝试运行 pnpm exec vitest run tests/unit/session-task-workspace-bootstrap.test.ts --maxWorkers=1 --no-file-parallelism 时，pnpm 先尝试清理 modules 目录，在无 TTY 环境以 ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY 中止；未产生测试通过结论。
- 未运行重型测试、构建、队列或任务图操作。
