# P5 执行提示词：Critical-first 自适应预算

> 状态：P5 前置准备已完成，本提示词用于实际执行 P5
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线：`734ec877e75682861103660fbdea2bd55253ece0`
> 详细开发约束：`reports/context-compression/P5-DEVELOPMENT-PROMPT-2026-08-17.md`
> 上一阶段验收：`reports/context-compression/P4-ACCEPTANCE-EVIDENCE-2026-08-17.md`

---

## 1. 任务

按照 `P5-DEVELOPMENT-PROMPT-2026-08-17.md` 完成 P5，并在全部命令通过后
写 `reports/context-compression/P5-EVIDENCE-2026-08-17.md`。

P5 只做三件 runtime 事：

1. 给 `selectCompressionPlan` / `planCompression` 增加可选
   `thresholds` / `tierSchedule`；缺省行为与现在完全一致。
2. 在 `compact.ts` / `compaction-safeguard.ts` 的真实调用点写入 A5
   `deprecationCounters`，并把 `budgetShadow` 作为 diagnostics-only 字段
   放进 `CompactionDetails`，不进入 `CompressionArtifact`。
3. 在 `context-orchestrator.ts` 的既有通道决策前叠加
   `nativeMemory` / `nativeContextGating` 协商关闭，规则来自
   `docs/dev/hd-double-compression-contract.md`。

---

## 2. 执行前必读

按顺序读：

1. `reports/context-compression/P5-DEVELOPMENT-PROMPT-2026-08-17.md`
2. `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts`
3. `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts`
4. `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts`
5. `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts`
6. `openclaw_runtime/src/context-engine/context-orchestrator.ts`
7. `openclaw_runtime/src/observability/deprecation-counters.ts`
8. `docs/dev/hd-double-compression-contract.md`
9. 现有测试：
   - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.test.ts`
   - `openclaw_runtime/src/context-engine/context-orchestrator.test.ts`
   - `openclaw_runtime/src/observability/deprecation-counters.test.ts`

---

## 3. 执行纪律

- 先跑第 4 节命令建立 P5 基线，再开始写代码。
- TDD：先补测试，确认失败，再实现行为。
- 每个 P5 新增/修改文件都必须 JSON-serializable；不得携带 secrets。
- 默认 shadow / diagnostics-only；不得改变返回 summary；不得新增模型调用。
- 不修改 UI/E2E；不修改 `CompressionArtifact.schemaVersion`。
- 不创建第二套 Context Store / Budget / Task Ledger / Memory / Task Forest。

---

## 4. 基线命令（先执行）

```powershell
$env:Path = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:Path"
pnpm --version   # 期望 11.2.2
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm --dir openclaw_runtime exec vitest run src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/agent-hooks/compaction-validated-pipeline.test.ts src/agents/agent-hooks/compaction-addressability.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=dot
pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-artifact.test.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts --reporter=dot
pnpm contract:check
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm harness validate --spec harness/specs/tasks/a5-adaptive-context-budget-pilot.md
git diff --check
git status --short --branch
```

---

## 5. 实现顺序（按序推进，不跳步）

### 第 1 步：spec 先行

更新 `harness/specs/tasks/token-dense-recovery-compression-v1.md`：
- touchedAreas 增加 P5 runtime 路径（如
  `openclaw_runtime/packages/agent-core/src/harness/compaction/**` 已存在，
  确认 `openclaw_runtime/src/context-engine/context-orchestrator.ts` 和
  `openclaw_runtime/src/observability/deprecation-counters.ts` 被覆盖）。
- acceptance 增加 P5 条目：critical-first 顺序、threshold 只能提前、
  A5 计数器真实写入、native capability 协商 additive、planner p99、
  default shadow。

### 第 2 步：planner tests + 实现

新增/扩展 `compression-planner.test.ts`：
- 缺省 `thresholds` 与现有 ladder 完全一致。
- `{ tier1: 0.55 }` 只让 tier1 提前；`pressure=0.56` 缺省 tier0，带
  threshold 为 tier1。
- `planCriticalFirstBudget` 顺序固定，`niceToHaveProse` 先截断，
  `criticalLedger` 最后截断。

实现：
- `selectCompressionPlan(input)` 增加 optional `thresholds`；
  每个阈值用 `Math.min(userThreshold, defaultThreshold)` clamp。
- `planCompression` 增加 optional `tierSchedule`，只影响 `plan.tier`。
- `planCriticalFirstBudget` 纯函数，token estimation 用现有
  `estimateTokens` 等价逻辑。

### 第 3 步：A5 计数器接入

在 `compact.ts` 的 `compactionDetails` 生成处：
- 有 schedule 且实际 tier 与 schedule 一致时 `incrementA5PlanAdopted(1)`；
- 有 schedule 但运行时保护逻辑忽略时 `incrementA5PlanIgnored(1)`；
- budget 超限时 `incrementA5BudgetExceeded(1)`。

把 shadow 诊断放进 `compactionDetails`，例如：
`budgetShadow: { taskClass, plannedTier, actualTier, ignored, budgetExceeded, generatedAt }`。
禁止放入 `artifact`。

### 第 4 步：native capability 协商

在 `computeContextExtraSystemPrompt` 中：
- 读取模型能力声明 `nativeMemory` / `nativeContextGating`；
- 按 `hd-double-compression-contract.md` 决策表关闭通道；
- 无声明时保持现状；
- 关闭走既有 `recordContextOrchestratorSourceDecision`。

### 第 5 步：性能测试

- planner 100 次 p99 <= 30ms（小输入，`performance.now()`，宽松上限）。
- A5+A1+A3 累计 per-turn p99 <= 300ms smoke，记录 `artifacts/`。

### 第 6 步：回归与证据

跑第 7 节完整命令矩阵。全部通过后写
`reports/context-compression/P5-EVIDENCE-2026-08-17.md`，必须包含
P5 开发提示词第 11 节全部必答。

---

## 6. 阶段结束输出

必须输出并写入 `P5-EVIDENCE-2026-08-17.md`：
修改文件列表；数据流和 authority 是否变化；新增/更新测试；运行过的命令
及结果；指标变化；未解决问题；回滚开关或旧路径；是否满足进入 P6 的条件；
P5 必答逐项。

---

## 7. 完整命令矩阵（收尾前必须全绿）

```powershell
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm --dir openclaw_runtime exec vitest run src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/agent-hooks/compaction-validated-pipeline.test.ts src/agents/agent-hooks/compaction-addressability.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=dot
pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-artifact.test.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts --reporter=dot
pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-planner.test.ts src/context-engine/context-orchestrator.test.ts src/observability/deprecation-counters.test.ts --reporter=dot
pnpm contract:check
pnpm exec eslint <changed files>
pnpm run typecheck
cd openclaw_runtime && pnpm exec tsc -p tsconfig.core.json --noEmit --pretty false
pnpm run comms:replay
pnpm run comms:compare
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm harness validate --spec harness/specs/tasks/a5-adaptive-context-budget-pilot.md
git diff --check
```

---

## 8. 禁止事项

- 不得延后生产 ladder；threshold 只能提前。
- 不得把 `budgetShadow` 写入 `CompressionArtifact` 或 `artifact.quality`。
- 不得新增模型调用、DeepSeek/judge、UI/E2E。
- 不得宣布 token savings 或单模型自评成功。
- 不得修改 `D:\ClawX` 根工作树未提交改动；P0-P4 未提交改动必须保留。
- 不得在 `nativeMemory` / `nativeContextGating` 未声明时改变任何行为。
