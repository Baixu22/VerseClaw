# Coding Runtime P1 独立验收提示词（可复制给下一会话 / Agent）

> 本提示词只做验收，不做 P2。验收未通过或未获用户 residual 批准前，
> `TF-0070` 保持 `review_needed`，不得进入 P2 讨论或实现。

## 0. 起始信息（执行前先填空）

- 工作区：D:\ClawX（repo root）
- 起始提交 / HEAD：<执行 `git rev-parse HEAD` 后填写>
- 工作分支：main（脏工作树大量既有 WIP，禁止 checkout/reset/清理）
- 验收对象：`docs/dev/coding-runtime-development-spec.md` Phase 1
- 待验收节点：`TF-0070`（`review_needed`，90%）
- 实现证据：`reports/CODING-RUNTIME-P1-EVIDENCE-2026-08-16.md`
- 产品锁：liveReady=false、productApproved=false、defaultOn=false；不得讨论 GA
- 关键 flag：`runtime.coding.uftk.enabled` 必须仍为 false

## 1. 只读必读（先读，再写验收记录）

按顺序读：

1. `AGENTS.md`（仓库根）
2. `docs/dev/coding-runtime-development-spec.md`（只看 Phase 0/1 与 7.2 强制验收）
3. `reports/CODING-RUNTIME-P1-EVIDENCE-2026-08-16.md`
4. `docs/dev/handoffs/LATEST.md`（顶部 Coding Runtime P1 段落）
5. `shared/coding-runtime/types.ts` / `schema.ts` / `README.md` / `MIGRATION.md`
6. `tests/unit/coding-runtime-contract.test.ts`
7. `openclaw_runtime/src/agents/coding-runtime/*.ts`
8. `openclaw_runtime/src/agents/tools/write-journal.ts`
9. `openclaw_runtime/src/agents/sessions/tools/write.ts`、`edit.ts`
10. `openclaw_runtime/src/agents/apply-patch.ts`、`apply-patch-preflight.ts`
11. `openclaw_runtime/src/context-engine/coding-runtime-flags.ts`

## 2. 预检（先做，不猜）

1. 记录 `git status --short` 和 `git rev-parse HEAD`。
2. 确认本次 P1 变更集只包含以下路径（不允许新增无关 diff）：

```text
openclaw_runtime/src/agents/coding-runtime/**
openclaw_runtime/src/agents/tools/write-journal.ts
openclaw_runtime/src/agents/tools/write-journal.test.ts
openclaw_runtime/src/agents/apply-patch-preflight.ts
openclaw_runtime/src/agents/apply-patch.ts
openclaw_runtime/src/agents/sessions/tools/write.ts
openclaw_runtime/src/agents/sessions/tools/edit.ts
openclaw_runtime/src/agents/sessions/tools/edit-diff.ts
openclaw_runtime/src/agents/agent-tools.ts
openclaw_runtime/src/agents/agent-tools.read.ts
openclaw_runtime/src/context-engine/coding-runtime-flags.ts
openclaw_runtime/src/context-engine/coding-observability.ts
openclaw_runtime/src/context-engine/runtime-flag-ack.ts
openclaw_runtime/src/context-engine/dcs-prod-flags-catalog.test.ts
shared/coding-runtime/**
tests/unit/coding-runtime-contract.test.ts
docs/dev/coding-runtime-development-spec.md
docs/dev/handoffs/LATEST.md
reports/CODING-RUNTIME-P1-*.md
.agent-workbench/task-forest/**（仅 TF-0070 / TFP-coding-runtime-p1-*）
```

3. 若发现 write/edit/apply_patch 之外的第二套写路径、第二套 journal、SQLite/JSONL
   审计存储，或 P1 引入了新的默认开启行为：立即停下，判 REJECT 并报告。

## 3. 必须执行的验证命令（逐条记录 exit code）

根目录：

```bash
pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1
pnpm run typecheck:node
pnpm run typecheck:web
pnpm contract:check
pnpm run lint:bom
git diff --check -- <P1 tracked 变更文件列表>
```

runtime 定向（显式列出全部 9 个文件，不要用 glob，避免 Windows 展开差异）：

```bash
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts \
  src/agents/coding-runtime/atomic-write.test.ts \
  src/agents/coding-runtime/file-transaction-service.test.ts \
  src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts \
  src/agents/coding-runtime/rollback-preview.test.ts \
  src/agents/tools/write-journal.test.ts \
  src/agents/sessions/tools/write.test.ts \
  src/agents/sessions/tools/edit.test.ts \
  src/agents/apply-patch.test.ts \
  src/agents/dcs-producer-envelope.test.ts \
  --maxWorkers=1
```

可选但建议：

```bash
pnpm verseshell:test
pnpm --dir openclaw_runtime tsgo:core
pnpm --dir openclaw_runtime tsgo:core:test
```

tsgo 判定规则（重要）：

- 若 `tsgo:core` / `tsgo:core:test` 失败，逐条检查错误文件。
- 错误文件若在 P1 变更集内：判 REJECT，必须修复后才能继续。
- 错误文件若不在 P1 变更集内（已知基线：`shared/verseshell/extraction.ts`、
  `shared/verseshell/facade.ts`，以及若干既有无关测试文件）：不得擅自修复；
  记录为 `P1_RESIDUAL_TSGO_BASELINE`，最终 verdict 只能给
  `ACCEPT_WITH_RESIDUAL`，不能给 `ACCEPT`。`TF-0070` done 必须等待用户明确
  接受该 residual 或另行授权修复。

## 4. 验收矩阵核对（不写码，只核对测试与磁盘）

### 4.1 功能

- [ ] `FileTransactionService` 实现 P0 接口并有测试覆盖
- [ ] flag on 时 write / edit / apply_patch / delete / move 全部进入统一 journal
- [ ] 每个 mutation 可按 batchId 单回滚；共享 batchId 可批量回滚
- [ ] `previewRollback(batchId)` 返回 unified diff 且不改磁盘/journal
- [ ] 非 git 目录完整回滚
- [ ] 原子写失败不留半文件
- [ ] `listAudit` fail-closed，不返回伪造空页

### 4.2 回滚强制场景

- [ ] 写入 -> 修改 -> 回滚，与写入前字节一致
- [ ] 删除文件后可恢复
- [ ] 移动文件后可恢复原路径与内容（含 destination 原先存在）
- [ ] apply_patch 提交后可回滚
- [ ] 回滚失败返回结构化 `recovery_required` + `recoveryRef`，journal 保留

### 4.3 Fail-closed 与兼容

- [ ] flag on 时 snapshot/journal 失败 -> mutation 失败，目标文件零变化
- [ ] flag off 时现有 write-journal fail-open 行为不回退
- [ ] write / edit / apply_patch 对外 TypeBox schema 不变
- [ ] DCS `details.working_memory` 成功/失败语义未被吞掉或改写
- [ ] `isCodingUftkEnabled()` 默认 false；shared 默认 flag 仍全 false

### 4.4 性能证据

- [ ] write 单文件绝对增量 < 50ms（实现证据：+3.88ms）
- [ ] edit 单文件绝对增量 < 50ms（实现证据：+3.99ms）
- [ ] ≥1MB apply_patch 无 O(n²) 退化（实现证据：1.07MB 线性耗时）

## 5. 完成后动作（只有 ACCEPT 或用户批准 ACCEPT_WITH_RESIDUAL 才做）

1. 创建并应用 Task Forest closeout proposal：
   - `action: set_status`，`id: TF-0070`，`status: done`，`progress: 100`
   - evidence 填本次验收命令、exit code、验收结论
   - 先 `proposal-save`，再 `validate`，再 `proposal-apply --yes`，再 `export`
2. 更新 `docs/dev/handoffs/LATEST.md` 顶部：P1 验收结论、TF-0070 done、
   是否含 tsgo residual、明确“P2 是否解锁由用户决定”。
3. 生成 `reports/CODING-RUNTIME-P1-ACCEPTANCE-<日期>.md`，逐条记录：
   - HEAD / 工作树状态
   - 每条命令 exit code
   - 回滚矩阵、fail-closed、flag off/on 矩阵结果
   - 性能复测或证据复核结果
   - 最终 verdict：`ACCEPT` / `ACCEPT_WITH_RESIDUAL` / `REJECT`

## 6. 硬性禁止

- 不修改 P1 代码，除非验收失败且用户明确授权修复
- 不修 tsgo 报错中的无关文件（除非用户明确授权）
- 不 flip `runtime.coding.uftk.enabled` 或任何产品锁
- 不清理/提交无关 WIP
- 不进入 P2 / P3 / P4 / P5 设计或实现
- 不把本地 P1 绿灯表述为 UFTK GA、canary 或整体成熟度结论

## 7. 验收结论口径

- `ACCEPT`：第 3 节全部命令 exit 0，第 4 节全部勾选。
- `ACCEPT_WITH_RESIDUAL`：仅存在第 3 节 tsgo 判定规则定义的基线 residual，
  其余全部通过。
- `REJECT`：任一 P1 变更集内测试/类型/契约失败，或功能/回滚/fail-closed
  矩阵出现反例。

只有用户对 verdict 明确确认后，P1 才视为验收完成；之后才允许讨论是否进入 P2。
