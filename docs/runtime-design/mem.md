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
Phase 1 — 接线修复（1 周，预期 temporal 17%→40%，整体 43%→55%）
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
Phase 2 — 检索激活（3-5 天，预期整体 55%→63%）
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
Phase 3 — open_domain 结构化（1 周，预期 open_domain 66%→75%，整体 63%→68%）
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

三、预期分数区间（保守估计）
阶段完成	temporal	multi_hop	single_hop	open_domain	Overall
当前	17.3%	39.6%	52.8%	66.1%	43.0%
Phase 1	38-45%	44-50%	55-60%	67%	51-55%
Phase 1+2	45-52%	50-58%	60-65%	68%	56-61%
Phase 1+2+3	48-54%	52-60%	61-66%	72-76%	58-64%
Phase 全部	52-58%	58-65%	62-67%	74-78%	62-67%
这些数字用 DeepSeek V4 Pro 做 Judge，不换模型，是真实的系统提升。

超过 LangMem (58.1%) 是 Phase 2 完成后的合理目标，接近 Mem0 (66.88%) 是 Phase 3 完成后的乐观目标。

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