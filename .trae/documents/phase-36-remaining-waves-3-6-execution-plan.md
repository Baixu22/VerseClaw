# Phase 36 剩余 Wave 3-6 执行计划（Refined Execution Plan）

> 本文件是 Phase 36 在 Plan Mode 下重新生成的**剩余工作**执行计划。覆盖 Wave 3（C 评估：统计模块 + 多回合驱动器）、Wave 4（D 流水线：eval-helpers + 长对话测试 + 报告生成器 + package.json 脚本）、Wave 5（E 规范：task spec + rules）、Wave 6（全量验证）。
>
> 前序 Wave 1（B 收尾：CircuitBreaker 4 类型错误修复 + B7 sentinel 复用 + delta wiring）与 Wave 2（C 基础：ScriptedLlmDriver + testResearchOnly breakthrough）已完成并验证。本计划聚焦**尚未创建**的文件。

---

## 一、当前状态分析（Current State Analysis — Phase 1 实测）

### 已完成（前序会话，本计划不再触及）
| Wave | 文件 | 状态 |
|------|------|------|
| 1.1 | `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts` | ✅ 4 类型错误修复（databasePath 收窄 + execute 泛型 + circuit_breaker_open union） |
| 1.2 | `openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts` | ✅ sentinel 复用（导入 `DEFAULT_PROMPT_INJECTION_SENTINEL`/`DEFAULT_RAW_LEAK_SENTINEL`）+ delta wiring（`TaskLoopRuntimeMemoryReadHydrationDeltaCounts` 类型 + `deltaCounts` 入参） |
| 2.1 | `openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.ts` | ✅ `ScriptedLlmDriver` 类（FIFO 队列 + A/B arm + reset） |
| 2.1 | `tests/unit/runtime-memory-eval-scripted-llm.test.ts` | ✅ 8 测试用例 |
| 2.2 | `openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts` | ✅ `TaskLoopRuntimeMemoryReadHydrationBreakthroughArm/Injection/InjectionSummary` 类型 + `testResearchOnlyBreakthrough`/`breakthroughInjection` 选项 + `summarizeBreakthroughInjection` helper |
| 2.2 | `tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts` | ✅ 5 测试用例 |

### 待完成（本计划目标 — 11 个新文件 + 2 个修改文件）

| Wave | 子项 | 文件 | 类型 |
|------|------|------|------|
| 3.1 | C6 统计模块 | `openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts` | 新建 |
| 3.1 | C6 测试 | `tests/unit/runtime-memory-eval-statistics.test.ts` | 新建 |
| 3.2 | C4 多回合驱动器 | `openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts` | 新建 |
| 4.1 | D1 eval-helpers | `tests/unit/helpers/runtime-memory-eval-helpers.ts` | 新建 |
| 4.1 | D1 改造现有测试 | `tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` | 修改（复用 helper） |
| 4.2 | D2 长对话测试 | `tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts` | 新建 |
| 4.3 | D3 报告生成器 | `tests/unit/helpers/runtime-memory-eval-report.ts` | 新建 |
| 4.4 | D4 脚本 | `openclaw_runtime/package.json` | 修改（追加 `eval:runtime-memory:long-conversation`） |
| 5 | E1 task spec | `harness/specs/tasks/phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval.md` | 新建 |
| 5 | E1 rules | `harness/specs/rules/runtime-memory-read-hydration-test-research-breakthrough.md` | 新建 |

### 关键架构事实（Phase 1 探查确认）

1. **`ScriptedLlmDriver` API（已存在）**：
   - `respond(sessionKey)` — 无 arm 出队
   - `respondForArm(sessionKey, arm)` — A/B arm 出队
   - `reset()` — 恢复所有队列到初始状态
   - `remaining(sessionKey, arm?)` — 剩余响应数
   - 队空抛 `Error`（避免静默假阳性）
   - 同 sessionKey + 同 arm 重复注册抛 `Error`

2. **`TaskLoopControllerDeps`（`openclaw_runtime/src/agents/task-loop-controller.ts` line 323-357）**：
   - `runtimeMemoryReadHydrationShadowOnly?: TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions` — 这是多回合驱动器的 DI 入口
   - 全部可选，多回合驱动器只注入需要的子集

3. **`runtime-core/index.ts` 不 re-export `agents/runtime-memory-eval/`**：
   - 统计模块和多回合驱动器位于 `openclaw_runtime/src/agents/runtime-memory-eval/`，测试通过相对路径 `../../openclaw_runtime/src/agents/runtime-memory-eval/...` 导入
   - 不需要修改 `runtime-core/index.ts`

4. **benefit-eval 测试 helpers（可抽取）**：
   - `readJson<T>(name)` — 读 fixture JSON
   - `createTempDbPath(prefix)` — 创建 temp SQLite 路径
   - `seedTempDb(dbPath, groups)` — 写入 facts 到 temp DB
   - `toProjection(fact)` / `toPersistenceRecord(fact)` — fixture 转换
   - `evaluate(corpus, queries)` / `evaluateQuery(corpus, query)` — 3-arm 评估
   - `armResult(returned, query)` / `naiveArm(corpus, query)` — 单 arm 计算
   - `pickMemoryDependentGroups(count)` — 选 memory-dependent 组
   - `expectThreshold(report, key)` — 门槛断言
   - `suppressionRate(c, r)` / `rate(s, t)` / `sum(values)` / `percentile(values, p)` — 通用统计

5. **package.json scripts 位置**：
   - `scripts` 块在 line 1423
   - `test:fast` 在 line 1777：`node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts`
   - `tsgo:core` 在 line 1840
   - 追加 `eval:runtime-memory:long-conversation` 在 `test:fast` 附近（按字母序插入）

6. **harness rules 格式**（参考 `backend-communication-boundary.md`）：
   ```markdown
   ---
   id: <kebab-case-id>
   title: <Title>
   type: ai-coding-rule
   appliesTo:
     - <scenario-id>
   requiredProfiles:
     - <profile>
   ---
   <规则正文>
   ```

7. **harness task spec 格式**（参考 Phase 35 spec）：
   - frontmatter 含 `id`, `title`, `scenario`, `taskType`, `intent`, `ownedPaths`, `touchedAreas`, `expectedUserBehavior`, `requiredProfiles`, `requiredRules`, `forbiddenPatterns`, `featureFlags`, `operatorGate`, `corpusGate`, `privacyRetentionGate`, `rollbackGate`, `metricsGate`, `rollback`, `requiredTests`, `acceptance`, `docs`
   - 正文含 Hard Boundaries、Dataset、Metrics、Validation 等章节

8. **fixtures 路径**：`tests/fixtures/runtime-memory-benefit-eval/` 含 `facts.json`、`queries.json`、`scenarios.json`、`expected-metrics.json`、`generate.mjs` — 长对话测试复用这些 fixtures

9. **测试位置约定**：`tests/unit/`（仓库根，非 `openclaw_runtime/` 下）；helpers 在 `tests/unit/helpers/`（已存在 `role-gateway-test-utils.ts`）

---

## 二、优化策略（沿用原计划，不调整）

1. **确定性优先**：统计模块用固定 seed 的 mulberry32 RNG；多回合驱动器用 `ScriptedLlmDriver`
2. **统计严谨**：bootstrap CI + paired t-test + 最小样本量，30 轮 × 4 queries = 120 样本
3. **工程闭环**：每个 Wave 结束跑 `tsgo:core`（仅校验触及文件零新增错误）+ 相关 vitest
4. **规范同步**：Wave 5 补 harness task spec + rules，让后续 AI 工作可验证
5. **不引入额外依赖**：统计模块内置 Student t 分布 CDF 近似（查表 + 插值），不引入 `mathjs`/`simple-statistics`

---

## 三、具体变更（Proposed Changes）

### Wave 3.1 — C6 统计显著性模块

#### 3.1.1 新建 `openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts`

纯函数模块，无副作用，无外部依赖。

```typescript
// 确定性 RNG（mulberry32）— 同 seed 同输出，保证 CI 可重放
export function mulberry32(seed: number): () => number;

// Bootstrap 置信区间（默认 1000 次重采样，95% CI）
export type BootstrapCIResult = {
  mean: number;
  lower: number;
  upper: number;
  iterations: number;
  confidence: number;
};
export function bootstrapConfidenceInterval(
  samples: readonly number[],
  options?: {
    iterations?: number;   // 默认 1000
    confidence?: number;   // 默认 0.95
    seed?: number;         // 默认 0x1a2b3c4d（固定，保证 CI 可重放）
  },
): BootstrapCIResult;

// 配对 t 检验（同 subject 的 baseline vs treatment）
export type PairedTTestResult = {
  t: number;
  df: number;
  pValue: number;        // 双侧
  meanDiff: number;
  stdDevDiff: number;
  significant: boolean;  // pValue < alpha（默认 0.05）
  alpha: number;
};
export function pairedTTest(
  baseline: readonly number[],
  treatment: readonly number[],
  options?: { alpha?: number }, // 默认 0.05
): PairedTTestResult;

// 最小样本量（基于 z 检验近似，单样本/配对双侧）
// 默认 Cohen's d=0.2（小效应）, alpha=0.05, power=0.8 → ≈197
export function minimumSampleSize(
  effectSize?: number, // Cohen's d，默认 0.2
  alpha?: number,      // 默认 0.05
  power?: number,      // 默认 0.8
): number;

// Cohen's d（效应量）
export function cohensD(
  baseline: readonly number[],
  treatment: readonly number[],
): number;

// 辅助：mean, stdDev, percentile（导出供报告生成器复用）
export function mean(values: readonly number[]): number;
export function stdDev(values: readonly number[]): number;
export function percentile(values: readonly number[], p: number): number;
```

**实现要点**：
- `mulberry32(seed)`：标准实现，`>>> 0` 无符号右移，返回 `[0, 1)` 浮点
- `bootstrapConfidenceInterval`：重采样时用 `Math.floor(rng() * n)` 选索引；CI 用 percentile 法（`lower = percentile(bootstraps, (1-conf)/2)`, `upper = percentile(bootstraps, 1-(1-conf)/2)`）
- `pairedTTest`：`diffs[i] = treatment[i] - baseline[i]`；`t = meanDiff / (stdDevDiff / sqrt(n))`；`df = n - 1`；p-value 用 Student t 分布 CDF 近似（内置 df=1..30 查表 + df>30 用正态近似）
- `minimumSampleSize`：`n = ceil(((z_alpha/2 + z_beta) / d) ^ 2)`；`z_alpha/2 = 1.959964`（alpha=0.05 双侧），`z_beta = 0.841621`（power=0.8）；d=0.2 → `((1.959964+0.841621)/0.2)^2 = (14.007925)^2 = 196.22 → ceil = 197`
- `cohensD`：`d = (mean_treatment - mean_baseline) / pooled_std`；`pooled_std = sqrt(((n1-1)*var1 + (n2-1)*var2) / (n1+n2-2))`
- 边界：空数组 → `mean=0, stdDev=0`；`n=0` 时 `pairedTTest` 抛 `Error("pairedTTest requires non-empty samples")`；`baseline.length !== treatment.length` 抛 `Error`
- `percentile`：与 benefit-eval 测试一致（`sorted[Math.min(len-1, Math.floor(p*len))]`），保证复用兼容

#### 3.1.2 新建 `tests/unit/runtime-memory-eval-statistics.test.ts`

```typescript
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  bootstrapConfidenceInterval,
  pairedTTest,
  minimumSampleSize,
  cohensD,
  mulberry32,
  mean,
  percentile,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/statistics";

describe("runtime memory eval statistics", () => {
  // 1. mulberry32 确定性
  it("mulberry32 returns deterministic sequence for same seed", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    for (let i = 0; i < 10; i += 1) {
      expect(rng1()).toBe(rng2());
    }
  });

  // 2. bootstrap CI 包含真实均值
  it("bootstrap CI contains the sample mean within [lower, upper]", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ci = bootstrapConfidenceInterval(samples);
    expect(ci.lower).toBeLessThanOrEqual(ci.mean);
    expect(ci.upper).toBeGreaterThanOrEqual(ci.mean);
    expect(ci.mean).toBeCloseTo(5.5, 5);
    expect(ci.iterations).toBe(1000);
    expect(ci.confidence).toBe(0.95);
  });

  // 3. bootstrap 确定性（同 seed 同 CI）
  it("bootstrap CI is deterministic for same seed", () => {
    const samples = Array.from({ length: 20 }, (_, i) => i * 2 + 1);
    const ci1 = bootstrapConfidenceInterval(samples, { seed: 123 });
    const ci2 = bootstrapConfidenceInterval(samples, { seed: 123 });
    expect(ci1.lower).toBe(ci2.lower);
    expect(ci1.upper).toBe(ci2.upper);
  });

  // 4. paired t-test 显著性判定
  it("paired t-test detects significant positive difference", () => {
    // treatment 系统性高于 baseline 1.0
    const baseline = [10, 11, 9, 10, 12, 11, 10, 9, 11, 10];
    const treatment = baseline.map((v) => v + 2);
    const result = pairedTTest(baseline, treatment);
    expect(result.meanDiff).toBeCloseTo(2, 5);
    expect(result.df).toBe(9);
    expect(result.t).toBeGreaterThan(0);
    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
  });

  // 5. paired t-test 无显著差异
  it("paired t-test reports non-significant for identical samples", () => {
    const baseline = [1, 2, 3, 4, 5];
    const treatment = [1, 2, 3, 4, 5];
    const result = pairedTTest(baseline, treatment);
    expect(result.meanDiff).toBe(0);
    expect(result.significant).toBe(false);
  });

  // 6. paired t-test 长度不匹配抛错
  it("paired t-test throws on length mismatch", () => {
    expect(() => pairedTTest([1, 2, 3], [1, 2])).toThrow();
  });

  // 7. 最小样本量数值（d=0.2, alpha=0.05, power=0.8 → 197）
  it("minimum sample size for d=0.2 is 197", () => {
    expect(minimumSampleSize(0.2, 0.05, 0.8)).toBe(197);
  });

  // 8. 最小样本量随效应量减小而增大
  it("minimum sample size decreases as effect size increases", () => {
    const small = minimumSampleSize(0.2);
    const medium = minimumSampleSize(0.5);
    const large = minimumSampleSize(0.8);
    expect(small).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(large);
  });

  // 9. Cohen's d 方向与大小
  it("cohensD returns positive value when treatment exceeds baseline", () => {
    const baseline = [1, 2, 3, 4, 5];
    const treatment = [4, 5, 6, 7, 8];
    const d = cohensD(baseline, treatment);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeCloseTo(1.5811, 3); // (5-3)/sqrt(pooled_var)
  });

  // 10. percentile 与 mean 基础正确性
  it("percentile and mean compute expected values", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
  });
});
```

**验证**：`pnpm test:fast -- tests/unit/runtime-memory-eval-statistics.test.ts` 全绿。

---

### Wave 3.2 — C4 30 轮多回合 TaskLoop 驱动器

#### 3.2.1 新建 `openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts`

```typescript
import { performance } from "node:perf_hooks";
import {
  buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
  type TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions,
  type TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
} from "../task-loop-runtime-memory-read-hydration-shadow.js";
import type { ScriptedLlmDriver } from "./scripted-llm.js";
import type { ScriptedLlmArm } from "./scripted-llm.js";

export type MultiTurnArm = ScriptedLlmArm; // "baseline" | "treatment"

export type MultiTurnQueryPlan = {
  queryId: string;
  taskId: string;
  subject: string;
  predicate: string;
  referenceTime: number;
  tokenBudget: number;
  limit: number;
  expectedFactIds: readonly string[];
};

export type MultiTurnTurnResult = {
  turn: number;
  baseline: ArmMetrics;
  treatment: ArmMetrics;
};

export type ArmMetrics = {
  recallAtK: number;
  precision: number;
  latencyMs: number;
  tokenOverhead: number;
  rawLeakRate: number;
  promptInjectionReturnRate: number;
  acceptedFactCount: number;
  rejectedFactCount: number;
};

export type MetricSummary = {
  mean: number;
  p50: number;
  p95: number;
  count: number;
};

export type MultiTurnRunResult = {
  turns: MultiTurnTurnResult[];
  aggregateBaseline: Record<keyof ArmMetrics, MetricSummary>;
  aggregateTreatment: Record<keyof ArmMetrics, MetricSummary>;
  totalDurationMs: number;
  turnCount: number;
  queriesPerTurn: number;
};

export type MultiTurnDriverOptions = {
  turns: number;              // 30
  queriesPerTurn: number;     // 4
  sessionKey: string;
  scriptedLlm: ScriptedLlmDriver;
  databasePath: string;
  queries: readonly MultiTurnQueryPlan[];  // 长度 >= queriesPerTurn * turns
  baselineOptions: Omit<TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions,
    "explicitOptIn" | "testResearchOnly" | "databasePath" | "queries">;
  treatmentOptions: Omit<TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions,
    "explicitOptIn" | "testResearchOnly" | "databasePath" | "queries"> & {
    breakthroughInjection: {
      enabled: true;
      arm: "treatment";
      acceptedFactsMaxTokens: number;
    };
  };
  loopRunIdPrefix?: string;   // 默认 "phase36_multiturn"
  now?: () => number;         // 默认 () => 1_700_000_000_000
};

export function runMultiTurnDriver(options: MultiTurnDriverOptions): MultiTurnRunResult;
```

**实现要点**：
- 每轮 turn `t` (0..turns-1)：取 `queries[t * queriesPerTurn .. (t+1) * queriesPerTurn]` 作为该轮的 query 子集
- 对每个 arm（baseline / treatment）：
  1. 调用 `scriptedLlm.respondForArm(sessionKey, arm)` 取一个响应（保证 LLM 路径被驱动，即使驱动器不直接使用响应文本 — 用于验证 ScriptedLlm 集成）
  2. 调用 `buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics` 两次（baseline: `testResearchOnlyBreakthrough` 不设 / treatment: `testResearchOnlyBreakthrough: true` + `breakthroughInjection`）
  3. 从 `diagnostics.queries` 聚合该轮该 arm 的 ArmMetrics：
     - `recallAtK = sum(truePositiveCount) / sum(expectedFactIds.length)`
     - `precision = sum(truePositiveCount) / sum(acceptedFacts.length)`（acceptedFacts=0 时为 0）
     - `latencyMs = diagnostics.metrics.latencyOverheadMs`
     - `tokenOverhead = diagnostics.metrics.tokenOverhead`
     - `rawLeakRate = diagnostics.metrics.rawLeakRate`
     - `promptInjectionReturnRate = diagnostics.metrics.promptInjectionReturnRate`
     - `acceptedFactCount = sum(queries.acceptedFacts.length)`
     - `rejectedFactCount = sum(queries.rejectedFacts.length)`
- 聚合：对每个 metric 字段，跨 30 轮收集样本，计算 `mean`/`p50`/`p95`/`count`
- `totalDurationMs = performance.now() - startedAt`
- 性能目标：30 轮 × 4 queries × 2 arms = 240 次 hydration 调用，CI 内 < 60s（纯函数 + temp SQLite，无网络）
- 边界：`queries.length < turns * queriesPerTurn` 抛 `Error`；`turns < 1` 抛 `Error`

**验证**：在 Wave 4.2 长对话测试中集成验证。

---

### Wave 4.1 — D1 eval-helpers 抽取

#### 4.1.1 新建 `tests/unit/helpers/runtime-memory-eval-helpers.ts`

从 `tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` 抽取共享逻辑。helper 文件不引入 vitest（保持纯函数，可被任意测试 import）。

```typescript
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryHydrationShadowFactProjection,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryTemporalFactCandidate,
  type RuntimeMemoryVerificationStatus,
} from "../../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../../openclaw_runtime/src/runtime-core/memory-persistence";

export const RUNTIME_MEMORY_EVAL_FIXTURE_DIR = fileURLToPath(
  new URL("../../fixtures/runtime-memory-benefit-eval", import.meta.url),
);

export const RUNTIME_MEMORY_EVAL_CONFIG = {
  runtime: { memory: { persist: true } },
} as const;

// === 类型（从测试文件抽出，供多个测试复用）===
export type FactLabel =
  | "useful" | "stale" | "invalid" | "future" | "candidate"
  | "rejected" | "conflict" | "prompt_injection" | "raw_leak" | "distractor";

export type LoadedFact = { /* ... 同原测试 ... */ };
export type LoadedQuery = RuntimeMemoryHydrationConsumerQuery & { /* ... */ };
export type Arm = "baseline" | "naiveMemory" | "guardedMemory";

export const HAZARD_LABELS: ReadonlySet<FactLabel> = new Set([...]);
export const UNSAFE_LABELS: ReadonlySet<FactLabel> = new Set([...]);

// === Fixture 加载 ===
export function loadEvalFixtures(): {
  facts: LoadedFact[];
  queries: LoadedQuery[];
  scenarios: Array<{ arm: Arm; description: string; usesMemory: boolean; guarded: boolean }>;
  expectedMetrics: { /* ... */ };
  corpus: RuntimeMemoryHydrationShadowFactProjection[];
  labelByFactId: Map<string, FactLabel>;
  factById: Map<string, LoadedFact>;
};

export function readJson<T>(name: string): T;  // 从 FIXTURE_DIR 读

// === Temp DB ===
export function createTempDbPath(prefix: string, tracker: string[]): string;
export function seedTempDb(
  dbPath: string,
  groups: ReadonlyArray<{ groupId: string; facts: LoadedFact[] }>,
): void;
export function toPersistenceRecord(
  fact: LoadedFact,
): RuntimeMemoryTemporalFact | RuntimeMemoryTemporalFactCandidate;
export function toProjection(fact: LoadedFact): RuntimeMemoryHydrationShadowFactProjection;
export function pickMemoryDependentGroups(
  count: number,
  facts: readonly LoadedFact[],
): Array<{ groupId: string; facts: LoadedFact[] }>;

// === 3-arm 评估（保持原 evaluate/evaluateQuery/armResult/naiveArm 签名）===
export type EvaluationReport = { /* ... 同原测试 ... */ };
export type QueryEvaluation = { /* ... */ };
export type ArmResult = { /* ... */ };

export function evaluate(
  evalCorpus: readonly RuntimeMemoryHydrationShadowFactProjection[],
  evalQueries: readonly LoadedQuery[],
  labelByFactId: Map<string, FactLabel>,
): EvaluationReport;
export function evaluateQuery(/* ... */): QueryEvaluation;
export function armResult(/* ... */): ArmResult;
export function naiveArm(/* ... */): RuntimeMemoryHydrationShadowFactProjection[];

// === 门槛断言（接受 expect 作为参数，避免直接依赖 vitest）===
export function expectThreshold(
  report: EvaluationReport,
  key: keyof EvaluationReport & string,
  expectedMetrics: { thresholds: Record<string, { min?: number; max?: number }> },
  assert: (condition: boolean, message: string) => void,
): void;

// === 通用统计（与 statistics.ts 保持兼容，但避免循环依赖 — 这里是测试专用轻量版）===
export function suppressionRate(candidateCount: number, returnedCount: number): number;
export function rate(successes: number, total: number): number;
export function sum(values: readonly number[]): number;
export function percentile(values: readonly number[], p: number): number;
```

**抽取原则**：
- helper 文件不 `import { expect } from "vitest"` — 门槛断言通过 `assert` 回调注入，保持纯函数
- 类型 `LoadedFact`/`LoadedQuery`/`EvaluationReport` 等从测试文件迁移到 helper，测试文件改为 `import type`
- `labelByFactId`/`factById` 作为 `loadEvalFixtures` 返回值，不再用模块级 mutable state
- `createTempDbPath` 接受 `tracker: string[]` 参数，调用方传入自己的 `tempDirs` 数组

#### 4.1.2 修改 `tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts`

- 删除所有被 helper 抽走的函数和类型定义
- 改为 `import { ... } from "./helpers/runtime-memory-eval-helpers"`
- 保留 `describe`/`it` 块，断言不变
- `afterEach` 仍负责 `closeOpenClawStateDatabaseForTest()` + `closeRuntimeMemoryHydrationShadowDatabasesForTest()` + 清理 `tempDirs`
- `loadEvalFixtures()` 在文件顶部调用一次，解构出 `facts`/`queries`/`scenarios`/`expectedMetrics`/`corpus`/`labelByFactId`/`factById`

**验证**：`pnpm test:fast -- tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` 全绿，断言无回归。

---

### Wave 4.2 — D2 长对话测试

#### 4.2.1 新建 `tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts`

```typescript
// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScriptedLlmDriver } from "../../openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm";
import { runMultiTurnDriver, type MultiTurnQueryPlan } from "../../openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver";
import {
  bootstrapConfidenceInterval,
  cohensD,
  minimumSampleSize,
  pairedTTest,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/statistics";
import {
  loadEvalFixtures,
  createTempDbPath,
  seedTempDb,
  pickMemoryDependentGroups,
} from "./helpers/runtime-memory-eval-helpers";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";

const TURNS = 30;
const QUERIES_PER_TURN = 4;
const SESSION_KEY = "agent:main:phase36_long_conversation";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Phase 36 long conversation eval (30 turns)", () => {
  it("runs 30 turns × 4 queries with scripted LLM under 60s", () => {
    const { result } = setupAndRun();
    expect(result.turnCount).toBe(TURNS);
    expect(result.queriesPerTurn).toBe(QUERIES_PER_TURN);
    expect(result.turns).toHaveLength(TURNS);
    expect(result.totalDurationMs).toBeLessThan(60_000);
  });

  it("treatment recall@k >= baseline recall@k with statistical significance", () => {
    const { result } = setupAndRun();
    const recallBaseline = result.turns.map((t) => t.baseline.recallAtK);
    const recallTreatment = result.turns.map((t) => t.treatment.recallAtK);
    const t = pairedTTest(recallBaseline, recallTreatment);
    expect(t.meanDiff).toBeGreaterThanOrEqual(0);
    expect(t.significant).toBe(true);
  });

  it("bootstrap CI of treatment recall@k excludes baseline mean", () => {
    const { result } = setupAndRun();
    const recallTreatment = result.turns.map((t) => t.treatment.recallAtK);
    const ci = bootstrapConfidenceInterval(recallTreatment);
    const baselineMean =
      result.turns.reduce((s, t) => s + t.baseline.recallAtK, 0) / result.turns.length;
    expect(ci.lower).toBeGreaterThanOrEqual(baselineMean);
  });

  it("minimum sample size for observed cohensD is achievable within 30 turns", () => {
    const { result } = setupAndRun();
    const recallBaseline = result.turns.map((t) => t.baseline.recallAtK);
    const recallTreatment = result.turns.map((t) => t.treatment.recallAtK);
    const d = cohensD(recallBaseline, recallTreatment);
    const required = minimumSampleSize(d, 0.05, 0.8);
    // 30 轮 >= 所需样本量（若 d 足够大，所需样本量 <= 30）
    expect(TURNS).toBeGreaterThanOrEqual(required);
  });

  it("raw leak rate and prompt injection rate remain 0 in treatment", () => {
    const { result } = setupAndRun();
    for (const turn of result.turns) {
      expect(turn.treatment.rawLeakRate).toBe(0);
      expect(turn.treatment.promptInjectionReturnRate).toBe(0);
    }
  });
});

function setupAndRun(): { result: MultiTurnRunResult } {
  const { facts, queries } = loadEvalFixtures();
  // 选 memory-dependent 组构造 temp DB
  const groups = pickMemoryDependentGroups(3, facts);
  const dbPath = createTempDbPath("phase36-long-conversation-", tempDirs);
  seedTempDb(dbPath, groups);

  // 构造 120 个 query plan（30 轮 × 4）
  const memoryQueries = queries.filter((q) => q.memoryRelevant).slice(0, TURNS * QUERIES_PER_TURN);
  expect(memoryQueries.length).toBeGreaterThanOrEqual(TURNS * QUERIES_PER_TURN);
  const queryPlans: MultiTurnQueryPlan[] = memoryQueries.map((q) => ({
    queryId: q.queryId,
    taskId: q.taskId,
    subject: q.subject,
    predicate: q.predicate,
    referenceTime: q.referenceTime,
    tokenBudget: q.tokenBudget,
    limit: q.limit,
    expectedFactIds: q.expectedFactIds,
  }));

  // Scripted LLM：每轮每 arm 一个响应，共 30 × 2 = 60 个
  const baselineScript = {
    sessionKey: SESSION_KEY,
    arm: "baseline" as const,
    responses: Array.from({ length: TURNS }, () => ({
      text: "baseline response",
      usage: { input: 100, output: 50, total: 150 },
    })),
  };
  const treatmentScript = {
    sessionKey: SESSION_KEY,
    arm: "treatment" as const,
    responses: Array.from({ length: TURNS }, () => ({
      text: "treatment response",
      usage: { input: 100, output: 50, total: 150 },
    })),
  };
  const scriptedLlm = new ScriptedLlmDriver([baselineScript, treatmentScript]);

  const result = runMultiTurnDriver({
    turns: TURNS,
    queriesPerTurn: QUERIES_PER_TURN,
    sessionKey: SESSION_KEY,
    scriptedLlm,
    databasePath: dbPath,
    queries: queryPlans,
    baselineOptions: {
      explicitOptIn: true,
      testResearchOnly: true,
      limit: 4,
      maxFacts: 16,
      now: () => 1_000,
    },
    treatmentOptions: {
      explicitOptIn: true,
      testResearchOnly: true,
      testResearchOnlyBreakthrough: true,
      breakthroughInjection: {
        enabled: true,
        arm: "treatment",
        acceptedFactsMaxTokens: 256,
      },
      limit: 4,
      maxFacts: 16,
      now: () => 1_000,
    },
  });

  return { result };
}
```

**验证**：`pnpm test:fast -- tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts` 5 个 it 全绿，总时长 < 60s。

---

### Wave 4.3 — D3 报告生成器

#### 4.3.1 新建 `tests/unit/helpers/runtime-memory-eval-report.ts`

```typescript
import type { MultiTurnRunResult, MetricSummary, ArmMetrics } from "../../openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver";
import {
  bootstrapConfidenceInterval,
  cohensD,
  minimumSampleSize,
  pairedTTest,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/statistics";

export type EvalReport = {
  phase: "phase-36";
  generatedAt: number;
  turns: number;
  queriesPerTurn: number;
  totalDurationMs: number;
  metrics: {
    baseline: Record<keyof ArmMetrics, MetricSummary>;
    treatment: Record<keyof ArmMetrics, MetricSummary>;
  };
  statistics: {
    pairedTTest: {
      t: number;
      df: number;
      pValue: number;
      significant: boolean;
      meanDiff: number;
    };
    bootstrapCI: {
      mean: number;
      lower: number;
      upper: number;
    };
    cohensD: number;
    minimumSampleSize: number;
  };
  thresholds: {
    p95LatencyMs: number;
    rawLeakRate: number;
    promptInjectionRate: number;
    totalDurationMs: number;
  };
  passed: boolean;
  failures: string[];
};

export function generateEvalReport(result: MultiTurnRunResult): EvalReport;
export function formatEvalReportText(report: EvalReport): string;
```

**实现要点**：
- `generateEvalReport`：对 `result.turns` 的 `recallAtK` 跑 `pairedTTest`、`bootstrapConfidenceInterval`、`cohensD`、`minimumSampleSize`
- `thresholds`：`p95LatencyMs < 60_000`、`rawLeakRate === 0`、`promptInjectionRate === 0`、`totalDurationMs < 60_000`
- `passed`：所有 threshold 通过 + `pairedTTest.significant === true` + `bootstrapCI.lower >= baselineMean`
- `failures`：收集所有未达标项的描述字符串
- `formatEvalReportText`：人类可读的多行文本（含指标表、统计结果、门槛对照、结论 PASS/FAIL）

**验证**：在 Wave 4.2 长对话测试中可选断言 `generateEvalReport(result).passed === true`（不强制加，避免过度耦合）。

---

### Wave 4.4 — D4 package.json 脚本

#### 4.4.1 修改 `openclaw_runtime/package.json`

在 `scripts` 块（line 1423 起）按字母序插入（在 `android:test:third-party` 之后、`audit:seams` 之前的 `a*` 区段不合适；应放在 `eval` 字母序位置，约在 `e*` 区段）。

实际位置：搜索 `scripts` 块内 `"e` 开头的脚本，按字母序插入。若不存在 `e*` 脚本，则插入在 `"docs:` 之后、`"e` 区段开头。

**变更**：
```json
"eval:runtime-memory:long-conversation": "node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts",
```

**验证**：`pnpm eval:runtime-memory:long-conversation`（从 `openclaw_runtime/` 目录执行）跑通长对话测试。

---

### Wave 5 — E1 task spec + rules

#### 5.1.1 新建 `harness/specs/tasks/phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval.md`

参考 Phase 35 spec 格式。frontmatter 关键字段：

```yaml
---
id: phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval
title: Phase 36 runtime memory read hydration optimization and long conversation eval
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement Phase 36 optimization and long conversation evaluation for Runtime Memory read hydration. Covers B-collection closeout (CircuitBreaker type fixes, B7 sentinel reuse, delta wiring), C-foundation (ScriptedLlmDriver, testResearchOnly breakthrough), C-eval (statistical significance module, 30-turn multi-turn driver), D-pipeline (eval-helpers extraction, long conversation test, report generator, package.json script), E-spec (this task spec + breakthrough rule). Builds on Phase 35 benefit evaluation evidence. No product cutover, no default TaskLoop connection, no user Runtime Memory DB reads in default path. testResearchOnlyBreakthrough allows A/B injection comparison under explicit opt-in + test environment only.
ownedPaths:
  - harness/specs/tasks/phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval.md
  - harness/specs/rules/runtime-memory-read-hydration-test-research-breakthrough.md
  - openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.ts
  - openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts
  - openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts
  - openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - tests/unit/helpers/runtime-memory-eval-helpers.ts
  - tests/unit/helpers/runtime-memory-eval-report.ts
  - tests/unit/runtime-memory-eval-scripted-llm.test.ts
  - tests/unit/runtime-memory-eval-statistics.test.ts
  - tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts
  - tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts
  - tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts
touchedAreas:
  - harness/specs/tasks/phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval.md
  - harness/specs/rules/runtime-memory-read-hydration-test-research-breakthrough.md
  - openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.ts
  - openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts
  - openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts
  - openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/package.json
  - tests/unit/helpers/runtime-memory-eval-helpers.ts
  - tests/unit/helpers/runtime-memory-eval-report.ts
  - tests/unit/runtime-memory-eval-scripted-llm.test.ts
  - tests/unit/runtime-memory-eval-statistics.test.ts
  - tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts
  - tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts
  - tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts
expectedUserBehavior:
  - Default TaskLoop behavior remains unchanged; Phase 36 adds no default read hydration, no product UI, no Gateway route, no IPC route, no host-api/api-client/shared contract, no provider/tool ordering change, and no runtime cutover.
  - testResearchOnlyBreakthrough is opt-in only, test-environment only, and does not change authority boundaries (noPromptContextModelMessageInjection remains true in default path; breakthrough only affects metrics delta counting and fact injection visibility in test path).
  - Statistical significance module is pure-function, deterministic (mulberry32 fixed seed), no external dependencies, no network calls.
  - Multi-turn driver uses ScriptedLlmDriver (deterministic, zero network), runs 30 turns × 4 queries under 60s in CI.
  - eval-helpers extraction preserves existing benefit-eval test assertions (no regression).
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
  - runtime-memory-read-hydration-test-research-breakthrough
forbiddenPatterns:
  - default runtime switch, default TaskLoop read hydration, default shadow helper call, automatic memory/provider registration, runtime authority, durable fact authority, or production cutover
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - hydration facts or evaluation results entering prompt assembly, context provider output, model messages, Gateway/provider transport payloads, runtime decisions, next actions, checkpoints, transcripts, lifecycle events, traces, durable memory writes, provider ordering, or tool selection IN THE DEFAULT PATH (testResearchOnlyBreakthrough test path allows fact injection for A/B comparison only)
  - consumer opening, reading, creating, migrating, or writing production SQLite databases, calling TaskLoop, provider, Gateway, IPC, host-api, api-client, or any service/listener/daemon/server
  - reading or writing user Runtime Memory databases; Phase 36 may use only controlled sanitized temporary fixture DBs under os.tmpdir() and only through the existing explicit diagnostics path
  - calling real LLM/provider/model endpoints; ScriptedLlmDriver must remain deterministic
  - bypassing sanitizer boundaries, returning raw SQLite rows, record_json, raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, or authority markers
  - changing authority boundary flags (noPromptContextModelMessageInjection, noTaskLoopDecisionAuthority, etc.) from true to false in the default shadow-only path
featureFlags:
  - No default runtime feature flag is added by Phase 36.
  - testResearchOnlyBreakthrough defaults to undefined/false; only set true in test fixtures.
operatorGate:
  runtimeAssertions:
    - Phase 36 requires no live operator gate because it runs only deterministic mock fixtures in unit tests.
    - testResearchOnlyBreakthrough is reachable only from test code, not from default TaskLoop, product runtime, Gateway, IPC, renderer, host-api, or api-client paths.
    - Any future expansion beyond mock fixtures requires a fresh spec with operator opt-in.
corpusGate:
  runtimeAssertions:
    - provenance is controlled_fixture
    - sanitized === true
    - noUserRealData === true
    - reproducible === true
    - corpus reuses Phase 35 fixtures (tests/fixtures/runtime-memory-benefit-eval/)
privacyRetentionGate:
  runtimeAssertions:
    - no raw transcript/chat/jsonl/trace/prompt/tool/env/secret material in accepted facts
    - retention is bounded to the test process lifetime; temp SQLite DBs are removed in afterEach
    - aggregate metrics only outside the test process
    - noUserRuntimeDbRead === true
    - noDurableFactAuthority === true
    - noRealModelCall === true (ScriptedLlmDriver is deterministic)
rollbackGate:
  runtimeAssertions:
    - single removal path: delete Phase 36 spec, rules, new modules, new tests, and package.json script
    - non-empty rollback owner
    - no migration required
    - no durable writes to undo
    - non-empty rollback validation commands
metricsGate:
  runtimeAssertions:
    - treatment recall@k >= baseline recall@k with paired t-test significance (alpha=0.05)
    - bootstrap CI of treatment recall@k excludes baseline mean
    - raw leak rate 0 in treatment
    - prompt injection return rate 0 in treatment
    - total duration < 60s for 30 turns × 4 queries
    - minimum sample size achievable within 30 turns for observed cohensD
    - authority boundary flags remain true in default shadow-only path
    - delta counts wired (no hardcoded 0 in testResearchOnlyBreakthrough path)
rollback:
  - Remove openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.ts
  - Remove openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts
  - Remove openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts
  - Remove tests/unit/helpers/runtime-memory-eval-helpers.ts
  - Remove tests/unit/helpers/runtime-memory-eval-report.ts
  - Remove tests/unit/runtime-memory-eval-scripted-llm.test.ts
  - Remove tests/unit/runtime-memory-eval-statistics.test.ts
  - Remove tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts
  - Remove tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts
  - Remove harness/specs/tasks/phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval.md
  - Remove harness/specs/rules/runtime-memory-read-hydration-test-research-breakthrough.md
  - Revert openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts (Wave 1.1 fixes)
  - Revert openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts (Wave 1.2 + 2.2 changes)
  - Revert tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts (Wave 4.1 helper extraction)
  - Revert openclaw_runtime/package.json (Wave 4.4 script)
requiredTests:
  - pnpm run tsgo:core
  - pnpm test:fast -- tests/unit/runtime-memory-eval-scripted-llm.test.ts
  - pnpm test:fast -- tests/unit/runtime-memory-eval-statistics.test.ts
  - pnpm test:fast -- tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts
  - pnpm test:fast -- tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts
  - pnpm test:fast -- tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts
  - pnpm test:fast -- tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts
  - pnpm eval:runtime-memory:long-conversation
acceptance:
  - All Wave 3-6 files created and tests pass.
  - tsgo:core shows zero new errors on touched files.
  - Long conversation eval (30 turns × 4 queries) completes under 60s with statistical significance.
  - Authority boundaries preserved in default shadow-only path.
  - harness validate --spec passes.
docs:
  required: true
  files:
    - .trae/documents/phase-36-optimization-strategy-and-long-conversation-eval.md
    - .trae/documents/phase-36-remaining-waves-3-6-execution-plan.md
---
```

正文章节：Hard Boundaries、testResearchOnlyBreakthrough Scope、Statistical Methodology、Multi-turn Driver Design、Validation、Phase 37 Hard Gates（占位）。

#### 5.1.2 新建 `harness/specs/rules/runtime-memory-read-hydration-test-research-breakthrough.md`

```markdown
---
id: runtime-memory-read-hydration-test-research-breakthrough
title: Runtime Memory Read Hydration Test Research Breakthrough
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
---

The `testResearchOnlyBreakthrough` option on `TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions` allows Runtime Memory read hydration facts to be **injected** into TaskLoop context for A/B comparison, but only under strict conditions.

## Conditions

1. `explicitOptIn === true` — must be explicitly opted in
2. `testResearchOnly === true` — must be in test/research mode
3. `testResearchOnlyBreakthrough === true` — must be explicitly set (defaults to undefined/false)
4. `breakthroughInjection.enabled === true` — must provide an enabled injection config with `arm` and `acceptedFactsMaxTokens`

## Allowed Effects

When all conditions are met:
- `buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics` returns a `breakthroughInjection` summary in diagnostics (arm, acceptedFactCount, estimatedTokens, acceptedFactsMaxTokens, truncatedByTokenBudget)
- Delta counts (`taskLoopDecisionDeltaCount`, `toolCallDeltaCount`, etc.) may be wired to non-zero values via `deltaCounts` input
- The injection is visible in diagnostics for A/B comparison

## Forbidden Effects (Authority Boundary Preserved)

Even when breakthrough is enabled:
- `noPromptContextModelMessageInjection` flag remains `true` in the authority contract — the breakthrough does NOT authorize prompt/context/model-message injection in production paths
- `noTaskLoopDecisionAuthority`, `noToolSelectionAuthority`, `noProviderOrdering` remain `true`
- `noDurableFactAuthority`, `noMemoryWriteAuthority`, `noCheckpointAuthority`, `noTranscriptAuthority` remain `true`
- No durable writes to Runtime Memory databases
- No changes to provider ordering or tool selection
- The breakthrough path is reachable ONLY from test code, never from default TaskLoop, product runtime, Gateway, IPC, renderer, host-api, or api-client

## Sanitization

Injected facts are sanitized projections (same shape as `RuntimeMemoryHydrationShadowFactProjection`), never raw SQLite rows, `record_json`, or authority markers. Prompt-injection sentinel and raw-leak sentinel checks remain active.

## Default Path Unchanged

When `testResearchOnlyBreakthrough` is not set (default), the existing shadow-only diagnostics path is unchanged: no fact injection, delta counts default to 0, authority boundary flags all `true`.
```

**验证**：`pnpm harness validate --spec phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval`（若 harness CLI 可用）。

---

### Wave 6 — 全量验证

| 步骤 | 命令 | 期望 |
|------|------|------|
| 1 | `pnpm run tsgo:core 2>&1 \| findstr /C:"runtime-memory-eval" /C:"multi-turn-driver" /C:"statistics.ts"` | 0 行输出（新文件零类型错误） |
| 2 | `pnpm run tsgo:core 2>&1 \| findstr /C:"memory-read-hydration-shadow"` | 0 行输出（Wave 1.1 修复保持） |
| 3 | `pnpm test:fast -- tests/unit/runtime-memory-eval-statistics.test.ts` | 10 it 全绿 |
| 4 | `pnpm test:fast -- tests/unit/runtime-memory-eval-scripted-llm.test.ts` | 8 it 全绿（保持） |
| 5 | `pnpm test:fast -- tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts` | 5 it 全绿（保持） |
| 6 | `pnpm test:fast -- tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` | 全绿（helper 抽取后无回归） |
| 7 | `pnpm test:fast -- tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts` | 全绿（保持） |
| 8 | `pnpm eval:runtime-memory:long-conversation` | 5 it 全绿，总时长 < 60s |
| 9 | `pnpm harness validate --spec phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval` | 通过（若 harness CLI 可用） |

---

## 四、假设与决策（Assumptions & Decisions）

1. **统计模块不引入外部依赖**：内置 mulberry32 + Student t 分布 CDF 近似（df<=30 查表 + 插值，df>30 正态近似）。不引入 `mathjs`/`simple-statistics`/`d3-stat`。
2. **bootstrap 确定性**：默认 seed `0x1a2b3c4d` 固定，保证 CI 可重放。同 seed → 同 CI。
3. **最小样本量 197 vs 30 轮**：Cohen's d=0.2 时最小样本量 ≈ 197，但 30 轮 × 4 queries 提供 30 个 turn-level 样本（每轮聚合 4 queries）。决策：测试用实测 d 判定，若 d >= 0.5（中等效应），30 轮即可达 power>=0.8。在 `minimum sample size` 测试中断言 `TURNS >= required`，若 d 太小导致 required > 30，测试会失败（这是期望行为：提示需要扩大轮数）。
4. **多回合驱动器不直接调用 TaskLoop**：只调用 `buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics`（纯函数），不调用 `runTaskLoop`（避免完整 TaskLoop 启动的复杂性）。ScriptedLlmDriver 的响应在驱动器内取一次（验证集成），但不影响 hydration 结果（hydration 是纯函数，与 LLM 响应无关）。
5. **D1 抽取不破坏现有测试**：helper 文件保持纯函数（不 import vitest），门槛断言通过 `assert` 回调注入。现有 benefit-eval 测试改为复用 helper 后，断言不变。
6. **预存类型错误不在本次范围**：仓库 `tsgo:core` 存在大量预存错误，本次只保证**触及文件**零新增错误。
7. **testResearchOnlyBreakthrough 不改 authority 契约**：breakthrough 只影响 metrics delta 计数与 fact 注入可见性（在测试路径），不改持久化/provider ordering/默认路径 authority 标志。
8. **package.json 脚本位置**：按字母序插入 `eval:runtime-memory:long-conversation`，不破坏现有脚本顺序。
9. **harness spec docs 字段**：引用 `.trae/documents/` 下的计划文件作为 docs 产物（这些文件已存在/将被创建）。

---

## 五、执行顺序（推荐 Todo）

1. Wave 3.1 — C6 统计模块 + 测试 → tsgo + vitest 验证
2. Wave 3.2 — C4 多回合驱动器 → tsgo 验证
3. Wave 4.1 — D1 eval-helpers 抽取 + 改造现有 benefit-eval 测试 → vitest 验证无回归
4. Wave 4.2 — D2 长对话测试 → vitest 验证 5 it 全绿 < 60s
5. Wave 4.3 — D3 报告生成器 → tsgo 验证
6. Wave 4.4 — D4 package.json 脚本 → `pnpm eval:runtime-memory:long-conversation` 验证
7. Wave 5 — E1 task spec + rules → harness validate（若可用）
8. Wave 6 — 全量验证（tsgo:core + 所有相关 vitest）

---

## 六、文件清单（11 新 + 2 改）

### 新建（11）
1. `openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts`（Wave 3.1）
2. `openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts`（Wave 3.2）
3. `tests/unit/helpers/runtime-memory-eval-helpers.ts`（Wave 4.1）
4. `tests/unit/helpers/runtime-memory-eval-report.ts`（Wave 4.3）
5. `tests/unit/runtime-memory-eval-statistics.test.ts`（Wave 3.1 测试）
6. `tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts`（Wave 4.2）
7. `harness/specs/tasks/phase-36-runtime-memory-read-hydration-optimization-and-long-conversation-eval.md`（Wave 5）
8. `harness/specs/rules/runtime-memory-read-hydration-test-research-breakthrough.md`（Wave 5）

### 修改（2）
1. `tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts`（Wave 4.1 复用 helper）
2. `openclaw_runtime/package.json`（Wave 4.4 追加 `eval:runtime-memory:long-conversation` 脚本）

---

## 七、关键风险与缓解

| 风险 | 缓解 |
|------|------|
| 30 轮 × 240 次 hydration 调用可能超 60s | 多回合驱动器用 temp SQLite + 纯函数；若超时，降低 maxFacts 或减少 turns；CI 跑前本地测一次 |
| bootstrap CI 测试可能因 RNG 浮点误差在跨平台下微差 | 用固定 seed + `toBeCloseTo` 而非 `toBe`；CI 与本地同 Node 版本 |
| D1 抽取后 benefit-eval 测试断言可能因 helper 边界差变化 | helper 严格保持原函数签名与返回值；抽取后跑完整 benefit-eval 测试确认无回归 |
| Student t 分布 CDF 近似在 df 边界（df=30）可能不连续 | df=30 用查表值，df=31 起用正态近似，并在 df=30/31 边界用插值平滑 |
| testResearchOnlyBreakthrough 可能被误解为允许生产注入 | rule spec 明确 forbidden effects；task spec forbiddenPatterns 列出禁止项；authority 标志保持 true |
| package.json 脚本插入位置可能破坏现有字母序 | 实际插入时先 Grep 确认 `e*` 区段位置，按字母序精确插入 |
