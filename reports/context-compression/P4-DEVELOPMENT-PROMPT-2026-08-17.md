# P4 开发提示词：ACON 式失败驱动优化与模型级联对比

> 状态：准备进入 P4，尚未修改 P4 文件
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线：`734ec877e75682861103660fbdea2bd55253ece0`
> 上一阶段证据：`reports/context-compression/P3-EVIDENCE-2026-08-17.md`

---

## 1. 角色与总目标

你是 Verse Claw/OpenClaw 的 Context Compression Fidelity Hardening 执行 agent。
当前阶段是 P4：**用 paired trajectory 分析做失败驱动优化，并建立
deterministic extractor / 当前压缩模型 / 强模型 critic 的模型级联对比**。

P4 验收只证明：

- runner 能读取并校验 paired trajectory JSONL：每条记录包含
  `sampleId`、压缩后 summary、完整上下文是否成功、压缩上下文是否成功；
- `fullContextSuccess=true && compressedSuccess=false` 的样本被识别为
  compression-induced failure，进入失败驱动分析；
- DeepSeek（或其他强模型）critic 能从失败轨迹中输出遗漏 critical atom
  候选和 repair guideline；没有 key 或 critic 失败时显式记录 `executed=false`，
  不得伪造；
- deterministic extractor 与 DeepSeek critic 的结果可以并列比较；
  压缩模型与唯一评审模型相同时不标记为 independent；
- 指标报告至少包含 recall、omission、fabrication、continuation、
  retry rate、latency、token、cost，并输出 mean / min / cohort / 95% CI；
- P0-P3 回归不破，runtime 压缩路径行为不变。

**不得宣布** token savings、结构化 judge 分数或单模型自评成功。
P4 数据未达 100 条 paired trajectories 前，不得进入蒸馏或 runtime 改造讨论。

---

## 2. 必读文件（先完整读，再动手）

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `reports/CONTEXT-COMPRESSION-DEVELOPMENT-PLAN-2026-08-17.md` 第 1、3、4(P4)、5、6、7 节
4. `harness/specs/tasks/token-dense-recovery-compression-v1.md`（当前 active spec）
5. `reports/context-compression/P0-EVIDENCE-2026-08-17.md`
6. `reports/context-compression/P1-EVIDENCE-2026-08-17.md`
7. `reports/context-compression/P2-EVIDENCE-2026-08-17.md`
8. `reports/context-compression/P3-EVIDENCE-2026-08-17.md`
9. `docs/enhancements/05-adaptive-context-budget.md`（P5 前置设计，P4 不实现）
10. 以下实际代码，不要根据文件名猜接口：
   - `scripts/context-compression-eval-runner.mjs`
   - `tests/unit/context-compression-eval.test.ts`
   - `tests/unit/helpers/context-compression-eval.ts`
   - `reports/context-compression/production-manifest-30.json`
   - `harness/specs/tasks/token-dense-recovery-compression-v1.md`
   - 以及 P4 要扩展的 CLI 区域：
     `main()`、`--paired-summary` overlay、`runDeepSeekJudge`、
     `runDeepSeekSchemaFree`、`runDeepSeekContinuation`、`createSampleManifest`、
     `summarizePairedDamage`、`writeHumanEvalPack` 附近。

---

## 3. 阶段开始仪式（必须执行）

按顺序执行并记录结果：

```powershell
$env:Path = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:Path"
pnpm --version   # 期望 pinned 11.2.2
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
```

然后跑 P4 基线（确认 P0-P3 未回归）：

```powershell
pnpm --dir openclaw_runtime exec vitest run src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/agent-hooks/compaction-validated-pipeline.test.ts src/agents/agent-hooks/compaction-addressability.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=dot
pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=dot
pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-artifact.test.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts --reporter=dot
pnpm contract:check
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
git diff --check
git status --short --branch
```

若本机已有 `DEEPSEEK_API_KEY`，先只做本地缓存冒烟，不直接打满
`--llm-judge --llm-schema-free --llm-continuation`；没有 key 则记录
`executed=false`，不得把缺失 key 解释为失败证据。

---

## 4. 硬边界（任何情况下不得违反）

1. 不创建第二套 Context Store、Context Budget、Task Ledger、Memory 或 Task Forest。
2. P4 只修改 eval runner、eval 测试、eval helper 和报告类文档；不得修改
   Agent Core compaction、Compaction Safeguard、CompressionArtifact authority、
   Context Runtime Kit 或 compact 持久化路径。
3. `CompressionArtifact.schemaVersion` 必须保持 `1`；P4 即使生成 guideline，
   也不能把 guideline 写进 artifact。
4. 自然语言摘要与 guideline 都只是 projection / 优化提示，不能成为事实源。
5. 不新增 runtime 模型调用；DeepSeek 只允许在 eval runner 中作为 judge /
   critic / continuation planner 被显式 CLI 触发。
6. 不让同一模型成为压缩器和唯一评审器：runner 必须记录
   `compressionModel` / `judgeModel` / `criticModel`，当压缩模型与唯一评审
   模型相同且没有其他独立评审时，`modelIndependence.ok` 必须为 false。
7. DeepSeek API key 只从环境变量读取，绝不写入 artifact、cache、report、
   manifest 或日志；cache 只存 prompt-versioned 结果，不存 key。
8. 不得用 token savings、结构化 judge 分数或单模型自评宣布成功。
9. 不修改 UI/E2E；如误改 UI，必须补 i18n 四语和 viewer E2E。
10. 不修改 `D:\ClawX` 根工作树的未提交改动；本 worktree 的 P0/P1/P2/P3
    未提交改动必须保留。
11. P4 新增 JSONL / JSON 产物必须 JSON-serializable；不得携带 secrets /
    API key / 完整 transcript 原文（只能保留引用、hash 和 bounded 截断）。
12. legacy transcript replay rollback 必须保留；P4 不改变 recovery 路径。

## 5. 当前接口事实（P4 准备时已核对）

### 5.1 Eval runner 已经具备的 P4 底座

- `--paired-summary <jsonl>` 已支持 overlay 外部 summary：
  每行 `{"sampleId","compressedSummary"}`，overlay 后保留
  `sample.pairedOriginalSummary` 并计算 `pairedDamage`。
- `--llm-judge` / `--llm-schema-free` / `--llm-continuation` 已存在，
  默认模型 `deepseek-chat`；全部通过 `DEEPSEEK_API_KEY` 环境变量调用。
- `--llm-judge-calibration` 生成 known-loss calibration 样本；
  `--llm-judge-live-rerun-ratio` 支持抽检缓存一致性。
- cache 按 promptVersion + sampleId + expected/stale/summary hash 分区，
  不存储 API key。
- `--sample-manifest` / `--write-sample-manifest` / `--write-human-eval-pack` /
  `--human-eval-ratings` / `--agent-manual-eval-ratings` 已存在。
- `summarizePairedDamage` 已能把 paired damage 与 template baseline 比较。
- 但 runner **没有** paired trajectory 输入：无法表达
  `fullContextSuccess` / `compressedSuccess` / `retryCount` /
  `latencyMs` / `tokenUsage` / `cost` / `compressorModel`。

### 5.2 P4 需要补的语义缺口

- `--paired-summary` 只能说明“生产 summary 比模板少保留了什么”，不能说明
  “完整上下文成功、压缩后失败”的真实任务结果。
- 没有 deterministic trajectory 分类器：full-context failure 不能算
  compression-induced failure；compressed success 也不能算压缩伤害。
- 没有 DeepSeek critic：当前 schema-free judge 只输出 omission 严重度，
  不输出“应补哪些 critical atom / 应改哪条 guideline”。
- 没有 guideline 产物：失败教训只散在 report 文本里，无法固定重放。
- 没有 model independence 记录：compressorModel 与 judgeModel 是否同源
  目前不可审计。

### 5.3 固定 manifest 现状

- `reports/context-compression/production-manifest-30.json` 是 P0 固定的
  30 样本；P4 不能修改其 sampleSelectionHash 或 digest，但可以新增
  paired-trajectory 输入文件，独立引用 sampleId。
- P0 baseline 目录：`artifacts/context-compression-baseline/2026-08-16T17-06-45-621Z/`。
- 30 样本 baseline 的 deterministic L2 分数为 10 且 std=0，已标记为校准
  风险；P4 报告不得把该 baseline 当作真实压缩质量。

### 5.4 DeepSeek 调用与缓存

- `fetchDeepSeekJson` 只接受 `baseUrl`、`apiKey`、`model`、`system`、
  `user`、`sampleId`、`purpose`。
- 当 `DEEPSEEK_API_KEY` 缺失且 cache 不完整时，现有 runner 返回
  `executed:false` 和 reason，不会抛异常中断整个 eval。
- P4 新增 critic 必须沿用这个行为：无 key 或无 cache 时显式失败，
  不得静默降级为可信。

### 5.5 P0-P3 当前回归状态

- P3 后 agent-hooks 测试 5 files / 35 tests、root 5 files / 57 tests、
  gateway/artifact 3 files / 39 tests 全部绿。
- `pnpm run typecheck` node+web PASS；test project 仅既有 1290 条
  observation-mode 错误。
- `cd openclaw_runtime && pnpm exec tsc -p tsconfig.core.json --noEmit`
  仅既有 `shared/verseshell/**` 错误；P4 不得新增。
- 注意 `tests/unit/host-services.test.ts` 仍存在跨盘路径既有失败，
  P4 命令矩阵不包含它。

---

## 6. P4 目标接口草案（实现时以测试锁行为，不要照抄猜测）

建议全部改动限制在 `scripts/context-compression-eval-runner.mjs` 与
`tests/unit/helpers/context-compression-eval.ts`，测试锁在
`tests/unit/context-compression-eval.test.ts`。

### 6.1 Paired trajectory 输入

```jsonc
// 每行一条；建议扩展名 *.paired-trajectory.jsonl
{
  "sampleId": "R1",
  "compressedSummary": "生产压缩输出，与 --paired-summary overlay 语义一致",
  "fullContextSuccess": true,
  "compressedSuccess": false,
  "failureKind": "wrong_next_action" | "omitted_blocker" | "repeated_work" | "stale_branch" | "other" | null,
  "compressorModel": "deepseek-chat",
  "retryCount": 1,
  "latencyMs": 4200,
  "tokenUsage": { "input": 8000, "output": 600, "cacheRead": 0, "cacheWrite": 0 },
  "cost": { "input": 0.004, "output": 0.001, "cacheRead": 0, "cacheWrite": 0 }
}
```

### 6.2 新 CLI

```text
--paired-trajectory <path.jsonl>
  读取 trajectory overlay；字段不全会显式记录 invalidRows，不崩溃。
  效果等价于 --paired-summary + full/compressed 成功失败上下文。

--compression-model <model>
  声明生产压缩模型；只用于 independence 审计，不调用。

--llm-critic
  开启 DeepSeek critic：对 compression-induced failure 样本输出
  遗漏 critical atom 候选和 repair guideline。

--critic-model <model>      默认 deepseek-chat
--critic-samples <n>        默认与 judge 样本数规则一致
--write-failure-guidelines <path.json>
  将 deterministic 合并后的 guideline 写入 JSON（不含 transcript 原文）。
```

### 6.3 核心纯函数（可放入 helper 或 runner 内部，测试必须直接覆盖）

```ts
type PairedTrajectoryRow = {
  sampleId: string;
  compressedSummary: string;
  fullContextSuccess: boolean;
  compressedSuccess: boolean;
  failureKind?: "wrong_next_action" | "omitted_blocker" | "repeated_work" | "stale_branch" | "other" | null;
  compressorModel?: string;
  retryCount?: number;
  latencyMs?: number;
  tokenUsage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
};

type TrajectoryDamageClass =
  | "compression_induced_failure"   // fullContextSuccess=true, compressedSuccess=false
  | "preexisting_failure"           // fullContextSuccess=false
  | "compressed_success"            // compressedSuccess=true
  | "indeterminate";

function classifyPairedTrajectory(row: PairedTrajectoryRow): TrajectoryDamageClass;

function buildFailureGuidelines(params: {
  rows: PairedTrajectoryRow[];
  criticResults: CriticalAtomCriticResult[];
  maxAtoms?: number;
}): FailureGuidelineSet;   // bounded、JSON-serializable、脱敏

function assertModelIndependence(params: {
  compressorModel?: string;
  judgeModel?: string;
  criticModel?: string;
  hasIndependentHumanRatings?: boolean;
}): { ok: boolean; reason: string };
```

约束：

- `classifyPairedTrajectory` 是纯函数，不调用模型；只有
  `fullContextSuccess=true && compressedSuccess=false` 才进入失败驱动分析。
- critic 结果必须包含 `sampleId`、`missingAtoms`（bounded）、
  `repairGuideline`（bounded）、`model`、`promptVersion`。
- `buildFailureGuidelines` 只做 deterministic 合并/去重，不调用模型；
  不得把 transcript 原文、API key、完整 code body 写入 guideline。
- `assertModelIndependence` 在 `compressorModel === judgeModel === criticModel`
  且无独立人工评分时 `ok=false`。
- 新增指标必须包含 `retryRate`、`latencyMean/Min`、`tokenInput/Output`
  （mean/min/CI）、`cost`（mean/min），并在 report 中注明这些数据来自
  trajectory rows，不可在 rows 缺失时编造。
- 现有 `--paired-summary` 行为必须保持；P4 可以把它实现为
  paired trajectory 的特例（只有 `compressedSummary` 字段），但不得破坏
  旧测试。

## 7. 先补测试，再实现行为（TDD 顺序）

### 第 1 批：paired trajectory 读取与分类

1. `loadPairedTrajectories` 能读取合法 JSONL；`sampleId` 重复时后写覆盖或
   显式记录 duplicate，不得静默丢半行。
2. 缺 `sampleId` / `compressedSummary` / 成功失败布尔字段的行进入
   `invalidRows`，不中断整个 run。
3. `classifyPairedTrajectory` 四类结果：
   - fullSuccess=true, compressedSuccess=false -> `compression_induced_failure`
   - fullSuccess=false -> `preexisting_failure`
   - compressedSuccess=true -> `compressed_success`
   - 其他缺省 -> `indeterminate`
4. 旧 `--paired-summary` 回归：只给 `sampleId+compressedSummary` 时仍能
   overlay，并且不进入 failure-driven critic。

### 第 2 批：failure guideline 与 model independence

5. `buildFailureGuidelines` 对多条失败轨迹合并同一 atom（按 canonical
   identity 去重），输出 bounded JSON，不包含 `originalTranscript` 或
   `DEEPSEEK_API_KEY`。
6. `assertModelIndependence`：
   - compressor=deepseek, judge=deepseek, critic=deepseek 且无人工评分
     -> `ok=false`；
   - 存在人工评分或第二个不同 judge -> `ok=true`。
7. `--write-failure-guidelines` 写出的 JSON 可被 `--guidelines` 读回；
   回读后固定 manifest 重放不改变 sampleSelectionHash。

### 第 3 批：DeepSeek critic（无 key 时显式失败）

8. `buildCriticPrompt` 只使用 `sample.originalTranscript` 的 bounded 前缀
   和压缩 summary，要求返回 strict JSON。
9. `normalizeCriticResult` 对缺字段 / 非法 JSON 返回
   `{ executed:false, reason: "critic_invalid_json" }`，不把半截输出当结果。
10. 无 `DEEPSEEK_API_KEY` 时 `runDeepSeekCritic` 返回
    `{ executed:false, reason: "missing_api_key" }`，缓存命中时仍可读。
11. 缓存 key 必须包含 promptVersion + sampleId + transcript/summary hash；
    不得包含 API key。

### 第 4 批：指标与报告

12. `summarizePairedTrajectoryMetrics` 输出 retryRate、latency、token、
    cost 的 mean/min/cohort/95% CI；空 cohort 显式 `n=0`，不写 `0/0`。
13. compression-induced failure 样本的 critic 命中率、omission 率、
    fabrication 率、continuation 指标必须与 P0-P3 既有指标并列输出；
    token savings 仍只作 advisory，不参与 pass/fail。
14. 无 trajectory rows 时 runner 不崩溃，summary 中
    `pairedTrajectory.requested=true, sampleCount=0`。

### 第 5 批：回归与契约

15. P0-P3 回归全绿。
16. `pnpm run typecheck` node+web PASS；test project 不新增错误。
17. 若只改 runner/tests，openclaw_runtime core tsc 无需重跑，但必须
    grep 确认 P4 changed files 无错误。
18. comms replay/compare PASS（P4 不触 comms 也要如实记录）。
19. UI/E2E 不修改；如误改，必须补 i18n 四语和 viewer E2E。

---

## 8. 建议实现顺序（全部完成前不进入 P5）

1. 更新 Harness spec：touchedAreas/acceptance/requiredTests 增补 P4 验收。
2. 写第 1 批测试，运行确认失败。
3. 实现 paired trajectory 读取/分类与 `--paired-trajectory` CLI。
4. 写第 2 批测试，实现 guideline 与 model independence。
5. 写第 3 批测试，实现 DeepSeek critic（无 key 显式失败）。
6. 写第 4 批测试，实现指标汇总与报告。
7. 用固定 manifest 跑本地缓存冒烟；若有 key，再跑有界 DeepSeek 抽样。
8. 全部命令通过后写 `reports/context-compression/P4-EVIDENCE-2026-08-17.md`。

---

## 9. 必须运行的命令（按顺序）

```powershell
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm --dir openclaw_runtime exec vitest run src/agents/agent-hooks/compaction-damage-rules.test.ts src/agents/agent-hooks/compaction-validated-pipeline.test.ts src/agents/agent-hooks/compaction-addressability.test.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts src/agents/embedded-agent-runner/run/preemptive-compaction.test.ts --reporter=dot
pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts tests/unit/context-runtime-kit-recovery-default.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run packages/agent-core/src/harness/compaction/compression-artifact.test.ts packages/gateway-protocol/src/schema/sessions.recall.test.ts --reporter=dot
pnpm contract:check
pnpm exec eslint <changed files>
pnpm run typecheck
cd openclaw_runtime && pnpm exec tsc -p tsconfig.core.json --noEmit --pretty false
pnpm run comms:replay
pnpm run comms:compare
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
git diff --check
```

本地有界 eval 冒烟（不强制，但必须记录是否执行）：

```powershell
# 固定 manifest，缓存开启，不打满模型
pnpm run eval:context-compression -- --target D:/verse_claw_worktree_compact --samples 12 --sample-source real --transcript-root C:/Users/27933/.openclaw/agents --sample-manifest reports/context-compression/production-manifest-30.json --out artifacts/context-compression-p4-smoke

# 仅当环境有 DEEPSEEK_API_KEY，并且固定 manifest 完整可读时：
pnpm run eval:context-compression -- --target D:/verse_claw_worktree_compact --samples 30 --sample-source real --real-samples 30 --transcript-root C:/Users/27933/.openclaw/agents --sample-manifest reports/context-compression/production-manifest-30.json --paired-summary <production-summaries.jsonl> --out artifacts/context-compression-p4-paired --no-cache --llm-judge --llm-schema-free --llm-continuation --llm-critic
```

> 没有 key 时上述第二条必须记录为 `executed=false (missing DEEPSEEK_API_KEY)`，
> 不得伪造，也不得把“未执行”解释为失败证据。

---

## 10. 修改文件候选与回滚

| 文件 | owner/性质 | 回滚 |
|---|---|---|
| `scripts/context-compression-eval-runner.mjs` | P0/P4 eval | `git checkout -- <path>`（注意会连 P0 一起丢） |
| `tests/unit/context-compression-eval.test.ts` | P0/P4 eval | `git checkout -- <path>`（注意会连 P0 一起丢） |
| `tests/unit/helpers/context-compression-eval.ts` | P0/P4 eval | `git checkout -- <path>`（注意会连 P0 一起丢） |
| `harness/specs/tasks/token-dense-recovery-compression-v1.md` | P0/P1/P2/P3 已改 | `git checkout` 会连前面阶段一起丢 |
| `reports/context-compression/P4-EVIDENCE-2026-08-17.md`（新建） | 本阶段新增 | 删除文件 |
| `reports/context-compression/failure-guidelines-*.json`（新建，如采用） | 本阶段新增 | 删除文件 |

> 注意：当前 P0/P1/P2/P3 改动均未提交。回滚单个 P4 文件用
> `git checkout -- <path>`；整体 reset 到基线会连 P0-P3 一起丢，只能在用户
> 明确批准后执行。

---

## 11. 阶段结束必须输出（照抄上一阶段格式）

- 修改文件列表；
- 数据流和 authority 是否变化；
- 新增/更新测试；
- 运行过的命令及结果；
- 指标变化；
- 未解决问题；
- 回滚开关或旧路径；
- 是否满足进入 P5 的条件。

P4 额外必须回答：

- paired trajectory 行 schema 和校验规则（给出测试名）；
- `fullContextSuccess=true && compressedSuccess=false` 是否被正确分类
  （给出测试名）；
- DeepSeek critic 输入输出与无 key 行为（给出测试名）；
- compressor / judge / critic 模型独立性如何审计（给出测试名）；
- guideline 如何生成、合并、回放，是否进入 artifact（给出测试名）；
- 指标是否包含 recall / omission / fabrication / continuation /
  retry rate / latency / token / cost 的 mean / min / cohort / 95% CI；
- 是否修改了 runtime 压缩路径（如未修改，说明为什么 P4 仍能证明
  failure-driven 优化有效）；
- 是否修改了 UI/E2E；
- 是否新增了任何 runtime 模型调用；
- 是否新增 token savings 或单模型自评成功宣称。

---

## 12. P4 完成标准（未全部满足不得进入 P5）

- 所有新增/回归测试绿。
- `pnpm harness validate --spec ...token-dense-recovery-compression-v1.md` PASS。
- `pnpm contract:check` PASS。
- `pnpm run typecheck` node+web PASS；test project 不新增错误。
- openclaw_runtime core tsc 的 P4 changed files 不新增错误（全量既有
  `shared/verseshell/**` 错误不计入）。
- comms replay/compare PASS（P4 不触 comms 也如实记录）。
- paired trajectory 分类器测试通过；compression-induced failure 样本进入
  失败驱动分析，其余样本不进入。
- DeepSeek critic 无 key / 非法 JSON 时显式失败，没有静默信任路径。
- guideline 输出 bounded 且 JSON-serializable，不进入 CompressionArtifact。
- 模型独立性审计存在；compressor 与唯一评审模型相同时 `ok=false`。
- 指标报告包含 recall、omission、fabrication、continuation、retry rate、
  latency、token、cost，且 token savings 仅 advisory。
- 未修改 runtime 压缩路径、未修改 UI/E2E、未新增 runtime 模型调用。
- 未创建第二套 context/memory/task truth。
