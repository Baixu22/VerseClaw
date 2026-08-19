# Coding Runtime P1-P5 全量验收提示词（2026-08-17）

> 本提示词用于在独立会话中对 Coding Runtime P1-P5 做一次完整的本地回归与矩阵验收。它只做验收，不启动新实现。验收通过只能说明本地 Coding Runtime 绿灯；**不得**将其表述为 UFTK GA、canary 或整体成熟度结论。

---

## 0. 起始信息（执行前先填空）

- 工作区：`D:\ClawX`（repo root）
- HEAD：<执行 `git rev-parse HEAD` 后填写>（预期基线 `734ec877e75682861103660fbdea2bd55253ece0`）
- 工作分支：main；脏工作树大量既有 WIP，禁止 checkout/reset/cleanup
- 前置状态：`TF-0070`=done(100%)；`TF-0071`=done(100%)；`TF-0072`=done(100%)；`TF-0073`=done(100%)；`TF-0074`=done(100%)
- 产品锁：liveReady=false、productApproved=false、defaultOn=false
- 关键 flag：`runtime.coding.uftk.enabled=false`；`runtime.coding.uftk.auditLog.enabled=false`；`runtime.coding.uftk.execSideEffects.enabled=false`；`runtime.coding.uftk.commandApproval.enabled=false`；`runtime.coding.uftk.baseVersionGuard.enabled=false`；`runtime.coding.uftk.gitCheckpoint.enabled=false`；shared 6 个 UFTK flag 全 false

---

## 1. 只读必读（先读，再写任何结论）

按顺序读：

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `docs/dev/coding-runtime-development-spec.md`（Phase 0-5 + 7.2 强制验收项 + 7.4 DoD + 8/9 防护）
4. `docs/dev/handoffs/LATEST.md`（顶部 Coding Runtime P5 已确认段落）
5. `reports/CODING-RUNTIME-P5-ACCEPTANCE-2026-08-17.md`
6. `reports/CODING-RUNTIME-P5-EVIDENCE-2026-08-17.md`
7. `reports/CODING-RUNTIME-P4-EVIDENCE-2026-08-17.md`
8. `reports/CODING-RUNTIME-P3-ACCEPTANCE-PROMPT.md`
9. `shared/coding-runtime/types.ts` / `schema.ts` / `README.md` / `MIGRATION.md`
10. `openclaw_runtime/src/agents/coding-runtime/` 下全部实现与测试（file-transaction-service、file-lock-manager、turn-diff、exec-audit、command-approval-policy、audit-sink、audit-log、audit-index、replay、git-checkpoint、atomic-write、rollback-preview）
11. `openclaw_runtime/src/agents/tools/write-journal.ts`、`openclaw_runtime/src/agents/checkpoint-rollback-executor.ts`（只读参考）
12. `openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts`、`session-write-lock.ts`、`openclaw_runtime/src/infra/file-lock-manager.ts`
13. `openclaw_runtime/src/context-engine/coding-observability.ts`、`coding-runtime-flags.ts`
14. `openclaw_runtime/src/runtime-core/event-log-persistence.ts`（只读参考，不改变其权威边界）

---

## 2. 预检（先做，不猜）

1. 记录 `git rev-parse HEAD` 与 `git status --short`。
2. 实测并记录 6 个运行时 UFTK flag 全 false；shared `DEFAULT_CODING_RUNTIME_FLAGS` 6 项全 false；产品锁三项全 false。
3. 确认 `TF-0070`/`TF-0071`/`TF-0072`/`TF-0073`/`TF-0074` 全部 done(100%)，且没有新的 Coding Runtime in_progress/review_needed 节点。
4. 若发现第二套审计 sink/锁/队列/journal、`coding-runtime/` 之外的 SQLite/JSONL 审计真源、新的默认开启行为、模型工具 schema 变化：停下并报告。
5. `tsgo:core` 应 exit 0。`tsgo:core:test` 当前允许的既有 residual 仅为未跟踪 RLG WIP：`session-drain-service.test.ts`、`session-reset-service.stop.test.ts`、`session-reset-service.subagent-stop.test.ts`；错误列表不得出现 P1-P5 文件。
6. `tests/unit/config-schema-parity.test.ts` 当前因预存 `runtime.memory.candidateGeneration`（zod 有、type/leaves 无）失败；验收只允许该预存原因，不修。

---

## 3. 全量必跑命令（逐条记录 exit code）

### 3.1 契约

```bash
pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1
```

### 3.2 Runtime 定向全量（P1-P5 全部相关测试）

```bash
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/atomic-write.test.ts \
  src/agents/coding-runtime/file-lock-manager.test.ts \
  src/agents/coding-runtime/turn-diff.test.ts \
  src/agents/coding-runtime/file-transaction-service.test.ts \
  src/agents/coding-runtime/file-transaction-service.concurrency.test.ts \
  src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts \
  src/agents/coding-runtime/rollback-preview.test.ts \
  src/agents/coding-runtime/command-approval-policy.test.ts \
  src/agents/coding-runtime/exec-audit.test.ts \
  src/agents/coding-runtime/exec-audit.tool-integration.test.ts \
  src/agents/coding-runtime/audit-log.test.ts \
  src/agents/coding-runtime/audit-index.test.ts \
  src/agents/coding-runtime/replay.test.ts \
  src/agents/coding-runtime/git-checkpoint.test.ts \
  src/agents/coding-runtime/git-checkpoint.restore.test.ts \
  src/agents/tools/write-journal.test.ts \
  src/agents/sessions/tools/write.test.ts \
  src/agents/sessions/tools/edit.test.ts \
  src/agents/apply-patch.test.ts \
  src/agents/dcs-producer-envelope.test.ts \
  src/agents/bash-tools.exec.resolve-env.test.ts \
  src/agents/rc04-exec-approval-wiring.test.ts \
  --maxWorkers=1
```

### 3.3 Flags / 工程门禁

```bash
pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1

pnpm run typecheck:node
pnpm run typecheck:web
pnpm contract:check
pnpm run lint:bom
git diff --check -- <P1-P5 tracked 变更文件列表>
pnpm verseshell:test
pnpm --dir openclaw_runtime tsgo:core
pnpm --dir openclaw_runtime tsgo:core:test
```

### 3.4 预存失败复核（只允许以下原因）

```bash
pnpm exec vitest run tests/unit/config-schema-parity.test.ts --maxWorkers=1
```

允许：exit 1 且失败项只有 `runtime.memory.candidateGeneration`。其他任何失败为回归。

---

## 4. 全量矩阵（逐项实测，不靠嘴说）

### 4.1 P1 文件事务

- write / edit / apply_patch / delete / move 全部进入统一 journal。
- 每个 mutation 可单独回滚，也可按 batch 回滚。
- `previewRollback` 返回统一 diff。
- 非 git 项目可完整回滚。
- 原子写失败不留半文件；删除/移动后可恢复原路径与内容。

### 4.2 P2 并发与冲突

- 同文件并发读不互斥；同文件并发写串行。
- 过期 `baseVersion` 返回 `E_CONFLICT` + diff，目标文件零变化。
- `apply_patch baseVersions[]` 在 preflight 阶段冲突，目标零变化。
- 跨进程同文件写复用 `session-write-lock` / `infra/file-lock-manager`。
- 锁带超时、owner、stale 检测；模型对外 schema 不变。

### 4.3 P3 Exec 审计与审批

- exec flag off：行为与 P1/P2 一致，不产生 CodingExecEvent，不做快照。
- execSideEffects on：completed/failed/running 至少一条 CodingExecEvent；added/modified/deleted 正确。
- commandApproval on：Allow/Prompt/Forbidden、最长前缀、大小写/空白归一化、默认 prompt。
- forbidden：spawn 前阻断，目标零变化，记 `status=denied` + `approval.decision=forbidden`。
- raw command 不落盘：只有 `commandRedacted` + `commandHash`。
- 快照有界：默认 maxFiles=20000、maxFileBytes=10MB、skipDirs 生效、不扫工作区外。

### 4.4 P4 审计与回放

- auditLog off：P1/P2/P3 行为不变；无 JSONL/SQLite 写入；`listAudit` fail-closed。
- auditLog on：每次 mutation/exec/rollback 至少一条事件；事件先经 `CodingAuditEventSchema` 校验。
- JSONL append-only：旧记录不改写；单行 JSON + 原子 append；损坏尾行跳过并告警。
- SQLite 可按 session/time/toolName/path/command(redacted) 查询；可从 JSONL 完全重建；SQLite 删除不丢事实。
- `replay(sessionId)` 顺序与真实执行顺序一致（并发 mutation + exec 验证）。
- 落盘失败：schema 非法 fail-closed；JSONL append 失败在 `flush`/`close` 显式抛错并告警；SQLite 索引失败降级告警。
- 异步/批量：`write` 不阻塞主工具调用；`flush`/`close` 排空；批量写入测试覆盖。
- 路径边界：JSONL/SQLite 在 `<openclaw-state>/logs/coding-audit`，不写工作区根目录。
- 分页：`AuditQuery.limit` / `cursor` 有界生效。
- write/edit/apply_patch/exec 对外 TypeBox schema 不变。

### 4.5 P5 Git Checkpoint

- 创建：`git stash create` 风格 temp-index + `write-tree` + `commit-tree` 私有 ref；创建后 index/worktree 零变化；返回 id；可列查。
- restore：修改/删除/新增/嵌套路径全部恢复到 checkpoint；不使用 `git reset --hard` / `git clean -f`。
- 非 git：结构化 `unsupported`，不破坏 P1-P4。
- 并发 restore：串行；一个成功后另一个等待后成功或结构化冲突/超时；最终工作区不混合。
- 冲突/失败：返回结构化错误 + diagnostic，用户内容不静默丢失。
- 嵌套 `.git` / submodule：显式 warning/error + `unsupported`。
- flag off：默认 disabled，不改变既有工具路径，不新增模型 schema。
- 与 journal 区分：git checkpoint 不调用/替代 write-journal 回滚；两条路径不互相污染。

---

## 5. 性能与复杂度复核

- 单文件 write/edit 在 auditLog off/on 的 p50 增量 <50ms，p95 不出现数量级退化（以真实 `FileTransactionService` 集成测试为准）。
- 大文件（≥1MB）apply_patch 无 O(n²) 明显退化；审计落盘不读取文件内容。
- replay 复杂度线性；10,000 条事件回放记录实测时间。
- exec flag on 只增加一次 bounded 快照 + diff；无全盘扫描；审批 O(rules) 且热路径无 IO。
- git checkpoint 不做全树复制；10,000+ 文件真实仓库 create/restore 记录实测时间；restore 锁带超时。
- 非 git checkpoint 场景开销可忽略；git 命令失败 fail-closed。

---

## 6. Residual 判定规则

- `tsgo:core:test` 只允许第 2.5 条列出的 3 个既有 RLG WIP 测试文件错误；不得出现任何 P1-P5 文件。
- `config-schema-parity` 只允许第 2.6 条列出的 `runtime.memory.candidateGeneration`。
- 其他任何非零 exit、失败测试、stall、trailing whitespace、flag 翻转均视为回归，必须停下报告，不得擅自修复无关文件。
- 验收结论不得表述为 UFTK GA / canary / 整体成熟度。

---

## 7. Task Forest 与收尾

- 确认 `TF-0070`~`TF-0074` 全部 done(100%)；无新增未关闭 Coding Runtime 节点。
- 验收结论写入 `docs/dev/handoffs/LATEST.md` 顶部：命令 exit code、P1-P5 矩阵结果、性能实测、tsgo 状态、residual。
- 如全量验收通过，输出 verdict=ACCEPT_WITH_RESIDUAL（允许的 residual）或 ACCEPT（无 residual）；用户确认前不修改 task forest。
- 不创建新的 TF 节点，不启动 P6 或 Coding Runtime 之外的工作。

---

## 8. 硬性禁止

- 不 checkout / reset / clean / 提交无关 WIP。
- 不 flip 任何 UFTK flag 或产品锁。
- 不新增第二套审计 sink/锁/队列/journal；不让 SQLite 成为无法从 JSONL 重建的权威真源。
- 不使用 `git reset --hard`、`git clean -f` 等不可逆命令作为 restore 手段。
- 不改变 write / edit / apply_patch / exec 模型对外 schema。
- 不修复无关既有错误；不把本地绿灯表述为 UFTK GA、canary 或整体成熟度结论。
