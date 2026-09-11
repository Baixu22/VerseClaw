# Context Compression Fidelity Hardening

> 状态：开发准备报告，未包含 runtime 实现变更
> 工作树：`D:\verse_claw_worktree_compact`
> 分支：`codex/context-compression-hardening`
> 基线提交：`734ec877e75682861103660fbdea2bd55253ece0`
> 更新时间：2026-08-17

## 1. 目标与边界

本工作包继续依附 OpenClaw/Verse Claw 现有基座，不创建独立压缩产品、独立 Context Store、第二套 Context Budget 或第二个任务真相源。

现有权威边界保持不变：

- Agent Core compaction 负责 cut point、历史截断和 compaction entry。
- Compaction Safeguard 负责摘要生成、质量门、retry 和 fallback。
- CompressionArtifact 负责结构化恢复载体，不证明任务完成。
- Context Runtime Kit 负责 selector、checksum、archive 和 recovery projection。
- Task Ledger、ClawGraph、Memory、Knowledge 和 Observability 继续拥有各自领域事实。

本报告只定义实现顺序、入口、测试和放行门槛；Task Forest 节点尚未写入。

## 2. 已知基线

固定的 10 个 production compaction 给出：

| 指标 | 当前值 | 结论 |
| --- | ---: | --- |
| production fact recall | 0.1292 | 严重遗漏 |
| critical retention | 0/41 | 硬失败 |
| weighted recall | 0.2556 | 严重失败 |
| compression ratio | 0.0144 | 过度压缩风险 |
| decision/entity loss | 23 / 46 | 事实与实体大量丢失 |
| DeepSeek structured judge | 8.0/10 | 不足以放行 |
| DeepSeek completeness | 0/10 | 硬失败 |
| schema-free major omission | 80% | 硬失败 |
| real continuation first/critical action | 80% / 80% | 低于目标 |
| no repeated work | 100% | 当前优势 |
| completion delta | 0.20 | 高于目标 |

当前优势必须保留：accuracy、no-fabrication、causal-chain、no-repeat。优化重点是 completeness、critical recall、stale branch 和 recovery action，而不是单纯增加摘要长度。

> 本节指标来自前一轮 10 个 production compaction 的 paired audit；本 worktree 后续生成的 30 样本 harness baseline 只用于固定输入、验证 runner 和建立可重放 manifest，除非提供 `--paired-summary`，不得将两者混为同一条结果。

## 3. 目标架构

```text
L0 transcript/archive
  -> high-recall fact extraction
  -> typed semantic atom ledger
  -> provider or built-in LLM rendering
  -> normalize -> artifact -> validate -> damage audit
  -> bounded repair or preserve recent turns/fallback
  -> persist CompressionArtifact + evidence refs
  -> L2 summary / L3 labels / recovery projection
```

自然语言摘要永远是 projection，不是事实源。任何 critical atom 都必须能回到 transcript、archive handle、file hunk 或 CVK selector。

## 4. 分阶段开发计划

### P0: 基线、manifest 与 Harness 契约冻结

入口文件：

- `openclaw_runtime/packages/agent-core/src/harness/compaction/**`
- `openclaw_runtime/src/agents/agent-hooks/**`
- `scripts/context-compression-eval-runner.mjs`
- `tests/unit/context-compression-eval.test.ts`
- `harness/specs/tasks/token-dense-recovery-compression-v1.md`

工作内容：

1. 将固定 production manifest 从 10 个扩展到至少 30 个样本。
2. 固定 provider、pressure、turn count、split-turn、previous-summary、file-hunk 六类 cohort。
3. 保存 manifest digest、transcript inventory hash、model id、prompt version 和运行参数。
4. 把 critical recall、schema-free omission 和真实 continuation 设为 Hard Gate。
5. 先修复 artifact/recovery 测试的 Windows Vitest `/@fs/D:/ClawX/tests/setup.ts` 映射问题。

验证命令：

```powershell
pnpm harness context --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm harness validate --spec harness/specs/tasks/token-dense-recovery-compression-v1.md
pnpm run eval:context-compression -- --target D:\verse_claw_worktree_compact --samples 30 --sample-source real --real-samples 30 --transcript-root C:\Users\27933\.openclaw\agents --write-sample-manifest reports/context-compression/production-manifest-30.json --out artifacts/context-compression-baseline --no-cache

# runtime production summary 必须按 sampleId 写成 JSONL：{"sampleId":"R1","compressedSummary":"..."}
pnpm run eval:context-compression -- --target D:\verse_claw_worktree_compact --samples 30 --sample-source real --real-samples 30 --transcript-root C:\Users\27933\.openclaw\agents --sample-manifest reports/context-compression/production-manifest-30.json --paired-summary <production-summaries.jsonl> --out artifacts/context-compression-production-paired --no-cache --llm-judge --llm-schema-free --llm-continuation
```

依赖：无。预计 1-2 个工作日。该阶段不改变 runtime 行为。

### P1: Semantic Atom 与 Artifact 兼容契约

入口文件：

- `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts`
- `openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts`
- `shared/host-api/contract.ts`
- `tests/unit/compression-artifact.test.ts`
- `tests/unit/context-runtime-kit-compression-artifact.test.ts`

设计：

- 保留 `CompressionArtifact v1` 全部字段。
- 增加可选 semantic atom ledger，不立即破坏 wire schema。
- atom 至少包含 `type`、`canonicalIdentity`、`severity`、`confidence`、`scope`、`polarity`、`status`、`evidenceRefs` 和 `supersedes/conflicts` 关系。
- 覆盖 `goal`、`latest_user_ask`、`decision`、`constraint`、`failed_attempt`、`entity`、`next_action`、`outcome` 和 `safety_boundary`。
- 旧字段由 adapter 从 ledger 生成，Markdown 只作为 L2 projection。
- 不能把大段代码、工具 schema 或 durable facts 直接复制进 artifact。

验收：旧 v1 payload 可读；critical atom 必须有 evidence ref；unverified/stale/superseded 状态可见；连续 compaction 不丢失 lineage。

依赖：P0。预计 3-5 个工作日。回滚为继续使用 v1 adapter。

### P2: Provider/LLM 共用 Validated Compaction Pipeline

入口文件：

- `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts`
- `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-quality.ts`
- `openclaw_runtime/src/agents/agent-hooks/compaction-damage-rules.ts`
- `openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-runtime.ts`

统一流程：

```text
provider/LLM output
  -> normalize -> artifact build -> critical ledger comparison
  -> damage audit -> optional strong verifier
  -> bounded repair -> fallback/preserve turns -> cap/persist
```

必须删除 provider 的 trusted bypass。第一轮只记录 `wouldRetry`、`wouldFallback`、`wouldPreserveTurns`，不立即全量 enforce。

critical goal、decision、constraint、failure cause/validation/next、exact identifier 缺失，或 stale branch 与 current goal 冲突时，允许一次 repair；repair 失败则保留 recent turns 或取消本次压缩。

依赖：P1。预计 4-6 个工作日。回滚：恢复 shadow mode，关闭 repair/enforce。

### P3: Addressable Recall 与重复压缩防损

复用现有入口：

- `openclaw_runtime/src/gateway/session-compaction-checkpoints.ts`
- `openclaw_runtime/src/context-engine/registry/context-item-registry.ts`
- `openclaw_runtime/src/context-engine/cvk/recovery.ts`
- `openclaw_runtime/src/context-engine/cvk/codebase-index.ts`
- `tests/unit/context-runtime-kit-recovery-context.test.ts`

工作内容：

1. 每个被省略的 critical atom 都必须可通过 archive handle、file hunk 或 CVK selector 恢复。
2. missing/stale selector 必须显式失败，不能静默信任。
3. 后续 compaction 从 atom ledger 加新消息重建，不能只递归摘要上一次自然语言摘要。
4. 增加 stale branch、superseded decision 和失败动作重复执行 fixtures。
5. 保留 legacy transcript replay 作为 rollback path。

验收：critical atom addressable recovery 100%；real continuation critical action >= 0.95；no-repeat >= 0.98；三次以上 compaction 后不出现递归损失。

依赖：P1，建议在 P2 shadow 数据可用后接入。预计 4-6 个工作日。

### P4: ACON 式失败驱动优化与模型级联对比

入口文件：

- `scripts/context-compression-eval-runner.mjs`
- `tests/unit/context-compression-eval.test.ts`
- `docs/enhancements/05-adaptive-context-budget.md`

每轮执行 paired trajectory 分析：完整上下文成功、压缩后失败、强模型识别遗漏 atom、更新 guideline、固定 manifest 重放。

模型职责：

- deterministic extractor：高召回候选事实。
- 当前 provider/built-in LLM：正常压缩与渲染。
- DeepSeek 或其他强模型：critical verifier/repair 和抽样 judge。
- 不让同一模型成为压缩器和唯一评审器。
- 至少 100 条 paired trajectories 后才考虑小模型蒸馏。

比较指标必须包含 recall、omission、fabrication、continuation、retry rate、latency、token 和 cost。DeepSeek key 只能通过环境变量注入，不写入缓存或 artifact。

依赖：P2、P3。预计 3-5 个工作日加数据积累。

### P5: Critical-first 自适应预算

必须复用现有 Context Orchestrator/A5 authority：

- `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts`
- `openclaw_runtime/src/context-engine/context-orchestrator.ts`
- `openclaw_runtime/src/observability/deprecation-counters.ts`
- `harness/specs/tasks/a5-adaptive-context-budget-pilot.md`

预算顺序：critical ledger、latest user ask、未完成动作、失败链验证状态、exact identifiers、important facts、nice-to-have prose。

固定 `0.15..0.35` 压缩比不再是硬目标。若模型声明 `nativeMemory` 或 `nativeContextGating`，按 `docs/dev/hd-double-compression-contract.md` 协商关闭重复应用层压缩/记忆通道，但保留 provenance receipt。

A5 门槛：plan adoption >= 80%、planner p99 <= 30ms、cumulative per-turn p99 <= 300ms、budget violation 时降级到 default budget。

依赖：P3。预计 3-5 个工作日。回滚为关闭 adaptive mode，恢复默认 budget。

### P6: 受控推广

推广顺序固定为：`shadow -> would-retry -> provider/pressure pilot -> critical-only enforce -> limited enforce`。

进入 critical-only enforce 前必须满足：至少 30 个固定 production paired samples、至少 20 个人工评分样本、至少 2 名评分者、critical dropped 连续为 0、schema-free omission <= 0.10、真实 continuation first/critical >= 0.95、stale leakage = 0、completion delta <= 0.08。

emergency cohort 默认保守处理：保留 recent turns 和 archive handle，不直接全量 enforce。

## 5. 统一质量门槛

```text
critical recall >= 0.95 且每个样本 critical dropped = 0
important recall >= 0.85
weighted recall >= 0.90
schema-free major omission <= 0.10
real continuation first/critical action >= 0.95
no repeated work >= 0.98
contradictory action = 0
stale leakage = 0
completion delta <= 0.08
low-confidence failure-chain ratio <= 0.10
no fabrication >= 0.98
```

平均值不能掩盖 worst case。报告必须同时输出 mean、min、每个 cohort 和 95% 置信区间。

## 6. 测试矩阵

每个实现阶段至少运行：

```powershell
pnpm harness context --spec <active-spec>
pnpm harness validate --spec <active-spec>
pnpm exec vitest run tests/unit/context-compression-eval.test.ts tests/unit/compression-artifact.test.ts tests/unit/context-runtime-kit-compression-artifact.test.ts tests/unit/context-runtime-kit-recovery-context.test.ts --reporter=verbose
pnpm run typecheck
pnpm run comms:replay
pnpm run comms:compare
```

涉及 Host API、恢复展示或 compaction UI 时增加：

```powershell
pnpm exec playwright test tests/e2e/chat-manual-compaction.spec.ts tests/e2e/chat-recovery-assist.spec.ts tests/e2e/compaction-artifact-viewer.spec.ts
```

真实模型复测必须固定 manifest，并使用 `--no-cache`、`--llm-judge`、`--llm-continuation`、`--llm-schema-free`；报告记录模型、prompt、成本和 latency，但不保存凭据。

## 7. Harness、文档与回滚

- 优先更新 `harness/specs/tasks/token-dense-recovery-compression-v1.md` 的 acceptance，不创建平行任务真相源。
- 若 quality gate 形成可复用边界，再增加 `harness/specs/rules/` 规则并关联 `context-runtime-kit` scenario。
- P2 之后的 runtime/接口变化必须复核 `README.md`、`README.zh-CN.md`、`README.ja-JP.md`。
- P0-P5 默认 off 或 shadow；任何阶段都可回到 legacy summary、legacy transcript replay 和现有 recent-turn preserve。
- 不允许仅凭 token savings、结构化 judge 分数或 deterministic action proxy 宣布可上线。

## 8. Task Forest 提案

本报告不直接写入 `.agent-workbench/task-forest/`。候选节点如下：

- primary parent：`TF-0010` OpenClaw Runtime Authority convergence。
- contributes to：`TF-0038` RC-07 Memory 与 Context slot convergence。
- proposed node：`Context Compaction Fidelity Hardening P0-P6`。
- status：`proposed`，不抢占当前 ready 槽位。
- dependency：当前唯一 ready 的 `TF-0066` Trace Correlation 完成后，才能完整关联 `requestId/compactionId` 与 failure taxonomy。
- first ready child：`P0 基线、manifest 与 Harness 契约冻结`。

## 9. 当前准备状态

- worktree 已创建且为独立分支。
- 该 worktree 从提交 `734ec877e75682861103660fbdea2bd55253ece0` 创建；根工作区 `D:\ClawX` 当时已有的其他未提交改动未带入本分支，避免把无关 runtime 变更混入压缩基线。
- 本报告是当前 worktree 的第一份压缩开发交接文档。
- 尚未修改 runtime、Harness、Task Forest 或 README。
- 根工作区和 `openclaw_runtime` 依赖已按各自 lockfile 安装，固定 pnpm 版本为 `11.2.2`。
- Windows/Codex 环境运行嵌套 Harness 命令前，应确保全局 pinned pnpm 位于 PATH 首位，避免 fallback pnpm `11.9.0` 触发版本拒绝：

```powershell
$env:Path = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:Path"
pnpm --version
```

- 2026-08-17 环境冒烟：`harness context` 通过；压缩评估、Artifact、CRK Artifact、CRK Recovery 共 4 个测试文件、41 个测试通过。
- 已用显式 transcript 根目录完成 30 个真实样本的 P0 harness baseline：`C:\Users\27933\.openclaw\agents` 下发现 333 个 JSONL、解析 172 个 transcript 和 4,338 条 entry；manifest digest 为 `ce6de7968ea4458a7523b9c3d631013ec783d0ef91f3767c0e45ae0aeaf25f92`。这里的“真实”只表示输入 transcript 来自真实运行；压缩输出仍是 runner 的 deterministic template summary，不是当前 runtime 已生成的 production compaction 输出。
- 本次 harness baseline 产物：`artifacts/context-compression-baseline/2026-08-16T17-06-45-621Z/`；样本 manifest：`reports/context-compression/production-manifest-30.json`。关键结果为 critical/important/weighted recall `1/1/1`、critical dropped `0`、真实 continuation critical action `1`、no-repeat `1`、completion delta `0`，但 L1 acceptance 因平均 compression ratio `0.6979` 未通过旧的 `0.15..0.35` 压缩比门槛。该失败应解释为门槛与真实样本分布不一致，不得解释为事实保留失败；P5 需要改为 critical-first 的预算/质量联合门槛。它不能直接与上方 production paired audit 的 `0.1292` recall 比较。
- 本次 baseline 的 deterministic L2 分数全部为 `10` 且标准差为 `0`，报告已标记为校准风险；未提供 DeepSeek 或人工评分时，不得将其作为独立质量证据。
- 当前环境未提供 `DEEPSEEK_API_KEY`，所以 DeepSeek judge、schema-free omission 和 continuation 没有执行；拿到密钥后使用固定 manifest 加 `--no-cache --llm-judge --llm-schema-free --llm-continuation` 重跑，并将 latency/token/cost 单独记录。
- Task Forest 只读 `validate` 通过；当前 `status=ready` 节点仍为 `TF-0066`，压缩工作包没有写入 canonical graph，也没有改变 ready 槽位。
- `harness validate --no-diff` 通过。普通 diff-aware validate 当前会因报告和 production manifest 不属于旧 spec 的 `touchedAreas/ownedPaths` 而拒绝，不能通过扩大旧 spec ownership 来掩盖这个准备态差异；正式 P0 active spec 必须显式拥有这些评估资产。
- `pnpm run typecheck` 的 node/web 项目通过；test project 以 observation mode 执行并报告 1290 条既有测试类型错误，不阻塞该聚合命令。日志位于 `artifacts/typecheck-cache/test-typecheck-errors.log`。
- `pnpm run comms:replay` 通过，基线证据位于 `artifacts/comms/current-metrics.json`。
- `pnpm run comms:compare` 通过，通信指标无丢失、重复或顺序违规，比较报告位于 `artifacts/comms/compare-report.md`。
- 默认 `--transcript-root %USERPROFILE%\.openclaw` 会递归进入一个指向不存在 `openclaw_runtime/dist/extensions/browser/skills/browser-automation` 的 junction，并在收集样本阶段抛错；当前以 `--transcript-root %USERPROFILE%\.openclaw\agents` 绕开该环境链接问题。正式 P0 应在 runner 中将不可解析 junction 记录为 skipped input，而不是让整个评估崩溃。
- 下一步应从 P0 开始，先建立/更新正式 active Harness task spec 并通过 diff-aware validate，再决定是否进入 P1 Semantic Atom 契约实现。
