# Coding Runtime P3 证据报告（2026-08-17）

> 状态：P3 开发已交付自检完成；TF-0072=review_needed(90%)，等待独立验收。
> 本报告不是 UFTK GA / canary / 整体成熟度结论。

## 0. 起始信息

- 工作区：`D:\ClawX`（repo root）
- HEAD：`734ec877e75682861103660fbdea2bd55253ece0`
- 工作分支：`main`；未 checkout / reset / clean；工作树仍含大量既有 WIP
- 前置状态：`TF-0070`=done(100%)；`TF-0071`=done(100%)；`TF-0072` 已创建：in_progress -> review_needed(90%)
- 验收对象：`docs/dev/coding-runtime-development-spec.md` Phase 3 + 7.2/7.4
- 产品锁：liveReady=false、productApproved=false、defaultOn=false
- 关键 flag：`runtime.coding.uftk.enabled=false`；`runtime.coding.uftk.execSideEffects.enabled=false`；`runtime.coding.uftk.commandApproval.enabled=false`

## 1. P3 交付物

| 交付物 | 路径 | 状态 |
|---|---|---|
| exec 前后工作区指纹快照 + side-effect diff | `openclaw_runtime/src/agents/coding-runtime/exec-audit.ts` | 已存在并有测试 |
| 命令前缀 Allow/Prompt/Forbidden 策略 | `openclaw_runtime/src/agents/coding-runtime/command-approval-policy.ts` | 已存在并有测试 |
| 统一内存审计流 | `openclaw_runtime/src/agents/coding-runtime/audit-sink.ts` | 已存在并有测试 |
| bash-tools.exec.ts 接入 | `openclaw_runtime/src/agents/bash-tools.exec.ts` | 已接入并有集成测试 |
| flag/config | `coding-runtime-flags.ts` + `types.openclaw.ts` + `zod-schema.ts` + `runtime-feature-leaves.ts` | 已同步，默认 false |
| 契约补充 | `shared/coding-runtime/types.ts` / `schema.ts` / `README.md` / `MIGRATION.md` | P3 章节已写 |

关键实现约束复核：

- exec 事件不包含 raw command；仅 `commandRedacted`（redactSensitiveText tools 模式）+ sha256 `commandHash`。
- 工作区快照为 bounded：默认 maxFiles=20000、maxFileBytes=10MB，跳过 `.git`/`node_modules` 等目录；不扫工作区外。
- 命令审批策略：最长前缀优先，大小写/空白归一化；默认决策 `prompt`（fail-closed）；`forbidden` 在 bash-tools.exec.ts 前置阻断并记录 `denied` 事件。
- 统一审计 sink 为内存实现；未新增 SQLite/JSONL 落盘，Phase 4 再落盘。
- `approval-pending` / `approval-unavailable` 不记录 exec 事件（命令尚未实际执行）。

## 2. 必跑命令与 exit code（自检复跑）

| 命令 | Exit | 结果 |
|---|---:|---|
| `pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1` | 0 | 1 file / 8 tests PASS |
| runtime 定向 15 文件（显式列出，`vitest.agents.config.ts`）`--maxWorkers=1` | 0 | 15 files / 148 tests PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1` | 0 | 1 file / 4 tests PASS |
| `pnpm run typecheck:node` | 0 | PASS |
| `pnpm run typecheck:web` | 0 | PASS |
| `pnpm contract:check` | 0 | Contract check passed |
| `pnpm run lint:bom` | 0 | check-no-bom: ok |
| `git diff --check -- <P3 tracked 文件列表>` | 0 | clean；新文件无行尾空白 |
| `pnpm verseshell:test` | 0 | bundle 13/13 + runtime-bundle 11/11 + runtime 15 files/141 tests + MCP 11/11 |
| `pnpm --dir openclaw_runtime tsgo:core` | 0 | PASS |
| `pnpm --dir openclaw_runtime tsgo:core:test` | 2 | **residual**：仅既有未跟踪 RLG WIP 文件 `session-drain-service.test.ts`、`session-reset-service.stop.test.ts`、`session-reset-service.subagent-stop.test.ts`；无 P3 文件 |

runtime 定向 15 文件实际为：

```text
src/agents/coding-runtime/file-lock-manager.test.ts
src/agents/coding-runtime/turn-diff.test.ts
src/agents/coding-runtime/file-transaction-service.test.ts
src/agents/coding-runtime/file-transaction-service.concurrency.test.ts
src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts
src/agents/coding-runtime/command-approval-policy.test.ts
src/agents/coding-runtime/exec-audit.test.ts
src/agents/coding-runtime/exec-audit.tool-integration.test.ts
src/agents/tools/write-journal.test.ts
src/agents/sessions/tools/write.test.ts
src/agents/sessions/tools/edit.test.ts
src/agents/apply-patch.test.ts
src/agents/dcs-producer-envelope.test.ts
src/agents/bash-tools.exec.resolve-env.test.ts
src/agents/rc04-exec-approval-wiring.test.ts
```

## 3. P3 功能矩阵

- [x] `captureWorkspaceSnapshot` 生成 workspace-relative 文件指纹（hash/mtime/size）。
- [x] `diffWorkspaceSnapshots` 生成 added / modified / deleted 三类 side-effect。
- [x] `buildCodingExecEvent` 通过 `CodingExecEventSchema` 校验；无 `command` 字段。
- [x] `command-approval-policy` 支持前缀 token 规则；最长前缀优先；默认 prompt。
- [x] `ExecAuditor.recordExecEvent` 写入统一内存 audit sink；`InMemoryCodingAuditSink.query` 可按 session 过滤。
- [x] `bash-tools.exec.ts` 集成：forbidden 前置阻断 + denied 事件；completed/failed/running 记录事件。
- [x] 新 flag 默认 false：`isCodingExecSideEffectsEnabled()`=false、`isCodingCommandApprovalEnabled()`=false。
- [x] `write` / `edit` / `apply_patch` 对外 TypeBox schema 不变；`exec` 对外 schema 不变。

## 4. tsgo residual

`pnpm --dir openclaw_runtime tsgo:core` exit 0。

`pnpm --dir openclaw_runtime tsgo:core:test` exit 2，错误文件：

- `src/gateway/session-drain-service.test.ts`
- `src/gateway/session-reset-service.stop.test.ts`
- `src/gateway/session-reset-service.subagent-stop.test.ts`

以上 3 个文件均为既有未跟踪 WIP（Runtime Lifecycle Governance 相关工作），不属于 P3 变更。P3 文件不在错误列表中。

## 5. 已知预存失败（非 P3）

`tests/unit/config-schema-parity.test.ts` 失败，原因：`runtime.memory.candidateGeneration` 存在于 zod-schema.ts，但不存在于 types.openclaw.ts / runtime-feature-leaves.ts。该 mismatch 在 HEAD 已存在，非 P3 引入，未修。

## 6. 产品锁与默认关闭复核

- `runtime.coding.uftk.enabled` = false。
- `runtime.coding.uftk.execSideEffects.enabled` = false。
- `runtime.coding.uftk.commandApproval.enabled` = false。
- shared `DEFAULT_CODING_RUNTIME_FLAGS` 5 项全 false。
- liveReady=false、productApproved=false、defaultOn=false。

## 7. Task Forest 收尾

- `TFP-coding-runtime-p3-start-20260817`：proposal-save → validate → proposal-apply --yes → export 全通过；`TF-0072` 创建为 in_progress(5%)。
- `TFP-coding-runtime-p3-review-needed-20260817`：proposal-save → validate → proposal-apply --yes → export 全通过；`TF-0072` 置 review_needed(90%)。
- 当前 `TF-0072`：review_needed(90%)，child_of `TF-0010`，depends_on `TF-0071`；未置 done。
- 下一次独立验收通过且用户确认后，才允许 TF-0072 done 和讨论 P4。

## 8. 硬性禁止复核

- 未进入 P4/P5 设计或实现。
- 未 flip `runtime.coding.uftk.enabled`、`execSideEffects.enabled`、`commandApproval.enabled` 或任何产品锁。
- 未新增第二套锁/队列/journal/SQLite/JSONL 审计存储。
- 未改变 write/edit/apply_patch/exec 模型对外 schema。
- 未清理或提交无关 WIP。
- 未把 P1/P2/P3 本地绿灯表述为 UFTK GA / canary / 整体成熟度结论。
