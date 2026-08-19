# Coding Runtime P4 证据报告（2026-08-17）

> 状态：P4 开发已交付自检完成；TF-0073=review_needed(90%)，等待独立验收。P5 未解锁。
> 本报告不是 UFTK GA / canary / 整体成熟度结论。

## 0. 起始信息

- 工作区：`D:\ClawX`（repo root）
- HEAD：`734ec877e75682861103660fbdea2bd55253ece0`
- 工作分支：`main`；未 checkout / reset / clean；工作树仍含大量既有 WIP
- 前置状态：`TF-0070`=done(100%)；`TF-0071`=done(100%)；`TF-0072`=done(100%)
- 待验收节点：`TF-0073`=review_needed(90%)，child_of `TF-0010`，depends_on `TF-0072`，未 done
- 验收对象：`docs/dev/coding-runtime-development-spec.md` Phase 4 + 7.2/7.4
- 产品锁：liveReady=false、productApproved=false、defaultOn=false
- 关键 flag：`runtime.coding.uftk.enabled=false`；`runtime.coding.uftk.auditLog.enabled=false`；`runtime.coding.uftk.execSideEffects.enabled=false`；`runtime.coding.uftk.commandApproval.enabled=false`；`runtime.coding.uftk.baseVersionGuard.enabled=false`；shared 5 个 UFTK flag 全 false

## 1. P4 交付物

| 交付物 | 路径 | 状态 |
|---|---|---|
| 统一审计 sink 接口 + 内存实现 | `openclaw_runtime/src/agents/coding-runtime/audit-sink.ts` | 已扩展 `flush`/`close`/`CodingAuditQuerySink`，仍是唯一审计 sink 边界 |
| JSONL append-only 审计日志 + 持久 sink | `openclaw_runtime/src/agents/coding-runtime/audit-log.ts` | 新增并有测试 |
| SQLite 可重建查询索引 | `openclaw_runtime/src/agents/coding-runtime/audit-index.ts` | 新增并有测试 |
| 会话回放 | `openclaw_runtime/src/agents/coding-runtime/replay.ts` | 新增并有测试 |
| FTS 接入 durable sink | `openclaw_runtime/src/agents/coding-runtime/file-transaction-service.ts` | `auditLogSink` 选项；commit/rollback 写事件；`listAudit` 有 sink 查询、无 sink fail-closed |
| exec 接入 durable sink | `openclaw_runtime/src/agents/bash-tools.exec.ts` / `agent-tools.ts` | auditLog flag 使 ExecAuditor 在 auditLog on 时启用；`sideEffectsEnabled` 显式透传 |
| flag/config 同步 | `types.openclaw.ts` / `zod-schema.ts` / `runtime-feature-leaves.ts` / `coding-runtime-flags.ts` | 新增 `runtime.coding.uftk.auditLog.enabled`，默认 false |
| 契约文档 | `shared/coding-runtime/README.md` / `MIGRATION.md` | P4 章节已写 |

关键实现约束复核：

- `PersistentCodingAuditSink.write` 先 `assertCodingAuditEvent`（fail-closed schema 校验）再异步入队 JSONL + SQLite；不阻塞主工具调用。
- JSONL append-only：每事件单行 JSON，旧记录绝不改写；损坏尾行跳过并告警。
- SQLite 索引是 JSONL 的可重建投影；`query` 在 SQLite 为空而 JSONL 有事件时自动从 JSONL 重建。
- raw command 不落盘：`commandRedacted` + `commandHash` 进入 SQLite 命令过滤列；JSONL 无 `command` 字段。
- JSONL/SQLite 目录默认位于 `<openclaw-state>/logs/coding-audit`，不写入工作区根目录。
- 未新增第二套审计 sink/锁/队列/journal；文件状态真源仍是文件系统 + write-journal。

## 2. 必跑命令与 exit code（自检复跑）

| 命令 | Exit | 结果 |
|---|---:|---|
| `pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1` | 0 | 1 file / 8 tests PASS |
| runtime 定向 18 文件（显式列出，`vitest.agents.config.ts`）`--maxWorkers=1` | 0 | 18 files / 162 tests PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1` | 0 | 1 file / 4 tests PASS |
| `pnpm run typecheck:node` | 2 | **residual**：仅既有脏 WIP `openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts` 与未跟踪 `session-delete-operation-journal.ts` 类型错误；无 P4 文件。未授权前不修。 |
| `pnpm run typecheck:web` | 0 | PASS |
| `pnpm contract:check` | 0 | Contract check passed |
| `pnpm run lint:bom` | 0 | check-no-bom: ok |
| `git diff --check -- <P4 tracked 变更文件列表>` | 0 | clean；新文件无行尾空白 |
| `pnpm verseshell:test` | 0 | bundle 13/13 + runtime-bundle 11/11 + runtime 15 files/141 tests + MCP 11/11 |
| `pnpm --dir openclaw_runtime tsgo:core` | 2 | **residual**：仅既有未跟踪脏 WIP `session-delete-operation-journal.ts` 类型错误；无 P4 文件。 |
| `pnpm --dir openclaw_runtime tsgo:core:test` | 2 | **residual**：既有脏 WIP（sessions.lifecycle.ts / session-delete-operation-journal.ts）+ 既有 RLG WIP 测试（session-drain-service.test.ts / session-reset-service.stop.test.ts / session-reset-service.subagent-stop.test.ts）；无 P4 文件。 |

预存失败复核：`tests/unit/config-schema-parity.test.ts` 复跑 exit 1，失败原因仍为 `runtime.memory.candidateGeneration`（zod 有、type/leaves 无）；本次新增 `runtime.coding.uftk.auditLog.enabled` 未出现在 unknown 列表，非 P4 引入，未修。

runtime 定向 18 文件实际为：

```text
src/agents/coding-runtime/file-lock-manager.test.ts
src/agents/coding-runtime/turn-diff.test.ts
src/agents/coding-runtime/file-transaction-service.test.ts
src/agents/coding-runtime/file-transaction-service.concurrency.test.ts
src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts
src/agents/coding-runtime/command-approval-policy.test.ts
src/agents/coding-runtime/exec-audit.test.ts
src/agents/coding-runtime/exec-audit.tool-integration.test.ts
src/agents/coding-runtime/audit-log.test.ts
src/agents/coding-runtime/audit-index.test.ts
src/agents/coding-runtime/replay.test.ts
src/agents/tools/write-journal.test.ts
src/agents/sessions/tools/write.test.ts
src/agents/sessions/tools/edit.test.ts
src/agents/apply-patch.test.ts
src/agents/dcs-producer-envelope.test.ts
src/agents/bash-tools.exec.resolve-env.test.ts
src/agents/rc04-exec-approval-wiring.test.ts
```

## 3. P4 矩阵结果（逐项实测，不靠嘴说）

- auditLog flag off：无 JSONL/SQLite 写入；`FileTransactionService` 不配置 `auditLogSink` 时 `listAudit` 仍 fail-closed 抛 `E_AUDIT_WRITE_FAILED`，不返回伪造空页（`audit-log.test.ts` 覆盖）。
- auditLog flag on：FTS commit 写 mutation 事件、rollback 写 rollback 事件；ExecAuditor 通过统一 sink 写 exec 事件；事件均先经 `CodingAuditEventSchema` 校验（`assertCodingAuditEvent`）后才入队落盘。
- 统一落盘：JSONL/SQLite 仅通过 `audit-sink.ts` 的 `PersistentCodingAuditSink` 实现；未出现第二套审计 sink/队列/journal。
- JSONL append-only：`JsonlCodingAuditStore` 使用 append 写单行 JSON；旧记录绝不改写（测试比对首行 JSON 不变）；损坏尾行跳过并告警（`audit-log.test.ts` 覆盖）。
- SQLite 索引：可按 session / 时间 / toolName / path / command（redacted）查询；`rebuildFromEvents` 可从 JSONL 完全重建；删除 SQLite 后 `query` 自动从 JSONL 重建，不丢审计事实（`audit-index.test.ts` / `audit-log.test.ts` 覆盖）。
- 回放顺序：`replay(sessionId, jsonlStore)` 返回 JSONL append 顺序；`replay.test.ts` 用并发 mutation + exec 写入持久 sink 验证顺序与真实写入调用顺序一致。
- raw command 不落盘：JSONL 与 SQLite 中均无 raw command；只有 `commandRedacted` + `commandHash`；contract 测试拒绝带 `command` 的 exec 事件。
- 事件落盘失败：选择显式降级 + warning。`PersistentCodingAuditSink.write` 对 schema 非法事件 fail-closed 同步抛错；JSONL append 失败在 `flush`/`close` 显式抛错并告警；SQLite 索引写入失败降级告警（JSONL 权威可重建）。测试覆盖同步校验拒绝与 append 失败 `flush` 拒绝。
- 异步/批量：`write` 入队后立即返回，不阻塞主工具调用；`flush` 排空队列；测试批量写入 25 条并 flush 后 JSONL 行数与 SQLite 查询一致。
- 路径边界：`resolveCodingAuditLogDir` 默认 `<openclaw-state>/logs/coding-audit`；测试显式用 `OPENCLAW_STATE_DIR` 验证，不写入工作区根目录。
- 查询分页：`AuditQuery.limit` / `cursor` 生效；SQLite 查询 `LIMIT limit+1` 有界返回，`nextCursor` 为最后 seq（`audit-index.test.ts` 覆盖）。
- 模型对外 schema 不变：`write` / `edit` / `apply_patch` / `exec` 对外 TypeBox schema 未变（本阶段未触碰模型 schema；P3 已有验证保持）。
- P1/P2/P3 回归矩阵：全部包含在 18 文件定向测试中，162 tests PASS。

## 4. 性能与复杂度复核

- 单文件 write prepare+commit：auditLog off p50=6.802ms / p95=11.118ms；auditLog on p50=15.625ms / p95=20.967ms（增量 +8.8ms p50，< 50ms；真实 `FileTransactionService` 集成测量，30 次取 p50/p95）。
- 审计写入为异步入队 + 批量 append；`write` 不等待磁盘落盘，`flush` 有明确排空语义。
- SQLite 索引写入在队列中异步执行；查询走索引 `WHERE ... ORDER BY timestamp_ms, seq LIMIT ?`，单次结果有界。
- 大文件 apply_patch：P4 未改变 apply_patch 预检/应用路径；审计落盘只写事件 JSON，不读取文件内容。
- replay 复杂度与事件数线性；10,000 条事件回放实测约 130ms（`replayCodingSession`）。

## 5. Task Forest 与收尾

- `TF-0073`=review_needed(90%)，child_of `TF-0010`，depends_on `TF-0072`，未置 done。
- `TFP-coding-runtime-p4-start-20260817` 与 `TFP-coding-runtime-p4-review-needed-20260817` 已 save → validate → apply → export。
- `docs/dev/handoffs/LATEST.md` 顶部已写入 P4 交接段。
- 独立验收通过且用户明确确认前，不置 `TF-0073` done，不启动 P5。
