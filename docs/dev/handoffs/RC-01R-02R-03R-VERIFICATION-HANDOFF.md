# RC-01R → RC-02R → RC-03R 真实开发验收与闭环修复 — 交接提示词

> 用途：本文件是交给下一位开发/验收 agent 的完整任务提示词。下一位 agent 必须基于**真实命令输出**验收，不允许以“预计会过”“测试名看着对”“实现者自述”代替执行证据。
> 状态红线：**RC-00R F4 仍未关闭**；RC-01R/02R/03R **未 accepted、未 done**；`STATUS.md.accepted_work_packages` 保持空；RC-10 保持 blocked；`liveReady/productApproved/defaultOn` 保持 false。本轮所有开发在脏主工作树完成，**未提交任何内容**。

---

## 0. 给下一位 agent 的总体要求

1. 工作目录只能是 `C:\Users\27933\Desktop\clawx\ClawX`（主工作树）。
2. **禁止**：`git worktree add/remove/prune`、进入/创建/复制其他 worktree、`cherry-pick`、`rebase`、`checkout`、`stash`、`reset`、`clean`、`git add -A`；不借用其他 worktree 的产物。
3. **保护 workstream（不得回滚、删除、覆盖、整体暂存，不得伪装成 RC 修复）**：`.agent-workbench/task-forest/**`、`src/pages/Chat/ChatInput.tsx`、`src/stores/chat.ts`、`src/stores/chat/runtime-event-handlers.ts`、`shared/chat/types.ts`、`openclaw_runtime/src/agents/tool-loop-detection.ts`（P0-3 语义改动）、`openclaw_runtime/src/gateway/**`（checkpoint gateway）、`docs/dev/handoffs/**`、研究文档、`tests/unit/chat-*.test.*`。
4. 串行规则：先验收 RC-01R，全绿后再验收 RC-02R，再 RC-03R；任一包失败，只修当前包，不得并行预实现后续包，不得用跳过、扩 glob、mock-only、regex 或静态表绕过。
5. 验收结论措辞：F4 未关闭期间，结论只能是“本地实现与门禁证据”，不得宣称 clean-candidate 或独立验收通过。

## 1. 当前仓库状态（验收起点）

- 分支：`fix/rc00r-acceptance-control-plane`；HEAD=`2e16093f4`（前序已含 RC-01R 基础 commit：`515c400b6`、`3d0c7a739`）。
- `acceptedBaseSha`= `6493d5cce6fbfa558aa26eb4cfb5a4cd71504664`（= `origin/main`，HEAD 的祖先）。
- 工作树包含**接力/未提交改动**（RC-02/03 relay 实现 + 本会话完成内容），全部保留、全部未提交。
- 已跟踪基线：`artifacts/runtime-authority-convergence/rc-01/baseline.json`（Git 跟踪，与工作树一致）。

### 本会话完成的关键开发（供验收时核对）

**RC-01R**（前序 commit 已落地，本会话验证）：
- baseline.json Git 跟踪 + deterministic（`generatedAt` 派生自 acceptedBaseSha，非 wall-clock）+ generator 对缺失 owner path fail-closed。
- `scripts/rc01-authority-inventory.mjs`、`scripts/rc01-baseline-validate.mjs`、`tests/unit/rc01-authority-inventory-baseline.test.ts`、`harness/specs/tasks/rc01r-self-contained-baseline.md`。

**RC-02R**（relay + 本会话适配，全部未提交）：
- `openclaw_runtime/src/agents/receipt-store.ts`：typed canonical input（含 `ReceiptBudget`、`ReceiptIdentity` 校验）、内部重算 `contentDigest`（caller 不可伪造）、同 idempotency key 同内容幂等/不同内容 conflict、canonical ref 支持 URL-encoded segment（`%`）。
- `shadow-census.ts`：ShadowContextReceipt/v0（provider projection 前）＋ ShadowWireReceipt/v0（guarded request boundary，finalizer 之后、send 之前）；npm fallback `runtimeMode=npm`/`receiptCoverage=0`/`readiness=false`；shadow 写失败只记 census，不改变发送行为。
- 八入口真实生产调用链（desktop chat / cron / channel fixture / CLI-compact / embedded attempt / context engine / payload hook / provider transport）＋ transport spy；provider registry 为 coverage 分母。
- 本会话为保持全局 typecheck 绿的调用方适配：`context-engine/dcs-receipts.ts`（budgetSummary JSON → typed ReceiptBudget）、`rc03-seal-hook.ts`/`rc03-seal.test.ts`（identity/digest/ref 适配）。

**RC-03R**（本会话完成，全部未提交）：
- `rc03-seal-hook.ts`：`resolveRc03SealState(cfg, env)`（env `OPENCLAW_RC03_SEAL` + config `runtime.rc03.seal` + enhancement kill switch，默认 off）；`appliedProducerIdsFromLineage`（真实 producer 执行结果，不再全标 applied）；seal plan 按 runId 记录；ContextReceipt/v1 写失败进 shadow census diagnostics。
- `context-orchestrator.ts`：`finalizeContextOrchestratorTurn` 支持 `cfg`，无显式参数时从真实 config 解析 RC-03 seal。
- `shadow-census.ts` `emitRc03WireReceipt` ＋ `provider-transport-fetch.ts`：guarded boundary 在 rc03Plan 存在时持久化 **WireReceipt/v1**（绑定最终 body digest + 注册的 non-semantic transform ids），写失败进 census。
- `stream-resolution.ts`/`extensions.ts`/`run/attempt.ts`：真实 config/runId 接线，seal plan 流入 transport。
- `rc03-seal-wiring.test.ts`：+6 个反例（config 驱动 seal、kill switch parity、producer applied 真值、写失败 census、`resolveRc03SealState`、WireReceipt/v1 guarded boundary digest）。

---

## 2. 完整验收测试（按包执行，逐条记录命令与真实输出）

> 规则：每条命令必须**实际执行**并记录 exit code / test counts；不得用缓存结果、fast gate 冒充 final gate；不得加 `--no-diff`（结构检查例外需注明）。

### 2.1 通用全局门禁（每个包验收前都跑）

```powershell
pnpm run lint:check
pnpm run typecheck
```

- 期望：lint 0 errors（122 warnings 为既有基线，不得新增 error）；typecheck `success: true`、node/web 两 project exit 0。

### 2.2 RC-01R 验收

```powershell
pnpm exec vitest run tests/unit/rc01-authority-inventory-baseline.test.ts
pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm exec vitest run tests/unit/harness-specs.test.ts
pnpm harness validate --spec harness/specs/tasks/rc01r-self-contained-baseline.md
node scripts/rc01-baseline-validate.mjs
```

- 期望：16/16、8/8、17/17 通过；harness validate “Spec is valid”；baseline validate PASSED（classified=41、modules=16/16）。
- Determinism：连续两次 `node scripts/rc01-authority-inventory.mjs` 后 `git diff -- artifacts/runtime-authority-convergence/rc-01/baseline.json` 为空；`git ls-files` 包含 baseline；`acceptedBaseSha` 是 HEAD 祖先。

### 2.3 RC-02R 验收

```powershell
pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/shadow-census.test.ts src/agents/rc02-shadow-census.acceptance.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm harness validate --spec harness/specs/tasks/rc02-full-payload-shadow-census.md
pnpm run comms:replay
pnpm run comms:compare
```

- 期望：15/15＋7/7＋8/8 通过；acceptance＋control-pack 通过；harness validate “Spec is valid”；comms 写 `artifacts/comms/current-metrics.json` 与 `compare-report.md` 且指标全 PASS。
- 反例核对（测试名即证据）：
  - 同 idempotency key 同内容 → `identical-content` duplicate；不同语义内容 → `content-conflict` 且不写入。
  - caller 注入 `contentDigest` → 拒绝（unsupported field）；raw prompt/credential/cookie/环境变量字段 → 拒绝。
  - 每个 provider（openai×3、azure、anthropic×2、google×2、bedrock、vertex）都产生 correlated shadow_context＋shadow_wire，registry 为分母。
  - npm fallback：`runtime_mode=npm`、`receiptCoverage=0`、`readiness=false`、degraded reason。
  - shadow 写失败：`failed=true`、census `acceptanceReady=false`，发送 bytes/顺序不变。

### 2.4 RC-03R 验收

```powershell
pnpm --dir openclaw_runtime exec vitest run src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts
pnpm --dir openclaw_runtime exec vitest run src/agents/receipt-store.test.ts src/agents/shadow-census.test.ts src/agents/rc02-shadow-census.acceptance.test.ts
pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
pnpm harness validate --spec harness/specs/tasks/rc03-dcs-seal-dual-receipts.md
```

- 期望：rc03 pair 通过（含 6 个 RC-03R 反例）；rc02 trio 仍全绿（回归）；acceptance＋control-pack 通过；harness validate “Spec is valid”。
- 反例核对：
  - 正常 agent turn 不传测试参数、仅 env/config 开 flag → 进入 seal 并持久化 ContextReceipt/v1。
  - config off / 无 env → 不 seal；kill switch → 不 seal、不写 receipt、messages 逐字节不变。
  - producer applied 真值：lineage 中 `charsApplied=0` 的 producer 不标 applied。
  - ContextReceipt 写失败 → `contextReceiptPersisted=false` 且 census `acceptanceReady=false`。
  - guarded boundary：真实 transport spy 拦截的最终 body digest 与 WireReceipt/v1 的 `wire_digest` 一致，`transform_ids_json` 含 `transport-wire-serialization`。

### 2.5 构建与全量

```powershell
pnpm --dir openclaw_runtime run build
pnpm run build:vite
pnpm test
```

- 期望：runtime build 与 vite build 成功；`pnpm test` 全量 3 files/31 tests failed——**必须逐项核对失败文件**，只允许 `tests/unit/chat-input.test.tsx`、`tests/unit/chat-runtime-event-handlers.test.ts`、`tests/unit/uas-05-verseshell-process-lifecycle.test.ts`（保护 workstream），与 RC-01R 基线一致；出现任何新失败即当前包失败。

### 2.6 E2E（受限项，如实记录）

- 已知环境问题：pnpm 11 忽略 deprecated `shamefully-hoist`，`kysely`/`tslog` 未 hoist 到根 `node_modules`（require 链为 HEAD 既有代码，非本 diff 引入）。修复后 `zoom-shortcuts.spec.ts` PASS；`main-navigation.spec.ts` 2 个 failure 在保护 UI workstream 路径。
- 验收要求：如实记录“E2E 受限”及原因，不得把它写成本包失败或本包通过证据。

---

## 3. 修复完整闭环（发现失败时的处理顺序）

1. **最小定位**：先跑失败测试单文件，读实现与调用方，确认归属包（不得归咎保护 workstream 或“不是本 diff 引入”）。
2. **最小修复**：只改当前包 spec `ownedPaths` 内路径；新路径必须同步加入对应 RC spec 的 `ownedPaths`（路径精确，禁止宽 glob）。
3. **最小重测**：修复后先跑该测试文件 → 再跑该包全部 focused 测试 → 再跑全局 `lint:check`/`typecheck` → 再跑 `pnpm test` 全量确认失败集无新增。
4. **规格同步**：行为/接口变化后跑 `pnpm harness validate --spec <该包spec>`；涉及通信路径跑 `comms:replay`/`comms:compare`。
5. **重复直至闭环**：任一 gate 非绿，继续修当前包；当前包全绿后才允许验收下一包。
6. **禁止的绕法**：恒真断言、mock-only、regex/静态表代替执行、`--no-diff`、跳过失败项、扩大 glob 覆盖保护改动。

## 4. 提交与进入下一阶段的判定

1. 三包本地门禁全绿后，**由用户决定是否授权提交**。提交必须是三个独立 commit（RC-01R → RC-02R → RC-03R），每个 commit 只含该包 spec ownedPaths 允许的路径；禁止 `git add -A`，禁止把保护 workstream 混入。
2. **F4 恢复是正式验收的硬前置**：恢复双 detached worktree ＋ 独立 Verifier 后，在干净 checkout 复跑全部 gate（含 clean clone 基线可读、determinism、全局绿线），由不同 actor 生成 `final-report.json`。
3. 只有 RC-03R 被独立 Verifier 接受后，才允许解锁 **RC-04R**（durable approval 唯一权威 + 严格 CAS 状态机）；`STATUS.md.accepted_work_packages` 在 Verifier evidence 存在前保持空。
4. 下一位 agent 的最终输出必须包含：逐条命令与 exit/test counts、改动文件清单、未跑项与原因、残余风险、当前包状态，以及明确的“F4 未关闭 / 本地证据 vs 正式验收待补”声明。
