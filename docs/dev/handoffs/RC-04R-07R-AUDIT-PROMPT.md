# RC-04R → RC-07R 开发成果独立审计提示词（AUDIT PROMPT）

> 用途：交给**另一位独立 agent（审计者 / Verifier）**对本会话（2026-08-05）完成的 RC-04R、RC-05R、RC-06AR、RC-06BR、RC-06CR、RC-06DR、RC-07R 七个包的完整开发成果进行审计与独立复现。
> 审计者身份要求：与实现者不同（不同 actor）；若执行正式验收需双 detached worktree + 唯一 output dir；**复用本会话任何 evidence 一律拒绝**（本会话全部结论仅为"本地实现与门禁证据"）。
> 前置状态红线：F4 未关闭；`STATUS.md.accepted_work_packages` 保持空；RC-10 blocked；product locks 全 false（`liveReady/productApproved/defaultOn=false`）。审计不得修改这些状态，不得调用真实 provider/channel。

---

## 0. 审计背景与任务来源

- 原始开发任务提示词：`docs/dev/handoffs/RC-04-07-DEVELOPMENT-PROMPT.md`（含每包开发任务、反例测试、验收命令、退出条件）。
- 前置包（RC-01R/02R/03R）本地门禁全绿但**未 accepted**；F4（独立验收基础设施）未恢复，本会话按用户授权的"本地实现与门禁证据"口径推进。
- 每包 spec（审计者必须逐包阅读并验证）：
  - `harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md`
  - `harness/specs/tasks/rc05-minimal-operator-governance-slice.md`
  - `harness/specs/tasks/rc06a-taskflow-capability-proof.md`
  - `harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md`
  - `harness/specs/tasks/rc06c-mission-lifecycle-migration.md`
  - `harness/specs/tasks/rc06d-task-loop-lifecycle-migration.md`
  - `harness/specs/tasks/rc07-memory-context-slot-convergence.md`
- 必读规则：`harness/specs/rules/agent-engineering-acceptance-boundary.md`、`harness/specs/rules/runtime-authority-convergence-boundary.md`。
- 每包开始前运行：`pnpm harness context --spec harness/specs/tasks/<spec>.md`。

## 1. 被审计的改动文件清单（reviewed paths）

以下为本会话（RC-04R..RC-07R）实际改动的文件。审计者应逐文件阅读并在干净 worktree 中复核；**保护 workstream 不得触碰**（`.agent-workbench/task-forest/**`、`src/pages/Chat/ChatInput.tsx`、`src/stores/chat*`、`shared/chat/types.ts`、`openclaw_runtime/src/agents/tool-loop-detection.ts`、checkpoint gateway、`docs/dev/handoffs/**`、`tests/unit/chat-*.test.*`——注意 `docs/dev/handoffs/**` 只读不写）。

### RC-04R（Durable Approval 唯一权威与严格 Effect 状态机）
- `openclaw_runtime/src/state/openclaw-state-schema.sql`（+ `openclaw-state-schema.generated.ts`、`openclaw-state-db.generated.d.ts` 经 `node scripts/generate-kysely-types.mjs` 重新生成）：`approval_ledger.request_json→request_digest`、新增 `revision`；`effect_receipts.proposal_json→proposal_digest`、新增 `schema_version DEFAULT '2'`
- `openclaw_runtime/src/agents/approval-ledger.ts`：digest-only 存储；transition 单 immediate transaction + `WHERE state=? AND revision=?` CAS + revision 单调递增；`recordEffectOutcome` 严格只接受 `execution_started`；`needs_reconciliation` 仅 unknown 进入；旧 `request_json` 表自动迁移（表重建，raw 丢弃）
- `openclaw_runtime/src/agents/effect-receipt.ts`：proposal digest-only；幂等比较 8 维度（proposal digest/approval id+decision/executor/outcome/journal refs/recoverability/schema_version）；旧 `proposal_json` 迁移
- `openclaw_runtime/src/gateway/exec-approval-manager.ts`：durable ledger 为唯一 authority（create/resolve 硬失败，无静默 fallback）；process Map 降为 cache；新增 `recoverPendingFromLedger()`
- `openclaw_runtime/src/gateway/server-aux-handlers.ts`（touchedAreas）：flag 默认开启 + 启动时 `recoverPendingFromLedger()`
- `openclaw_runtime/src/agents/rc04-durable-approval.test.ts`（15 用例）、`rc04-exec-approval-wiring.test.ts`（6 用例）

### RC-05R（真实 Operator 治理与交付一致性）
- `openclaw_runtime/src/agents/operator-slice.ts`：三阶段（`createOperatorSliceIntent`/`resolveOperatorGovernancePolicy`+`resolveOperatorSliceApproval`/`executeOperatorSliceEffect`）；governance（actor+policyDigest）绑定 EffectReceipt proposal；bounded file effect 经 realpath 双重包含 + lstat 拒绝 symlink leaf + 写 canonicalTarget；`runOperatorSlice` 同步兼容封装
- `openclaw_runtime/src/agents/operator-slice.test.ts`（11 用例，含 symlink 中间目录与 leaf 回归用例）
- `openclaw_runtime/src/cron/delivery.ts`：移除硬编码 approved；slice 路径 intent→policy→execute（executor=真实 send，ack 后才 applied）；新增 `runKey` 参数（per-run 幂等 key）
- `openclaw_runtime/src/gateway/server-methods/inbox.ts`（新建）+ `inbox.test.ts`（新建，5 个安全门禁用例）：`inbox.operator.list/decide/lineage`；decide 要求 device-token 认证（`isDeviceTokenAuth`）且仅限 `OPERATOR_SLICE_ACTOR` intent，policyDigest 服务端计算
- `openclaw_runtime/src/gateway/server-aux-methods.ts`、`server-aux-handlers.ts`：注册 `inbox.operator.*`
- `openclaw_runtime/src/gateway/server-cron.ts`、`server-cron-notifications.ts`：调用点传 per-run `runKey`
- `openclaw_runtime/extensions/channels/rc05-operator-fixture/{adapter.ts, __tests__/conformance.test.ts}`：有状态可执行 fixture（connection drop/rate limit/duplicate/restart/denial/unknown 六场景）
- `scripts/channel-conformance.mjs`：从源码 regex 改为可执行 fixture runner（spawn vitest + JSON 解析；win32 不带引号的原因已在注释记录）
- `src/stores/inbox.ts`、`src/pages/Inbox/index.tsx`：operator 源接线（真实 ledger 数据）
- `shared/i18n/locales/{en,zh,ja,ru}/inbox.json`：`source.operator` + `status.operator.*`
- `tests/unit/inbox-store.test.ts`、`tests/unit/agent-dev-regularization.test.ts`：适配新语义
- `tests/e2e/rc05-operator-inbox.spec.ts`（新建，2 用例）
- `harness/specs/tasks/rc05-minimal-operator-governance-slice.md`：touchedAreas 补 `src/pages/Inbox/**`、`tests/unit/**`

### RC-06AR（TaskFlow CAS 能力证明）
- `openclaw_runtime/src/tasks/task-flow-cas.ts`：create sentinel（`CAS_CREATE_SENTINEL=-1`，拒绝任意 revision 与 terminal 初态创建）；UPDATE 级 `WHERE flow_id=? AND revision=?` CAS + affected rows 检查；`delivery_state`/`wait_json`/`state_json` 支持显式 null 清空（`!== undefined`）；`isTerminalFlowStatus`
- `openclaw_runtime/src/tasks/task-flow-cas.test.ts`（10 用例，含审计反例 999+succeeded+delivered、并发双写、null-clear）
- `openclaw_runtime/src/tasks/task-flow-registry.store.sqlite.ts`：select 补 `delivery_state`
- `openclaw_runtime/src/state/openclaw-state-schema.sql`：`flow_runs.delivery_state TEXT`；`openclaw-state-db.ts`：`ensureColumn` 迁移

### RC-06BR / RC-06CR / RC-06DR（三域 read-only projection）
- `openclaw_runtime/src/agents/clawgraph/clawgraph-taskflow-projection.ts`（+test 9 用例）
- `openclaw_runtime/src/agents/mission-control/mission-taskflow-projection.ts`（+test 8 用例）
- `openclaw_runtime/src/agents/task-loop-taskflow-projection.ts`（+test 9 用例）：cancelled 显式映射（非 blocked/waiting 冒充）；非 waiting 显式清空 wait_json
- 三域均：create sentinel 适配；flag-off 保持纯 legacy 路径；Observe + read-only projection 阶段（writer cutover/freeze/rollback 未实施）

### RC-07R（Memory/Context Slot 强制收敛）
- `openclaw_runtime/src/agents/slot-convergence.ts`（+test 8 用例）：`buildSlotMechanismCensus`（真实源 census）、`enforceSlotConvergenceForConfig`、`assertSingleMemorySlotOwner`/`assertSingleContextEngineSlot`
- `openclaw_runtime/src/plugins/config-normalization-shared.ts`：normalize 同时校验 memory + contextEngine slot，errors 并入 `slotConvergenceErrors`
- `openclaw_runtime/src/plugins/activation-planner.ts`（touchedAreas）：`resolveManifestActivationPlan` 对非空 `slotConvergenceErrors` 抛错（fail-closed 消费）
- `tests/unit/rc07-memory-context-slot-convergence.test.ts`（5 用例，重写）

### 文档（只读审计，不得修改）
- `docs/dev/handoffs/RC-04-07-DEVELOPMENT-PROMPT.md`（每包记录 + review/security 修复记录）
- `docs/dev/handoffs/LATEST.md`
- `docs/dev/unified-agent-system/runtime-convergence/{STATUS,WORK-PACKAGES,TARGET-ARCHITECTURE,AGENT-START}.md`

## 2. 本会话声明的验证证据（审计者必须独立复现，不得采信）

| 项 | 实现者声明 |
|---|---|
| 全量 `pnpm test` | 3 files / 31 failed = RC-01R 基线保护文件（chat-input.test.tsx / chat-runtime-event-handlers.test.ts / uas-05-verseshell-process-lifecycle.test.ts），零新增失败 |
| `pnpm run lint:check` | 0 errors / 122 warnings（与基线一致） |
| `pnpm run typecheck`（node+web） | PASS |
| `pnpm i18n:lint` | PASS |
| 7 个 spec `pnpm harness validate` | 全 PASS |
| focused vitest（RC-04..07 相关） | rc04 21/21、operator-slice 11/11、inbox gate 5/5、task-flow-cas 10/10、三域 projection 9+8+9、rc07 5/5、receipt-store/rc02 等回归组全过 |
| `pnpm run channel:conformance` | PASS（executable-fixture 9 tests / 0 failures） |
| E2E `tests/e2e/rc05-operator-inbox.spec.ts` | 2/2 PASS（需先 `pnpm --dir openclaw_runtime run build` + `pnpm run build:vite`） |
| review / security_review | 多轮复查终轮 PASS（4 个 should-fix + 2 个 MEDIUM + nits 全部修复） |

## 3. 每包审计验收命令（必须逐包独立复跑）

```powershell
# RC-04R
pnpm --dir openclaw_runtime exec vitest run src/agents/rc04-durable-approval.test.ts src/agents/rc04-exec-approval-wiring.test.ts
pnpm --dir openclaw_runtime exec vitest run src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts src/agents/receipt-store.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm harness validate --spec harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md

# RC-05R
pnpm --dir openclaw_runtime exec vitest run src/agents/operator-slice.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/rc04-durable-approval.test.ts src/agents/rc04-exec-approval-wiring.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/rc02-shadow-census.acceptance.test.ts extensions/channels/rc05-operator-fixture/__tests__/conformance.test.ts
pnpm --dir openclaw_runtime exec vitest run src/gateway/server-methods/inbox.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm run channel:conformance
pnpm harness validate --spec harness/specs/tasks/rc05-minimal-operator-governance-slice.md

# RC-06A
pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/operator-slice.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm harness validate --spec harness/specs/tasks/rc06a-taskflow-capability-proof.md

# RC-06B / RC-06C / RC-06D
pnpm --dir openclaw_runtime exec vitest run src/agents/clawgraph/clawgraph-taskflow-projection.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/mission-control/mission-taskflow-projection.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/task-loop-taskflow-projection.test.ts
pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm harness validate --spec harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md
pnpm harness validate --spec harness/specs/tasks/rc06c-mission-lifecycle-migration.md
pnpm harness validate --spec harness/specs/tasks/rc06d-task-loop-lifecycle-migration.md

# RC-07R
pnpm exec vitest run tests/unit/rc07-memory-context-slot-convergence.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/slot-convergence.test.ts src/memory/memory-store.test.ts src/context-engine/block-store.test.ts
pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts src/agents/task-loop-taskflow-projection.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm harness validate --spec harness/specs/tasks/rc07-memory-context-slot-convergence.md

# 全局门禁（每包后 + 全部结束后）
pnpm run lint:check; pnpm run typecheck
pnpm test   # 失败集必须与 RC-01R 基线完全一致（3 files / 31 failed），出现新失败即该包失败
```

## 4. 每包退出条件（spec acceptance 对照）

- **RC-04R**：process Map 不再是 approval truth；unknown 不自动 replay；duplicate effect count=0；schema 迁移 + reopen proof 全绿；raw secret 扫描 DB 不得出现；`approval_pending` 直接 record applied 必须失败。
- **RC-05R**：slice 成功但真实 send 失败 → 记录不得为 applied；denial 的 adapter call count=0；重复 intent 实际 effect count=1；channel-conformance 为可执行 fixture（非 regex）；`inbox.operator.decide` 拒绝匿名/非 device-token/非 operator intent。
- **RC-06A**：create sentinel（-1）+ terminal 初态拒绝；SQL 级 revision CAS；双独立连接并发唯一 winner；restart 恢复 revision/wait/terminal/delivery；审计反例 `expectedRevision=999 + succeeded + delivered` 失败。
- **RC-06B/C/D**：read-only projection（flag-off 纯 legacy）；cancel/restart/child-task（B）、wait/resume/cancel（C）、cancelled 显式非 blocked/waiting 冒充（D）证明；本阶段不要求 writer cutover（属后续阶段，审计者不得要求实现者在本包内完成 cutover）。
- **RC-07R**：`slotConvergenceErrors` 有生产消费方（activation planner 抛错）；census 从真实源生成；parallel memory writes=0；SEKB auto-writeback=0。

## 5. 审计约束与禁止事项

1. **工作目录**：仅限 `C:\Users\27933\Desktop\clawx\ClawX`（或审计者自己的 detached worktree 副本）；禁止 worktree add/remove/prune、cherry-pick、rebase、checkout、stash、reset、clean、`git add -A`。
2. **不得修改**：保护 workstream（见第 1 节）、`docs/dev/handoffs/**`、`STATUS.md.accepted_work_packages`、product locks。发现的缺陷只记录，不得"顺手修复"（除非获得实现方单独授权）。
3. **禁止**：恒真断言、mock-only、regex/静态表代替执行、`--no-diff`、跳过失败项、把 diagnostics/replay 提升为 authority、新增第二 runtime/store/service、raw prompt/tool/credential/cookie/env 持久化。
4. **F4 未恢复期间**：审计结论只能写"独立复现结果 / 本地实现与门禁证据"，不得宣称 `accepted/done`；不得解除 RC-10 blocked；不得调用真实 provider/channel。
5. **正式验收（若被授权）**：双 detached worktree + 不同 actor + 唯一 output dir；`fac6327a2` 与本会话任何 evidence 只作 rejected historical input，复用一律拒绝。
6. 通信路径变更检查：若审计中发现通信路径缺陷，按 `pnpm run comms:replay` / `pnpm run comms:compare` 复核（本会话未触碰 gateway 事件/发送/重试/fallback 语义）。

## 6. 审计者输出格式（必须逐包给出）

对每个包输出：

```text
## RC-0xR 审计结论
- verdict: PASS | FAIL | CONCERN（附理由，禁止无依据结论）
- 复现命令与结果：命令 + exit/test counts（独立复跑，非引用）
- 代码审查发现：file:line + 严重度（blocking / should-fix / nit）
- 与实现者声明的差异：逐条列出
- 残余风险与后续阶段提示（如 06B/C/D cutover）
```

最后输出全局总结：

```text
## 全局审计总结
- 包级 verdict 汇总表
- 全局门禁复现结果（lint/typecheck/pnpm test 基线比对）
- 是否发现新增失败 / 保护文件被触碰
- 推荐动作：修复清单（若有）/ 进入正式验收的条件（F4 恢复后）
```

## 7. 审计线索（实现者自述的关键设计决策，供交叉验证）

1. `approval_ledger`/`effect_receipts` 迁移在 agents 层内联执行（`migrateApprovalLedgerShape`/`migrateEffectReceiptsShape`），旧 DB reopen 时自动 digest 化并丢弃 raw——审计重点：迁移幂等性、raw 不残留。
2. `exec-approval-manager` authority 反转后，`create`/`resolve` 对 ledger 硬失败；`recoverPendingFromLedger` 只恢复未过期 `approval_pending`，恢复记录 request 为 digest-only 占位。
3. cron slice 的幂等 key 现为 `op:{runKey}:{sessionKey}`（runKey 由调用方传 `${job.id}:${Date.now()}`）——审计重点：同 tick 重放与跨 tick 区分的语义。
4. `TaskLoopStatus` 联合类型**未**扩展 `cancelled`（外围 gateway 消费方超范围）；cancelled 显式支持落在 projection adapter 层——审计重点：确认该边界记录与 spec "显式支持 cancelled" 的差距是否可接受。
5. 三域 projection 均未接入 active path（无生产调用方）；`rc06b/c/d` 的 `runtime.ts`/`mission store`/`task-loop-controller` 除 create-sentinel 适配外未改 lifecycle 写路径。
6. `activation-planner.ts` 抛错是 RC-07R fail-closed 的唯一消费点——审计重点：是否存在绕过 planner 的插件加载路径（若存在需升级为 CONCERN）。
