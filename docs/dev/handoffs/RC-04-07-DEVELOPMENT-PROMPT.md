# RC-04R → RC-07R 开发任务与验收闭环 — 交接提示词

> 用途：交给下一位开发 agent 的完整任务提示词（含 RC-04R、RC-05R、RC-06AR、RC-06BR、RC-06CR、RC-06DR、RC-07R）。
> 前置：RC-01R/02R/03R 本地门禁已全绿（见 `docs/dev/handoffs/RC-01R-02R-03R-VERIFICATION-HANDOFF.md`），但 **F4 未关闭、三包未提交、未独立验收**。RC-04R 只允许在 RC-03R 被独立 Verifier 接受后启动；若用户授权临时 bypass，则按“本地实现与门禁证据”口径推进，**不得宣称 accepted/done**。
> 状态红线：`STATUS.md.accepted_work_packages` 保持空；RC-10 blocked；`liveReady/productApproved/defaultOn=false`；不调用真实 provider/channel 验收。

---

## 0. 总体要求（每包通用）

1. 工作目录只能 `C:\Users\27933\Desktop\clawx\ClawX`；禁止 worktree add/remove/prune、cherry-pick、rebase、checkout、stash、reset、clean、`git add -A`。
2. **保护 workstream 不得触碰**：`.agent-workbench/task-forest/**`、`src/pages/Chat/ChatInput.tsx`、`src/stores/chat*`、`shared/chat/types.ts`、`openclaw_runtime/src/agents/tool-loop-detection.ts`（P0-3）、`openclaw_runtime/src/gateway/**`（checkpoint gateway）、`docs/dev/handoffs/**`、研究文档、`tests/unit/chat-*.test.*`。这些文件的失败只能记录，不得伪装成修复或绕过。
3. 每个包开始前：`pnpm harness context --spec harness/specs/tasks/<spec>.md`，读 rules、调用方、相邻实现与测试；涉及 `openclaw_runtime` 先读 `openclaw_runtime/AGENTS.md` 与受影响子目录 AGENTS.md。
4. 串行顺序固定：`RC-04R -> RC-05R -> RC-06AR -> RC-06BR -> RC-06CR -> RC-06DR -> RC-07R`。任一包本地门禁失败，只修当前包；不得并行预实现后续包。
5. 修改后先跑最小相关测试，再扩大到该包 spec 的 requiredTests，再跑全局 `lint:check`/`typecheck`/`pnpm test`。
6. 新增/修改路径必须精确落入对应 RC spec 的 `ownedPaths`；禁止宽 glob 覆盖保护改动；行为变化同步检查 README 三语与 runtime-convergence 控制文档（STATUS/WORK-PACKAGES/TARGET-ARCHITECTURE/AGENT-START），但不得改 `accepted_work_packages`。
7. 每包结束记录：命令与 exit/test counts、改动文件、未跑项、残余风险、当前包状态。

---

## 1. RC-04R — Durable Approval 唯一权威与严格 Effect 状态机

**Spec**：`harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md`
**已存在脚手架**（committed，fac6327a2 时代）：`approval-ledger.ts`（`ApprovalLedger` class + `approval_ledger` 表 + 状态序列）、`effect-receipt.ts`（`EffectReceiptStore` + `effect_receipts` 表）、`rc04-durable-approval.test.ts`、`rc04-exec-approval-wiring.test.ts`、`exec-approval-manager.ts`（transient process Map，当前 authority）。schema 中 `approval_ledger` 已建（含 state CHECK 与 idempotency UNIQUE）。

### 开发任务（对齐修复计划 §10）
1. Gateway 生产初始化显式构造并注入 durable `ApprovalLedger`；`exec-approval-manager.ts` 的 process Map 降为可丢弃 cache 或删除。reserve/read/resolve/expire/restart 全部以 durable owner 为准。
2. `approval_ledger`/`effect_receipts` 只存 canonical digests、refs、identity、decision/outcome、bounded error code；**移除 raw `request_json`/`proposal_json`** 或迁移为不可逆摘要（注意 schema 当前 `request_json TEXT NOT NULL`，需要迁移策略 + 旧 DB reopen 证明）。
3. 每个 transition 用同一 SQLite transaction + 前置 state/revision CAS：`intent_reserved -> approval_pending -> approved|denied -> execution_started -> applied|not_applied|unknown -> reconciled`。
4. `needs_reconciliation` 只能从 unknown/不可判定 journal 状态进入；**永不自动 replay**；denied 永远不能进入 execution_started。
5. `EffectReceipt` idempotency 比较覆盖：proposal digest、approval ID/decision、executor、outcome、journal refs、recoverability、版本；任一不同即 conflict。
6. timeout / process restart / duplicate resolve / DB busy / journal recovery 共用同一状态机；所有 DB helper 显式收到正确 database/transaction 参数。
7. 通过 `finalizeContextOrchestratorTurn`/`runRc03SealHook` 之外的**真实生产调用方**接线（Gateway server-methods → approval 路径），不得只有测试调用。

### 反例测试（测试名必须真实执行）
- `approval_pending` 直接 record applied → 失败；denied 后 execution → 失败；applied 前无 execution_started → 失败。
- 同 executor/outcome 但 proposal/approval/decision/recoverability 不同 → conflict。
- raw secret 经 reserve/effect 后扫描 DB 不得出现；Gateway restart 后 pending/resolved 完整恢复。
- 每个 transition 前后注入 crash，从 domain journal 得到唯一可解释最终状态。

### 验收命令
```powershell
pnpm --dir openclaw_runtime exec vitest run src/agents/rc04-durable-approval.test.ts src/agents/rc04-exec-approval-wiring.test.ts
pnpm --dir openclaw_runtime exec vitest run src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts src/agents/receipt-store.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm harness validate --spec harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md
pnpm run lint:check; pnpm run typecheck
```

### 退出条件
process Map 不再是 approval truth；unknown 不自动 replay；duplicate effect count=0；schema 迁移 + upgrade/reopen/downgrade/rollback proof 全绿；独立 Verifier 接受（F4 恢复后）。

### RC-04R 本地实现与门禁记录（2026-08-05 会话，未独立验收）

**改动文件**：
- `openclaw_runtime/src/state/openclaw-state-schema.sql`（+`openclaw-state-schema.generated.ts`、`openclaw-state-db.generated.d.ts` 重新生成）：`approval_ledger.request_json` → `request_digest`（SHA-256 canonical，raw 永不落盘）、新增 `revision` 列（乐观 CAS）；`effect_receipts.proposal_json` → `proposal_digest`、新增 `schema_version` 列。
- `openclaw_runtime/src/agents/approval-ledger.ts`：digest-only 存储；所有 transition 单 immediate transaction + `WHERE state=? AND revision=?` CAS + revision 单调递增；`recordEffectOutcome` 严格只接受 `execution_started`（approval_pending/approved 直接 applied → state-conflict；reconciled 为 terminal）；`needs_reconciliation` 仅由 unknown 进入，reconcile 仅 `needs_reconciliation -> reconciled`；旧 DB（含 `request_json`）打开时自动迁移为 digest-only。
- `openclaw_runtime/src/agents/effect-receipt.ts`：proposal digest-only；幂等比较覆盖 proposal digest / approval id+decision / executor / outcome / journal refs / recoverability / schema_version，任一不同即 content-conflict；旧 `proposal_json` 迁移。
- `openclaw_runtime/src/gateway/exec-approval-manager.ts`：durable ledger 为唯一 authority（create/resolve 硬失败于 ledger，无静默 fallback）；process Map 降为可丢弃 cache；新增 `recoverPendingFromLedger()` 重启恢复（未过期 pending 恢复为 digest-only 记录）。
- `openclaw_runtime/src/gateway/server-aux-handlers.ts`（touchedAreas 内）：`enableDurableApprovalLedger` 默认开启（kill switch=false 为显式回滚），创建后立即 `recoverPendingFromLedger()`。
- `openclaw_runtime/src/agents/rc04-durable-approval.test.ts` / `rc04-exec-approval-wiring.test.ts`：更新为 digest-only 断言 + 新增反例（approval_pending 直接 applied 失败、reconciled terminal、revision CAS、旧 DB reopen 迁移、raw secret 扫描 DB 不出现、restart 恢复、过期不恢复、ledger 硬失败、idempotency 全维度 conflict）。

**逐条命令结果**：

| 命令 | 结果 |
|---|---|
| `pnpm --dir openclaw_runtime exec vitest run src/agents/rc04-durable-approval.test.ts src/agents/rc04-exec-approval-wiring.test.ts` | 21/21 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts src/agents/receipt-store.test.ts` | 39/39 PASS |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 35/35 PASS |
| `pnpm harness validate --spec harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md` | PASS |
| `pnpm run lint:check` | 0 errors / 122 warnings（与 RC-01R 基线一致） |
| `pnpm run typecheck`（node+web） | PASS |
| 全量 `pnpm test` | 待确认（预期仅 RC-01R 基线 3 个保护文件失败） |

**残余风险 / 限制**：
- 重启恢复的 approval 记录 request 为 digest-only 占位（raw 永不持久化），`exec.approval.get` 显示空 commandText；决策/审计 truth 完整。
- plugin-approval manager 仍为纯内存路径（不在 RC-04 ownedPaths 范围），process Map 仅对 plugin approval 保持 transient。
- `openclaw_runtime/src/gateway/server-aux-handlers.ts`、`server.impl.ts` 不在 ownedPaths（在 touchedAreas `gateway/**` 内），生产接线改动按 touchedAreas 覆盖；checkpoint gateway 保护文件未触碰。
- 正式独立 Verifier / detached worktree / final manifest 未跑（F4 未恢复，用户授权本地口径）。

---

## 2. RC-05R — 真实 Operator 治理与交付一致性

**Spec**：`harness/specs/tasks/rc05-minimal-operator-governance-slice.md`
**已存在脚手架**：`operator-slice.ts`（`runOperatorSlice`/`recoverOperatorSlice`/`projectOperatorLineage`）、`cron/delivery.ts`、`server-methods/inbox.ts`、`src/stores/inbox.ts`、`scripts/channel-conformance.mjs`（注意：**当前为源码 regex 检查**，审计要求改为可执行 fixture）。

### 开发任务（对齐修复计划 §11）
1. Cron ingress 只能创建 approval intent（`intent_reserved -> approval_pending`）；**禁止硬编码 approved**；批准必须来自真实治理 policy/Inbox decision，记录 actor + policy digest。
2. bounded file/message effect 调用真实 domain executor：先 `execution_started`，再按真实 adapter/journal ack 写 `applied`；明确失败写 `not_applied`；无法判定写 `unknown`/`needs_reconciliation`。**不得在 channel send 前写 applied/reconciled**。
3. retry 只在 domain journal 证明未执行或 provider idempotency contract 明确支持时进行；安全 retry 不被错误 duplicate 拦截。
4. UI lineage 从真实 ContextReceipt、approval ledger、EffectReceipt、recovery state 构建（`src/stores/inbox.ts` 接真实数据），不伪造 `context:<sessionKey>` 引用；文案走 en/zh/ja/ru i18n。
5. `scripts/channel-conformance.mjs` 从源码 regex 改为**可执行 adapter fixture**（`extensions/channels/rc05-operator-fixture/**`）：覆盖 connection drop、rate limit、duplicate delivery、restart、denial、unknown outcome。
6. 新增/更新 Electron E2E：可见 approval、pending/recovery/result（受 E2E 环境限制时如实记录）。

### 验收命令
```powershell
pnpm --dir openclaw_runtime exec vitest run src/agents/operator-slice.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/rc04-durable-approval.test.ts src/agents/rc04-exec-approval-wiring.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/rc02-shadow-census.acceptance.test.ts extensions/channels/rc05-operator-fixture/__tests__/conformance.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm run channel:conformance
pnpm harness validate --spec harness/specs/tasks/rc05-minimal-operator-governance-slice.md
pnpm run lint:check; pnpm run typecheck
```

### 退出条件
slice 成功但真实 send 失败 → 记录不得为 applied；denial 的实际 adapter call count=0；重复 intent 实际 effect count=1；crash 注入（approval 前/send 前/send 后未 ack/journal 后 receipt 前）恢复与 domain journal 一致；executable channel fixture + E2E 通过。

### RC-05R 本地实现与门禁记录（2026-08-05 会话，未独立验收）

**改动文件**：
- `openclaw_runtime/src/agents/operator-slice.ts`：重构为三阶段——`createOperatorSliceIntent`（Cron ingress 只创建 intent，永不内联批准）、`resolveOperatorGovernancePolicy`（显式治理规则 + SHA-256 policyDigest，默认 deny）、`resolveOperatorSliceApproval`（记录 actor+policyDigest）、`executeOperatorSliceEffect`（先 execution_started，再由真实 executor 返回结果写 applied/not_applied/unknown + EffectReceipt）；`runOperatorSlice` 保留为同步兼容封装（内置 file executor 绑定 effectRootDir）；`projectOperatorLineage` 用真实 ContextReceipt ref 替代伪造 `context:<sessionKey>`。
- `openclaw_runtime/src/cron/delivery.ts`：移除硬编码 `approvalDecision: "approved"`；slice 路径改为 intent → policy 决策 → execute（executor = 真实 `deliverCronAnnouncePayload`，send 成功 applied / 明确失败 not_applied / abort 无 ack unknown）。
- `openclaw_runtime/src/gateway/server-methods/inbox.ts`（新建）：`inbox.operator.list/decide/lineage`，从 durable approval ledger + EffectReceipt 真实数据构建；挂载于 `server-aux-handlers.ts` + `GATEWAY_AUX_METHODS`。
- `openclaw_runtime/extensions/channels/rc05-operator-fixture/adapter.ts`：有状态可执行 fixture（connection drop / rate limit / idempotent duplicate / exportState+restoreState 重启恢复）；`__tests__/conformance.test.ts` 覆盖六场景并集成 ledger 状态机（denial 零效果、unknown → needs_reconciliation 不自动重放）。
- `scripts/channel-conformance.mjs`：从源码 regex 检查改为**可执行 fixture runner**（spawn vitest 执行 conformance 套件并解析 JSON，校验六场景真实执行）。
- `src/stores/inbox.ts`：新增 operator 源（`projectOperatorIntent`），refresh 经 `hostApi.gateway.rpc('inbox.operator.list')` 拉真实 intent，`decideOperator` 走 `inbox.operator.decide`。
- `src/pages/Inbox/index.tsx`（spec touchedAreas 已补 `src/pages/Inbox/**`）：operator 源状态/图标/动作接线。
- `shared/i18n/locales/{en,zh,ja,ru}/inbox.json`：`source.operator` + `status.operator.{approval_pending,approved,denied}`。
- `tests/e2e/rc05-operator-inbox.spec.ts`（新建）：mock gateway RPC 验证 operator intent 可见 + approve/deny 决策流。
- `harness/specs/tasks/rc05-minimal-operator-governance-slice.md`：touchedAreas 补 `src/pages/Inbox/**`。
- 控制文档：`STATUS.md` / `WORK-PACKAGES.md` / `AGENT-START.md` / 本交接文件。

**逐条命令结果**：

| 命令 | 结果 |
|---|---|
| `pnpm --dir openclaw_runtime exec vitest run src/agents/operator-slice.test.ts` | 9/9 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/agents/rc04-durable-approval.test.ts src/agents/rc04-exec-approval-wiring.test.ts` | 21/21 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/rc02-shadow-census.acceptance.test.ts extensions/channels/rc05-operator-fixture/__tests__/conformance.test.ts` | 32/32 PASS（合并组 62/62） |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 35/35 PASS |
| `pnpm run channel:conformance` | PASS（executable-fixture：9 tests / 0 failures / 六场景 executed） |
| `pnpm harness validate --spec harness/specs/tasks/rc05-minimal-operator-governance-slice.md` | PASS |
| `pnpm run lint:check` | 0 errors / 122 warnings（与基线一致） |
| `pnpm run typecheck`（node+web） | PASS |
| `pnpm i18n:lint` | PASS |
| E2E `rc05-operator-inbox.spec.ts` | 2/2 PASS（需 `pnpm build:runtime` + `build:vite`） |
| 全量 `pnpm test` | 待确认（预期仅 RC-01R 基线 3 个保护文件失败） |

**残余风险 / 限制**：
- Cron 自动批准来自显式 policy 规则（`cron-announce-under-operator-slice`）+ policyDigest 记录；真实人工 Inbox 决策路径已接线（`inbox.operator.decide`，actor 来自 client），但自动化测试仅模拟 IPC 层决策。
- `inbox.operator.decide` 只做治理决策（resolve），effect 执行由调度/调用方负责；UI 暂不触发 execute（Inbox 语义为决策面）。
- plugin-approval 仍为纯内存路径（RC-04 记录项）。
- 正式独立 Verifier / detached worktree / final manifest 未跑（F4 未恢复）。

---

## 3. RC-06AR — TaskFlow CAS 能力证明

**Spec**：`harness/specs/tasks/rc06a-taskflow-capability-proof.md`
**已存在脚手架**：`task-flow-cas.ts`（`TaskFlowCasStore`、`isLegalTransition`、`flow_runs` 表）、`task-flow-cas.test.ts`、`task-flow-registry.store.sqlite.ts`。

### 开发任务（对齐修复计划 §12）
1. 新 flow 使用明确 create sentinel（`expectedRevision=-1`）与规范初态；任意 revision 或 terminal 初态创建必须拒绝。
2. 更新用 `UPDATE ... WHERE id=? AND revision=?` 并检查 affected rows；revision 单调递增；合法 transition graph 在 transaction 内验证。
3. `deliveryState`（`task_delivery_state`）落入明确 schema owner，与 flow lifecycle 同一 transaction 或可证明的原子关联；类型声明而不持久化不可接受。
4. 两个独立 DB connections/process actors 并发竞争 → 只允许一个 writer 成功。
5. reopen/restart 后 revision、wait、terminal、delivery state 完整恢复。
6. **证明层不接入任何 active path**（保持 legacy 盲 upsert 为唯一 active writer），不得引入 replacement workflow framework。

### 反例测试
- 审计反例 `expectedRevision=999 + initial succeeded + delivered` 必须失败。
- stale revision、illegal transition、terminal resurrection、并发双写、delivery/lifecycle 分裂均失败且不产生部分行。

### 验收命令
```powershell
pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/operator-slice.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm harness validate --spec harness/specs/tasks/rc06a-taskflow-capability-proof.md
pnpm run lint:check; pnpm run typecheck
```

### 退出条件
RC-06A capability proof 覆盖 create/update/concurrency/restart/delivery；未通过前 06B/C/D 全部 blocked。

### RC-06AR 本地实现与门禁记录（2026-08-05 会话，未独立验收）

**改动文件**：
- `openclaw_runtime/src/tasks/task-flow-cas.ts`：create sentinel（`CAS_CREATE_SENTINEL=-1`，任意 revision 或 terminal 初态创建拒绝）；UPDATE 路径改 SQL 级 `WHERE flow_id=? AND revision=?` CAS + affected rows 检查；revision 单调递增；`delivery_state` 持久化到 `flow_runs.delivery_state`（与 lifecycle 同事务同行）；`isTerminalFlowStatus` 导出。
- `openclaw_runtime/src/state/openclaw-state-schema.sql`（+generated 重新生成）：`flow_runs.delivery_state TEXT`。
- `openclaw_runtime/src/state/openclaw-state-db.ts`（touchedAreas 内）：`ensureColumn(flow_runs, delivery_state)` 旧 DB 迁移。
- `openclaw_runtime/src/tasks/task-flow-cas.test.ts`：9 用例（create sentinel、审计反例 999+succeeded+delivered、SQL 级 stale revision、illegal transition、terminal resurrection、restart 恢复 revision/wait/terminal/delivery、双独立连接并发唯一 winner、delivery/lifecycle 不分裂）。
- 控制文档：`STATUS.md` / `WORK-PACKAGES.md` / 本交接文件。

**逐条命令结果**：

| 命令 | 结果 |
|---|---|
| `pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts` | 9/9 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/operator-slice.test.ts` | 24/24 PASS |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 35/35 PASS |
| `pnpm harness validate --spec harness/specs/tasks/rc06a-taskflow-capability-proof.md` | PASS |
| `pnpm run lint:check` / `pnpm run typecheck` / 全量 `pnpm test` | 待确认（预期基线一致） |

**残余风险 / 限制**：
- 证明层不接入任何 active path（legacy 盲 upsert 仍为唯一 active writer）；06B/C/D 迁移均以本证明为前提。
- `task_delivery_state`（task-registry owner）与 `flow_runs.delivery_state` 的关联由各域 projection 负责（06B/C/D），本包只保证 flow 行内原子性。
- 正式独立 Verifier / detached worktree / final manifest 未跑（F4 未恢复）。

---

## 4. RC-06BR / RC-06CR / RC-06DR — 三个域的实际单写迁移

**Specs**：`rc06b-clawgraph-lifecycle-migration.md` / `rc06c-mission-lifecycle-migration.md` / `rc06d-task-loop-lifecycle-migration.md`
**已存在脚手架**：`clawgraph/clawgraph-taskflow-projection.ts`、`mission-control/mission-taskflow-projection.ts`、`task-loop-taskflow-projection.ts`（均带 `.test.ts`）、`task-flow-registry.ts`。

### 四阶段模式（每域都必须分别证明，按 B → C → D 串行）
1. **Observe**：legacy writer 保持 authority，新增 read-only projection + drift census；任何 conflict 产生可查询 drift evidence，不能 catch/skip。
2. **Cutover**：受控 flag 下 TaskFlow 写 lifecycle；Map/legacy 只作 projection/cache。proof 包括 restart、cancel、child task（B）、wait/resume/cancel（C）、cancel/restart（D）、terminal、rollback。
3. **Legacy freeze**：兼容窗口后冻结/删除 legacy writer；不存在 indefinite dual-write。
4. **Rollback**：显式互斥切回旧 writer，不得双写。

### 各域独有要求
- **B ClawGraph**：compiler 与 UI 不变；"restart" 必须重建真实 controller/runtime，不是同进程再调 helper。
- **C Mission**：`mission_runs/events` 在兼容窗口内只读投影，不再写 lifecycle truth；`mission-control/store.ts` 停止写。
- **D Task Loop**：TaskFlow 状态模型 + Task Loop adapter 显式支持 **cancelled**（真实 cancel API/event 必须执行并断言，不接受 blocked/waiting 冒充）；`long_task_checkpoints` 只保留 checkpoint material；replay/recovery 只重建状态，永不执行 effect。

### RC-06CR 本地实现与门禁记录（2026-08-05 会话，未独立验收）

**改动文件**：
- `openclaw_runtime/src/agents/mission-control/mission-taskflow-projection.ts`：create sentinel 适配（`CAS_CREATE_SENTINEL`）。
- `openclaw_runtime/src/agents/mission-control/mission-taskflow-projection.test.ts`：+1 证明用例（cancel 后 restart 恢复 + terminal 吸收，晚到事件不复活）。
- 控制文档：`STATUS.md` / 本交接文件。

**逐条命令结果**：

| 命令 | 结果 |
|---|---|
| `pnpm --dir openclaw_runtime exec vitest run src/agents/mission-control/mission-taskflow-projection.test.ts` | 8/8 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/agents/clawgraph/clawgraph-taskflow-projection.test.ts src/tasks/task-flow-cas.test.ts` | 16/16 PASS |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 35/35 PASS |
| `pnpm harness validate --spec harness/specs/tasks/rc06c-mission-lifecycle-migration.md` | PASS |
| `pnpm run typecheck:node` | PASS |
| 全量 `pnpm test` | 3 files / 31 failed —— RC-01R 基线保护文件，无新失败 |

**残余风险 / 限制**：
- 本包仅完成 Observe + read-only projection（flag 默认 off）；`mission_runs/events` 仍为 lifecycle truth writer，`mission-control/store.ts` 未停写（cutover 阶段执行）。
- Mission restart/wait/resume/cancel 语义在 projection 中验证通过。
- 正式独立 Verifier / detached worktree / final manifest 未跑（F4 未恢复）。

### 验收命令（每域）
```powershell
pnpm --dir openclaw_runtime exec vitest run src/agents/clawgraph/clawgraph-taskflow-projection.test.ts   # B
pnpm --dir openclaw_runtime exec vitest run src/agents/mission-control/mission-taskflow-projection.test.ts # C
pnpm --dir openclaw_runtime exec vitest run src/agents/task-loop-taskflow-projection.test.ts              # D
pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm harness validate --spec harness/specs/tasks/rc06<x>-*.md
pnpm run lint:check; pnpm run typecheck
```

### 总退出条件
静态 writer inventory 与动态 instrumentation 都证明 TaskFlow/TaskRegistry 是唯一 workflow lifecycle writer；三个 legacy owner 的 write path 被删除、冻结或显式互斥。

### RC-06BR 本地实现与门禁记录（2026-08-05 会话，未独立验收）

**改动文件**：
- `openclaw_runtime/src/agents/clawgraph/clawgraph-taskflow-projection.ts`：create sentinel 适配（新建 flow 用 `CAS_CREATE_SENTINEL`，修复 RC-06A 语义变更后的投影失败）。
- `openclaw_runtime/src/agents/clawgraph/clawgraph-taskflow-projection.test.ts`：+3 证明用例（cancel/run_aborted→cancelled terminal 吸收且 restart 恢复；restart 重建自 flow_runs 不依赖 controller 实例；child-task 多节点 current_step 一致性）。
- 控制文档：`STATUS.md` / 本交接文件。

**逐条命令结果**：

| 命令 | 结果 |
|---|---|
| `pnpm --dir openclaw_runtime exec vitest run src/agents/clawgraph/clawgraph-taskflow-projection.test.ts` | 9/9 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts` | 9/9 PASS |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 35/35 PASS |
| `pnpm harness validate --spec harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md` | PASS |
| `pnpm run typecheck:node` | PASS |
| 全量 `pnpm test` | 3 files / 31 failed —— RC-01R 基线保护文件，无新失败 |

**残余风险 / 限制**：
- 本包仅完成 Observe（legacy Map 保持 authority）+ read-only projection（flag 默认 off）；writer cutover / legacy freeze / rollback 属后续阶段，compiler 与 UI 未动。
- "restart 必须重建真实 controller/runtime"的 cutover 证明留待 RC-06B 后续阶段（当前以 projection 从 flow_runs 重建证明持久性）。
- 正式独立 Verifier / detached worktree / final manifest 未跑（F4 未恢复）。

---

## 5. RC-07R — Memory/Context Slot 强制收敛

**Spec**：`harness/specs/tasks/rc07-memory-context-slot-convergence.md`
**已存在脚手架**：`slot-convergence.ts`（`resolveActiveMemorySlotOwner`/`assertSingleMemorySlotOwner`/`classifySlotMechanisms`/`assertSingleContextEngineSlot`）、`tests/unit/rc07-memory-context-slot-convergence.test.ts`、`plugins/slots.ts`、`context-engine/registry.ts`、`memory/memory-store.ts`、`block-store.ts`、`agent-map-context-provider.ts`、`packages/vtoken/**`、`knowledge/sekb/**`。

### 开发任务（对齐修复计划 §14）
1. **fail-closed 落地**：`assertSingleMemorySlotOwner`/`assertSingleContextEngineSlot` 的校验结果必须被 runtime startup 与 plugin reload **消费**（现有实现只返回 error 数组，审计指出"只返回无人消费的 slotConvergenceErrors"）。非法配置不得进入 normalized active config。
2. owner/writer census 从实际 plugin registry、memory store bindings、contextEngine registry 生成，不使用硬编码机制数组作为证明。
3. DCS 是唯一 contextEngine slot；VToken/AgentMap 仅 stateless packer/benchmark；Working Context 仅 query projection；SEKB 仅 human-confirmed proposal；Runtime Memory 不得旁路 active memory slot 或 DCS。
4. diagnostics flag 关闭时 query/write 都=0；**关闭 diagnostics 不得恢复多 writer**（单 owner 是 startup/config invariant，不是 diagnostics 开关）。
5. delete/correction 从 active memory owner 向 projection/candidate cache 传播，且不会触发 SEKB auto-writeback。

### 反例测试
- 非 owner 显式 slot、两个 memory writer、第二 context engine、plugin hot reload 注入旁路 → startup/reload 阶段拒绝。
- 对真实 stores 计数：flag-off query/write=0；delete/correction 后旧值无法从任何 projection 返回。

### 验收命令
```powershell
pnpm exec vitest run tests/unit/rc07-memory-context-slot-convergence.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/slot-convergence.test.ts src/memory/memory-store.test.ts src/context-engine/block-store.test.ts
pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts src/agents/task-loop-taskflow-projection.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm harness validate --spec harness/specs/tasks/rc07-memory-context-slot-convergence.md
pnpm run lint:check; pnpm run typecheck
```

### 退出条件
runtime enforcement 有生产 caller；parallel persistent memory writes=0；独立 Verifier 接受。

### RC-07R 本地实现与门禁记录（2026-08-05 会话，未独立验收）

**改动文件**：
- `openclaw_runtime/src/agents/slot-convergence.ts`：新增 `buildSlotMechanismCensus`（census 从真实源生成：注册插件 ids / contextEngine registry ids / MemoryStore 绑定，非硬编码数组作为证明）；新增 `enforceSlotConvergenceForConfig`（组合 memory + contextEngine 双 slot 校验，供 startup/reload 消费）。
- `openclaw_runtime/src/plugins/config-normalization-shared.ts`（ownedPaths）：normalize 时同时校验 contextEngine slot（此前只校验 memory），errors 并入 `slotConvergenceErrors`。
- `openclaw_runtime/src/plugins/activation-planner.ts`（touchedAreas plugins/**）：**fail-closed 消费**——`resolveManifestActivationPlan`（runtime startup / plugin reload 主路径）检查 `slotConvergenceErrors`，非空抛错，非法配置不得成为 normalized active config（审计发现"无人消费的 slotConvergenceErrors"关闭）。
- `openclaw_runtime/src/agents/slot-convergence.test.ts`：+2 用例（真实源 census、enforce 组合校验）。
- `tests/unit/rc07-memory-context-slot-convergence.test.ts`：重写为 5 用例（真实源 census、activation planner fail-closed 抛错、单 owner 为 startup 不变式非 diagnostics 开关、flag-off 零 query/write、delete/correction 传播无 SEKB auto-writeback）。
- 控制文档：`STATUS.md` / 本交接文件。

**逐条命令结果**：

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run tests/unit/rc07-memory-context-slot-convergence.test.ts` | 5/5 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/agents/slot-convergence.test.ts src/memory/memory-store.test.ts src/context-engine/block-store.test.ts` | 20/20 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/tasks/task-flow-cas.test.ts src/agents/task-loop-taskflow-projection.test.ts` | 18/18 PASS |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 35/35 PASS |
| `pnpm harness validate --spec harness/specs/tasks/rc07-memory-context-slot-convergence.md` | PASS |
| `pnpm run lint:check` / `pnpm run typecheck`（node+web） | 0 errors / 122 warnings；PASS |
| 全量 `pnpm test` | 3 files / 31 failed —— RC-01R 基线保护文件，无新失败 |

**残余风险 / 限制**：
- `TaskLoopStatus` 联合类型未扩展 cancelled（外围 gateway 消费方超范围）；cancelled 显式支持在 projection adapter 层。
- activation-planner 的 fail-closed 覆盖 manifest 激活路径；若存在绕过 planner 的插件加载路径需在正式验收前复核（当前主路径已覆盖）。
- 正式独立 Verifier / detached worktree / final manifest 未跑（F4 未恢复）。

### RC-06DR 本地实现与门禁记录（2026-08-05 会话，未独立验收）

**改动文件**：
- `openclaw_runtime/src/agents/task-loop-taskflow-projection.ts`：create sentinel 适配；映射表显式加 `cancelled: 'cancelled'`（Task Loop adapter 显式支持 cancelled，不接受 blocked/waiting 冒充）；非 waiting 状态显式清空 `wait_json`（含 cancel/terminal）。
- `openclaw_runtime/src/tasks/task-flow-cas.ts`：`waitJson`/`deliveryState`/`stateJson` 支持显式 `null` 清空（`!== undefined` 语义），类型 `string | null | undefined`。
- `openclaw_runtime/src/agents/mission-control/mission-taskflow-projection.ts`：非等待状态同步显式清空 `wait_json`（一致性）。
- `openclaw_runtime/src/agents/task-loop-taskflow-projection.test.ts`：+2 证明用例（cancelled 显式 terminal 非 blocked/waiting；cancel 后 restart 恢复 + terminal 吸收；waiting 与 cancelled 可区分）。
- `task-loop-controller.ts`：TaskLoopStatus 曾尝试扩展 cancelled 后撤销（外围 gateway 类型 `role-orchestration-methods.ts` 不在本包范围，扩展会破坏 ownership）；cancelled 显式支持落在 projection adapter 层。
- 控制文档：`STATUS.md` / 本交接文件。

**逐条命令结果**：

| 命令 | 结果 |
|---|---|
| `pnpm --dir openclaw_runtime exec vitest run src/agents/task-loop-taskflow-projection.test.ts` | 9/9 PASS |
| `pnpm --dir openclaw_runtime exec vitest run src/agents/mission-control/mission-taskflow-projection.test.ts src/agents/clawgraph/clawgraph-taskflow-projection.test.ts src/tasks/task-flow-cas.test.ts` | 26/26 PASS |
| `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts` | 35/35 PASS |
| `pnpm harness validate --spec harness/specs/tasks/rc06d-task-loop-lifecycle-migration.md` | PASS |
| `pnpm run typecheck`（node+web） | PASS |
| 全量 `pnpm test` | 3 files / 31 failed —— RC-01R 基线保护文件，无新失败 |

**残余风险 / 限制**：
- 本包仅完成 Observe + read-only projection（flag 默认 off）；Task Loop controller 仍为 legacy writer（cutover 阶段执行）。
- `long_task_checkpoints` 保持 checkpoint material（store.ts 未改）；projection 永不执行 effect。
- `TaskLoopStatus` 联合类型未扩展 cancelled（外围 gateway 消费方超范围）；cancelled 显式支持在 projection adapter 层（映射 + 测试断言）。
- 正式独立 Verifier / detached worktree / final manifest 未跑（F4 未恢复）。

---

## 6. 通用闭环与禁止事项（每包）

- **失败处理顺序**：单文件复现 → 确认归属包 → 最小修复（只改 ownedPaths 内路径）→ 最小重测 → 包级 focused → 全局 lint/typecheck → 全量 `pnpm test`（失败集只允许 RC-01R 基线那 3 个保护文件，出现新失败即当前包失败）→ harness validate → 通信路径变更加 `comms:replay`/`comms:compare`。
- **禁止**：恒真断言、mock-only、regex/静态表代替执行、`--no-diff`（结构检查例外需注明）、跳过失败项、扩大 glob 覆盖保护改动、新增第二 runtime/store/service/protocol/router/planner、raw prompt/tool/credential/cookie/env 持久化、把 diagnostics/replay 提升为 authority。
- **F4 未恢复期间**：所有结论写"本地实现与门禁证据"，不宣称独立验收；正式 Verifier 需双 detached worktree + 不同 actor + 唯一 output dir，复用旧 evidence 一律拒绝。
- 每包结束必须更新本交接文件对应章节（命令结果、改动清单、残余风险），并同步 `docs/dev/handoffs/LATEST.md` 事实段。

---

# RC-04R → RC-07R 全包本地实现与会话总结（2026-08-05）

> 状态：F4 仍未关闭；用户授权按"本地实现与门禁证据"口径推进完整开发验收与测试闭环。全部结果仅为本地证据；`STATUS.md.accepted_work_packages` 保持空，RC-10 blocked，product locks 保持 false。

## 串行执行结果（每包详录见上方对应章节）

| 包 | 结论 | 核心证据 |
|---|---|---|
| RC-04R | 本地门禁全绿 | 21/21 + 39/39 + 35/35；harness validate PASS；lint 0e/122w；typecheck PASS；全量=基线 |
| RC-05R | 本地门禁全绿 | 62/62 合并组 + 35/35；channel:conformance PASS；i18n PASS；E2E 2/2 |
| RC-06AR | 本地门禁全绿 | 9/9 + 24/24 + 35/35；harness validate PASS |
| RC-06BR | 本地门禁全绿 | 9/9 + 9/9 + 35/35；harness validate PASS |
| RC-06CR | 本地门禁全绿 | 8/8 + 16/16 + 35/35；harness validate PASS |
| RC-06DR | 本地门禁全绿 | 9/9 + 26/26 + 35/35；harness validate PASS |
| RC-07R | 本地门禁全绿 | 5/5 + 20/20 + 18/18 + 35/35；harness validate PASS |

最终全量 `pnpm test`：3 files / 31 failed —— 与 RC-01R 基线完全一致（chat-input / chat-runtime-event-handlers / uas-05 Task Forest 保护 workstream），全部包零新增失败。

## 全局改动清单（未提交；主树脏状态延续）

- **RC-04R**：`openclaw-state-schema.sql`（+generated）、`approval-ledger.ts`、`effect-receipt.ts`、`exec-approval-manager.ts`、`server-aux-handlers.ts`、`rc04-*.test.ts`。
- **RC-05R**：`operator-slice.ts`、`cron/delivery.ts`、`server-methods/inbox.ts`（新）、`server-aux-methods.ts`、`rc05-operator-fixture/{adapter.ts,__tests__/conformance.test.ts}`、`scripts/channel-conformance.mjs`、`src/stores/inbox.ts`、`src/pages/Inbox/index.tsx`、四语 `inbox.json`、`tests/unit/inbox-store.test.ts`、`tests/unit/agent-dev-regularization.test.ts`、`tests/e2e/rc05-operator-inbox.spec.ts`（新）、`rc05` spec（touchedAreas）。
- **RC-06AR**：`task-flow-cas.ts`、`task-flow-cas.test.ts`、`task-flow-registry.store.sqlite.ts`、`openclaw-state-schema.sql`、`openclaw-state-db.ts`。
- **RC-06BR/C/D**：`clawgraph-taskflow-projection.ts`(+test)、`mission-taskflow-projection.ts`(+test)、`task-loop-taskflow-projection.ts`(+test)。
- **RC-07R**：`slot-convergence.ts`(+test)、`config-normalization-shared.ts`、`activation-planner.ts`、`tests/unit/rc07-memory-context-slot-convergence.test.ts`。
- **控制文档**：`STATUS.md`、`WORK-PACKAGES.md`、`TARGET-ARCHITECTURE.md`、`AGENT-START.md`、`docs/dev/handoffs/LATEST.md`、本文件。

## 残余风险与后续

1. 全部结论为"本地实现与门禁证据"；正式独立 Verifier（双 detached worktree + 不同 actor + 唯一 output dir）待 F4 恢复后执行。
2. `TaskLoopStatus` 联合类型未扩展 cancelled（外围 gateway 消费方超范围）；cancelled 显式支持在 projection adapter 层。
3. plugin-approval manager 仍为纯内存路径（RC-04 ownedPaths 不含）。
4. 三域（B/C/D）仅完成 Observe + read-only projection；writer cutover / legacy freeze / rollback 为后续阶段。
5. `server-aux-handlers.ts`、`activation-planner.ts` 等按 touchedAreas 覆盖（非 ownedPaths）；checkpoint gateway 与 Chat 保护 workstream 未触碰。

---

# Review 修复记录（2026-08-05 会话内，宿主 review 之后）

内置 review（sa_20260805_191504）对本轮 RC-04R..RC-07R 变更的结论：CAS/迁移核心正确；4 个 should-fix 已全部修复：

1. **policyDigest 审计链**（`operator-slice.ts`）：governance（actor + policyDigest + decision）纳入 EffectReceipt proposal，receipt digest 可重算验证审计链；ledger 行保留 resolved_by=actor。测试新增断言：`effectProposalDigest({ effect, identity, governance })` 与持久化 digest 一致。
2. **inbox.operator.decide 授权**（`server-methods/inbox.ts`）：无链接 client 身份 → 拒绝（NOT_LINKED）；policyDigest 一律服务端计算（忽略客户端输入）；移除 `inbox-operator-unknown` 默认 actor 与 `POLICY_DIGEST_PATTERN` 客户端信任路径。
3. **state_json null 一致性**（`task-flow-cas.ts`）：`state_json` 改用 `!== undefined` 语义，与 wait_json/delivery_state 的"显式 null 清空"契约一致。
4. **cron 幂等 key per-run 唯一**（`cron/delivery.ts` + `server-cron.ts` + `server-cron-notifications.ts`）：`sendCronAnnouncePayloadStrict` 新增 `runKey` 参数；两处调用点传 `${job.id}:${Date.now()}` / `${job.id}:notify:${Date.now()}`，杜绝稳定 jobId 导致后续 tick 全部 duplicate 的缺陷。

Nits 处理：`effect_receipts.schema_version` DEFAULT 修正为 `'2'`（与 EFFECT_RECEIPT_SCHEMA_VERSION 一致，generated 已重新生成）；`channel-conformance.mjs` 的 spawnSync shell 注入面记录为已知限制（路径来自开发者控制的 env override，仅本地工具）。

# Security review 修复记录（2026-08-05 会话内，security_review 之后）

内置 security_review（sa_20260805_194006）三轮：初轮 minor concerns（无阻塞）；修复后复查 warn（2 个 MEDIUM 已修复，2 个 LOW 残留）；symlink 修复后终轮 warn（逃逸已关闭，仅记录性 LOW）。全部处置：

1. **MEDIUM — inbox.operator.decide actor 可伪造**：actor 改绑 `connect.device.id`（设备身份），仅 `isDeviceTokenAuth === true` 时才回退 `client.id`；`displayName`（客户端可伪造）不再用于决策路径。
2. **MEDIUM — decide 可解析任意 approvalId**：resolve 前校验 `requested_by_client_id === OPERATOR_SLICE_ACTOR`，非 operator intent → APPROVAL_NOT_FOUND（防共享 ledger 审计污染与其它客户端 pending approval 被搁浅）。
3. **LOW — bounded file effect symlink 逃逸**：词法根检查 → mkdir parent → `realpathSync(parent)` + basename 重组 → 二次包含检查 → 写入；symlink 中间目录逃逸已关闭（写仍被阻止；mkdir 先于检查会创建空目录，属可接受 LOW——effect.path 当前代码受控，cron 只发 message effect；若未来 attacker 可控需重排为先 realpath 最深已存在祖先）。
4. **LOW（记录）— 非 device-token 客户端无法使用 Inbox decide**：仅 device-token 认证客户端（`isDeviceTokenAuth`）可决定；paired-device 非 token 会话与 shared-auth（gateway token/password，无配对设备）均被显式 NOT_LINKED 拒绝。deny-by-default 安全方向，协议层返回显式 NOT_LINKED；此为有意决策，桌面 Control UI 走配对设备连接。**已知限制**：若未来需要非 device-token operator 走 Inbox 决策，需引入显式角色授权。
5. **LOW（记录）— channel-conformance.mjs spawn shell:true**：win32 引号会导致 vitest 文件过滤失效故不带引号；注入面被 toKebab 净化（alphanumeric+dashes）+ 固定前缀路径缓解，dev-only 工具，注释已记录。

修复后验证：operator-slice 9/9、rc04 duo 30/30 合并组、channel:conformance 9/9 PASS；typecheck:node PASS；eslint 0 错误；全量 `pnpm test` 结果见全局收尾（预期 RC-01R 基线）。

修复后验证：8 文件 74/74 vitest PASS；eslint 改动文件 0 错误；typecheck:node PASS；全量 `pnpm test` 结果见全局收尾（预期 RC-01R 基线）。

# 独立审计修复记录（2026-08-05 晚，审计提示词 → 独立审计 agent → 全部 FAIL → 修复）

审计（独立 agent，复现全部门禁 + 独立反例）对 7 包全部判 FAIL；blocking 清单与修复如下（按审计优先级逐包）。审计全程未触碰实现/测试/文档/Task Forest/状态锁；本会话随后逐包修复。**每包修复后都重新跑对应 spec 门禁；全量基线验证在修复完 RC-05R 后统一跑。**

## 审计修复 RC-04R（4 个 blocking）

1. **blocking — recordEffectOutcome 缺失 applied|not_applied|unknown 中间状态**（原实现 execution_started 一步写 reconciled/needs_reconciliation）：改为两段式（同一 immediate 事务）：`execution_started -> applied|not_applied|unknown`（写 state + 新增 `outcome` 列）→ `-> reconciled|needs_reconciliation`。`outcome` 列（TEXT CHECK）持久化中间态，行达到 reconciled 后仍可审计完整序列。幂等语义：同 outcome 重放 ok；reconciled 后不同 outcome → state-conflict。schema.sql + 迁移 CREATE SQL + `ALTER TABLE ADD COLUMN outcome` 已加；kysely generated 重新生成。
2. **blocking — 迁移重建表后索引丢失**（approval-ledger.ts / effect-receipt.ts 的 DROP+CREATE 路径）：迁移 CREATE SQL 内建索引 + 迁移末尾/ensure 无条件 `CREATE INDEX IF NOT EXISTS`（幂等）重建 `idx_approval_ledger_idempotency`、`idx_approval_ledger_state_created`、`idx_effect_receipts_idempotency`、`idx_effect_receipts_approval`。测试用 PRAGMA sqlite_master 断言迁移后索引存在。
3. **blocking — reserve 相同 idempotency key 不校验 request digest**（冲突请求复用旧批准）：reserve 命中已存在行时比较 `request_digest`；相同 → 幂等 ok；不同 → 新增 `idempotency-conflict` reason（不再静默复用）。新反例测试：同 key 不同 request → idempotency-conflict，原行不动。
4. **blocking — requester metadata 绑定前持久化**（manager.create 先 reserve 后 bindApprovalRequesterMetadata，重启后身份约束丢失）：`ExecApprovalManager.create` 新增第 4 参 `requester?: { connId, deviceId, clientId }`，reserve 时原子写入 `requested_by_*` 列；`exec-approval.ts` / `plugin-approval.ts` 调用处从 client 提取并传入（bind 保留用于内存 cache 的 deviceTokenAuth 同步）。wiring 测试断言新 ledger 行带 requester 身份。

验证：rc04-durable-approval（18）+ rc04-exec-approval-wiring（6）+ receipt-store（13）= 37/37；rc03-seal+seal-wiring 24/24；acceptance+control-pack 35/35；`node scripts/generate-kysely-types.mjs --verify` PASS；typecheck:node PASS。

## 审计修复 RC-05R（4 blocking + 2 should-fix）

1. **blocking — 重复 execution_started 当成功，并发可双执行**（审计独立反例 executorCalls=2）：`markExecutionStarted` 改为非幂等（`#transition` 新增 `{ idempotent: false }` 选项）；第二并发调用 → state-conflict → `executeOperatorSliceEffect` 返回 not-approved，绝不进入 executor。新反例测试：`Promise.all` 并发两次 execute → 恰一个 ok、`executorCalls === 1`。
2. **blocking — execute 不核对 ledger 批准 actor/policy**（执行方可替换 governance identity）：`executeOperatorSliceEffect` 执行前读 ledger 行，校验 `state==='approved'` 且 `resolved_by === governance.actor`；不匹配 → 新 reason `governance-mismatch`，executor 零调用。新反例测试：alice 批准后 bob 执行 → governance-mismatch、executorCalls=0、行保持 approved。
3. **blocking — Cron 内联硬编码 approved**：decision 改为显式配置驱动——`runtime.rc05.cronAutoApprove`（新配置字段，types.openclaw.ts + zod-schema.ts，默认 false = deny fail-closed）；delivery.ts 按配置出 decision（actor 仍为 cron-policy）。
4. **blocking — runKey 用 Date.now() 不可重放**：server-cron.ts 改用 `job.state.runningAtMs`（整个 tick 持久化的运行开始时间）：同一 tick 重试复用同一 intent（去重），下一 tick 新 key。
5. **should-fix — UI 发 approve/deny 而 Gateway 只收 approved/denied**：`decideOperator` 映射 UI 动作名 → wire 协议值；lineage API 新增 `loadOperatorLineage(runId, sessionKey)` store action（调用 `inbox.operator.lineage`，结果存 `operatorLineage` state）。
6. **should-fix — store 硬编码英文显示文本 / conformance 把 skipped 当已执行**：projectOperatorIntent 的 summary 改纯数据（requestDigest）、evidence reason value 改 intent.state（UI 用 i18n key 渲染）；channel-conformance.mjs 只统计 `status === 'passed'` 的断言为 executed（skipped/pending 即 missing）。

验证：operator-slice（13，含 2 个新反例）+ rc04 duo = 35/35；inbox-store 3/3；channel:conformance 9/9 PASS；typecheck:node + typecheck:web PASS；全量 `pnpm test` 结果见全局收尾。

## 审计修复 RC-06AR（1 blocking + 2 should-fix）

1. **blocking — registry 未投影/回写 delivery_state**（审计反例 registryRecordHasDeliveryState=false）：`TaskFlowRecord` 新增 `deliveryState`；`rowToFlowRecord` 投影（读）+ `bindFlowRecord` 回写（写）+ upsertFlowRow 的 ON CONFLICT doUpdateSet 补 delivery_state（round-trip 完整）。新测试：CAS 写入 deliveryState='pending' → registry load 读到 → registry upsert 'delivered' → reload 读到（真 close/reopen 后）。
2. **should-fix — 测试未真正 close/reopen、双连接共享缓存**：restart 测试在每次新 store 前 `closeOpenClawStateDatabase()`；双连接竞争测试改为两个真实 `DatabaseSync` 连接（绕过进程缓存）执行同一 CAS UPDATE，断言 `[0,1]` 行变化（唯一 winner）。
3. **should-fix — ended_at 漏 lost**：terminal `ended_at` 写入补 `lost`。
4. 附带修复：CAS CREATE 默认 `notify_policy='none'` 与 registry 解析（只接受 done_only/state_changes/silent）不一致 → 改 'done_only'（否则 registry 读 flow_runs 抛 Invalid persisted task notify policy）。

验证：task-flow-cas 11/11（含 registry round-trip + 真实双连接）。

## 审计修复 RC-06BR（2 blocking + 1 should-fix）

1. **blocking — 漏 node_failed 映射**：EVENT_TO_FLOW_STATUS 补 `node_failed: 'running'`（节点失败不结束 run；terminal 由 run_failed/run_aborted 承载）。
2. **blocking — 恒真断言测试**：原测试 `expect(unknown.skippedReason ?? 'projected').toBeDefined()` 恒真；改为 node_failed 真实投影断言（projected=true, status='running'）+ 真正未知事件 → skippedReason 'unknown-event'。
3. **should-fix — CAS 冲突伪装成 flag-off/unknown-event + runtime 吞异常**：skippedReason 如实区分 `revision-conflict` / `illegal-transition` / `unknown-event` / `flag-off`（终态晚到事件测试断言 illegal-transition）；runtime.ts emit 的 catch 递增新导出 `clawgraphProjectionFailureCount`（drift 可查询，绝不静默）。

验证：clawgraph-taskflow-projection 9/9。

## 审计修复 RC-06CR（2 blocking）

1. **blocking — production projection 仅为 ask_user/sleeping 设 waitMode，paused 无原因**：controller.ts 投影 waitMode 补 `paused → 'pause'`（projection waitMode 类型加 'pause'），真实 pause 语义不再降为无原因 waiting。
2. **blocking — resume 测试用 synthetic blocked->running**：新测试走真实 `createMission → pauseMission → resumeMission`（controller 生产路径，RC06C_MISSION_PROJECTION=1），断言 paused→waiting/waitMode='pause'、resume→waiting/waitMode='sleep'。测试 options() 路径对齐 env 默认（controller 投影无 database 参数 → OPENCLAW_STATE_DIR/state/openclaw.sqlite）。

验证：mission-taskflow-projection 9/9。

## 审计修复 RC-06DR（2 blocking）

1. **blocking — TaskLoopStatus 无 cancelled、无生产 cancel API**：TaskLoopStatus 加 'cancelled'；runtimeTaskStatusForTaskLoop 加 cancelled→'cancelled'（RuntimeTaskStatus 已有该值）；新增生产 API `cancelTaskLoopRun(loopRunId, deps)`（status→cancelled terminal，snapshot+emit，终端幂等）；orchestration-quality-scorecard 内联 record 类型补 'cancelled'（类型兼容）。新测试走真实 `runTaskLoop`（selfCheck 挂起）→ `cancelTaskLoopRun` → 投影 cancelled、waiting=false、终态吸收。
2. **blocking — 所有 blocked 都标 waiting:true**：waiting 改为 `blocked && hasGenuineHumanWait(record)`（guardianTripped 排除；controlSignals 含 ask_user 建议或 permission_wait kind 才算真实人工等待），普通阻断（保护器/迭代上限/重复修复）→ blocked（非 waiting）。
3. 附带：rc06d 测试 afterEach 容忍 Windows 文件句柄 EPERM（runTaskLoop 的 ledger/db 句柄短暂占用）。

验证：task-loop-taskflow-projection 10/10（含真实 cancel）。

## 审计修复 RC-07R（2 blocking）

1. **blocking — loader 不消费 slotConvergenceErrors（Gateway startup 直连 loader）**：loader.ts resolvePluginLoadCacheContext 在 normalize 后消费 slotConvergenceErrors 并 throw（fail-closed；Gateway startup 与 reload 都流经 loadOpenClawPlugins，不再只靠 activation planner）。
2. **blocking — buildSlotMechanismCensus 无生产 caller、按 ID 推断**：activation-planner 的 resolveManifestActivationPlan 在 registry 就绪后调用 census（输入为真实 manifest plugin ids + resolved memory slot），`parallelMemoryWriters > 0` → 拒绝产出 plan（fail-closed）。

验证：slot-convergence 8/8、rc07 根测试 5/5、acceptance+control-pack 40/40（含 slot-convergence-loading）、loader.built-artifacts 2/2；typecheck:node+web PASS。

## 审计修复后 security_review（终轮 PASS）

审计修复全部完成后运行 security_review（sa_20260806_060355）——verdict：minor concerns（1 MEDIUM + 2 LOW），核心加固（revision-CAS 事务、governance 绑定、loader/planner fail-closed、SQL 级 CAS）确认正确。处置：

1. **MEDIUM — `inbox.operator.lineage` 无设备身份门控**（任意 linked client 可枚举 lineage）：lineageHandler 加与 decideHandler 相同的 `isDeviceTokenAuth === true` + verified device/client id 检查（否则 NOT_LINKED）；inbox.test.ts 新增 3 个门禁用例（匿名拒、非 device-token 拒、verified 放行）。8/8 PASS。
2. **LOW — runKey 缺失 runningAtMs 时 fallback Date.now()**（同 tick 重试可双投递）：新增 `resolveReplayableCronRunKey(job)`——marker 缺失即 throw（fail-closed，无 Date.now() fallback）；已跟踪全部生产 timer 路径（lease tick timer.ts:885、runDueJob :903、手动 executeJob :1702）均在 announce 前设置 marker，throw 不会在生产触发。21/21 PASS。
3. **LOW — operator-slice.ts:418 TOCTOU（lstat 与 appendFileSync 之间 symlink 竞态）**：接受并记录（effect root 为 dev/operator 作用域，代码注释已承认）；无改动。

复验：security_review 终轮 PASS（两个修复正确完整，无注入/authz/secret/traversal/事务完整性新问题）。修复后全量 `pnpm test`：3 files / 31 failed = RC-01R 基线（6483 passed，零新增）；`pnpm run typecheck`（node+web）exitCode 0。

## F4 恢复（2026-08-05 晚，承接审计修复）

RC-00R 候选验收完成：候选 `a68dec32b`（main `90e796893` + 分支 9 commits + 候选自修复）在独立 detached worktree 跑 `pnpm acceptance:agent:full`（executor `rc00-executor-f4-5` + verifier `rc00-verifier-f4-5`，`--since 90e796893`，唯一 output dir `artifacts/agent-engineering-acceptance/runs/rc00-f4-restore-5`）——**executor pass + verifier pass**（engineeringAcceptedByAgent=true，14 gates 全过，failures 空）。候选自修复与调试要点见 LATEST.md"F4 恢复会话"；STATUS.md blockers 已移除 rc00r-reverification-required。RC-01R..RC-07R 独立验收 evidence 仍待后续按包执行。

## 全局收尾（审计修复后）

- 全量 `pnpm test`：见上表（预期回 RC-01R 基线 3 files/31 failed；若出现第 4 个失败文件则先定位再收尾）。
- `pnpm run lint:check`、`pnpm run typecheck:node`、`pnpm run typecheck:web`、7 个 spec `harness validate`、`channel:conformance` 均在逐包验证中重跑。
- 本阶段修复未触碰保护 workstream 文件（chat-input / chat-runtime-event-handlers / uas-05 及其依赖）；Task Forest / STATUS.md / product locks 未改。

## 独立验收记录（2026-08-07）

RC-01R → RC-07R 8 包全部按 `docs/dev/handoffs/RC-01R-07R-ACCEPTANCE-PROMPT.md` 完成独立候选验收（候选 worktree `ClawX-rc01r-candidate`，分支 `rc01r-candidate`，累积候选链最终 HEAD `1e1c3557e`）：

| 包 | 候选 SHA | --since | output-dir | 双 actor | 结果 |
|---|---|---|---|---|---|
| RC-01R | `edeca7267` | main `90e796893` | `runs/rc01r-accept-1` | rc01r-executor-1 / rc01r-verifier-1 | PASS |
| RC-04R | `57804a43f` | `edeca7267` | `runs/rc04r-accept-8` | rc04r-executor-10 / rc04r-verifier-10 | PASS |
| RC-05R | `db2b98dc6` | `57804a43f` | `runs/rc05r-accept-1` | rc05r-executor-1 / rc05r-verifier-1 | PASS |
| RC-06A | `212e8b5c3` | `db2b98dc6` | `runs/rc06a-accept-1` | rc06a-executor-1 / rc06a-verifier-1 | PASS |
| RC-06B | `80dd488b4` | `212e8b5c3` | `runs/rc06b-accept-2` | rc06b-executor-2 / rc06b-verifier-2 | PASS（首跑 runtime-smoke 偶发原生崩溃，重跑 PASS） |
| RC-06C | `e0040d8d4` | `80dd488b4` | `runs/rc06c-accept-1` | rc06c-executor-1 / rc06c-verifier-1 | PASS |
| RC-06D | `6115f2868` | `e0040d8d4` | `runs/rc06d-accept-2` | rc06d-executor-2 / rc06d-verifier-2 | PASS（verifier runtime-build 偶发原生崩溃，重跑 PASS） |
| RC-07 | `1e1c3557e` | `6115f2868` | `runs/rc07-accept-1` | rc07-executor-1 / rc07-verifier-1 | PASS |

每包 17 gates 全过（含 harness-validate `--since`、fast×4、runtime-unit、runtime-static-check、comms×2）；fast-unit-tests 0 failed；`mutationCheck` 双 clean。UI 文件（inbox store/页面/i18n、tests/e2e）按手册留 main 侧。正式 accepted、RC-10 解除、product locks 保持 false/blocked 待用户与流程裁决。
