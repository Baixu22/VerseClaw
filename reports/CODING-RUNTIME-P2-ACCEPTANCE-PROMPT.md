# Coding Runtime P2 独立验收提示词（2026-08-17）

> 本提示词只做 P2 验收：并发读写与冲突检测。P2 验收通过且用户确认前，不得进入 P3/P4/P5，不得把 P1/P2 绿灯表述为 UFTK GA 或 canary。

## 0. 起始信息（执行前先填空）

- 工作区：D:\ClawX（repo root）
- HEAD：<执行 `git rev-parse HEAD` 后填写>（当前基线为 `734ec877e75682861103660fbdea2bd55253ece0`）
- 工作分支：main；脏工作树大量既有 WIP，禁止 checkout/reset/cleanup
- 前置状态：P1 verdict=ACCEPT；`TF-0070`=done(100%)，child_of `TF-0010`
- 待验收节点：`TF-0071`=review_needed(90%)，child_of `TF-0010`，depends_on `TF-0070`
- 验收对象：`docs/dev/coding-runtime-development-spec.md` Phase 2 + 7.2/7.4
- 产品锁：liveReady=false、productApproved=false、defaultOn=false
- 关键 flag：`runtime.coding.uftk.enabled` 仍为 false；`runtime.coding.uftk.baseVersionGuard.enabled` 默认 false

## 1. 只读必读（先读，再写任何结论）

按顺序读：

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `docs/dev/coding-runtime-development-spec.md`（重点 Phase 2、7.2 并发/审计/性能强制项、7.4 DoD）
4. `docs/dev/handoffs/LATEST.md`（顶部 Coding Runtime P2 段落）
5. `reports/CODING-RUNTIME-P1-ACCEPTANCE-2026-08-17.md`
6. `reports/CODING-RUNTIME-P2-EVIDENCE-2026-08-17.md`
7. `shared/coding-runtime/types.ts` / `schema.ts` / `README.md` / `MIGRATION.md`
8. `openclaw_runtime/src/agents/coding-runtime/*.ts`
9. `openclaw_runtime/src/agents/apply-patch-batch-lock.ts`
10. `openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts`
11. `openclaw_runtime/src/agents/session-write-lock.ts` 与 `openclaw_runtime/src/infra/file-lock-manager.ts`
12. `openclaw_runtime/src/agents/sessions/tools/write.ts`、`edit.ts`
13. `openclaw_runtime/src/agents/apply-patch.ts`、`apply-patch-preflight.ts`、`agent-tools.ts`
14. 现有测试：coding-runtime 全部测试、file-mutation-queue / write-journal / write / edit / apply_patch / dcs-producer-envelope 测试

## 2. 预检（先做，不猜）

1. 记录 `git rev-parse HEAD` 与 `git status --short`。
2. 确认 `runtime.coding.uftk.enabled=false`；`runtime.coding.uftk.baseVersionGuard.enabled=false`；shared 5 个 UFTK flag 全 false。
3. 确认 `TF-0070` 为 done；`TF-0071` 为 review_needed(90%)，且未 done。
4. 若发现 P1 回归、第二套锁系统、第二套 journal、SQLite/JSONL 审计存储、新的默认开启行为：停下并报告。
5. tsgo 基线：`tsgo:core` 应 exit 0；`tsgo:core:test` 当前存在既有未跟踪 RLG WIP 类型错误（session-drain-service.test.ts、session-reset-service.stop.test.ts、session-reset-service.subagent-stop.test.ts），无 P2 文件。验收时不得把该 residual 算作 P2 缺陷，但也不得擅自修复无关文件。

## 3. 必跑命令（逐条记录 exit code；P2 验收通过前全部要 0 或按第 2.5 条记录 residual）

```bash
pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1

pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts   src/agents/coding-runtime/file-lock-manager.test.ts   src/agents/coding-runtime/turn-diff.test.ts   src/agents/coding-runtime/file-transaction-service.test.ts   src/agents/coding-runtime/file-transaction-service.concurrency.test.ts   src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts   src/agents/tools/write-journal.test.ts   src/agents/sessions/tools/write.test.ts   src/agents/sessions/tools/edit.test.ts   src/agents/apply-patch.test.ts   src/agents/dcs-producer-envelope.test.ts   --maxWorkers=1

pnpm run typecheck:node
pnpm run typecheck:web
pnpm contract:check
pnpm run lint:bom
git diff --check -- <P2 tracked 变更文件列表>
pnpm verseshell:test
pnpm --dir openclaw_runtime tsgo:core
pnpm --dir openclaw_runtime tsgo:core:test
```

tsgo 规则：P2 文件在错误列表中必须修复；无关既有错误不得擅自修复，记 residual 并等待用户授权（当前已修复的基线应保持 0）。

## 4. 必须测试的并发矩阵（不写码验收，不靠嘴说）

- 同文件两并发写：一个成功，另一个等待串行成功或返回 E_CONFLICT；不允许丢更新/互相覆盖
- 同文件两并发读：不互斥，能并行完成
- 同文件读 + 写：读只在写持锁期间等待，写完成后读获得新内容
- 不同文件并发写：并行，无串行 convoy
- 过期 baseVersion 写 / edit / apply_patch：E_CONFLICT + diff，目标文件零变化
- 跨进程同文件写：一个持锁，另一个等待或 E_LOCK_TIMEOUT；锁 owner/stale 可诊断
- Windows 上至少验证一次跨进程锁；有 Linux 环境则补一次 Linux 验证
- flag off：write/edit/apply_patch 行为与 P1 验收时一致，schema 不变，DCS working_memory 语义不变
- P1 回滚矩阵全部回归：单批/共享 batch 回滚、delete/move/apply_patch 回滚、previewRollback、recovery_required、非 git 目录、原子写失败注入

## 5. 性能证据复核

- flag off / flag on 的 write、edit 单文件耗时；绝对增量 < 50ms。
- 无竞争 lock + baseVersion 检查开销；不同文件并发不随文件数退化。
- ≥1MB apply_patch 无 O(n²) 退化（P1 的 1.07MB 线性证据为回归基线）。
- 锁等待有超时上限；不得无限阻塞工具调用。

## 6. Task Forest 与收尾

- 确认 `TF-0071` 状态为 review_needed（约 90%），未置 done。
- 确认 `reports/CODING-RUNTIME-P2-EVIDENCE-2026-08-17.md` 存在且内容可复核。
- 验收结论写入 `docs/dev/handoffs/LATEST.md` 顶部：P2 交付内容、测试命令 exit code、并发矩阵结果、tsgo 状态；明确 P2 等待独立验收，P3 未解锁。
- 只有验收通过且用户明确确认后，才允许 `TF-0071` done 和讨论 P3。

## 7. 硬性禁止

- 不进入 P3 / P4 / P5 设计或实现
- 不 flip `runtime.coding.uftk.enabled`、`baseVersionGuard` 或任何产品锁
- 不新增第二套锁/队列/journal/SQLite/JSONL 审计存储
- 不改变 write / edit / apply_patch 模型对外 schema
- 不清理或提交无关 WIP
- 不把 P1/P2 本地绿灯表述为 UFTK GA、canary 或整体成熟度结论
