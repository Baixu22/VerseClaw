# P2 开发提示词：Provider/LLM 共用 Validated Compaction Pipeline

> 状态：准备进入 P2，尚未修改 P2 runtime 文件
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线：`734ec877e75682861103660fbdea2bd55253ece0`
> 上一阶段证据：`reports/context-compression/P1-EVIDENCE-2026-08-17.md`

---

## 1. 角色与总目标

你是 Verse Claw/OpenClaw 的 Context Compression Fidelity Hardening 执行 agent。
当前阶段是 P2：让 **compaction provider 插件与 built-in LLM** 走同一条
`normalize -> artifact -> critical ledger comparison -> damage audit -> shadow decision`
管线，删除 provider 的 trusted bypass。

P2 验收只证明：

- provider 输出和 built-in LLM 输出都经过同一 finalize 管线；
- 每次 safeguard compaction 都生成 `CompressionArtifact v1` 并写入 `details.artifact`；
- critical goal / decision / constraint / failed_attempt / next_action / exact identifier
  缺失会被 deterministic audit 记录；
- damage audit 从“只有测试使用”变成 runtime shadow 数据；
- `wouldRetry` / `wouldFallback` / `wouldPreserveTurns` 只记录、不 enforce；
- 除现有 LLM `qualityGuard` retry 外，P2 不新增任何模型调用。

**不得宣布** token savings、结构化 judge 分数或单模型自评成功。

---

## 2. 必读文件（先完整读，再动手）

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `reports/CONTEXT-COMPRESSION-DEVELOPMENT-PLAN-2026-08-17.md` 第 1、3、4(P2)、5、6、7 节
4. `harness/specs/tasks/token-dense-recovery-compression-v1.md`（当前 active spec）
5. `reports/context-compression/P1-EVIDENCE-2026-08-17.md`
6. `reports/context-compression/P0-EVIDENCE-2026-08-17.md`
7. 以下实际代码，不要根据文件名猜接口：
   - `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts`
   - `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts`
   - `openclaw_runtime/src/agents/agent-hooks/compaction-damage-rules.ts`
   - `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-runtime.ts`
   - `openclaw_runtime/src/agents/agent-hooks/compaction-damage-rules.test.ts`
   - `openclaw_runtime/src/plugins/compaction-provider.ts`
   - `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts`（safeguard runtime 装配区域）
   - `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts`（details 持久化区域，约 `compactionDetails` / `persistSessionCompactionCheckpoint`）
   - `openclaw_runtime/src/agents/sessions/agent-session.ts`（`session_before_compact` -> `appendCompaction` 区域）
   - `openclaw_runtime/src/agents/sessions/extensions/types.ts`（`SessionBeforeCompactEvent` / `SessionBeforeCompactResult`）
   - `openclaw_runtime/src/agents/sessions/compaction/compaction.ts`（agent-core bridge）
   - `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts`（P1 authority）
   - `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts`（`previousArtifact` lineage）

---

## 3. 阶段开始仪式（必须执行）

按顺序执行并记录结果：

```powershell
$env:Path = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:Path"
pnpm --version   # 期望 pinned 11.2.2
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
```

然后跑 P2 基线（本提示词准备时已跑，仍要自己复核）：

```powershell
pnpm --dir openclaw_runtime exec vitest run src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=dot
pnpm exec vitest run tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=dot
pnpm --dir openclaw_runtime exec vitest run packages/gateway-protocol/src/schema/sessions.recall.test.ts packages/agent-core/src/harness/compaction/compression-artifact.test.ts --reporter=dot
pnpm contract:check
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
git diff --check
git status --short --branch
```

---

## 4. 硬边界（任何情况下不得违反）

1. 不创建第二套 Context Store、Context Budget、Task Ledger、Memory 或 Task Forest。
2. Agent Core compaction、Compaction Safeguard、CompressionArtifact、Context Runtime Kit
   的 authority 保持不变；P2 的 pipeline 只是 safeguard 内的一层 finalize/audit。
3. 自然语言摘要只能是 projection，不能成为事实源；`details.artifact` 是结构化 carrier。
4. 每个 critical atom 必须能回到 transcript、archive handle、file hunk 或 CVK selector；
   沿用 P1 的 `critical_atom_missing_evidence` 降级规则。
5. provider 与 built-in LLM 必须调用同一个 finalize 函数；禁止 provider early-return trusted bypass。
6. P2 是 shadow-only：`wouldRetry` / `wouldFallback` / `wouldPreserveTurns` 只写入
   audit/diagnostics，不得改变返回 summary、不得 abort、不得触发新的 provider/LLM repair。
   现有 LLM `qualityGuard` retry 行为保持原样。
7. 不得新增模型调用、DeepSeek 调用或结构化 judge。DeepSeek API key 只从环境变量读取，
   绝不写入 artifact、cache、report 或日志。
8. `CompressionArtifact.schemaVersion` 必须保持 `1`；旧 v1 payload 继续可读。
9. 不得用 token savings、结构化 judge 分数或单模型自评宣布成功。
10. 不修改 `D:\ClawX` 根工作树的未提交改动；本 worktree 的 P0/P1 未提交改动必须保留。
11. P2 新增 artifact 必须 JSON-serializable，并且不携带 Gateway schema 尚不接受的
    `telemetry` 对象或 CRK optional 字段（除非 P2 同时完成三处契约同步，但 P2 默认不做）。
12. 不修改 UI/E2E；`CompactionArtifactViewer` 与 recovery 展示路径不因 P2 回归。

---

## 5. 当前接口事实（P2 准备时已核对）

### 5.1 trusted bypass 确实存在

`compaction-safeguard.ts` provider 分支：

- provider `summarize()` 返回非空 string 后，直接组装 suffix 并 `return`；
  注释明确写着 `// No quality guard: the provider is trusted.`。
- provider 分支没有 `auditSummaryQuality`、没有 `auditCompactionDamage`、
  没有 atom ledger comparison，也没有 `details.artifact`。
- built-in LLM 分支只做 `auditSummaryQuality` 的 section/identifier/latest-ask 检查，
  不调用 `auditCompactionDamage`，也不生成 `CompressionArtifact`。
- 两个分支的 `details` 目前都是 `{ readFiles, modifiedFiles }`。

### 5.2 可复用但不完整的质量模块

- `auditSummaryQuality` 已检查 5 个必需 section、strict identifier policy 下的
  opaque identifier、latest user ask 重叠；返回 `{ ok, reasons }`。
- `extractOpaqueIdentifiers` 已能抽取 hex ID、URL、path、`file:line`、长数字等。
- `summaryIncludesIdentifier` 目前是 `compaction-safeguard-quality.ts` 的 private 函数；
  P2 若要在 pipeline 中复用，必须显式 export 或把相关比较留在 quality 模块内。
- `auditCompactionDamage` 已实现 shadow/enforce 参数，但当前 runtime 零调用，
  只有 `compaction-damage-rules.test.ts` 引用。

### 5.3 P1 已提供的 lineage 入口

- `event.preparation.previousArtifact?: CompressionArtifact` 已经存在；
  它来自前一个 `CompactionEntry.details.artifact` 的 `normalizeCompressionArtifact`。
- 但 embedded safeguard 路径目前从不写 `details.artifact`，所以 P2 之前该字段
  第一次压缩后仍为空；P2 开始生成后，后续压缩才能吃到 lineage。
- `buildDeterministicCompressionArtifact` 支持 `previousArtifact` 和
  `semanticAtoms`，会自动把 `supersedes` 目标置为 `superseded` 且不删除旧 atom。

### 5.4 artifact 可持久化路径已通

- `agent-session.ts` 会把 extension 返回的 `compaction.details` 原样传给
  `sessionManager.appendCompaction`。
- `embedded-agent-runner/compact.ts` 的 `compactionDetails` 会透传 hook result details，
  并写入 `persistSessionCompactionCheckpoint`；P2 只需在 safeguard extension 的
  `details` 里加 `artifact` / `validatedPipeline`，无需改 checkpoint 落盘链路。
- Gateway `CompressionArtifactSchema` 已接受 P1 的 `semanticAtoms`；
  但 `additionalProperties: false`，P2 默认不要给 artifact 塞 `telemetry` 对象或
  CRK optional 字段，除非本阶段同步补齐（默认不补齐）。
- 从 `agent-hooks` 目录 import authority：
  `../../../packages/agent-core/src/harness/compaction/compression-artifact.js`。

### 5.5 provider 契约

- `CompactionProvider.summarize()` 只返回 `Promise<string>`，没有结构化 artifact、
  evidence、质量或 lineage 契约。P2 必须把 provider 输出当 untrusted string，
  和 LLM 输出一样 normalize。
- `tryProviderSummarize` 已经对 abort/timeout 做了正确传播，保留该行为。
- provider 失败仍 fallback 到 built-in LLM；P2 不改变该 fallback。

### 5.6 现有 retry 与 recent-turn preserve

- LLM 分支的 `qualityGuardEnabled` 默认在 safeguard 模式为 true，
  `qualityGuardMaxRetries` 默认 1；该循环已是有界 repair。
- `splitPreservedRecentTurns` 和 suffix 组装先于 P2 存在；P2 的 artifact 必须从
  **summary body（pre-suffix）** 构建，不得把 preserved turns / tool-failure /
  file-ops / workspace rules suffix 当成 durable facts 抽进 atom。
- P2 shadow decision 不新增 repair：`wouldRetry=true` 只表示“如果未来 enforce，
  会走已有 qualityGuard 式重试”；`wouldFallback=true` 只表示“如果 repair 失败，
  未来会 fallback/preserve turns”。

---

## 6. P2 目标接口草案（实现时以测试锁行为，不要照抄猜测）

建议在 `openclaw_runtime/src/agents/agent-hooks/` 新建：

```ts
// compaction-validated-pipeline.ts
import type { CompressionArtifact, CompressionSemanticAtom } from
  "../../../packages/agent-core/src/harness/compaction/compression-artifact.js";

export const COMPACTION_VALIDATED_PIPELINE_SCHEMA = "compaction-validated-pipeline/v1" as const;

export type CompactionCriticalLedgerAudit = {
  compared: number;
  missingAtomIds: string[];
  missingExactIdentifiers: string[];
};

export type CompactionValidatedDecision = {
  schema: typeof COMPACTION_VALIDATED_PIPELINE_SCHEMA;
  mode: "shadow";
  source: "provider" | "llm" | "boundary";
  wouldRetry: boolean;
  wouldFallback: boolean;
  wouldPreserveTurns: boolean;
  reasons: string[];
  quality: { ok: boolean; reasons: string[] };
  damage: CompactionDamageAudit;      // 复用 compaction-damage-rules.ts 类型
  criticalLedger: CompactionCriticalLedgerAudit;
  repairAttempts: number;             // P2 恒为 0；现有 LLM qualityGuard 不计入
};

export type ValidatedCompactionOutput = {
  artifact: CompressionArtifact;
  decision: CompactionValidatedDecision;
};
```

核心函数草案：

```ts
export function extractCandidateSemanticAtoms(params: {
  summary: string;
  messages: AgentMessage[];
  previousArtifact?: CompressionArtifact;
}): CompressionSemanticAtom[];

export function buildValidatedCompactionOutput(params: {
  source: "provider" | "llm" | "boundary";
  summary: string;                    // summary body，不含 preserved/suffix
  messages: AgentMessage[];
  previousSummary?: string;
  previousArtifact?: CompressionArtifact;
  readFiles?: string[];
  modifiedFiles?: string[];
  identifiers?: string[];
  latestAsk?: string | null;
  identifierPolicy?: "strict" | "off" | "custom";
}): ValidatedCompactionOutput;
```

约束：

- `buildValidatedCompactionOutput` 内部必须调用
  `buildDeterministicCompressionArtifact`，不得复制 P1 的 normalize/builder。
- candidate atom 的 heading 映射至少覆盖：
  `goal`、`latest_user_ask`、`decision`、`constraint`、`failed_attempt`、
  `entity`、`next_action`、`outcome`、`safety_boundary`；
  解析不到的类型就留空，不得发明。
- candidate atom `id` 必须 ledger-stable（例如
  `atom-<type>-<deterministic-hash(canonicalIdentity)>-<n>`），
  同一 `canonicalIdentity` 必须复用 previousArtifact 的 id/evidenceRefs/supersedes 关系。
- 大段代码、tool schema、durable fact body 不得进入 atom.text；只允许
  bounded projection + evidence ref。candidate 文本先截断再交给 builder。
- critical 比较只比较 previousArtifact 中 `severity: "critical"` 且
  status 不是 `superseded` / `stale` 的 atom。
- critical atom 命中规则：优先 `canonicalIdentity` 精确命中；否则允许
  “summary projection 命中”（至少 2 个 meaningful token 重叠，短文本 1 个）；
  两者都不满足才记 `missing_atom:<id>`。
- exact identifier 缺失：对 compared critical atoms 和最近 10 条消息抽取
  opaque identifiers，summary 不包含的记 `missing_exact_identifier:<value>`。
- damage audit 固定 `{ mode: "shadow" }`。
- decision 语义固定：
  - `wouldRetry = !quality.ok || damage.verdict === "suspect" || missingAtomIds.length > 0 || missingExactIdentifiers.length > 0`
  - `wouldFallback = damage 含 critical goal_token_decay 或 missingAtomIds 非空`
  - `wouldPreserveTurns = wouldFallback`
  - `repairAttempts = 0`（shadow）
- 返回的 `artifact.quality.warnings` 会由 P1 builder 生成；pipeline 不得静默清除。
- `validatedPipeline` audit 必须 JSON-serializable，放进 compaction `details`。

### 6.1 `compaction-safeguard.ts` 重构点

- 删除 provider 分支的 trusted early-return 和注释。
- 抽出 `finalizeSafeguardCompaction(params)`（或等价纯函数），provider / LLM /
  no-real-conversation boundary 三个出口都调用它，传入：
  - `source`
  - summary body（provider: `providerResult`；LLM: `lastHistorySummary`；
    boundary: fallback summary）
  - 原消息集、`preparation.previousSummary`、`preparation.previousArtifact`、
  - `readFiles` / `modifiedFiles`、identifiers、latestAsk、identifierPolicy。
- finalize 只负责 audit + artifact，不改 summary；suffix 组装和 cap 保持在原调用点。
- 三个出口的 `details` 统一为：
  `{ readFiles, modifiedFiles, artifact, validatedPipeline }`。
- provider 成功仍返回 provider summary + suffix，shadow 下行为不变。
- LLM `qualityGuard` retry 循环保持不变；最终 artifact/audit 用最后成功的
  `lastHistorySummary`（不包含 preserved turns/suffix）。
- 在 `testing` 对象中导出新的纯函数和 audit 类型，供单测注入调用。

### 6.2 可选的小改动

- `compaction-safeguard-quality.ts`：如 pipeline 需要复用
  `summaryIncludesIdentifier` / `hasAskOverlap`，显式 export，不复制实现。
- `compaction-damage-rules.ts`：P2 不改 damage 规则语义；只在 audit 数据中引用其类型。
- `compaction-safeguard-runtime.ts`：默认不新增配置；shadow 是常量行为。
  若测试需要 off 开关，用 dependency injection，不新增 config schema。

---

## 7. 先补测试，再实现行为（TDD 顺序）

### 第 1 批：pure pipeline（新建 `compaction-validated-pipeline.test.ts`）

1. `buildValidatedCompactionOutput` 对无 previousArtifact 的 structured summary：
   - 返回 `artifact.schemaVersion === 1`；
   - `decision.mode === "shadow"`；
   - `decision.repairAttempts === 0`；
   - `decision.wouldRetry/wouldFallback/wouldPreserveTurns` 全 false；
   - candidate atoms 非空且所有字段可 JSON.stringify。
2. critical ledger comparison：
   - previousArtifact 含 critical goal / decision / constraint /
     failed_attempt / next_action atom，新 summary 保留全部 -> `missingAtomIds: []`。
   - 新 summary 丢掉一个 critical decision -> `missing_atom:<id>`，
     `wouldRetry/wouldFallback/wouldPreserveTurns` 均 true。
   - previous 中 `superseded` / `stale` atom 不参与比较。
   - conflict atom 双方仍出现在 artifact.semanticAtoms，projection 仍可见。
3. exact identifier：
   - previous critical atom 或最近消息含 `src/auth/middleware.ts`、hex id、
     URL 等，新 summary 丢失 -> `missing_exact_identifier:*` 非空。
4. damage audit integration：
   - summary 缺 required sections -> `decision.damage.verdict === "suspect"`；
   - summary 无 goal anchor -> `wouldFallback === true`。
5. shadow contract：
   - 对 suspect 输出，调用方传入的 summary 字符串原样保留（helper 不修改）；
   - helper 不接收/不调用 model、provider、streamFn，测试可断言调用计数为 0。
6. provider 与 LLM 同管线：
   - 同一个 helper 分别以 `source: "provider"` 和 `source: "llm"` 处理同一份
     合法/损坏 summary，audit 结果和 artifact 形状一致；
   - source 仅记录在 decision 中，不改变 audit 语义。
7. P1 回归：provider-style 输入里 critical atom 缺 evidence 时，最终 artifact 中
   status 不得为 `verified`（沿用 P1 规则）。

### 第 2 批：safeguard wiring（`compaction-safeguard.ts`）

8. 通过 `testing` 导出的 finalize helper 验证：
   - `finalizeSafeguardCompaction` 返回 `{ artifact, validatedPipeline }`；
   - `details` 可被 `JSON.parse(JSON.stringify(...))` round-trip。
9. 用依赖注入（`testing.setSummarizeInStagesForTest` 已有；如需要可新增
   finalize dependency）验证 shadow 下 summary 不变、不新增模型调用。
10. 跑 `manual-compaction.test.ts` / `preemptive-compaction.test.ts`，确认
    provider/boundary/LLM 路径没有行为回归；若这些测试断言了 details 精确形状，
    按 P2 新形状更新断言，不得把 artifact 字段从 details 里删掉。

### 第 3 批：回归与契约

11. P1 root tests：
    `tests/unit/compression-artifact.test.ts` 全绿；
    `context-runtime-kit-*` 全绿；Gateway schema 测试全绿。
12. 若有 artifact 从 safeguard 流入 checkpoint 的集成 fixture，补充断言：
    `details.artifact.schemaVersion === 1` 且 `details.validatedPipeline.schema`
    正确；没有现成 fixture 时在 P2 evidence 中写明用 pure pipeline 测试覆盖，
    并把 checkpoint 集成留到 P3。
13. UI/E2E 不修改；如误改 UI，必须补 i18n 四语和 viewer E2E。

---

## 8. 建议实现顺序（全部完成前不进入 P3）

1. 先更新 Harness spec：touchedAreas/acceptance/requiredTests 增补 P2 验收与新增文件。
2. 写第 1 批测试，运行确认失败。
3. 实现 `compaction-validated-pipeline.ts`：
   candidate atom 提取、critical ledger comparison、damage/quality 组合、decision。
4. 写/跑第 2 批测试，重构 `compaction-safeguard.ts`：
   删除 provider trusted bypass，三个出口统一 finalize，details 增加 artifact/audit。
5. 跑第 3 批回归。
6. 全部命令通过后写 `reports/context-compression/P2-EVIDENCE-2026-08-17.md`。

---

## 9. 必须运行的命令（按顺序）

```powershell
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm --dir openclaw_runtime exec vitest run src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/agent-hooks/compaction-validated-pipeline.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-artifact.test.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts --reporter=verbose
pnpm contract:check
pnpm exec eslint <changed files>
pnpm run typecheck
pnpm run comms:replay
pnpm run comms:compare
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
```

若需要验证 openclaw_runtime core TS：

```powershell
cd openclaw_runtime
pnpm exec tsc -p tsconfig.core.json --noEmit --pretty false
```

> 注意：该全量 core tsc 当前有与 P2 无关的 `shared/verseshell/**` 既有错误；
> 只要求 grep 确认 P2 changed files 没有新增错误，不要把既有错误修进 P2。

UI/E2E 路径不应修改；若误修改，额外运行：

```powershell
pnpm exec playwright test tests/e2e/chat-manual-compaction.spec.ts tests/e2e/chat-recovery-assist.spec.ts tests/e2e/compaction-artifact-viewer.spec.ts
```

---

## 10. 修改文件候选与回滚

| 文件 | owner/性质 | 回滚 |
|---|---|---|
| `openclaw_runtime/src/agents/agent-hooks/compaction-validated-pipeline.ts`（新建） | 本阶段新增 | 删除文件 |
| `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts` | P2 runtime | `git checkout -- <path>` |
| `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts`（如需 export） | P2 runtime | `git checkout -- <path>` |
| `openclaw_runtime/src/agents/agent-hooks/compaction-damage-rules.ts`（如需类型引用） | P2 runtime | `git checkout -- <path>` |
| `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-runtime.ts`（如需 testing switch） | P2 runtime | `git checkout -- <path>` |
| `openclaw_runtime/src/agents/agent-hooks/compaction-validated-pipeline.test.ts`（新建） | 本阶段新增 | 删除文件 |
| `openclaw_runtime/src/agents/agent-hooks/compaction-damage-rules.test.ts`（如需补断言） | 测试 | `git checkout -- <path>` |
| `harness/specs/tasks/token-dense-recovery-compression-v1.md` | P0/P1 已改 | P0/P1 未提交，`git checkout` 会连 P0/P1 一起丢 |
| `reports/context-compression/P2-EVIDENCE-2026-08-17.md`（新建） | 本阶段新增 | 删除 |

> 注意：当前 P0/P1 改动均未提交。回滚单个 P2 文件用 `git checkout -- <path>`；
> 整体 reset 到基线 `734ec877e` 会连 P0/P1 一起丢弃，只能在用户明确批准后执行。

---

## 11. 阶段结束必须输出（照抄上一阶段格式）

- 修改文件列表；
- 数据流和 authority 是否变化；
- 新增/更新测试；
- 运行过的命令及结果；
- 指标变化；
- 未解决问题；
- 回滚开关或旧路径；
- 是否满足进入 P3 的条件。

P2 额外必须回答：

- provider trusted bypass 是否删除（给出代码位置和测试名）；
- provider 与 built-in LLM 是否真的共用 finalize（给出测试名）；
- `details.artifact` 是否在 provider / LLM / boundary 三个出口都生成；
- `wouldRetry` / `wouldFallback` / `wouldPreserveTurns` 是否只记录未 enforce；
- P2 是否新增了任何模型调用；
- critical ledger / exact identifier 缺失是否可被 deterministic audit 记录（给出测试名）；
- 是否修改了 UI/E2E（如未修改，说明为什么不需要）。

---

## 12. P2 完成标准（未全部满足不得进入 P3）

- 所有新增/回归测试绿。
- `pnpm harness validate --spec ...token-dense-recovery-compression-v1.md` PASS。
- `pnpm contract:check` PASS。
- `pnpm run typecheck` node+web PASS；test project 不新增错误。
- openclaw_runtime core tsc 的 P2 changed files 不新增错误（全量既有
  `shared/verseshell/**` 错误不计入 P2）。
- comms replay/compare PASS（如未触及 comms 也如实记录并说明）。
- provider 路径不再存在 trusted bypass 注释/early-return。
- 三个出口均写入 `details.artifact`（schemaVersion=1）和
  `details.validatedPipeline`（shadow）。
- 除现有 LLM qualityGuard 外，没有新增模型调用。
- 不存在 provider trusted bypass；DeepSeek key 未落盘。
- 未创建第二套 context/memory/task truth。
