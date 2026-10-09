# mem 探索报告：能力定位、对标 Codex CLI / Manus、以及写入读出的真实收益

日期：2026-10-09
基线：`arena/022d0cd0-verseclaw` @ `7573115a`
方法：仓库代码与证据通读 + **在本沙箱实际安装依赖并运行评测**（非只读推断）

---

## 0. 结论先行

1. **"mem" 不是一个东西，是三个。** 混为一谈会得出完全错误的战略判断：产品里的 **Role Memory**（已上线的记忆卡治理平面）、研发中的 **Runtime Memory**（时序 fact + 读水合）、以及一个**离线的 LoCoMo 评测装置**。三者的代码路径、默认开关、证据等级完全不同。

2. **75.2% 这个 LoCoMo 分数当前不能拿出去对标。** 三个硬伤：judge prompt 自称为 `frozen-v2-generous`（含"部分正确即算对""14 天容差""列表覆盖 50% 即算对""子串即算对"）；`context_recall` 指标本身是坏的（0.008）；仓库里**没有该次运行的任何 artifact**，且 CI 中该测试因缺 API key 被 skip。详见 §3。

3. **真正跑通并被实测证明的收益是"闸门"，不是"记忆"。** 我实跑的结果：guarded 相对 naive 检索，精确率 8.77% → 100%，危险事实返回数 240 → 0。但 guarded 相对"完全没有记忆"的 baseline 的提升，是**合成语料构造出来的**（baseline 用空库、treatment 用种子库），不是涌现出来的。详见 §4。

4. **写入侧目前收益为零（因为默认全关），读出侧收益是安全性收益。** 读出成本极低（p50 31 tokens / 0.27 ms），但默认 token 预算只有 256、上限 8 条——这个量级能否改变模型行为，**没有任何证据**。

5. **最合适的使用者是"长期、多会话、多角色、且能审阅记忆的桌面重度用户"**，不是普通聊天用户，也不是跨设备用户。VerseClaw 的记忆是**治理优先（governance-first）**设计，这个定位是真实的差异化，但也决定了它的适用面很窄。详见 §5。

---

## 1. "mem" 的三个实体

| # | 名称 | 代码位置 | 默认状态 | 证据等级 |
|---|---|---|---|---|
| A | **Role Memory** | `openclaw_runtime/src/memory/*.ts`（`memory-store.ts` 92KB、`gatekeeper.ts`、`memory-dual-gate.ts`、`memory-policy.ts`） | **写入闸门与读取闸门默认都关**（`writeEnabled: false` / `useEnabled: false`） | 单元 + E2E 局部可用 |
| B | **Runtime Memory** | `openclaw_runtime/src/runtime-core/memory-*.ts` + `src/agents/runtime-memory-eval/`（136 个文件、37,602 行） | **全部 `runtime.memory.*` 默认 false**（`persist` / `shadow` / `provider` / `proposeFacts` / `injectPilot`） | shadow / diagnostics-only |
| C | **LoCoMo 评测装置** | `tests/unit/runtime-memory-locomo-full-500.test.ts`（3,869 行）+ 12 万行相关测试 | 需要 `RUNTIME_MEMORY_REAL_LLM=1` + DeepSeek/SiliconFlow key，**CI 中 skip** | 一次性离线跑分 |

### 1.1 三者的关系不是"层层递进"，而是"基本没接通"

这是本次探索最重要的结构性发现，有三条独立证据：

- **抽取器自己说它是评测专用的。** `openclaw_runtime/src/runtime-core/memory-extraction-prompt.ts` 文件头三行：

  > `// Shared LLM extraction prompt builders for memory fact extraction.`
  > `// Used by the LoCoMo eval harness and available for **future** production`
  > `// LLM-based extraction paths.`

  也就是说，产生 75.2% 的那套 fact 抽取，从未进入生产路径。

- **读取闸门与写入闸门默认关闭。** `openclaw_runtime/src/memory/memory-dual-gate.ts`：

  > `Defaults are closed (off), matching COMPASS advanced flags and the Role Memory "disabled until enabled" UI copy.`

- **Role Memory 的官方 surface report 自评未就绪。** `docs/dev/knowledge-system-unification/surface-reports/role-memory-retrieval.json`：

  ```json
  "currentStage": "shadow",
  "evidenceLevel": "E2", "e4": "not-evaluated", "e5": "blocked",
  "claims": { "liveReady": false, "productApproved": false, "defaultOn": false, "ga": false }
  ```

**推论**：C（评测装置）的高分不能用来证明 A 或 B 的产品能力。把它们并列宣传会构成仓库自有的 `FP-OVERCLAIM`（见 `reports/report-authenticity-true-false-positive-matrix-2026-07-04.md` 的判定口径）。

---

## 2. 我们 vs Codex CLI vs Manus

### 2.1 对标表

| 维度 | **VerseClaw mem** | **Codex CLI** | **Manus** |
|---|---|---|---|
| 记忆载体 | SQLite 时序 fact + 记忆卡（subject/predicate/objectSummary + `valid_at`/`invalid_at`/`expired_at`） | 两层：`AGENTS.md`（人写、版本控制）+ `~/.codex/memories/`（agent 自动摘要、Markdown） | 文件系统即上下文（VM sandbox 内的文件 + todo.md），必要时才上向量库 |
| 写入时机 | 抽取 + **人工/闸门审批**（propose → gatekeeper → review） | 后台异步：会话**空闲 6 小时**后才进入 Phase 1 摘要，再全局锁跑 Phase 2 合并 | 边做边写：中间结果直接落文件；压缩前先 offload 到文件 |
| 读取方式 | 有守卫的水合：13 类拒绝理由 + 冲突裁决 + token 预算（默认 256 tokens / 8 条） | `memory_summary.md` **截断到 5000 tokens**，其余只能靠 `MEMORY.md` 字面子串匹配 | `grep` / `glob` / `cat` 按需取回，**可恢复压缩**（保留 URL/路径即视为可恢复） |
| 默认开关 | **全关**（写闸门、读闸门、persist、injectPilot 均 false） | **默认关**：需先开 `features.memories`，之后 `generate_memories` / `use_memories` 默认 true | 默认开（文件写入是 agent 的常规动作） |
| 作用域 | **角色级隔离**（role-scoped memory control plane，8 个内置角色各有记忆边界） | 单机单用户，**无跨机器同步、无团队共享** | 会话内 sandbox；跨会话的 knowledge 需用户确认才持久化 |
| 核心优化目标 | 治理、可审计、防泄漏、防注入 | 零配置、低摩擦 | **KV-cache 命中率**（输入输出比约 100:1，缓存与未缓存价差 10 倍） |
| 已量化证据 | 合成语料三臂评测（见 §4）；LoCoMo 一次性离线跑分（见 §3） | 无公开 benchmark 分数 | 无公开 benchmark 分数 |

外部依据：Codex 两层记忆与 5000-token 截断、6 小时空闲门、默认关闭、无跨机同步见 [1](https://mem0.ai/blog/how-memory-works-in-codex-cli)、[2](https://x.com/mem0ai/article/2054580022049198513?lang=en)、[4](https://datamcp.app/blog/codex-memory-mcp)；社区对"写入前逐条授权"的诉求见 [5](https://github.com/openai/codex/discussions/12567)。Manus 的文件系统即上下文、可恢复压缩、todo.md 复诵、KV-cache 优先见 [2](https://www.zenml.io/llmops-database/context-engineering-for-production-ai-agents-at-scale)、[4](https://dev.to/contextspace_/context-engineering-for-ai-agents-key-lessons-from-manus-1lgb)。

### 2.2 定位判断

**我们不是"记忆能力"最强，而是"记忆治理"最严。**

- 对 **Codex CLI**：我们多的是**时序语义**（`valid_at`/`invalid_at`/`expired_at` + 时序检索模式 filter/boost/strict）、**结构化三元组**、**12 类拒绝闸门**、**角色级隔离**。Codex 的关键词兜底与 5000-token 硬截断在我们的设计里根本不存在。这是真实的架构优势。
- 对 **Manus**：Manus 追求的是**低成本、可恢复、缓存友好**——他们明确说"为了修上下文而牺牲 KV-cache 是不划算的"。我们完全没有把 KV-cache 命中率作为约束写进记忆设计。这是一块**真实的战略空白**：我们的读水合每轮注入 8 条 fact，如果 fact 顺序或内容抖动导致 prefix 变化，在 100:1 的输入输出比下成本会被放大。
- **共同的短板**：三者都**没有跨设备/跨团队的记忆同步**。这一格是空的，Memo/Codex 用户都在抱怨。

---

## 3. 75.2% 能不能对外说：不能。三条硬伤

`tests/unit/helpers/locomo-pipeline.ts:225` 里有一张 SOTA 对比表（Backboard 0.90 / Hindsight_Gemini3 0.8961 / Memobase 0.7578 / Zep 0.7514 / Mem0 0.6688 / LangMem 0.581），`ours` 由运行时填入。仓库里最新的 `tests/fixtures/runtime-memory-eval/locomo-full-500-report.json` 是 **0.752**。

这个 0.752 落在 Memobase(0.7578) 与 Zep(0.7514) 之间，看上去非常漂亮。但它**不可用于排名**，理由如下。

### 3.0 （最严重）升级阶梯会把整段对话塞进生成器，而报告里不披露比例

`tests/unit/runtime-memory-locomo-full-500.test.ts` 的答案生成走三级升级阶梯：

| Level | 喂给生成器的上下文 | 预算上限 |
|---|---|---|
| 0 | 仅检索到的 top-5 facts | — |
| 1 | episodic 摘要 + 检索 facts | `EscalationBudget(500, 0.25)` → 125 题 |
| **2** | **`fullConversation`——整段对话原文** | `EscalationBudget(500, 0.15)` → **75 题** |

代码位置：`2135-2210`（cached 路径）与 `3163-3225`（fresh 路径），关键行：

```ts
if (strippedAnswer.insufficient && fullConversationBudget.tryUse()) {
  const fullConversation = fullConversationTextByConversation.get(conversationId) ?? "";
  rawAnswer = await generateDualTrackAnswer(qa.question, category, fullConversation, [], ...);
  finalAssembledContext = fullConversation;      // ← 整段对话进上下文
  escalationLevel = 2;
}
```

触发条件是模型自己输出"证据不足"。也就是说：**记忆检索失败 → 静默退回全上下文 → 答对了仍然计入记忆系统的分数。**

- `EscalationBudget.maxEscalations = Math.floor(totalQuestions * maxRate)`（`runtime-memory-escalation-ladder.ts:52`），500 × 0.15 = **75 题 / 15%**。
- 真实运行会输出 `escalation` 统计块（`3579` 行：`escalation: escalationStats`，含 `full_conversation_rate`、`level2`）。
- **但提交进仓库的 `locomo-full-500-report.json` 里没有这个字段**（只有 `dataset` / `version` / `totalQuestions` / `metrics` / `generatedAt`）。

**结论**：0.752 是"记忆 + 最多 15% 全上下文兜底"的混合分，混合比例未披露。作为产品的优雅降级设计可以辩护；作为**记忆能力的测量值不成立**。这是本次探索发现的最严重问题，优先级高于 judge 宽松度。

### 3.1 judge 是显式"宽松"的

`tests/unit/helpers/runtime-memory-judge-freeze.ts:1-19`，`promptVersion: "frozen-v2-generous-2026-07-04"`（注意 generous 是团队自己命名的，日期正是 0.752 那次运行的日期）：

```
- Partial credit: if the predicted answer covers part of the ground truth, answer CORRECT.
- If the ground truth is a list, the predicted answer must cover at least 50% of items.
- Time tolerance: if dates are within 14 days of each other, treat as CORRECT.
- If the predicted answer is a superstring or substring of the ground truth (case-insensitive), answer CORRECT.
```

"部分正确算对" + "子串算对" + "14 天容差"，这三条恰好精准豁免了**记忆系统最典型的失败模式**（答非所问但话题沾边、时间记错）。而对比表里的 0.581–0.90 是各家用**各自 judge** 跑出来的。

### 3.2 `context_recall` 是个坏指标，不能用来交叉验证

0.752 这份报告同时报了 `context_recall: 0.008`——即"组装出的上下文几乎从不包含标准证据"。如果这是真的，75.2% 的正确率就只能来自泄漏或 judge 放水。我查了实现，结论是**这个指标本身坏了**：

- `computeContextRecall(assembledContext, goldEvidence)`（`tests/unit/helpers/runtime-memory-context-recall.ts:12`）做的是"取 gold 中长度 > 3 的词，看是否出现在 context 里"。
- 但 LoCoMo 的 `evidence` 字段是**对话轮次 ID**，不是文本。`tests/fixtures/locomo/locomo10_raw.json` 里是 `{"question": "When did Caroline go to the LGBTQ support group?", "answer": "7 May 2023", "evidence": ["D1:3"]}`。
- `"D1:3"` 去掉非词字符后是 `"d13"`，长度 3，被 `> 3` 过滤掉 → `goldWords` 为空 → `continue` → 该题恒为 0。

**所以 0.008 是"拿轮次 ID 当文本匹配"的产物，既不能证明泄漏，也不能证明检索有效。** 它现在被写进报告并被 `locomo-report-comparator.test.ts` 消费，会持续误导后续读报告的人。

### 3.2b 检索没进步，分数涨了 30 点——而且 temporal 是**反向**的

把 phase3 基线与 v10.0 逐类对齐（同一批 500 题）：

| 类目 | j (P3) | j (v10) | Δj | recall@5 (P3) | recall@5 (v10) | Δrecall@5 |
|---|---|---|---|---|---|---|
| temporal | 0.3533 | 0.8067 | **+0.4533** | 0.6377 | 0.5181 | **−0.1195** |
| multi_hop | 0.4271 | 0.6146 | +0.1875 | 0.1888 | 0.2407 | +0.0519 |
| single_hop | 0.5276 | 0.7800 | +0.2524 | 0.3726 | 0.4939 | +0.1213 |
| open_domain | 0.5118 | 0.8200 | +0.3082 | 0.5711 | 0.6260 | +0.0549 |
| **OVERALL** | 0.4520 | 0.7520 | **+0.3000** | 0.4672 | 0.4979 | **+0.0306** |

两处异常：

1. **整体：recall@5 只涨 3.06 个点，j 涨 30 个点。** 检索侧几乎没动，分数暴涨 → 增益几乎全部来自答案生成 / judge 侧（§3.0 的全上下文兜底 + §3.1 的宽松 judge）。
2. **temporal 类目是反向的：recall@5 从 0.6377 掉到 0.5181（−12 个点），j 却从 0.3533 涨到 0.8067（+45 个点）。** 检索明显变差而判分大幅变好，这只能用"judge 与时间容差规则放水"解释——而 `frozen-v2-generous` 里恰好有一条 `Time tolerance: if dates are within 14 days of each other, treat as CORRECT`。

### 3.2c judge 健全性检查是个空转检查

`buildJudgeSanityReport()`（`runtime-memory-judge-freeze.ts:100-118`）把所有样本初始化为 `manualVerdict: "unreviewed"`。而：

- `reviewedCount = 非 unreviewed 的样本数` → 恒为 0
- `falseNegativeRate = 0`（reviewed 为空时直接 return 0）
- `requiresPromptReview = reviewedCount > 0 && falseNegativeRate > 0.15` → **恒为 false**

全仓库只有 `judge-sanity-check.test.ts` 的测试夹具里手工填过 `truly_wrong` / `actually_correct`；**没有任何生产代码或自动化流程会去填它**。所以"judge 健全性检查"永远输出"健康"，它不是一个有效的质量闸门。

### 3.3 没有 artifact，CI 里跳过，且跨系统本来就不可比

- 0.752 这个数字**只以 fixture 形式存在于** `tests/unit/locomo-report-comparator.test.ts:93`（硬编码字面量），`artifacts/runtime-memory-eval/` 目录不存在。也就是说，**没有那次 500 题运行的报告产物可查**。
- 我实跑确认：`npx vitest run tests/unit/runtime-memory-locomo-full-500.test.ts` → **1 skipped**（缺 `RUNTIME_MEMORY_REAL_LLM` / API key）。该分数在 CI 中**无法复现**。
- 更根本的是，**LoCoMo 分数跨系统本来就不是排名**。外部审计发现：LoCoMo 答案键有 **6.4% 错误率**，而其默认 judge 对**故意构造的错误但话题沾边的答案接受了 62.81%**[1](https://agentos.sh/blog/memory-benchmark-transparency-audit/)；同一个 Mem0 系统自报 94.4%、第三方论文实测 67.6%，差 27 个点[2](https://dev.to/todoforai/947-on-locomo-and-why-most-of-the-gap-between-published-memory-numbers-isnt-the-memory-26bo)；同一批答案换不同 judge 模型可差 5–20 个点[3](https://mnemoverse.com/docs/technology/benchmarks/locomo)。

**结论**：把 0.752 与 Memobase/Zep 并列，是把一个"宽松 judge + 无产物 + CI 不可复现"的数字，放进一个"本身就不具可比性"的排行榜里。**建议对外口径改为**："在 LoCoMo 500 题子集上、使用我们自有的宽松 judge，端到端正确率 75.2%；该数字不可与厂商自报分数直接比较；上下文召回指标当前实现有缺陷，不作为证据。"

### 3.4 顺带：mem.md 的优化方案已经过时

`docs/runtime-design/mem.md` 的基线是 `temporal 17.3% / multi_hop 39.6% / single_hop 52.8% / open_domain 66.1% / overall 43.0%`。而仓库里最新的 fixture 已是 `temporal 80.7% / multi_hop 61.5% / single_hop 78.0% / open_domain 82.0% / overall 75.2%`。**这份文档描述的优化路线（Phase 1–4）对应的问题在代码里大部分已经被解决或绕过**，继续照它排期会做无用功。

---

## 4. 写入 / 读出的实际收益：我实跑出来的数字

我把依赖装起来，在沙箱里跑了 Phase 35（收益评测）与 Phase 36（长对话统计评测），全部通过（`7 passed` / `6 passed`）。以下是**实际测得值**，不是文档里的期望值。

### 4.1 读水合三臂实测（语料：1,460 条 fact / 120 条 query）

| 指标 | baseline（无记忆） | naive（无守卫检索） | **guarded（现有消费者）** |
|---|---|---|---|
| recall@k | 0 | 1.000 | **1.000** |
| precision | — | 0.0877 | **1.000** |
| 返回的不安全标签 fact 数 | — | 1,040 | **0** |
| 返回的危险 fact 数 | — | 240 | **0** |
| 返回的必须拒绝 fact 数 | — | 1,040 | **0** |
| 任务成功率（记忆相关） | 0 | 0 | **1.000** |
| 任务成功率（记忆无关） | 1.000 | 1.000 | **1.000**（未退化） |
| token 开销 p50 / p95 | 0 | — | **31 / 34** |
| 纯消费者延迟 p50 / p95 | — | — | **0.27 ms / 0.60 ms** |

来源：`tests/unit/helpers/runtime-memory-eval-helpers.ts` 的 `evaluate()`，我用临时探针在沙箱内导出（`tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` 7/7 通过）。

### 4.2 这些数字到底证明了什么

**证明了（真实、可对外说）：**

- 守卫机制有效且有意义的量级：naive 检索会把 240 条危险事实、1,040 条不安全事实直接送进上下文；guarded 全部拦下。精确率从 8.77% 提到 100%。
- 成本可忽略：31 tokens（p50）、0.27 ms（p50）。默认预算 `DEFAULT_TOKEN_BUDGET = 256` / `DEFAULT_LIMIT = 8`（`memory-read-hydration-consumer.ts:61-62`）。
- 无记忆无关退化：记忆无关场景的成功率 baseline 与 guarded 都是 1.0，符合"加记忆不能拖累无关任务"的门槛。
- 13 类拒绝理由全部生效（`record_kind_not_fact` / `verification_status_not_verified` / `future_valid_at` / `invalidated_at_reference_time` / `task_mismatch` / `prompt_injection_sentinel` / `raw_leak_sentinel` / `conflicting_fact` / `token_budget_exceeded` …）。

**没有证明（必须说清楚）：**

1. **"记忆让任务做得更好"没被证明。** baseline 臂用的是**空数据库**（recall 恒为 0），treatment 臂用的是**按查询精确播种的数据库**。Phase 36 的查询筛选函数（`runtime-memory-eval-helpers.ts:276-292`）只保留 `expectedFactIds` **全部**都在种子库里的查询。所以"1.0 vs 0"是设计出来的，不是涌现的。这测的是**检索正确性**，不是**端到端任务收益**。
2. **p-value 是常量，不是算出来的。** `openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts:213-229`：

   ```ts
   // p-value via critical t comparison (two-sided, alpha=0.05 table only).
   if (Math.abs(t) > critical) { pValue = 0.049; } else { pValue = 0.051; }
   ```

   我用 t=9.42 / df=29 的样本实测，返回 `pValue: 0.049`（真实 p 应约为 1e-10）。作为显著性**判定**它没错（等价于 |t| > 临界值），但把它写成 `pValue` 字段并断言 `p < 0.05`，会让人误以为得到了一个精确 p 值。**建议改名为 `significant` 布尔 + 保留 `tStatistic`，或接入真正的 t 分布实现。**
3. **LLM 真值验证那 3 个用例是被跳过的。** `runtime-memory-long-conversation-real.test.ts` 实测 `8 passed | 3 skipped`，跳过的正是 `llm_token_recall_30_samples_with_cohen_d`、`multi_judge_vote_on_subset` 等需要真实模型的用例。**到目前为止，没有任何一条真实模型参与的"记忆带来收益"的证据。**

### 4.3 写入侧：成本已知，收益未知

- **写入成本**（可从 LoCoMo harness 推算）：每 30 轮对话一次抽取调用（`CHUNK_SIZE = 30`，`maxTokens: 4096`，`runtime-memory-locomo-full-500.test.ts:786,833`），外加每条 fact 的 embedding。单位成本不高。
- **写入收益 = 0，因为默认全关。** `runtime.memory.persist` / `proposeFacts` / `shadow` / `provider` 全部默认 false；`memory-dual-gate.ts` 的 `writeEnabled` 默认 false。**今天没有任何一条生产路径在写记忆。**
- 于是形成一个**死结**：没有持久化语料 → 读水合无事可做 → 收益评测只能在合成语料上做 → 合成语料的收益无法说服任何人打开持久化开关。`docs/runtime-design/mem.md` 第四节已经预警过同构问题（"如果生产 maxFacts 过小，重要性驱逐必须在其他所有改动之前完成，否则后面全是无效功"）。

---

## 5. 谁用这个 mem 方案最合理

### 5.1 先看这套方案"贵"在哪

它要求用户接受三件事：**(a) 记忆要被审阅才生效**（propose → gatekeeper → review）；**(b) 记忆按角色隔离**，不是"一个大脑"；**(c) 单设备、单 workspace**。愿意付这个成本的人，必须能从"记忆是对的、可审计的"里拿到足够大的回报。

### 5.2 最合适（按契合度排序）

| 排名 | 画像 | 为什么契合 | 触发条件 |
|---|---|---|---|
| **1** | **长期项目里的多角色 agent 编排者**（role-first 用户：planner/architect/implementer/tester/reviewer/security-reviewer/skeptic/docs-writer 八角色协作） | 这是**唯一**把"角色级记忆隔离"当刚需的场景：reviewer 不该被 implementer 的中间态污染，security-reviewer 的结论必须可追溯。这是 Codex CLI 与 Manus 都没做的维度，是真实差异化 | 需要把 `contextBlock.role-memory` 与双闸门打开，并补 E3/E4 证据 |
| **2** | **受合规约束、需要"记忆可解释"的专业用户**（法务、医疗、金融、安全审计） | 13 类拒绝理由 + 冲突裁决 + 来源/置信度/审阅链路 = 每条进上下文的记忆都能回答"它从哪来、为什么能用、谁批的"。这正是 Codex 用户公开抱怨缺的东西（"我要的是写入前的逐条授权，不是事后删除"）[5](https://github.com/openai/codex/discussions/12567) | 需要把审阅流程做成低摩擦的 UI，否则没人用 |
| **3** | **超长会话的重度桌面用户**（同一项目连续数周、每轮上百次工具调用） | 时序 fact（`valid_at`/`invalid_at`）+ 时间感知检索（filter/boost/strict）在"上周那个决定是什么"这类问题上，结构上优于 Codex 的 5000-token 摘要截断 | 需要证明"记得准"优于"摘要够用" |

### 5.3 不合适

- **跨设备 / 团队协作用户**：我们和 Codex CLI 一样**没有跨机器同步**，`~/.codex/memories` 换台机器就归零，我们换台机器同样归零。**这一格全行业都是空的**，谁先做谁拿到一批用户。
- **一次性 / 短会话用户**：写入闸门 + 人工审阅的成本 > 记忆带来的收益。Manus 的"文件即上下文"在短任务上成本更低。
- **在意 KV-cache 成本的大规模调用场景**：Manus 把缓存命中率当北极星（输入输出 100:1，缓存价差 10 倍）[4](https://dev.to/contextspace_/context-engineering-for-ai-agents-key-lessons-from-manus-1lgb)。我们的读水合每轮注入内容，若 fact 排序/内容抖动导致 prefix 失效，成本会被放大，而这一点**没有写进任何设计约束**。
- **想要"开箱即用"的人**：默认全关，`liveReady: false`。

### 5.4 一句话定位

> **VerseClaw 的 mem 不是"更聪明的记忆"，是"可被追责的记忆"。**
> 它该卖给的，是那些**记忆出错代价高于记忆缺失代价**的用户。

---

## 6. 建议（按性价比排序）

| 优先级 | 动作 | 理由 | 成本 |
|---|---|---|---|
| **P0** | **修 `computeContextRecall`**：把 LoCoMo 的 `evidence: ["D1:3"]` 轮次 ID 解析成对应轮次文本后再做召回计算；修好之前，从报告里移除该字段 | 它现在是 0.008，被写进报告并被比较器消费，持续制造"要么泄漏要么 judge 放水"的误判 | 半天 |
| **P0** | **给 0.752 加限定口径**，并在 `locomo-pipeline.ts` 的 SOTA 表旁注明"非同类 judge，不可排名" | 防 `FP-OVERCLAIM`，符合仓库已有的 authenticity 规矩 | 1 小时 |
| **P1** | **把 `pValue` 改名/重写**：改为返回 `significant: boolean` + `tStatistic`，或接入真正的 t 分布 | 现在的 0.049/0.051 是常量，一旦被引用就是伪造精度 | 2 小时 |
| **P1** | **补一条真实模型的最小闭环证据**：在受控 fixture 上，让同一个任务在"有记忆/无记忆"两臂跑同一个模型，比较**任务产出**而非"是否召回了预期 fact" | 这是打通"打开 persist 开关"这个死结的唯一办法；当前所有收益证据都是检索正确性，不是任务收益 | 1–2 天 |
| **P2** | **升级 judge**：增加 strict 档（去掉 partial credit / 14 天容差 / 子串规则），同时报 strict 与 generous 两个分数 | 两个分数之间的差值本身就是有价值的信息：它量化了"我们的记忆有多少是真记住、多少是蒙对" | 1 天 |
| **P2** | **把 KV-cache 友好性写进读水合约束**：fact 排序稳定化、注入块放 prefix 末尾、内容确定性序列化 | 对标 Manus 的北极星指标；我们目前完全没有这个约束 | 设计 + 1 天 |
| **P3** | **跨设备/团队记忆同步** | 全行业空白，Codex 用户在公开抱怨 | 大 |
| **P3** | 归档 `docs/runtime-design/mem.md`（基线已过时 32 个点） | 防止照着过时文档排期 | 1 小时 |

---

## 附录 A：本次探索的可复现命令

```bash
# 依赖（沙箱内需绕过 TLS 拦截）
pnpm install --ignore-scripts --config.strict-ssl=false
# openclaw_runtime 不在 workspace 内，其依赖需把 .pnpm 提升到根 node_modules（node_modules 已被 gitignore）

# 收益评测（Phase 35）
npx vitest run tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts   # 7 passed
# 长对话统计（Phase 36）
npx vitest run tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts  # 6 passed
# 长会话真实语料
npx vitest run tests/unit/runtime-memory-long-conversation-real.test.ts  # 8 passed | 3 skipped（需真实模型）
# LoCoMo 500 题
npx vitest run tests/unit/runtime-memory-locomo-full-500.test.ts         # 1 skipped（需 API key）
```

## 附录 B：关键文件索引

| 主题 | 路径 |
|---|---|
| mem 优化方案（已过时） | `docs/runtime-design/mem.md` |
| SOTA 对比表 | `tests/unit/helpers/locomo-pipeline.ts:225` |
| 宽松 judge 定义 | `tests/unit/helpers/runtime-memory-judge-freeze.ts:1-19` |
| judge 策略注册 | `tests/unit/helpers/locomo-judge-registry.ts:251`（默认 `frozen-v2-generous`） |
| context_recall 实现（有缺陷） | `tests/unit/helpers/runtime-memory-context-recall.ts:12` |
| p-value 常量 | `openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts:213-229` |
| 查询筛选（构造性偏差来源） | `tests/unit/helpers/runtime-memory-eval-helpers.ts:276-292` |
| 读水合消费者 | `openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts:71` |
| 双闸门（默认关闭） | `openclaw_runtime/src/memory/memory-dual-gate.ts` |
| 抽取器（评测专用声明） | `openclaw_runtime/src/runtime-core/memory-extraction-prompt.ts:1-3` |
| Role Memory 就绪度自评 | `docs/dev/knowledge-system-unification/surface-reports/role-memory-retrieval.json` |
| Phase 35 收益评测 spec | `harness/specs/tasks/phase-35-runtime-memory-read-hydration-benefit-evaluation-design.md` |
| Phase 36 长对话 spec | `harness/specs/tasks/phase-36-runtime-memory-long-conversation-statistical-eval.md` |
| 真实性判定口径 | `reports/report-authenticity-true-false-positive-matrix-2026-07-04.md` |
