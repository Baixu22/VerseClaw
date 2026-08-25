# P5 开发提示词：Critical-first 自适应预算

> 状态：准备进入 P5，尚未修改 P5 runtime 文件
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线：`734ec877e75682861103660fbdea2bd55253ece0`
> 上一阶段证据：`reports/context-compression/P4-ACCEPTANCE-EVIDENCE-2026-08-17.md`

---

## 1. 角色与总目标

你是 Verse Claw/OpenClaw 的 Context Compression Fidelity Hardening 执行 agent。
当前阶段是 P5：在现有 Compression Planner 与 Context Orchestrator/A5 authority
之上，实现 **critical-first 自适应预算**，默认仍 shadow / diagnostics-only。

P5 验收只证明：

- 预算顺序固定为：critical ledger > latest user ask > 未完成动作 >
  失败链验证状态 > exact identifiers > important facts > nice-to-have prose；
- `0.15..0.35` 压缩比不是 pass/fail 门槛，只作 advisory economics；
- planner 支持可选的 per-task-class threshold，且只能把阈值**提前**，
  生产 ladder（0.6/0.75/0.85/0.95）仍是硬 backstop；
- A5 `deprecationCounters` 的 `planAdoptedCount` / `planIgnoredCount` /
  `budgetExceededCount` 被真实写入，`degrade_to_default_budget` 由既有
  A5 registry 在 ignored rate > 20% 时触发；
- planner p99 <= 30ms，A5+A1+A3 累计 per-turn p99 <= 300ms；
- 模型声明 `nativeMemory` / `nativeContextGating` 时按
  `docs/dev/hd-double-compression-contract.md` 协商关闭重复通道，并保留
  provenance receipt；
- P0-P4 回归不破，legacy default budget 与 legacy transcript replay 保留。

**不得宣布** token savings、结构化 judge 分数或单模型自评成功。

---

## 2. 必读文件（先完整读，再动手）

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `reports/CONTEXT-COMPRESSION-DEVELOPMENT-PLAN-2026-08-17.md` 第 1、3、4(P5)、5、6、7 节
4. `harness/specs/tasks/token-dense-recovery-compression-v1.md`（compression active spec）
5. `harness/specs/tasks/a5-adaptive-context-budget-pilot.md`（A5 active pilot spec，只读优先）
6. `docs/enhancements/05-adaptive-context-budget.md`（设计，P5 只实现其中 shadow 子集）
7. `docs/dev/hd-double-compression-contract.md`
8. `reports/context-compression/P0-EVIDENCE-2026-08-17.md`
9. `reports/context-compression/P1-EVIDENCE-2026-08-17.md`
10. `reports/context-compression/P2-EVIDENCE-2026-08-17.md`
11. `reports/context-compression/P3-EVIDENCE-2026-08-17.md`
12. `reports/context-compression/P4-ACCEPTANCE-EVIDENCE-2026-08-17.md`
13. 以下实际代码，不要根据文件名猜接口：
    - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts`
    - `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts`
    - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts`
    - `openclaw_runtime/src/context-engine/context-orchestrator.ts`
    - `openclaw_runtime/src/context-engine/turn-injection-budget.ts`
    - `openclaw_runtime/src/observability/deprecation-counters.ts`
    - `openclaw_runtime/src/context-engine/context-health-monitor.ts`
    - `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts`
    - `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts`

---

## 3. 阶段开始仪式（必须执行）

```powershell
$env:Path = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:Path"
pnpm --version   # 期望 pinned 11.2.2
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
```

然后跑 P5 基线（确认 P0-P4 未回归）：

```powershell
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

## 4. 硬边界（任何情况下不得违反）

1. 不创建第二套 Context Store、Context Budget、Task Ledger、Memory 或 Task Forest。
2. Context Orchestrator 仍是注入/通道预算的唯一 authority；A5 计数器在
   `deprecation-counters.ts` 内，只允许调用，不得复制一套新计数器。
3. `selectCompressionPlan` 的生产 ladder 是硬 backstop；P5 只能通过可选
   `thresholds` / `tierSchedule` 把阈值**提前**（lower），不得延后。
4. 自然语言摘要只能是 projection，`details.artifact` 是结构化 carrier。
5. 默认仍 shadow / diagnostics-only：
   - 不新增模型调用、不新增 DeepSeek/judge；
   - 不改变返回 summary；
   - 不 enforce `wouldRetry` / `wouldFallback` / `wouldPreserveTurns`；
   - 不修改 UI/E2E。
6. `CompressionArtifact.schemaVersion` 必须保持 `1`；P5 新增字段（如
   `budgetShadow`）若进入 `CompactionDetails`，必须 JSON-serializable、
   不带 secrets，并且不得破坏 Gateway / Electron 既有 mapping。
7. 固定 `0.15..0.35` 压缩比不是硬门槛；token savings 永远只作 advisory。
8. 不得用 token savings、结构化 judge 分数或单模型自评宣布成功。
9. 不修改 `D:\ClawX` 根工作树的未提交改动；本 worktree 的 P0/P1/P2/P3/P4
   未提交改动必须保留。
10. `nativeMemory` / `nativeContextGating` 协商必须是 additive 开关；
    无能力声明时行为与现状完全一致。
11. legacy default budget 和 legacy transcript replay rollback 必须保留。

---

## 5. 当前接口事实（P5 准备时已核对）

### 5.1 `compression-planner.ts`

- `selectCompressionPlan({ tokensBefore, settings, contextWindow? })` 当前
  硬编码 0.6/0.75/0.85/0.95 ladder；没有 `thresholds` 或 `tierSchedule` 参数。
- `CompressionPlannerInput` 当前只有 `tokensBefore` / `settings` / `messages` /
  `staleExcludedCount` / `readFiles` / `modifiedFiles` / `tokenPruningAdapter`。
- `planCompression` 返回 `{ plan, messages, telemetry }`，tier 行为在函数内
  用 `plan.tier` 驱动；P5 只需让 `plan.tier` 可选地来自 task-class schedule。
- `finalizeCompressionTelemetry` 在 compact 后补 `tokensAfter` /
  `compressionRatio`；`compressionRatio` 已经是 advisory 数据。

### 5.2 `deprecation-counters.ts`（A5 authority）

- 已有 `A5DeprecationCounters { planAdoptedCount, planIgnoredCount, budgetExceededCount }`。
- 已有 `incrementA5PlanAdopted` / `incrementA5PlanIgnored` /
  `incrementA5BudgetExceeded`。
- 已有 registry `computeViolations`：A5 ignored rate > 20% 时返回
  `degrade_to_default_budget`。
- P5 只需在真实调用点写入这些计数器；不得另建计数器或另建阈值逻辑。

### 5.3 `context-orchestrator.ts`

- `computeContextExtraSystemPrompt` 已集中处理 memory/vtoken 通道预算与
  开关（`isMemoryPilotEnabled` / `resolveMemoryBudget` / `resolveVtokenBudget`）。
- `finalizeContextOrchestratorTurn` / `endContextOrchestratorTurn` 已提供
  turn 级生命周期，P5 的 cumulative per-turn 预算应挂在这里。
- `recordContextOrchestratorSourceDecision` 已可记录通道 skip/flag-off，
  无需新降级语义。

### 5.4 `hd-double-compression-contract.md`

- 能力信号为 `capabilities.nativeMemory` / `capabilities.nativeContextGating`。
- 协商规则：`nativeMemory=true` 关闭 vtoken/memory_pilot，保留 referential
  BlockStore；`nativeContextGating=true` 关闭 vtoken/memory_pilot/BlockStore
  注入，仅保留 provenance receipt。
- 执行点在 `computeContextExtraSystemPrompt`；关闭 = stage.enabled=false。
- 无能力声明时保持现状。

### 5.5 P4 live residual 对 P5 的约束

- live DeepSeek continuation 在 deterministic template summary 上
  L3 real continuation gate 未通过（firstActionMatchRate=0.4、
  criticalActionMatchRate=0.5、completionDelta=0.5）。
- live judge / schema-free 10 个 template 样本均为 10 分且 std=0，已标记
  calibration risk。
- 因此 P5 **不得**把 compression ratio 或 L3 失败归因于 planner；
  P5 只做 shadow 数据记录，不提升默认策略。

---

## 6. P5 目标接口草案（实现时以测试锁行为，不要照抄猜测）

### 6.1 planner：可选 task-class threshold

```ts
export type TierThresholds = {
  tier1?: number;   // default 0.60；P5 只允许 <= 0.60
  tier2?: number;   // default 0.75；P5 只允许 <= 0.75
  tier3?: number;   // default 0.85；P5 只允许 <= 0.85
  tier4?: number;   // default 0.95；P5 只允许 <= 0.95
};

export type CompressionPlannerInput = {
  // ...existing fields
  tierSchedule?: {
    taskClass?: string;
    thresholds: TierThresholds;
    budgetTokens?: number;
    reason?: string;
  };
};

export function selectCompressionPlan(input: {
  tokensBefore: number;
  settings: CompactionSettings;
  contextWindow?: number;
  thresholds?: TierThresholds;   // optional；缺省等于现有 ladder
}): CompressionPlan;
```

约束：

- `selectCompressionPlan` 必须用 `Math.min(userThreshold, defaultThreshold)`
  的语义：P5 只能让压缩更早发生。
- `planCompression` 
 在 `input.tierSchedule` 存在时把 `plan` 的 tier 选择传给
  既有 tier 行为；不得 fork 现有 ladder 行为。
- `CompressionTelemetry` 可以新增 optional `taskClass?` / `budgetTokens?`，
  但必须 JSON-serializable，且不得破坏 P0-P4 既有断言。

### 6.2 critical-first 预算顺序

建议新增纯函数（可放 `compression-planner.ts` 或同目录新文件，但不新造 authority）：

```ts
export type CriticalFirstBudgetInput = {
  criticalLedger?: CompressionSemanticAtom[];
  latestUserAsk?: string;
  unfinishedActions?: string[];
  failureChainValidation?: string[];
  exactIdentifiers?: string[];
  importantFacts?: string[];
  niceToHaveProse?: string[];
  budgetTokens: number;
};

export type CriticalFirstBudgetPlan = {
  allowedTokens: Partial<Record<keyof CriticalFirstBudgetInput, number>>;
  order: Array<keyof CriticalFirstBudgetInput>;
  truncated: Array<keyof CriticalFirstBudgetInput>;
};

export function planCriticalFirstBudget(input: CriticalFirstBudgetInput): CriticalFirstBudgetPlan;
```

约束：

- 顺序固定：`criticalLedger` -> `latestUserAsk` -> `unfinishedActions` ->
  `failureChainValidation` -> `exactIdentifiers` -> `importantFacts` ->
  `niceToHaveProse`。
- 只做 token estimation 与 bounded truncation；不调用模型。
- `niceToHaveProse` 先被截断；`criticalLedger` 最后被截断。
- P5 shadow 阶段该函数只用于生成 `budgetShadow` diagnostics；不得改变
  实际 summary 或 artifact 生成路径。

### 6.3 A5 计数器接入

```ts
deprecationCounters.incrementA5PlanAdopted(1);  // 实际 tier 与 schedule 一致
deprecationCounters.incrementA5PlanIgnored(1);  // 运行时因压力/保护逻辑忽略 schedule
deprecationCounters.incrementA5BudgetExceeded(1); // budgetTokens 超限
```

约束：

- 只在 `compact.ts` / `compaction-safeguard.ts` 的确定性调用点写入；
- 不新增模型调用，不改变返回 summary；
- `degrade_to_default_budget` 由既有 `deprecationCounters.computeViolations`
  生成，P5 只读取并写入 shadow diagnostics。

### 6.4 native capability 协商

在 `computeContextExtraSystemPrompt` 的既有通道决策前叠加：

```ts
type NativeContextCapabilities = {
  nativeMemory?: boolean;
  nativeContextGating?: boolean;
};
```

约束：

- 无声明 = 现状。
- `nativeMemory=true`：memory_pilot 与 vtoken 通道 `enabled=false`；
  BlockStore 保留 referential，provenance receipt 继续。
- `nativeContextGating=true`：memory_pilot / vtoken / BlockStore 注入均关闭，
  仅保留 receipt。
- 关闭路径走既有 `recordContextOrchestratorSourceDecision`。

---

## 7. 先补测试，再实现行为（TDD 顺序）

### 第 1 批：planner threshold 与 critical-first 预算

1. `selectCompressionPlan` 缺省 `thresholds` 时与现有 0.6/0.75/0.85/0.95
   ladder 完全一致。
2. `thresholds` 只能提前：`{ tier1: 0.55 }` 在 pressure=0.56 时选 tier1，
   pressure=0.56 且缺省时仍 tier0；任何 `threshold > default` 被 clamp 或拒绝。
3. `planCriticalFirstBudget` 顺序固定，`niceToHaveProse` 先被截断，
   `criticalLedger` 最后被截断；输出 bounded JSON。
4. `planCompression` 接收 `tierSchedule` 后只改变 `plan.tier`，tier 行为
   （micro-compact / token-pruning / emergency-collapse）与既有实现一致。

### 第 2 批：A5 计数器

5. `compact.ts` 或 helper 在 plan 被采纳/忽略/超限时分别
   `incrementA5PlanAdopted` / `incrementA5PlanIgnored` /
   `incrementA5BudgetExceeded`；shadow 下不改变 summary。
6. `deprecationCounters.computeViolations` 在 ignored rate > 20% 时返回
   `degrade_to_default_budget`（沿用既有 A5 测试；P5 只补真实调用点测试）。
7. P5 新增 `budgetShadow` 诊断 JSON-serializable，不进入
   `CompressionArtifact.schemaVersion`，不携带 secrets。

### 第 3 批：native capability 协商

8. `nativeMemory=true`：memory_pilot / vtoken skip，BlockStore referential
   保留，receipt 保留。
9. `nativeContextGating=true`：memory_pilot / vtoken / BlockStore 注入均 skip，
   仅 receipt。
10. 无能力声明时，`computeContextExtraSystemPrompt` 输出与现状完全一致。

### 第 4 批：性能预算

11. planner 100 次调用 p99 <= 30ms（用小型固定输入，测试环境波动允许
    `performance` 阈值断言，但不得用 wall-clock 卡死 CI；优先用
    `performance.now()` 与宽松上限）。
12. A5+A1+A3 累计 per-turn p99 <= 300ms 的 smoke 测试（记录
    `artifacts/`，不设过脆断言）。

### 第 5 批：回归与契约

13. P0-P4 回归全绿。
14. `pnpm harness validate` 两个 spec 均 PASS。
15. `pnpm contract:check` PASS；`pnpm run typecheck` node+web PASS。
16. core tsc 的 P5 changed files 不新增错误；comms replay/compare PASS。
17. UI/E2E 不修改；如误改 UI，必须补 i18n 四语和 viewer E2E。

---

## 8. 建议实现顺序（全部完成前不进入 P6）

1. 更新 `token-dense-recovery-compression-v1.md` 的 P5 acceptance 与
   touchedAreas（如需）；不另建 spec。
2. 写第 1 批测试，运行确认失败。
3. 实现 planner `thresholds` / `tierSchedule` 与 `planCriticalFirstBudget`。
4. 写第 2 批测试，接入 A5 计数器与 `budgetShadow`。
5. 写第 3 批测试，接入 native capability 协商。
6. 写第 4 批性能预算测试。
7. 跑第 5 批回归和契约。
8. 全部命令通过后写 `reports/context-compression/P5-EVIDENCE-2026-08-17.md`。

---

## 9. 必须运行的命令（按顺序）

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

UI/E2E 路径不应修改；若误修改，额外运行：

```powershell
pnpm exec playwright test tests/e2e/chat-manual-compaction.spec.ts tests/e2e/chat-recovery-assist.spec.ts tests/e2e/compaction-artifact-viewer.spec.ts
```

---

## 10. 修改文件候选与回滚

| 文件 | owner/性质 | 回滚 |
|---|---|---|
| `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts` | P5 runtime | `git checkout -- <path>` |
| `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts` | P1/P3/P5 | `git checkout -- <path>` |
| `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts` | P3/P5 | `git checkout -- <path>` |
| `openclaw_runtime/src/context-engine/context-orchestrator.ts` | P5 runtime | `git checkout -- <path>` |
| `openclaw_runtime/src/observability/deprecation-counters.ts` | 只读/调用 | 如误改 `git checkout -- <path>` |
| `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.test.ts`（新建/扩展） | P5 新增 | 删除/checkout |
| `openclaw_runtime/src/context-engine/context-orchestrator.test.ts`（扩展） | P5 测试 | `git checkout -- <path>` |
| `harness/specs/tasks/token-dense-recovery-compression-v1.md` | P0-P4 已改 | `git checkout` 会连前面阶段一起丢 |
| `reports/context-compression/P5-EVIDENCE-2026-08-17.md`（新建） | 本阶段新增 | 删除文件 |

> 注意：当前 P0/P1/P2/P3/P4 改动均未提交。整体 reset 到基线会连
> P0-P4 一起丢，只能在用户明确批准后执行。

---

## 11. 阶段结束必须输出（照抄上一阶段格式）

- 修改文件列表；
- 数据流和 authority 是否变化；
- 新增/更新测试；
- 运行过的命令及结果；
- 指标变化；
- 未解决问题；
- 回滚开关或旧路径；
- 是否满足进入 P6 的条件。

P5 额外必须回答：

- 预算顺序是否固定为 critical ledger -> latest user ask ->
  unfinished actions -> failure chain validation -> exact identifiers ->
  important facts -> nice-to-have prose（给出测试名）；
- planner threshold 是否只能提前，生产 ladder 是否仍为 backstop（给出测试名）；
- A5 三个计数器在哪个调用点写入，ignored rate > 20% 是否触发
  `degrade_to_default_budget`（给出测试名）；
- planner p99 与 A5+A1+A3 累计 per-turn p99 是否满足门槛（给出测试名）；
- `nativeMemory` / `nativeContextGating` 协商关闭是否 additive，无声明时
  是否保持现状（给出测试名）；
- `budgetShadow` 是否 JSON-serializable 且不进入 CompressionArtifact；
- 是否新增了任何模型调用；
- 是否修改了 UI/E2E；
- 是否新增 token savings 或单模型自评成功宣称。

---

## 12. P5 完成标准（未全部满足不得进入 P6）

- 所有新增/回归测试绿。
- `pnpm harness validate` 两个 spec 均 PASS。
- `pnpm contract:check` PASS。
- `pnpm run typecheck` node+web PASS；test project 不新增错误。
- openclaw_runtime core tsc 的 P5 changed files 不新增错误（全量既有
  `shared/verseshell/**` 错误不计入）。
- comms replay/compare PASS。
- planner 缺省行为与 P0-P4 完全一致；threshold 只能提前。
- critical-first 预算顺序由 deterministic 纯函数测试锁定。
- A5 计数器被真实写入，`degrade_to_default_budget` 由既有 registry 触发。
- planner p99 <= 30ms；A5+A1+A3 累计 per-turn p99 <= 300ms。
- native capability 协商 additive，provenance receipt 保留。
- 默认 shadow / diagnostics-only；未修改 UI/E2E；未新增模型调用。
- 未创建第二套 context/memory/task truth；DeepSeek key 未落盘。
