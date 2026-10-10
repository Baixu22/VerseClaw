> **基线状态（issue #146 复核，2026-10-10；driven_by: agent）**
>
> 本文件原来的排期起点是手写的 `43.0%`。入库产物
> `tests/fixtures/runtime-memory-eval/locomo-full-500-report.json` 的 `metrics.overall.j_score` 是 `0.752`，
> 相差 32.2 个点 —— 照旧基线排期是无效功。旧基线及由它推导出的阶段目标（§三）已全部作废。
>
> 现行基线**不手写**：以 §零 的机器引用块为准，由 `tests/unit/runtime-memory-baseline-doc-guard.test.ts`
> 强制校验。引用块、§三 的「当前」行或产物指标缺失/不可解析时，该守卫**失败**（不静默跳过）。
> 守卫只覆盖 §零 的引用块、§三 的「当前」行、以及 judge 版本与 5 条豁免规则；本文件其余数字
> （如 §一 的 `-7.3%`、§四 的存活率）不在守卫范围内，仍属未复核的历史论述。

零、基线（机器引用，禁止手改）
基线是「入库产物 + 指标路径」，不是本文件里手写的一句话。下块由守卫逐字段比对产物，改块必须同步产物。

<!-- BEGIN runtime-memory-baseline -->
```json
{
  "sourceArtifact": "tests/fixtures/runtime-memory-eval/locomo-full-500-report.json",
  "sha256": "d65dd7cdd93f0306fce93cb8363ce107ba60a8606c94607cf3a9d6590cd377df",
  "reportVersion": "10.0-stage2-adaptive-retrieval",
  "generatedAt": "2026-07-04T08:00:00.000Z",
  "totalQuestions": 500,
  "metricPaths": {
    "metrics.overall.j_score": 0.752,
    "metrics.overall.recall_at_5": 0.49785195945265603,
    "metrics.overall.context_recall": 0.008,
    "metrics.byCategory.temporal.j_score": 0.8066666666666666,
    "metrics.byCategory.multi_hop.j_score": 0.6145833333333334,
    "metrics.byCategory.single_hop.j_score": 0.78,
    "metrics.byCategory.open_domain.j_score": 0.82
  },
  "judge": {
    "promptVersion": "frozen-v2-generous-2026-07-04",
    "promptVersionSource": "tests/unit/helpers/runtime-memory-judge-freeze.ts:4 (FROZEN_JUDGE_CONFIG.promptVersion)",
    "exemptionRulesSource": "tests/unit/helpers/runtime-memory-judge-freeze.ts:25-31 (FROZEN_JUDGE_INTERPRETATION.limitations)",
    "exemptionRules": [
      "Partial answers are accepted as correct.",
      "Only 50% of a reference list is required.",
      "Dates within 14 days are accepted as correct.",
      "Case-insensitive substrings and superstrings are accepted.",
      "Aliases referring to the same entity are accepted."
    ]
  },
  "escalation": {
    "path": "escalation.full_conversation_rate",
    "present": false,
    "value": null
  }
}
```
<!-- END runtime-memory-baseline -->

零.1 基线的来源与免责（这 0.752 也不是可采纳的实测基线）
- **产物**：`tests/fixtures/runtime-memory-eval/locomo-full-500-report.json`（入库；字节摘要 SHA-256
  `d65dd7cdd93f0306fce93cb8363ce107ba60a8606c94607cf3a9d6590cd377df`，与 `tests/fixtures/runtime-memory-eval/README.md` 登记值一致）。
- **指标路径**：主指标 `metrics.overall.j_score` = `0.752`；分档为 `metrics.byCategory.<category>.j_score`。
  `metrics.overall.recall_at_5` / `metrics.overall.context_recall` 是检索代理，`context_recall` 尤其不能当记忆能力结论
  （见 `docs/dev/p0-memory-evaluation-integrity.md:11`）。
- **免责**：同一份 README 明确声明这三份历史聚合「lack a complete verifiable run record … retained for historical
  schema inspection only … baseline adoption rejects them」；`docs/dev/p0-memory-evaluation-integrity.md:7` 同样记录
  「历史 0.752 / 0.452 未找到可验证的逐题运行记录，不能作为已测量能力基线」。
- 所以正确读法是：**43.0% 已作废；0.752 是入库产物的当前值，但仍不是可采纳的实测基线。** 在
  `pnpm eval:runtime-memory:locomo:full500` 产出并通过 `pnpm eval:runtime-memory:locomo:verify` 的真实 500 题报告入库前，
  不得用这两个数中的任何一个做排期、收益计算或完成判定。

零.2 judge 版本与豁免规则（已逐条核对本树代码）
- judge 版本：`frozen-v2-generous-2026-07-04`（`tests/unit/helpers/runtime-memory-judge-freeze.ts:4`）。
- 豁免规则共 **5 条**（同文件 `:25-31` 的 `FROZEN_JUDGE_INTERPRETATION.limitations`，逐条列在 §零 引用块的
  `judge.exemptionRules`）：部分正确即判对；列表只要求覆盖 50%；日期相差 14 天内算对；大小写不敏感的子串/超串算对；
  同实体别名算对。守卫把这份数组与代码常量做深比较，规则增减会立即失败。
- 该 judge 明确定位为 `judgeComparableAcrossConfigurations: false` / `rankingAllowed: false`（同文件 `:22-33`）：
  **不同 judge、数据集或管线下的分数不可直接比较**，也不允许跨系统排名。
- 判断题的默认模型是 `deepseek-chat`（可被 `RUNTIME_MEMORY_LLM_MODEL` / `DEEPSEEK_MODEL` 覆盖）。旧文本里
  「这些数字用 DeepSeek V4 Pro 做 Judge」在本树中找不到任何依据，已作废（见 §三）。

零.3 降级兜底占比：本产物没有该字段（如实记录，不编数字）
issue #146 要求引用 0.752 时一并披露 `escalation.full_conversation_rate`。**该字段在这次入库产物里不存在**：
产物顶层键只有 `dataset`、`version`、`totalQuestions`、`metrics`、`generatedAt`，既没有 `escalation`，也没有
`judgeConfig`、`scoreAttribution`、`sampleResults`，因此 `escalation.full_conversation_rate` 无法解析。

- 这个字段是新 schema 的必填项，不是可选装饰：`tests/unit/helpers/runtime-memory-locomo-report-schema.ts:3-24`
  把 `escalation` 列为必填顶层字段，`:349-351` 要求 `escalation.full_conversation_rate === escalation.level2 / total`；
  `docs/dev/p0-memory-evaluation-integrity.md:16` 要求「拒绝把全量 J 冒充纯记忆分」。
- 结论：**本产物是旧 schema，无法给出降级兜底占比。** §零 引用块以 `"present": false` 记录这一事实；一旦产物出现
  `escalation`，守卫立即失败，强制先把真实占比写进本文件再引用分数。
- **用降级兜底产生的分数不是纯记忆分。** 只要 `escalation.level2`（全对话兜底）占比大于 0，`metrics.overall.j_score`
  就是「记忆 + 兜底」的混合分，不能当作记忆能力读数，也不能与不含降级的运行直接比较。

零.4 引用路径可得性（issue #146「相关」项的核对结果）
- `.gitignore:112` 是 `/runtime-research/`，**整目录被忽略**（issue 原文写作 `:217`，行号不对）；
  `git ls-files runtime-research` 返回 0 行。
- 本 worktree 里 `runtime-research/` 完全不存在（未跟踪文件不会随 worktree 建立）。主工作区
  `D:\ClawX\runtime-research\handoffs\` 存在，但其中**确实没有**
  `phase-36-runtime-memory-long-conversation-statistical-eval/`。
- spec 侧核对：`harness/specs/tasks/phase-35-runtime-memory-read-hydration-benefit-evaluation-design.md:9,14,111`
  的 `ownedPaths` / `touchedAreas` / 回滚路径都指向 `runtime-research/handoffs/phase-35-.../`；但
  `harness/specs/tasks/phase-36-runtime-memory-long-conversation-statistical-eval.md:7-16` 的 `ownedPaths`
  **不指向** `runtime-research/`。issue 把「Phase 35/36」并列不准确 —— 只有 Phase 35 存在该问题。
- 后果：被忽略目录里的产出既不入版本控制、也不随 worktree/CI 出现，不能作为可复核证据；引用它作为交付物的 spec
  在干净检出处无法验收。是否把 `runtime-research/` 纳入版本控制是 Lead 决策 —— **本文件不改 `.gitignore`，
  也不新增该目录内容。**

一、问题全景（基于代码证据，无猜测）
text

问题分层                     代码证据                        影响类目
─────────────────────────────────────────────────────────────────────
L1: 数据写入错误（最根本）
  valid_at = Date.now()       self-edit-tools + consolidation  temporal ↓↓↓
  实体图谱空表                appendRelation 全库仅读取路径    multi_hop ↓↓
  候选默认不可见              includeCandidates=false          全类目 -7.3%
  trimRows 硬删最旧           deleteFrom(tableName)            temporal ↓

L2: 检索未激活（次根本）
  裸 searchWithEmbedding      eval harness 代码确认            全类目 ↓
  valid_at 错导致 boost 无意义 L1 的连锁效应                   temporal ↓↓
  
L3: 抽取层信息丢失
  相对时间未归一化            "yesterday"存入 facts 原文       temporal ↓↓
  无结构化 Profile            flat facts 存储                  open_domain ↓

L4: 容量压力
  maxFacts FIFO 驱逐最旧      maxFacts=20 存活率 36.4%        temporal ↓↓↓
二、完整优化方案
Phase 1 — 接线修复（1 周；原列预期 temporal 17%→40%、整体 43%→55% 已作废，见 §零 / §三）
这一阶段只修复"已设计但未接通"的能力，零新功能。

1.1 修复 valid_at — 事件时间替代写入时间
这是整个 temporal 类目崩溃的根因。

TypeScript

// 改动位置：AUDN 写入调用处（self-edit-tools + background-consolidation）

// 之前（错误）：
const fact = {
  content: "James took his dogs to the beach",
  valid_at: Date.now(),  // ← 写入时间，对 temporal 毫无意义
}

// 之后（正确）：
const fact = {
  content: "James took his dogs to the beach",
  valid_at: sessionAnchorDate.getTime(),  // ← 对话发生的日期
  reference_time: resolvedEventTime,       // ← 如果能从内容解析出更精确的时间
}
sessionAnchorDate 从哪里来：LoCoMo 每段对话有明确的 session 日期，AUDN 写入时需要把这个日期作为参数传入，而不是用 Date.now()。

1.2 相对时间归一化 — 在抽取 prompt 里解决
这是 valid_at 修复的配套，让存入的 fact 内容本身携带绝对时间：

text

AUDN 抽取 prompt 新增指令：

"If the fact contains relative time expressions (yesterday, last month, 
three weeks ago, next Tuesday), resolve them to absolute dates using 
the session date {sessionDate} provided.

Examples:
- Session date: 2022-08-10
- Input: 'James took his dogs to the beach yesterday'
- Output fact: 'James took his dogs to the beach on 2022-08-09'

- Input: 'Alice started her job last March'  
- Output fact: 'Alice started her job in March 2021'
  (infer year from session date context)

If resolution is uncertain, preserve original text AND append 
'(approx. {sessionDate})' as a temporal anchor."
这一步改动最小（只改 prompt），但对 temporal 类目影响最大。

1.3 填充实体图谱 — 接通写入路径
TypeScript

// 改动位置：AUDN 抽取完成后的写入流程
// 在 appendFact 之后加一步实体关系提取

async function writeFact(store: RuntimeMemoryStore, fact: RuntimeMemoryTemporalFact) {
  const factId = await store.appendFact(fact)
  
  // 新增：提取实体关系并写入图谱
  const relations = extractEntityRelations(fact.content)
  // 格式：[{subject: "James", relation: "owns", object: "dogs"}, ...]
  
  for (const rel of relations) {
    await store.appendRelation(
      factId,
      rel.subject,
      rel.relationType,  // "related_to" | "supersedes" | "contradicts"
      rel.object,
    )
  }
}

// extractEntityRelations 的实现策略：
// 不需要专门 LLM 调用，AUDN 抽取时顺带输出实体三元组
// prompt 新增："Also output: entities: [{subject, relation, object}]"
1.4 候选可见性策略
不是简单改默认值，而是按置信度分级处理：

TypeScript

// 选项：高置信候选检索时可见，低置信候选不可见
// 比 includeCandidates=true/false 更精细

interface RetrievalOptions {
  candidateThreshold: number  // 默认 0.7：置信度 > 0.7 的候选参与检索
}

// 检索时：
const effectiveFacts = facts.filter(f => 
  f.verificationStatus === "verified" || 
  (f.verificationStatus === "candidate" && f.confidence >= options.candidateThreshold)
)
1.5 trimRows 改为重要性驱逐
TypeScript

// 之前：FIFO，删最旧的（对 temporal 是致命的）
// 之后：按重要性分数驱逐，保留时间锚点高的 facts

// 驱逐优先级（从低到高，先驱逐低分的）：
// 1. 低置信度候选
// 2. 无实体关系的孤立 facts
// 3. 内容相似度高的冗余 facts（近似重复）
// 4. 重要性分数最低的 verified facts
// 最后驱逐：有明确时间戳的 temporal facts（保留到最后）
Phase 2 — 检索激活（3-5 天；原列预期整体 55%→63% 已作废，见 §三）
让已有的三种时序检索模式真正发挥作用。

2.1 评测 harness 改用完整检索
TypeScript

// eval harness 里：
// 之前：
const hits = await searchWithEmbedding(facts, query, topK)

// 之后：
const hits = await hybridSearchFacts(store, {
  query: question,
  topK: 10,
  temporalMode: detectQueryTemporalMode(question),
  referenceTime: sessionAnchorDate.getTime(),
  includeInvalidated: false,
  candidateThreshold: 0.7,
})
2.2 时序查询检测器
TypeScript

function detectQueryTemporalMode(
  question: string
): "filter" | "boost" | "strict" {
  const lower = question.toLowerCase()
  
  // strict 模式：问题要求特定时间点的状态
  const strictPatterns = [
    /when did/,
    /what date/,
    /on what day/,
    /in \d{4}/,
    /before .* did/,
    /after .* did/,
    /at the time of/,
  ]
  if (strictPatterns.some(p => p.test(lower))) return "strict"
  
  // filter 模式：问题涉及时间范围
  const filterPatterns = [
    /currently/,
    /now/,
    /still/,
    /anymore/,
    /recently/,
    /latest/,
  ]
  if (filterPatterns.some(p => p.test(lower))) return "filter"
  
  // 默认：boost（时间越近权重越高，但不过滤）
  return "boost"
}
2.3 链式检索（multi_hop 的核心修复）
TypeScript

async function chainedHybridSearch(
  store: RuntimeMemoryStore,
  question: string,
  sessionDate: Date,
  topK: number = 10,
): Promise<RuntimeMemoryTemporalFact[]> {
  
  // Step 1: 常规混合检索
  const step1 = await hybridSearchFacts(store, {
    query: question,
    topK,
    temporalMode: "boost",
    referenceTime: sessionDate.getTime(),
  })
  
  // Step 2: 从 Step 1 结果里提取实体
  const entityNames = extractEntityNames(step1.map(f => f.content))
  
  if (entityNames.length === 0 || !isMultiHopQuestion(question)) {
    return step1
  }
  
  // Step 3: 用实体查询关联 facts（走实体图谱）
  const relatedFactIds = await store.getRelatedFactIds(
    entityNames,
    { maxHops: 2, maxBudget: topK * 2 }
  )
  const step2 = await store.getFactsByIds(relatedFactIds)
  
  // Step 4: RRF 融合
  return rrfFuse([step1, step2], { k: 60 }).slice(0, topK)
}

function isMultiHopQuestion(question: string): boolean {
  const patterns = [
    /how long/,
    /how many .* since/,
    /what .* before .* after/,
    /compare/,
    /relationship between/,
    /both .* and/,
  ]
  return patterns.some(p => p.test(question.toLowerCase()))
}
Phase 3 — open_domain 结构化（1 周；原列预期 open_domain 66%→75%、整体 63%→68% 已作废，见 §三）
这是唯一需要新增功能的阶段。

Memobase 在 open_domain 得到 77% 的核心原因是结构化 Profile——开放性问题可以直接按字段汇总，不需要检索。

你的 flat facts 已经有 66%，这说明 Hybrid RRF 在开放性问题上已经不差。你需要加的是一个轻量 Profile 层，不是完整重构：

TypeScript

// 不是替代 flat facts，是在之上加一层聚合索引

interface UserProfile {
  userId: string
  lastUpdated: number
  
  // 从 facts 动态聚合，不单独存储
  dimensions: {
    occupation: ProfileDimension      // "Alice is a senior software engineer"
    preferences: ProfileDimension[]   // ["Alice likes gardening", ...]
    relationships: ProfileDimension[] // ["Alice is married to Bob", ...]
    locations: ProfileDimension[]     // ["Alice lives in Brooklyn", ...]
    timeline: TimelineEntry[]         // 按时间排序的重大事件
  }
}

// open_domain 检索时：
// 1. 先查 Profile（O(1)，直接返回维度数据）
// 2. 再做 hybridSearch 补充细节
// 3. 合并作为上下文
async function openDomainRetrieval(question: string, profile: UserProfile) {
  const relevantDimensions = selectProfileDimensions(question, profile)
  const detailFacts = await hybridSearchFacts(store, { query: question, topK: 5 })
  return mergeProfileAndFacts(relevantDimensions, detailFacts)
}
Profile 的维护策略：不单独调用 LLM 生成 Profile，而是在每次写入 facts 后异步更新受影响的维度。成本接近零。

Phase 4 — 跨会话实体融合（可选，个人项目视精力决定）
这是你的真正差异化点，所有竞品都没有做好的。

text

Fact A (session 1, 2022-03-15): "Caroline attends a support group"
Fact B (session 3, 2022-05-20): "The support group meets every Thursday"
Fact C (session 5, 2022-06-01): "Caroline missed the support group this week"

当前系统：三个孤立 facts，multi_hop 检索需要同时找到 A+B 才能回答
           "When does Caroline's support group meet?"

融合后：Composite Fact:
  "Caroline attends a support group that meets every Thursday"
  sources: [factA.id, factB.id]
  confidence: 0.95
  valid_at: 2022-03-15（最早来源的时间）
  updated_at: 2022-05-20（最新更新时间）
这个功能实现的前提是实体图谱已经有数据（Phase 1 完成后）。

三、分数区间（原阶段目标已作废，勿用于排期）
阶段完成	temporal	multi_hop	single_hop	open_domain	Overall
当前	80.7%	61.5%	78.0%	82.0%	75.2%

- 上表「当前」行的每个百分比都来自 §零 的引用块，即入库产物
  `tests/fixtures/runtime-memory-eval/locomo-full-500-report.json` 的 `metrics.byCategory.<category>.j_score`
  与 `metrics.overall.j_score`（此处按百分比保留一位小数；精确值以 §零 引用块为准）。该行由
  `tests/unit/runtime-memory-baseline-doc-guard.test.ts` 逐格校验。
- 原表其余四行（Phase 1 `51-55%`、Phase 1+2 `56-61%`、Phase 1+2+3 `58-64%`、Phase 全部 `62-67%`，
  以及各分档区间）全部以已作废的 43.0% 为起点推导，**现已作废**，不再作为目标、收益计算或完成判定的依据。
- 本文件不再给出任何阶段目标：现行 0.752 本身还不是可采纳的实测基线（§零.1），在真实 500 题报告入库前定标没有意义。
- 旧文「这些数字用 DeepSeek V4 Pro 做 Judge，不换模型，是真实的系统提升」不成立：本树 frozen judge 的默认模型是
  `deepseek-chat`（§零.2），且 frozen judge 下 `rankingAllowed=false` —— 既不能声称「不换模型可比」，也不能从这批
  数字得出「真实的系统提升」。
- 旧文用「超过 LangMem (58.1%)」「接近 Mem0 (66.88%)」当目标同样撤回：
  `docs/dev/p0-memory-evaluation-integrity.md:12` 规定外部论文值只进 references，整体 `judgeComparable=false` /
  `rankingAllowed=false`，不同 judge、数据或管线下的分数不可直接比较。

四、一个不能省略的前置步骤
在做任何 Phase 1 改动之前，先确认 maxFacts 的生产默认值。

text

maxFacts=20:  存活率 36.4% → Phase 1 所有改动效果全部被 FIFO 吃掉
maxFacts=200: 存活率接近 90% → Phase 1 改动真正生效
maxFacts=1024: 测试条件，最理想
如果生产 maxFacts 过小，重要性驱逐（Phase 1.5）必须在其他所有改动之前完成，否则后面全是无效功。

五、执行顺序总结
text

第 0 天: 确认 maxFacts 生产默认值
          如果 < 200 → 先做重要性驱逐

第 1-3 天: Phase 1.1 + 1.2（valid_at + 相对时间归一化）
            → 改动集中在 AUDN prompt + 写入调用处
            → 完成后立即重跑 temporal 150 题验证提升

第 3-5 天: Phase 1.3（填充实体图谱）+ 1.4（候选可见性）
            → 完成后重跑 multi_hop 96 题

第 5-7 天: Phase 2（检索激活）
            → 完成后重跑完整 500 题，获得新基准分

第 2-3 周: Phase 3（Profile 层）
            → 验证 open_domain 提升

后续视精力: Phase 4（跨会话融合）
每个阶段都有独立的可验证指标，不需要等到全部完成才能看到效果。