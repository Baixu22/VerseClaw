# Coding Runtime Production Rollout 继续工作提示词（2026-08-19）

> 使用方式：在 **`D:\ClawX-UFTK-Pilot`** 这个 worktree / workspace 里新开会话，把本文件全文作为起始提示词执行。
> 这是 P1-P7 验收完成后的下一阶段：**把能力接进真实使用，不再停留在 shadow / 未接线状态。**

---

## 0. 起始信息（执行前先确认）

- Workspace：`D:\ClawX-UFTK-Pilot`（不是 `D:\ClawX`）
- 分支：`feat/coding-runtime-uftk-pilot`
- 基线 commit：`cf022ea0f`
- 状态：worktree clean，依赖已安装，contract 9/9 与 lock-core/scoped checkpoint 36/36 smoke 已通过
- 前置结论：
  - Coding Runtime P1-P7 全部验收：`TF-0070..TF-0076` 均为 `done(100%)`
  - P1-P7 verdict：ACCEPT_WITH_RESIDUAL
  - 12 个 UFTK flag 全部默认 `false`
  - 产品锁：`liveReady=false`、`productApproved=false`、`defaultOn=false`
  - P7 模块仍无生产调用方

---

## 1. 必读顺序

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `docs/dev/coding-runtime-development-spec.md`
4. `docs/dev/coding-runtime-p6-p7-development-spec.md`
5. `docs/dev/coding-runtime-production-rollout-plan.md` ← 本阶段主计划
6. `shared/coding-runtime/README.md`
7. `shared/coding-runtime/MIGRATION.md`
8. `reports/CODING-RUNTIME-P6-P7-ACCEPTANCE-PROMPT-2026-08-19.md`
9. `reports/CODING-RUNTIME-P6-ACCEPTANCE-2026-08-19.md`
10. `reports/CODING-RUNTIME-P7-ACCEPTANCE-2026-08-18.md`
11. `openclaw_runtime/src/agents/agent-tools.ts`（P1-P5 + P6A 现有接线点）
12. `openclaw_runtime/src/context-engine/coding-runtime-flags.ts`

---

## 2. 本阶段唯一目标

**把已验收能力放进真实生产路径，并按 Pilot A → Pilot B → Pilot C 逐步放量。不继续做 shadow，不启动新的大阶段，不写“未来再接线”的空计划。**

当前推荐的执行策略：

- Pilot A：先真实启用已经接线的 P1-P5 + P6A。
- Pilot B：A 稳定后，在 turn / long-task 前接 auto checkpoint。
- Pilot C：一周后再评估，exec undo 优先走内部恢复路径，不新增模型工具。

---

## 3. Pilot A 任务清单（先做）

### 3.1 目标配置

只对 `D:\ClawX-UFTK-Pilot` 这个 workspace / 对应 agent 显式开启：

```text
runtime.coding.uftk.enabled = true
runtime.coding.uftk.baseVersionGuard.enabled = true
runtime.coding.uftk.auditLog.enabled = true
runtime.coding.uftk.concurrencyV2.enabled = true
```

要求：

- 找到本仓库真实的 runtime config 落点（config 文件 / Settings / config schema），**只写实例配置，不改任何代码默认值**。
- 确认其他 workspace / agent 的 flag 仍为 false。
- 确认产品锁三个 false 不变。
- 不新增模型工具 schema。

### 3.2 验证接线真的生效

在开启后，用真实工具路径验证，而不是只看 resolver：

- write / edit / apply_patch 走 `FileTransactionService`，journal 有记录；
- audit 事件真实落到 `<openclaw-state>/logs/coding-audit/`；
- `previewRollback(batchId)` 与 `rollback(batchId)` 真实可用；
- 同文件并发写串行；
- 过期 `baseVersion` 真实返回 `E_CONFLICT` + diff，目标零变化；
- `concurrencyV2` 开启后，cross-process read marker 行为可观察。

### 3.3 真实使用指标（Pilot A 完成门槛）

连续使用，收集：

- 至少 30 个真实 write/edit/apply_patch/exec；
- audit JSONL + SQLite 有真实事件；
- 至少一次真实 `previewRollback` 或 `rollback` 成功；
- 至少一次真实 `E_CONFLICT` 或锁等待被记录，并确认不是误伤；
- 无内容丢失、无工具语义回归。

### 3.4 回归命令（每次变更后跑）

```bash
pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/coding-runtime --maxWorkers=1 --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1
pnpm run typecheck:node
pnpm run typecheck:web
pnpm contract:check
pnpm run lint:bom
pnpm run lint:dcs
git diff --check
pnpm verseshell:test
pnpm --dir openclaw_runtime tsgo:core
pnpm --dir openclaw_runtime tsgo:core:test
```

---

## 4. Pilot B 任务清单（A 完成并经用户确认后）

开启：

```text
runtime.coding.uftk.gitCheckpoint.enabled = true
runtime.coding.uftk.gitCheckpoint.pathScoped.enabled = true
runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled = true
runtime.coding.uftk.gitCheckpoint.lifecycle.enabled = true
runtime.coding.uftk.autoCheckpoint.enabled = true
```

实现：

- 在 `embedded-agent-runner` turn 开始前调用 `AutoCheckpointService.checkpointBeforeTurn(...)`；
- 在 `mission-control` / 长任务 tick 前调用 `checkpointBeforeLongTask(...)`；
- 失败只结构化 warn，绝不抛进 turn；
- 默认关闭，仅 allowlist 命中时创建。

Pilot B 完成门槛：

- 10 个真实 turn 产生 10 个可列查 checkpoint，label 绑定 `requestId`；
- 至少一次真实 restore 成功，scope 外路径零变化；
- 至少一次 safety snapshot 恢复演练通过；
- retention 生效，不删最新 checkpoint，不删 safety ref。

---

## 5. Pilot C 任务清单（A+B 完成并稳定后）

开启：

```text
runtime.coding.uftk.execSideEffects.enabled = true
runtime.coding.uftk.execUndo.enabled = true
```

默认方案：**内部恢复路径，不新增模型工具。**

- exec 前自动 path-scoped checkpoint；
- exec 后按 `CodingExecEvent.sideEffects` 提供恢复面；
- 只撤销工作区文件副作用；
- 网络 / DB / 远端 push / 依赖安装明确不支持，且不得声称已撤销。

---

## 6. 硬性禁止

1. 不 checkout / reset / clean，不提交无关 WIP。
2. 不 flip 任何默认 flag 或产品锁。
3. 不新增第二套锁 / 队列 / journal / 审计真源。
4. 不使用 `git reset --hard` / `git clean -f`。
5. 不改变 write / edit / apply_patch / exec 模型对外 TypeBox schema。
6. 不把真实使用证据写成 UFTK GA / canary / 整体成熟度。
7. 不在主工作树 `D:\ClawX` 做生产接线开发。

---

## 7. 每轮结束必须做的事

1. 把本轮真实使用数据写入 `docs/dev/handoffs/LATEST.md`。
2. 更新本提示词对应阶段的勾选状态。
3. 运行回归命令并记录 exit code。
4. 如果出现任何用户内容丢失或工具语义回归：立即关闭对应 leaf，停下报告，不得自行扩大修复范围。
