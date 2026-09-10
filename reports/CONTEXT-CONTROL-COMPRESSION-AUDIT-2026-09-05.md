# ClawX 上下文控制与压缩策略审计报告

> 审计日期：2026-09-05
> 基线：分支 `feat/runtime-lifecycle-governance` @ `416a70073`
> 审计范围：`openclaw_runtime/packages/agent-core/src/harness/compaction/**`、`openclaw_runtime/src/agents/agent-hooks/compaction-*`、`openclaw_runtime/src/agents/embedded-agent-runner/{compact*, run/preemptive-compaction.ts, tool-result-truncation.ts}`、`openclaw_runtime/src/context-engine/**`、`openclaw_runtime/src/config/{defaults,materialize,types.openclaw,types.agent-defaults,settings-manager}.ts`
> 审计方法：静态代码读取 + 配置默认值全链路追踪 + 定向单测执行（`compression-planner.test.ts` / `compression-artifact.test.ts`，10 passed）+ 一次性 tier 选择探针（已实测并删除）
> 对照基准：`reports/CONTEXT-STRATEGY-AUDIT-2026-08-11.md`（上一轮策略审计）

---

## 一、结论摘要

1. **控制面是六层纵深，工程化程度高于同生态位产品**：预检路由 → 工具输出裁剪 → 注入预算 → 会话压缩 → 恢复载体 → 质量评分。每层都有明确所有者、默认值和 config-only 回滚开关，且压缩全部发生在**结构层**（不做 token 级压缩），这个方向判断是正确的。

2. **但被反复宣传的"5 档压力阶梯"在两种模式下都是空转的**（见 F-1，高危）。产品默认是 safeguard 模式，该模式**根本不调用** `planCompression`；显式 `default` 模式虽然调用，但压力分母缺失，导致所有 ≳51k 窗口的模型**恒定落到 tier4「emergency-collapse」**——即摘要输入被砍到「首个目标 + 1 条 next-action + 末尾 4 条」。

3. **中文场景存在系统性 token 低估约 4 倍**（见 F-4，高危）。仓库自带 CJK 感知估算器 `estimateStringChars`，预检路径和 pruner 都用了它，但**压缩规划与切点选择路径用的是 agent-core 的裸 `chars/4`**。对一个中文优先的产品，这意味着 `keepRecentTokens: 20000` 实际保留了约 4 倍内容。

4. **B-2/B-4 两个"行业空白填补者"已落地成代码，但默认不可观测**（F-3）。damage rules 两个调用点都硬编码 `mode: "shadow"`，且整个审计被 env 开关默认关掉；P6 promotion 默认 `shadow`，因此 `wouldRetry/wouldFallback/wouldPreserveTurns` 三个决策位永不生效。

---

## 二、架构总览：六层控制面

```
L0  预检与路由        preflight compaction / preemptive route（4+1 路由）
L1  工具输出裁剪      live cap → soft trim → hard clear → tool_output_compress
L2  注入预算          turn ledger（7 通道 + 优先级 + decay）
L3  会话压缩          cut point → tier ladder → LLM 结构化摘要 → artifact
L4  恢复载体          CompressionArtifact / archive handle / post-compaction 重锚
L5  质量度量          ContextHealthMonitor（B-4）+ damage rules（B-2）+ 离线 eval
```

自然语言摘要在设计上**永远是 projection，不是事实源**；任何 critical atom 都必须能回溯到 transcript、archive handle、file hunk 或 CVK selector（`docs/dev/hd-double-compression-contract.md`、`reports/CONTEXT-COMPRESSION-DEVELOPMENT-PLAN-2026-08-17.md` §3）。这条不变式在 `compression-artifact.ts` 的 `evidenceRefs` / `unverifiedClaims` 结构里被强制。

---

## 三、逐层详解

### L0 预检与路由（prompt 发出之前）

**preflight compaction**（`auto-reply/reply/agent-runner-memory.ts:735-860`）
双触发：token 阈值 `threshold = contextWindow − reserveTokensFloor(20,000) − softThresholdTokens(4,000)`，或 transcript 字节数超过 `maxActiveTranscriptBytes`。命中后先跑一次「memory flush」agentic turn（工具集被清空到只剩写入路径，`agent-tools.ts:1393-1402`），把还活着的记忆落盘，**再**压缩——这一步把"压缩即遗忘"降级为"压缩前先记住"。

**preemptive route**（`embedded-agent-runner/run/preemptive-compaction.ts:541-648`）
在提交 prompt 前做一次预算精算，产出 5 条路由之一：

| 路由 | 触发条件 | 行为 |
| --- | --- | --- |
| `fits` | `overflowTokens === 0` | 直接发 |
| `observation_masking` | Context Family 开关开 且 投影后 ≤ 预算 | 大观测替换为 archive handle 占位符 |
| `truncate_tool_results_only` | 可裁剪字符 ≥ `max(overflow+512tok, overflow×1.5)` | 只裁工具结果，不压缩 |
| `compact_then_truncate` | 可裁剪字符 >0 但不够 | 先压缩再裁 |
| `compact_only` | 无可裁剪空间 | 只压缩 |

两个值得肯定的护栏：
- **最小 prompt 预算地板**：`min(8000, contextWindow × 0.5)`（`agent-compaction-constants.ts:6,12`），防止 `reserveTokens` 配得过大时把 prompt 空间挤到 0。
- **bootstrap 守卫**：`hasRealConversation === false` 时不压缩（`preemptive-compaction.ts:608-611`），避免对空 transcript 无限重试。

token 估算在这一层是**分类加权**的：一般文本 4 chars/token、toolResult 2、JSON 3；每条消息 +12 token 边界开销、每个 content block +6、图片按 2,000 token；最后整体 × `SAFETY_MARGIN = 1.2`（`compaction-planning.ts:17`）。

**mid-turn precheck**（`run/attempt.ts:2726-2801` → `tool-result-context-guard.ts:505-560`）：工具循环内、下一次模型调用前再查一次压力。默认 **false**。

### L1 工具输出裁剪

三个独立机制，字符级、语言无关：

| 机制 | 位置 | 默认值 |
| --- | --- | --- |
| live tool result cap | `tool-result-truncation.ts:51-63,219-248` | 16k / 32k / 64k chars 按窗口分级；≤30% 上下文占比；`minKeepChars 2,000` |
| context-pruning（cache-TTL） | `context-pruning/settings.ts:52-69` | ttl 5min；`keepLastAssistants 3`；softTrim 4,000（head 1,500 / tail 1,500）；softTrimRatio 0.3 / hardClearRatio 0.5；`minPrunableToolChars 50,000` |
| tool_output_compress | `agents/tool-output-compress.ts:8,32-51` | 4,000 chars；head 70% / tail 20%；标记 `use context_read working_memory to expand` |

头尾双保留（而非只截尾）是对 LITM / 位置偏差的直接缓解；`hardClear` 用固定占位符替换而非删除消息，保住了 tool_use/tool_result 配对。

注意：context-pruning 只在 `mode: "cache-ttl"` 时生效（`settings.ts:77-79` 否则返回 null），而默认值仅在检测到 Anthropic 信号时注入（`config/defaults.ts:509-527`）。**其他 provider 下这一层默认是关的。**

### L2 注入预算（往 prompt 里加什么）

`context-engine/turn-injection-budget.ts` 是这一层的账本：**每个 agent turn 一个 ledger，所有注入源共用同一个账户**。设计文档明确写了它要消灭的反模式——"off-the-books growth"：在此之前 VToken、memory_pilot、CVK `systemPromptAddition` 各自长 prompt，预算能报 0 overflow 而 turn 实际多了几千字符。

固定优先级（低索引先扣，扣完后**后面的源降级**）：

```
knowledge > working_memory > tool_registry > cvk_addition > vtoken > memory_pilot > other
```

理由是"承载正确性的上下文优先于便利性上下文"——`knowledge`（目标与角色约束）和 `working_memory`（刚做过什么，丢了会重复劳动）在前；`tool_registry` 可恢复；后三者是增强。

每通道另有 `decayHalfLifeTurns`（`turn-injection-budget.ts:80-89`），**默认全部 `Infinity`**，需通过 `runtime.contextBlock.injectionBudget.channelDecay` 显式启用。这正好补上了上一轮审计标记的 B-1 缺口（注入层异质路由），代码已在，默认未开。

预算本体 `injection-budget.ts:13,52-136`：默认 2,000 chars，**fail-closed**（预算 ≤0 直接不注入），溢出走截断（保留 `rem-1` 字符 + `…`）或丢弃，并记 `overflows/truncations/drops` 三个计数。`assembler.ts:123` 的 `KNOWLEDGE_INJECTION_CHAR_BUDGET` 与之对齐。

去重靠 `ContextCandidate.dedupKey = context-authority:{objectId}:{version}:{contentDigest}`（sha256 内容摘要），命中即判 duplicate，不重复注入。

### L3 会话压缩

**触发**：`shouldCompact(contextTokens, contextWindow, settings)` = `contextTokens > contextWindow − reserveTokens`（`agent-core/.../compaction.ts:261-270`），默认 `reserveTokens = 16,384`。`contextTokens` 优先用 provider 真实 `usage`，只对 usage 之后的尾部消息做估算（`compaction.ts:230-258`）——这一点做得对。

**切点选择**（`compaction.ts:410-460`）：从尾部累加到 `keepRecentTokens`（默认 20,000）后取最近的合法切点。合法切点排除 `toolResult`（不切断 tool_use/tool_result 配对）；若切点落在一个 turn 中间，则把 turn 前缀单独摘要，产出 `**Turn Context (split turn):**` 段落拼接（`compaction.ts:855-891`）。

**两种模式**（关键结构性事实）：

| | `default` | `safeguard`（**产品默认**） |
| --- | --- | --- |
| 入口 | agent-core `compact()` | `session_before_compact` 扩展钩子 |
| 压力阶梯 | ✅ `planCompression` | ❌ **不调用** |
| 摘要生成 | 单次/分块 LLM | `summarizeInStages` 分阶段 |
| 质量门 | 无 | `auditSummaryQuality` + 有界 retry + 结构化 fallback |
| artifact | ✅ | ✅（`compaction-validated-pipeline.ts:680`） |
| damage 审计 | 无 | ✅ shadow |
| P6 promotion | 无 | ✅（默认 shadow） |

模式默认值由 `config/defaults.ts:529-552` 在 `materialize.ts:77`（`load` / `missing` 两种 profile）注入为 `"safeguard"`；但 `agent-settings.ts:132-138` 的 `resolveEffectiveCompactionMode` 在配置缺失时回落 `"default"`。

**5 档压力阶梯**（`compression-planner.ts:36-41,176-195,556-609`）——设计意图：

| tier | 压力 | 策略 | 实际动作 |
| --- | --- | --- | --- |
| tier0 | <0.60 | hot-context | 不动 |
| tier1 | <0.75 | micro-compact | >1200 字符消息按类型做 head/tail 折叠（栈帧/工具输出/文件体各有专门规则） |
| tier2 | <0.85 | token-pruning | 非热区 ≥600 字符消息按 0.45 目标比裁剪，保留因果锚点 ±5 词窗口 |
| tier3 | <0.95 | semantic-handoff | 同 tier2 |
| tier4 | ≥0.95 | emergency-collapse | **只留「首个目标 + 1 条 next-action + 末尾 4 条」** |

因果锚点表 `CAUSAL_ANCHORS`（`compression-planner.ts:90-125`）中英双语齐备（`because/failed/decided` + `因为/失败/决定` 等 35 项），这一点做得好。

**迭代增量续接**：`<previous-summary>` 作为背景重新蒸馏而非从头生成，配 `previousArtifact` 做 semantic atom 血缘，`firstKeptEntryId` 做断点（`compaction.ts:602-612,690-706`）。摘要 prompt 里有明确的反幻觉规则："不要陈述你没有逐一数过的重复次数/尝试次数，不确定就写 repeatedly"（`compaction.ts:525`）。

**摘要契约**：8 个必需 section（`## Goal and Progress` / `## Attempts and Failures` / `## Key Decisions and Constraints` / `## Current State` / `## Key Decisions` / `## Files Touched` / `## Tests` / `## Next Actions`），单一来源在 `compaction-sections.ts`，`compaction-safeguard-quality.ts:7-13` 有注释说明为什么不许存第二份拷贝（§R1 A3 缺陷类：两份会漂移，各自的测试只看得见自己那份）。

### L4 恢复载体

`CompressionArtifact`（`compression-artifact.ts:94-120`，schemaVersion 1）是结构化恢复载体，字段覆盖 objective / constraints / currentState / done / inProgress / blocked / decisions / filesTouched / testsRun / failedAttempts / deviations / nextAction / reviewNeeded，外加 `evidenceRefs`、`unverifiedClaims`、`retrievalTrace`、`rehydratedFileContext`、`semanticAtoms`、`quality`。

Semantic atom 有 9 种类型、3 档 severity、4 种 status（verified/unverified/stale/superseded）、极性和 `supersedes`/`conflicts` 关系。三条硬约束值得表扬：
- **critical 无证据即降级**：`severity === "critical" && evidenceRefs.length === 0` → status 强制降为 `unverified` 并打 `critical_atom_missing_evidence` 警告（`compression-artifact.ts:314-317`）。
- **证据引用排序**：可恢复类型（file/archive/cvk）排到前 8 名（`:278-284`），保证截断时先丢不可恢复的。
- **密钥脱敏**：`redactSecretLikeText`（`:221-232`）保留变量名、抹掉值，覆盖 `sk-`、`ghp_`/`github_pat`/`xox*`、`Bearer` 等前缀。
- **代码块不进 atom**：fenced code 与大 JSON 先替换为 `[code block omitted]` 再做 240 字符边界（`:241-251`），防止把 projection 当事实存储。

**observation masking**（`preemptive-compaction.ts:271-385`）：≥8,000 字符的旧 toolResult 归档成带 checksum 的 archive handle，prompt 里只留占位符 + 召回指引，且**归档写入后先 verify 再替换**（verify 失败就不替换，记 `archive_*` 诊断）。transcript 文件本身不变，纯投影。默认关。

**压缩后重锚**：post-compaction sections 从 AGENTS.md 重新注入（`compaction.postCompactionSections`，默认未设即禁用）；`post-compaction-loop-guard.ts` 用 3 条窗口检测「同 tool + 同 args hash + 同 result hash」的死循环，命中即 abort（这是当前唯一真正会改变运行时行为的压缩副作用防线）。

### L5 质量度量

**ContextHealthMonitor（B-4）**（`context-health-monitor.ts`）：四维确定性评分，无 LLM 依赖。

| 维度 | 权重 | 告警阈值 | 算法 |
| --- | --- | --- | --- |
| injectionPressure | 0.20 | 70 | turn ledger 的 dropRatio / degradation |
| structuralFidelity | 0.30 | 70 | 压缩摘要 section 覆盖率 |
| goalAlignment | 0.30 | 70 | `SessionGoal.objective` 的 n-gram 覆盖 |
| informationNovelty | 0.20 | 50 | 1 − 历史注入窗口的 8-gram 最大 Jaccard 重叠 |

设计上有一个细节做得很对：`noDataDimensions`（`:52-68`）显式区分"没测量"和"满分"——否则 scorecard 上的 100 无法区分二者，这正是它注释里点名的旧缺陷类。评分通过 `contextHealthScoreToScorecard` 走既有 `observability.traces` → Electron → UI 管线，合成 traceId `ctx-health-<turnId>`。

**compaction damage rules（B-2）**（`compaction-damage-rules.ts`）：4 类损伤 `goal_token_decay` / `structure_damage` / `entity_loss_risk` / `actionability_loss`，纯确定性关键词与 section 检查。`GOAL_RETENTION_MIN_COVERAGE = 0.2` 被刻意设在 health monitor 的 70 分告警线之下，"摘要在被判定为衰减之前就能被判定为漂移"。CJK 匹配问题在这里被显式修过（`:70-85` 的注释记录了 `目标|决策|约束` 因共享尾部 `\b` 而从写下那天就是死代码）。

**离线闭环**：`scripts/context-compression-eval-runner.mjs`（5,697 行）+ handoff benchmark v1（锁定 GT，`gtSha256 698de58e…`）。最近一次正式验收（`reports/context-compression/HANDOFF-BENCHMARK-V1-FINAL-ACCEPTANCE-2026-08-26.md`）在 12 个锁定样本上：handoff-success 0.333、repeat-work 0.25、contradiction 0、state-accuracy 0.938，相对 v1.1 基线 success +16.6pp / contradiction −25pp。该报告自己的结论是"验收通过（限于本基准与语料族；promotion 保持 shadow，不解锁产品级状态）"——这个自我定级是诚实的。

---

## 四、默认开关状态表（什么真的在跑）

| 开关 | 默认 | 证据 |
| --- | --- | --- |
| `agents.defaults.compaction.mode` | **safeguard**（materialize 注入） | `config/defaults.ts:529-552`；`config/materialize.ts:28-46,77` |
| `compaction.enabled` | true | `agent-core/.../compaction.ts:167-171` |
| `reserveTokens` | 16,384 | 同上 `:169` |
| `keepRecentTokens` | 20,000 | `sessions/settings-manager.ts:724-726` |
| `reserveTokensFloor`（preflight） | 20,000 | `agent-runner-memory.ts:751-754` |
| `softThresholdTokens` | 4,000 | `agent-runner-memory.ts:755` |
| `qualityGuard.enabled` | **true** | `embedded-agent-runner/extensions.ts:822` |
| `qualityGuard.maxRetries` | 1 | `compaction-safeguard.ts:104` |
| `compaction.promotionStage` | **shadow** | `compaction-promotion.ts:56-58` |
| `compaction.midTurnPrecheck.enabled` | false | `run/attempt.ts:2726-2727` |
| `OPENCLAW_COMPACTION_DAMAGE_AUDIT` | **off** | `compaction-damage-rules.ts:205,215-227` |
| `runtime.contextRuntimeKit.enabled` | **true**（无显式 slot 时） | `context-engine/registry.ts:877-887`；`config/runtime-feature-leaves.ts:108` |
| `runtime.contextBlock.{working-memory,tool-registry,compass,role-memory}.enabled` | false | `types.openclaw.ts:126-139`；`assembler.ts:90-95` |
| `runtime.contextBlock.sekb.enabled` | false | `types.openclaw.ts:140-162` |
| `injectionBudget.totalChars` | 2,000 | `injection-budget.ts:13` |
| `injectionBudget.channelDecay` | 全 `Infinity` | `turn-injection-budget.ts:80-89` |
| `runtime.contextFamily.observationMasking.enabled` | false | `types.openclaw.ts:248-258` |
| `runtime.contextFamily.contextStatus.enabled` | false | `types.openclaw.ts:259-263` |
| `runtime.vtoken.assembly.enabled` | false | `types.openclaw.ts:401-418` |
| `runtime.memory.injectPilot.enabled` | false | `types.openclaw.ts:374-389` |
| `contextEnhancement.killSwitch` | false（未触发） | `types.openclaw.ts:391-400` |
| context-pruning | 仅 Anthropic 信号下注入默认 | `config/defaults.ts:509-527`；`context-pruning/settings.ts:77-79` |

---

## 五、审计发现

### F-1（高危）5 档压力阶梯在两种模式下都不产生预期效果

**A. safeguard 模式（产品默认）下阶梯完全不运行。**
仓库范围 grep 确认 `planCompression` 的唯一调用点是 `agent-core/.../compaction.ts:826,836`。safeguard 扩展自己构造 `CompactionResult`（`compaction-safeguard.ts` → `summarizeInStages`），因此 micro-compact / token-pruning / emergency-collapse 三个动作在产品默认路径上**从未执行**。safeguard 里唯一引用阶梯的地方是 `buildCompactionBudgetShadow`（`:1096,1249,1612`），而它在 `schedule` 缺失时直接 `return undefined`（`compression-planner.ts:646`）。

**B. default 模式下压力分母缺失，恒定 tier4。**
`selectCompressionPlan` 的预算取 `input.contextWindow ?? input.settings.contextWindow ?? (reserveTokens + keepRecentTokens)`（`compression-planner.ts:182-187`）。而：
- `SettingsManager.getCompactionSettings()` 只返回 `{ enabled, reserveTokens, keepRecentTokens }`，**没有 `contextWindow`**（`sessions/settings-manager.ts:728-734`）；
- `compact()` 调 `planCompression` 时**不传** `contextWindow`（`compaction.ts:826-835`）。

于是分母恒为 `16,384 + 20,000 = 36,384`。实测探针（生产形状 settings，取各窗口的自动压缩触发点 `contextWindow − reserveTokens + 1`）：

| model contextWindow | tokensBefore | pressure | tier |
| ---: | ---: | ---: | --- |
| 32,000 | 15,617 | 0.4292 | tier0（完全不压缩） |
| 128,000 | 111,617 | 3.0677 | **tier4** |
| 200,000 | 183,617 | 5.0466 | **tier4** |
| 1,000,000 | 983,617 | 27.0343 | **tier4** |

分档边界换算：`contextWindow < 38.2k` → tier0；38.2–43.7k → tier1；43.7–47.3k → tier2；47.3–50.9k → tier3；**> 50.9k → tier4**。即所有现代模型都落在 tier4。

tier4 的动作是 `emergencyCollapseMessages`（`compression-planner.ts:533-554,588-591`）：把待摘要历史裁到「首个非空 user 消息 + 最后一条含 next-action 关键词的消息 + 末尾 4 条」。首次压缩没有 `previousSummary` 兜底，中段历史几乎整体丢失。

**为什么测试没抓到**：`compression-planner.test.ts:17` 的 fixture 硬编码 `contextWindow: 1_000`，测试永远走的是"调用方传了窗口"的分支。这与仓库自己在 `compaction-safeguard-quality.ts:7-13` / `compaction-damage-rules.ts:70-85` 里点名的缺陷类同源。

**建议**：把真实模型窗口注入 `CompactionSettings.contextWindow`（`getCompactionSettings()` 已经能拿到 `this.model`），或在 `compact()` 的 `planCompression` 调用点显式传 `contextWindow`；并明确决策 safeguard 模式是否应当运行阶梯（若是，在 `summarizeInStages` 之前接入；若否，删掉三处 `budgetShadow` 死代码并在文档里停止宣传五档）。

### F-2（高危）中文内容 token 低估约 4 倍，切点预算失真

仓库有 CJK 感知估算器 `utils/cjk-chars.ts:36-45`（非拉丁字符按 4 chars 计权，使下游 `chars/4` 对任意语种都成立），并且**预检路径**（`preemptive-compaction.ts:12,98`）和 **pruner**（`context-pruning/pruner.ts:3,144`）都用了它。

但压缩核心路径用的是 agent-core 的裸 `chars/4`：
- `estimateTokens`（`agent-core/.../compaction.ts:273-334`）——`findCutPoint` 的唯一计量（`:429`）；
- `estimateTextTokens`（`compression-planner.ts:233-235`）——`planCriticalFirstBudget` 的计量；
- `compaction-planning.ts:9` 从 `./sessions/index.js` 导入的 `estimateTokens`，经 `sessions/compaction/compaction.ts:13,36` 确认就是 agent-core 那个裸版本，因此 `estimateMessagesTokens` / `chunkMessagesByMaxTokens` / `computeAdaptiveChunkRatio` / `pruneHistoryForContextShare` 全部继承低估。

后果：中文会话里 `keepRecentTokens: 20,000` 实际保留约 4 倍内容，压缩后上下文远超预算，下一次压缩来得更早甚至直接溢出；`SAFETY_MARGIN = 1.2` 无法覆盖 4× 量级的偏差。

**建议**：在 agent-core 的 `estimateTokens` 内部改用 `estimateStringChars`（或把该 helper 下沉到 `agent-core`），并给 `compression-planner.estimateTextTokens` 同步。这是单点修复、收益最大的一条。

### F-3（中高）B-2 损伤检测与 P6 决策位在默认配置下无法生效

三重关闭叠加：
1. `auditCompactionDamage` 的两个调用点都**硬编码** `mode: "shadow"`（`compaction-safeguard.ts:1630`、`compaction-validated-pipeline.ts:668`），没有任何配置能把它切到 `enforce`；
2. 整个审计还被 env 开关 `OPENCLAW_COMPACTION_DAMAGE_AUDIT` 门控，未设置即 false（`compaction-damage-rules.ts:205,215-227`）；
3. `promotionStage` 默认 `shadow`，而 `resolveCompactionPromotionEnforcement` 在 shadow 下无条件 `allow`（`compaction-promotion.ts:170-173`），所以 `wouldRetry` / `wouldFallback` / `wouldPreserveTurns` 三个已经算出来的决策位被丢弃。

即：`reports/CONTEXT-STRATEGY-AUDIT-2026-08-11.md` 标记的 B-2 空白**代码已补齐、默认仍是空白**。当前唯一生效的压缩副作用防线仍是 `post-compaction-loop-guard`（行为级，非内容级）。

**建议**：把 `mode` 从硬编码改为读 `promotionStage`（shadow→shadow，≥would-retry→enforce），并给 damage 审计一个 config leaf 而不是只有 env（与 `contextEnhancement.killSwitch` 的 config+env 双形态保持一致——`assembler.ts:50-58` 和 `compaction-safeguard.ts:56-63` 都已记录过"只认 env 会让 config 形态静默失效"这个教训）。

### F-4（中）P5 task-class 阶梯是死配置

`tierSchedule` 全仓库只有读、没有写（`compaction.ts:163,834,844,847`；`compression-planner.ts:81,560,602-605`；`compaction-safeguard.ts:1096,1249,1612`；写入仅出现在 `compression-planner.test.ts:109,205`）。`CompactionSettings.tierSchedule` 既不在 `AgentCompactionConfig`（`types.agent-defaults.ts:572-620`）里，也不在 `getCompactionSettings()` 的返回里，因此：
- 任务类感知的提前压缩（P5 的核心卖点）无法启用；
- `CompressionTelemetry.taskClass` / `budgetTokens` 永远缺席；
- `buildCompactionBudgetShadow` 三个调用点永远返回 `undefined`。

**建议**：要么补 config leaf + 解析链路把它接通，要么按"未采用"清理掉，避免读者（和后续审计）把它当成在跑的能力。

### F-5（中）三套 token 估算器口径不一致

| 估算器 | 位置 | 口径 |
| --- | --- | --- |
| `estimateTokens` | `agent-core/.../compaction.ts:273-334` | 裸 `chars/4`；图片折算 4,800 **字符**（≈1,200 token） |
| `estimateMessageTokenPressure` | `preemptive-compaction.ts:431-468` | CJK 感知 + 分类 4/2/3 + 消息/块开销 + 图片 **2,000 token** + ×1.2 |
| `estimateTextTokens` | `compression-planner.ts:233-235` | 裸 `chars/4` |

图片口径差约 1.7×，CJK 口径差约 4×。结果是"触发压缩的判断""选档的判断""预算是否溢出的判断"三者可以互相矛盾。触发路径因为优先采用 provider 真实 `usage`（`compaction.ts:230-258`）而受害较轻，但**选档与切点路径没有 usage 兜底**。

**建议**：以 `preemptive-compaction.ts` 的分类加权版本为单一事实源下沉到 `agent-core`，其余两处改为调用；把 `SAFETY_MARGIN` 的语义写进注释（它补偿的是估算噪声，不是口径差）。

### F-6（中）质量门是确定性关键词匹配，无运行时语义检查

`auditSummaryQuality`（`compaction-safeguard-quality.ts:237-263`）只查三件事：section 标题字面存在、identifier 字面子串存在、与最新 ask 的关键词重叠 ≥2（`hasAskOverlap`，`:200-233`，`MAX_ASK_OVERLAP_TOKENS = 12`）。一个语义错误但结构完整、identifier 齐全、恰好复用了 2 个关键词的摘要会**通过**。

这是团队已知的边界（离线 judge harness 就是为此存在），但运行时侧没有任何语义护栏，且 `qualityGuard.maxRetries` 默认 1——一次重试后无论质量如何都放行（`compaction-promotion.ts:180-184` 的 `retry_budget_exhausted_or_not_needed`）。

**建议**：短期把 `structuralFidelity` / `goalAlignment` 的 B-4 分数接进放行判定（阈值已定义在 `context-health-monitor.ts:81-86`），比新增语义模型调用成本低得多。

### F-7（低-中）可观测性默认不落盘，无跨会话回归基线

`dcsObservability.writeSoakSnapshot`（`dcs-observability.ts:262-288`）和 context-health 的快照导出（`context-health-monitor.ts:401`）都是**显式调用才写文件**，代码注释明确写了 "never auto-called, no flag, no side effects when left uncalled"。B-4 分数走 trace-buffer 到 UI，但进程退出即失。

结果：无法回答"这周压缩质量是否比上周差"。离线 eval 有锁定 GT 可回放，但那是基准语料，不是真实用户会话的时间序列。

**建议**：给 health snapshot 一个按会话结束落盘的低频钩子（append-only JSONL 即可），复用已有的 event-log 落盘约定。

### F-8（低）最高杠杆模块单测偏薄

`compression-planner.ts`（667 行）+ `compression-artifact.ts`（1,125 行）合计 1,792 行，两个测试文件**共 10 个 test**（本次实测：2 files / 10 tests passed）。对照 `context-engine/` 有 47 个测试文件、compaction 相关共 21 个测试文件——薄的恰好是分档逻辑和 artifact 归一化这两个最容易静默劣化的地方（F-1 就是从这里漏出去的）。

### F-9（低）"双重压缩"能力协商已实现，但能力叶子未进类型化 schema

`docs/dev/hd-double-compression-contract.md` 定义的能力协商**已经落地**：`context-orchestrator.ts:384-433` 的 `resolveNativeContextNegotiation` 在 base model 声明 `capabilities.nativeMemory` 或 `capabilities.nativeContextGating` 时，把 `memory_pilot` 与 `vtoken` 两个通道协商关闭（`:501-503`，并在 `:175` 用 `nativeContextGating` 在 finalize 处闸掉 BlockStore candidate），溯源 receipt 保留。测试覆盖在 `context-orchestrator.test.ts:404-520`。

剩余缺口只是**声明面**：`nativeMemory` / `nativeContextGating` 不在 `config/types.openclaw.ts` 也不在 zod schema 中，`capabilityFromConfig` 是对 `unknown` cfg 做鸭子类型探测（`:384-415`，5 个候选位置）。因此该能力对用户不可发现、写错位置不会报错、拼写错误静默失效。

**建议**：把这两个 boolean 补进 `runtime.model.capabilities`（或选定单一权威位置）的类型与 zod schema，并把 `capabilityFromConfig` 的 5 处候选收敛成 1 处 + 明确的迁移。

---

## 六、本轮已验证 / 未验证

**已验证（实际执行）**
- `compression-planner.test.ts` + `compression-artifact.test.ts`：2 files / 10 tests passed。
- tier 选择探针：以生产形状 `CompactionSettings`（无 `contextWindow`）在 4 个模型窗口的触发点计算 tier，结果见 F-1 表格。探针文件已删除，工作树未留残留。
- 全仓 grep 确认：`planCompression` 唯一调用点、`tierSchedule` 无写入点、`mode: "shadow"` 两处硬编码、`nativeMemory` 不在 config schema。
- 配置默认值链路：`materialize.ts` → `applyCompactionDefaults` → `resolveEffectiveCompactionMode` 三段逐行确认。

**未验证（本轮未执行）**
- 未跑 `pnpm test:dcs`、`pnpm eval:context-compression`、`runtime-memory` 系列 eval，也未做 live 模型压缩。第五节引用的 handoff benchmark 数字来自项目自己 2026-08-26 的验收报告，本轮未复现。
- 未在真实长会话里观测 tier4 崩塌的端到端后果（F-1 的行为影响是从代码路径推导 + 探针数值证明的，不是线上实测）。
- 未审计 SEKB / FactStore / memory 三层的检索质量（属上一轮审计范围，本轮聚焦压缩与注入控制面）。
- Electron / 渲染层的上下文指示器（`TokenUsageBadge.tsx`、`CompactionArtifactViewer.tsx`）仅确认存在，未审计其数值口径是否与后端一致。

---

## 七、相对 2026-08-11 上一轮审计的变化

| 上一轮判定 | 当前状态 |
| --- | --- |
| 🔴 B-4 上下文质量实时评分「完全空白」 | ✅ **已实现**：`context-health-monitor.ts` 四维评分 + scorecard 管线 + `noDataDimensions`。但默认不落盘（F-7） |
| 🔴 B-2 压缩副作用监控「无内容级告警/回滚」 | 🟡 **代码已补、默认关闭**：`compaction-damage-rules.ts` 4 类损伤 + P6 promotion 五档门禁，但三重关闭叠加使其不可生效（F-3） |
| 🟡 B-1 注入层异质路由「只需给每通道加 decay/priority」 | ✅ **已按建议实现**：`TURN_INJECTION_CHANNEL_POLICY` 的 priority + decayHalfLifeTurns，默认全 Infinity 待开启 |
| ★★★ 「5 档 tier 60/75/85/95%」列为领先项 | ❌ **本轮推翻**：产品默认路径不运行阶梯，default 模式恒定 tier4（F-1）。上一轮是静态读代码得出的结论，未追配置默认值与调用链 |
| 局限声明「未运行运行时评测」 | 本轮同样以静态为主，但补了配置链路追踪与一次数值探针 |

上一轮把 tier 阶梯记为 `★★★`（产品级参考水平）是 ClawX 自我评估里最主要的一处高估，根因是审计只读了 `compression-planner.ts` 的阈值常量、没有追 `contextWindow` 从哪来、以及 safeguard 模式是否会走到那里。

---

## 八、修复优先级建议

| 优先级 | 项 | 工作量 | 收益 |
| --- | --- | --- | --- |
| P0 | F-2 CJK token 估算下沉到 `agent-core` | 单点，~20 行 | 中文会话所有预算判断立即正确 |
| P0 | F-1B 给 `planCompression` 传真实 `contextWindow` | 单点，~10 行 | 阶梯恢复设计语义，消除恒定 tier4 |
| P1 | F-1A 决策 safeguard 模式是否运行阶梯并落实 | 需设计决策 | 消除"宣传的能力不在默认路径上" |
| P1 | F-3 damage mode 跟随 promotionStage + 补 config leaf | 小 | B-2 从代码存在变为默认可观测 |
| P2 | F-8 给 planner/artifact 补分档与归一化的边界测试 | 中 | 防止 F-1 类缺陷再次静默 |
| P2 | F-5 统一三套估算器口径 | 中 | 三个判断不再互相矛盾 |
| P2 | F-7 health snapshot 按会话结束落盘 | 小 | 获得跨会话回归基线 |
| P3 | F-4 `tierSchedule` 接通或清理 | 小 | 消除死配置 |
| P3 | F-6 用 B-4 分数参与放行判定 | 小 | 运行时质量门从字面匹配升级到分数 |
| P3 | F-9 `capabilities.nativeMemory` 进类型化 schema | 小 | 能力可发现、可校验 |

---

## 九、总体评价

**架构判断正确、纵深充分、护栏设计成熟**——尤其是「摘要是 projection 不是事实源」「critical atom 无证据即降级」「fail-closed 预算」「off-the-books 注入零容忍」「密钥脱敏在归一化层」这几条不变式，都是产品级的品味，明显高于同生态位框架。

**但存在一类系统性风险：宣传的能力与默认配置下真正运行的能力之间有落差。** 本轮三个高危发现（F-1/F-2/F-3）都属这一类——代码写对了、测试也过了，但生产默认值让它空转，而测试 fixture 恰好绕开了那个默认值。这与仓库自己在多处注释里记录的缺陷类（§R1 A3 双拷贝漂移、§R1 A5 CJK 匹配、FP-P0-02 config 形态静默失效）是同源的，说明这不是偶发失误而是一个需要机制化拦截的模式：**任何"分档/阈值/预算"逻辑的测试，必须至少有一个 case 使用与生产完全一致的配置形状（不传可选参数），而不是自带完备 fixture。**

