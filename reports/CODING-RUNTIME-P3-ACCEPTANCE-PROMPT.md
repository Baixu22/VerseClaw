# Coding Runtime P3 独立验收提示词（2026-08-17）

> 本提示词只做 P3 验收：Shell 副作用审计与命令级审批。P3 验收通过且用户确认前，不得进入 P4/P5，不得把 P1/P2/P3 绿灯表述为 UFTK GA 或 canary。

## 0. 起始信息（执行前先填空）

- 工作区：D:\ClawX（repo root）
- HEAD：<执行 `git rev-parse HEAD` 后填写>（当前基线为 `734ec877e75682861103660fbdea2bd55253ece0`）
- 工作分支：main；脏工作树大量既有 WIP，禁止 checkout/reset/cleanup
- 前置状态：P1 verdict=ACCEPT；P2 verdict=ACCEPT_WITH_RESIDUAL 且用户已确认；`TF-0070`=done(100%)；`TF-0071`=done(100%)
- 待验收节点：`TF-0072`=review_needed(90%)，child_of `TF-0010`，depends_on `TF-0071`
- 验收对象：`docs/dev/coding-runtime-development-spec.md` Phase 3 + 7.2/7.4
- 产品锁：liveReady=false、productApproved=false、defaultOn=false
- 关键 flag：`runtime.coding.uftk.enabled` 仍为 false；`runtime.coding.uftk.execSideEffects.enabled` 默认 false；`runtime.coding.uftk.commandApproval.enabled` 默认 false

## 1. 只读必读（先读，再写任何结论）

按顺序读：

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `docs/dev/coding-runtime-development-spec.md`（重点 Phase 3、7.2 审计/性能强制项、7.4 DoD）
4. `docs/dev/handoffs/LATEST.md`（顶部 Coding Runtime P3 段落）
5. `reports/CODING-RUNTIME-P1-ACCEPTANCE-2026-08-17.md`
6. `reports/CODING-RUNTIME-P2-EVIDENCE-2026-08-17.md`
7. `reports/CODING-RUNTIME-P3-EVIDENCE-2026-08-17.md`
8. `shared/coding-runtime/types.ts` / `schema.ts` / `README.md` / `MIGRATION.md`
9. `openclaw_runtime/src/agents/coding-runtime/exec-audit.ts`
10. `openclaw_runtime/src/agents/coding-runtime/command-approval-policy.ts`
11. `openclaw_runtime/src/agents/coding-runtime/audit-sink.ts`
12. `openclaw_runtime/src/agents/coding-runtime/*.test.ts`（P3 相关三个测试）
13. `openclaw_runtime/src/agents/bash-tools.exec.ts`（ExecAuditor 接入段）
14. `openclaw_runtime/src/agents/bash-tools.exec-types.ts`
15. `openclaw_runtime/src/context-engine/coding-runtime-flags.ts`
16. `openclaw_runtime/src/config/types.openclaw.ts` / `zod-schema.ts` / `runtime-feature-leaves.ts`
17. 现有测试：coding-runtime 全部测试、bash-tools.exec.resolve-env、rc04-exec-approval-wiring、dcs-prod-flags-catalog

## 2. 预检（先做，不猜）

1. 记录 `git rev-parse HEAD` 与 `git status --short`。
2. 确认 `runtime.coding.uftk.enabled=false`；`runtime.coding.uftk.execSideEffects.enabled=false`；`runtime.coding.uftk.commandApproval.enabled=false`；shared 5 个 UFTK flag 全 false。
3. 确认 `TF-0070`、`TF-0071` 为 done；`TF-0072` 为 review_needed(90%)，且未 done。
4. 若发现 P1/P2 回归、第二套审计 sink/锁/队列/journal、SQLite/JSONL 审计落盘、新的默认开启行为：停下并报告。
5. tsgo 基线：`tsgo:core` 应 exit 0；`tsgo:core:test` 当前存在既有未跟踪 RLG WIP 类型错误（session-drain-service.test.ts、session-reset-service.stop.test.ts、session-reset-service.subagent-stop.test.ts），无 P3 文件。验收时不得把该 residual 算作 P3 缺陷，但也不得擅自修复无关文件。
6. `tests/unit/config-schema-parity.test.ts` 当前因预存 `runtime.memory.candidateGeneration`（zod 有、type/leaves 无）失败；该失败在 HEAD 已存在，非 P3 引入。验收时只允许该预存原因，不修。

## 3. 必跑命令（逐条记录 exit code；P3 验收通过前全部要 0 或按第 2.5/2.6 条记录 residual）

```bash
pnpm exec vitest run tests/unit/coding-runtime-contract.test.ts --maxWorkers=1

pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts   src/agents/coding-runtime/file-lock-manager.test.ts   src/agents/coding-runtime/turn-diff.test.ts   src/agents/coding-runtime/file-transaction-service.test.ts   src/agents/coding-runtime/file-transaction-service.concurrency.test.ts   src/agents/coding-runtime/file-transaction-service.tool-integration.flag-matrix.test.ts   src/agents/coding-runtime/command-approval-policy.test.ts   src/agents/coding-runtime/exec-audit.test.ts   src/agents/coding-runtime/exec-audit.tool-integration.test.ts   src/agents/tools/write-journal.test.ts   src/agents/sessions/tools/write.test.ts   src/agents/sessions/tools/edit.test.ts   src/agents/apply-patch.test.ts   src/agents/dcs-producer-envelope.test.ts   src/agents/bash-tools.exec.resolve-env.test.ts   src/agents/rc04-exec-approval-wiring.test.ts   --maxWorkers=1

pnpm --dir openclaw_runtime exec vitest run src/context-engine/dcs-prod-flags-catalog.test.ts --config test/vitest/vitest.config.ts --maxWorkers=1

pnpm run typecheck:node
pnpm run typecheck:web
pnpm contract:check
pnpm run lint:bom
git diff --check -- <P3 tracked 变更文件列表>
pnpm verseshell:test
pnpm --dir openclaw_runtime tsgo:core
pnpm --dir openclaw_runtime tsgo:core:test
```

tsgo 规则：P3 文件在错误列表中必须修复；无关既有错误不得擅自修复，记 residual 并等待用户授权（当前已修复的基线应保持 0）。

## 4. 必须测试的 P3 矩阵（不写码验收，不靠嘴说）

- exec flag off：`createExecTool` 行为与 P1/P2 时一致，不产生 CodingExecEvent，不做工作区快照
- execSideEffects flag on：每次终端 exec（completed/failed/running）产生一条 `CodingExecEvent`；sideEffects 能检测 added / modified / deleted
- commandApproval flag on：前缀规则 Allow / Prompt / Forbidden 分类正确；最长前缀优先；默认 prompt；大小写/空白归一化
- forbidden 命令：执行前阻断，目标零变化（不 spawn），记录 `status=denied` + `approval.decision=forbidden`
- raw command 不落盘：事件中无 `command` 字段，只有 `commandRedacted` + `commandHash`
- 统一审计流：`InMemoryCodingAuditSink` 可写、可按 session/query 过滤；禁用 auditor 时不伪造事件
- 工作区快照有界：maxFiles / maxFileBytes / skipDirs 生效，不扫工作区外
- 模型对外 schema 不变：`write` / `edit` / `apply_patch` / `exec` 对外 TypeBox schema 不变
- P1/P2 回归矩阵全部通过（含在 15 文件定向测试中）

## 5. 性能与复杂度复核

- execSideEffects flag off / on 的 exec 增量：以 `exec-audit.tool-integration.test.ts` 中真实 `createExecTool` 执行为准，flag on 增加一次 bounded 快照 + diff + 内存 sink 写入；不得引入全盘扫描。
- 快照上限：默认 `maxFiles=20000`、`maxFileBytes=10MB`；超过即截断或降级 hash。
- 命令审批策略评估为 O(rules) 前缀匹配，且规则数预期为个位数；不在 exec 热路径做 IO。
- forbidden 路径在 spawn 前返回，不启动子进程。

## 6. Task Forest 与收尾

- 确认 `TF-0072` 状态为 review_needed（约 90%），未置 done。
- 确认 `reports/CODING-RUNTIME-P3-EVIDENCE-2026-08-17.md` 存在且内容可复核。
- 验收结论写入 `docs/dev/handoffs/LATEST.md` 顶部：P3 交付内容、测试命令 exit code、P3 矩阵结果、tsgo 状态；明确 P3 独立验收结论，P4 未解锁。
- 只有验收通过且用户明确确认后，才允许 `TF-0072` done 和讨论 P4。

## 7. 硬性禁止

- 不进入 P4 / P5 设计或实现
- 不 flip `runtime.coding.uftk.enabled`、`execSideEffects.enabled`、`commandApproval.enabled` 或任何产品锁
- 不新增 SQLite/JSONL 审计落盘、第二套审计 sink/锁/队列/journal
- 不改变 write / edit / apply_patch / exec 模型对外 schema
- 不清理或提交无关 WIP
- 不把 P1/P2/P3 本地绿灯表述为 UFTK GA、canary 或整体成熟度结论
