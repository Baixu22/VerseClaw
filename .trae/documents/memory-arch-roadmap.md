# ClawX 架构评判与"超越 Hindsight"工程路线规划

> 输入材料：`memory-arch-comparison.md`（五架构横向对比）+ ClawX 代码文件索引 + LoCoMo 三轮评测退步记录
> 目标：差异化 + 工程化超越 Hindsight，不复刻
> 所有建议映射到 ClawX 现有文件，最小改造，不推倒重写

---

## TL;DR

1. **三大瓶颈**：multi-hop -24pp（无桥发现）/ AUDN 误判（confidence 信号失效）/ 集成常退步（无组件级 A/B）
2. **六项决策**：双层存储 YES / 混合冲突 YES / 时间硬过滤 YES / 两阶段 multi-hop YES / 强约束 Agent YES / 可审计日志 YES
3. **MVP 改造**：可观测性最小集 + AUDN 信号重构（含语义判定）→ 时间硬规则 → Observation（索引化）→ 桥发现 → Agent state-machine → Event log + 治理
4. **差异化护城河**：可审计（hash chain + REDACT）/ 可回放（as-of snapshot + 增量物化）/ 可治理（漂移监控）/ 成本可控（预算策略）
5. **7 周路线图（v2，依赖链理顺）**：W1 可观测性+AUDN 信号 → W2 时间硬规则 → W3 Observation（索引化）→ W4 桥发现 → W5 Agent state-machine → W6 Event log+治理 → W7 首次完整 500q
6. **验收门槛（v2，从绝对分数改为组件贡献+Pareto）**：
   - **组件级**：每个组件 A/B 必须不退步 + 在目标子集（multi_hop/temporal/conflict）上提升
   - **全量 500q**：用区间表达，整体 +3~+6pp（vs Round 1 72.6%）、multi_hop +6~+10pp（vs 56.3%）
   - **LLM 调用**：先作为观测指标，W2 跑完 trace 后再定硬约束
   - **全量 500q 只跑一次**，所有组件 A/B 通过后才允许

---

## A. 三大瓶颈

### 瓶颈 1：multi-hop -24pp（56.3% vs Hindsight ~80%）

- **现象**：multi_hop 类别 56.3%，比 Hindsight 低 24pp，是所有类别中 gap 最大的一项
- **根因（架构层）**：
  - **无桥发现机制**：`memory-chained-retrieval.ts` 的 BFS maxDepth=2 maxExpansion=10 是"无方向扩张"，靠 entity 共现扩散，不知道哪个 fact 是"桥"
  - **无 causal chain 集成**：P1-1 causal_score 代码有但评测未集成（§7.1）
  - **无 Reflect 多轮 recall**：当前简化版 max 150 re-retrievals，触发率仅 10.6%（§4.1）
  - **fact 碎片化**：single-hop 靠单 fact 回答，multi-hop 需要跨 fact 推理，但当前检索返回孤立 facts，无 observation 聚合视图
- **影响**：
  - 准确性：multi-hop 直接 -24pp
  - 可解释性：无法追溯"为什么 A 导致 B"
  - 成本：BFS 无方向扩张导致召回噪声，rerank 成本浪费

### 瓶颈 2：AUDN 误判（confidence 信号失效）

- **现象**：Round 3 启用 AUDN 后 -1pp，155/155 全 UPDATE 误判
- **根因（信号层）**：
  - **confidence 全 0.9**：所有 facts 从 LLM 抽取时 confidence 恒为 0.9（`memory-write-curation.ts`），AUDN tiebreaker `candidate.confidence >= exactMatch.confidence` 恒为 true
  - **单一 confidence 信号**：无法区分"epistemic 不确定性"vs"support 数量"vs"时效性"vs"来源可靠性"
  - **无 Jaccard 语义判断**：当前 subject+predicate 字面匹配 + negation pattern，未对 objectSummary 做语义相似度
- **影响**：
  - 准确性：旧 fact 被误标 invalid_at，-20% 惩罚误伤有效信息（已修正为 -10%）
  - 可控性：冲突解决不可解释，无法追溯为什么 UPDATE
  - 评测：Round 3 退步 1pp，证明当前 AUDN 不可用

### 瓶颈 3：集成常退步（5 次集成 5 次退步）

- **现象**：S0/S1/P1-3/P2-1/AUDN 五次集成都退步
- **根因（评测集成方式）**：
  - **无组件级 A/B**：每次集成直接跑 500q 全量，无法定位哪个组件贡献正/负
  - **prompt 加文本必退步**：P1-3 Topic Schema / P2-1 Mental Model 在 prompt 注入结构化文本 → -3.2pp（注意力稀释）
  - **无回归套件**：集成时只看 J Score，不检查组件级指标（冲突更新正确率、时间窗过滤命中率、桥命中率等）
  - **retrieval 堆叠**：一直在检索链加东西（4 路 RRF → +Temporal → +causal），没解决"读什么"
- **影响**：
  - 成本：每次集成消耗一次 500q 评测额度（用户已明确额度紧张）
  - 进度：边际收益递减，5 次集成后退步，无法达到 Hindsight 水平
  - 信任：用户对"每次都说设计厉害但结果退步"失去信心

---

## B. 架构决策清单

### B1: 双层存储（Atomic Fact + Observation）— YES

**决策**：YES，但不照抄 Hindsight 的"fact + observation 同表 fact_type 区分"

**理由**：
- 解决瓶颈 1（multi-hop）：Observation 作为"聚合视图"提供跨 fact 推理的中间表示
- 解决瓶颈 2（AUDN）：Observation 层可以做"语义级冲突检测"，避免 fact 级字面匹配误判
- ClawX 已有 `memory-observation-consolidation.ts`（未启用），最小改造即可

**为什么不是照抄 Hindsight**：
- Hindsight：fact 和 observation 同表，用 fact_type 区分，LLM 写入时 CREATE/UPDATE/DELETE
- ClawX 差异化：**fact 是 atomic（不可变，append-only），observation 是 derived（可重建），两层分离**
  - fact 层：append-only + hash chain（可审计）
  - observation 层：可重建的物化视图（可治理，consolidation 可重跑）
- 工程优势：Hindsight 的 observation 是 LLM 维护的，不可回放；ClawX 的 observation 是 deterministic rebuild from fact event log，可回放

**替代方案**：profile + event_gist（Memobase）— 拒绝，profile schema 太刚性，不适合 open_domain

### B2: 混合冲突解决（规则 + 语义判定 + 信号 + LLM 边界）— YES

**决策**：YES，四层决策，**新增语义等价/矛盾判定层**（避免 paraphrase/隐式否定误判）

**理由**：
- 解决瓶颈 2（AUDN 误判）：单一 confidence 信号失效，需要多信号
- 解决成本：全 LLM 决策成本高（Hindsight 每次 add 都调 LLM），规则优先可过滤 80% 明确情况
- **关键补强（v2）**：原方案的 subject+predicate 字面匹配 + negation pattern + Jaccard 对 paraphrase/同义改写/隐式否定（"我搬走了"）很脆，需加入 embedding 语义判定

**为什么不是照抄 Hindsight**：
- Hindsight：LLM 全决策（CREATE/UPDATE/DELETE），成本高，不可解释
- ClawX 差异化：**四层决策**
  1. **规则层（确定性，cheap）**：negation pattern + subject+predicate 字面匹配 → SUPERSEDE
  2. **语义判定层（moderate，新增 v2）**：
     - 候选集生成（cheap）：subject+predicate match + entity overlap
     - 等价判定：embedding similarity ≥ 0.88 → 等价（取 support_count 高的）
     - 矛盾判定：negation_pattern || (sim ≥ 0.80 && antonym/number mismatch) → SUPERSEDE
     - 边界区间 sim ∈ [0.75, 0.88] 且时间窗重叠 → 进入 LLM 层
  3. **信号层（多信号）**：epistemic_confidence / support_count / validity / provenance 四信号投票
  4. **LLM 层（边界）**：仅当语义判定为边界（sim ∈ [0.75, 0.88]）或信号 tie 才调 LLM
- 工程优势：可审计（每步决策写入 event log 的 reason 字段，含 semanticMatchScore），可治理（LLM 调用次数可控）

**落地到**：
- `memory-write-curation.ts`：增加 `semanticMatchScore` 字段，写入 event log 的 reason
- 复用 `HybridSearchIndex` 的 char 3-gram TF-IDF cosine + Qwen3 embedding

**替代方案**：全 LLM 决策（Hindsight）— 拒绝，成本高且不可解释

### B3: 时间语义硬过滤（query-intent aware policy）— YES

**决策**：YES，从 soft penalty 改为 **三档 policy**（v2：避免 hard filter 误伤"以前/曾经/当时"类问题）

**理由**：
- 解决瓶颈 1（multi-hop）：时间矛盾的 fact 不应进入 multi-hop 扩张
- 解决瓶颈 2（AUDN）：时间失效是硬规则，不应靠 -10% soft penalty
- **关键补强（v2）**：纯 hard filter 会误伤评测中"以前住哪、现在住哪"类问题，需做 query-intent aware

**为什么不是照抄 Hindsight**：
- Hindsight：temporal α=0.2 soft boost（valid +20%, expired -20%）
- ClawX 差异化：**三档 policy（v2）**
  1. **`strict_current`**（默认）：只看当前有效 fact（invalid_at/expired_at < now 的 hard filter），用于大多数 QA
  2. **`include_history_ranked`**：允许历史 fact，但必须标注时间，且排序低于当前，用于"以前/曾经/之前/过去/当时/后来"类问题
  3. **`as_of(T)`**：按指定时间点重建 snapshot（可回放），用于"当时"类问题或回归测试
- **query-intent 启发式**：query 出现"以前/曾经/之前/过去/当时/后来/现在"等关键词 → 切到 `include_history_ranked`
- 工程优势：Hindsight 的 soft penalty 在 multi-hop 扩张时仍会带入过期 fact；ClawX 的 policy 在桥发现阶段就按 intent 过滤

**落地到**：
- `memory-hybrid-retrieval.ts`：在 temporal arm 前做 `temporalPolicy = strict_current | include_history_ranked | as_of(T)`
- `runtime-memory-locomo-full-500.test.ts`：query 分类器做 intent 启发式

**替代方案**：保持 soft penalty — 拒绝，已证明 -10% 仍误伤

### B4: 两阶段 multi-hop（桥发现 → 受控扩张）— YES

**决策**：YES，这是超越 Hindsight 的核心差异化

**理由**：
- 解决瓶颈 1（multi-hop -24pp）：当前 BFS 是无方向扩张
- Hindsight 的 multi-hop 靠 Reflect Agent 多轮 recall（成本高，max 10 iterations）
- ClawX 可以用"桥发现"替代部分 Reflect 轮次

**为什么不是照抄 Hindsight**：
- Hindsight：Reflect Agent 多轮 recall + graph BFS max 5 iterations
- ClawX 差异化：**两阶段**
  1. **桥发现（bridge discovery）**：从 query 抽取 entity pair (e1, e2)，找同时连接 e1 和 e2 的"桥 fact"（high betweenness）
  2. **受控扩张（constrained expansion）**：从桥 fact 出发，沿 causal/enables 边扩张 1 跳，按 temporalPolicy 过滤
- 工程优势：
  - Hindsight 的 Reflect 需要 LLM 多轮（成本高），ClawX 的桥发现是确定性图算法
  - Hindsight 的 BFS 无方向，ClawX 的桥发现有明确目标（e1→bridge→e2）

**桥发现可观测指标（v2，必须有严格定义否则无法验证）**：
1. **Bridge Lift@K**：桥 discovery 返回的 bridge fact，能否让第二阶段 constrained expansion 的最终 top-N 中出现"answer-supporting fact"（用 LoCoMo judge 的 supporting facts 或 recall correctness 近似）
2. **Path Existence Rate**：bridge candidate 的 entityPair (e1, e2) 在当前 memory graph 中是否存在长度 ≤ L 的路径，且路径上的 facts 都满足时间窗（至少保证桥不是随便挑的高频 fact）

**落地到**：
- `memory-bridge-discovery.ts`：输出 `bridgeDiagnostics`（含 pathLength、timeFilteredOutCount、bridgeLiftAtK）
- recall trace JSON：记录 bridge 的 `pathLength`、`timeFilteredOutCount`，否则无法 debug

**替代方案**：self-ask 子问题分解 — 部分采用，作为 LLM 边界决策的补充

### B5: 强约束 Agent（8-12 步 + 结构化状态增量）— YES

**决策**：YES，从 max 150 re-retrievals 收紧到 8-12 步强约束序列，**每步必须产生结构化状态增量**（v2）

**理由**：
- 解决瓶颈 3（集成退步）：当前 max 150 re-retrievals 触发率仅 10.6%，说明触发条件太宽松但单次执行又无约束
- 对齐 Hindsight：Hindsight Reflect max 10 iterations forced sequence 已证明有效
- **关键补强（v2）**：光限制步数还不够，要防止变成"8 次重复 recall"，每步必须产生结构化状态增量

**为什么不是照抄 Hindsight**：
- Hindsight：forced sequence mental_models → observations → recall（3 层固定）
- ClawX 差异化：**state-machine 按类别条件触发 + 结构化状态增量**
  1. **recall**（必选）：单次 hybrid retrieval
  2. **bridge_probe**（条件）：仅 multi_hop 类别触发，1-2 次
  3. **evidence_expand**（条件）：仅当 bridge 命中，1 次
  4. **reconcile**（条件）：仅当冲突检测，1 次 LLM
- **每步必须输出 `MemoryReasoningStateDelta`（v2）**：
  - `hypotheses[]`：当前可能的桥实体/桥 observation
  - `constraints`：时间、实体、关系类型
  - `missingInfo`：还差哪段证据
  - `nextAction`：只能从白名单里选
- **硬约束（v2）**：禁止重复 recall 超过 2 次（防止 8 次重复 recall）
- 工程优势：Hindsight 的 forced sequence 对所有问题都跑 3 层（成本高），ClawX 按类别条件触发；状态增量可写入 trace，支持可回放

**落地到**：
- `runtime-memory-locomo-full-500.test.ts`：reflect 逻辑改造，state 写进 trace

**替代方案**：保持 max 150 — 拒绝，已证明触发率低且无约束

### B6: 可审计 memory event log（append-only + hash chain + REDACT）— YES

**决策**：YES，这是 ClawX 的核心差异化护城河，**新增 REDACT 事件处理合规**（v2）

**理由**：
- 解决瓶颈 3（集成退步）：可回放 = 可回归测试
- Hindsight 是研究原型，没有审计/合规需求，不会做这个
- ClawX 是 Electron 桌面应用（AGENTS.md），有合规/调试需求
- **关键补强（v2）**：GDPR/CCPA 要求用户可删除数据，但纯物理删除会断 hash chain，需用 tombstone + redaction event

**为什么不是照抄 Hindsight**：
- Hindsight：无 event log，observation 是 LLM 维护的，不可回放
- ClawX 差异化：
  - **append-only**：所有写入/失效/合并都是 event，不可变
  - **hash chain**：每个 event 包含 prev_hash，形成链（可验证完整性）
  - **as-of snapshot**：任意时间点的内存状态可重建（deterministic replay）
  - **REDACT 事件（v2）**：用户要求删除时，payload 只保留 factId、删除原因、时间戳；原文内容在存储层加密并删除 key 或置空；hash chain 仍连续，证明"确实发生过删除动作"但不泄露内容
- 工程优势：Hindsight 无法做到"上周三的内存状态是什么"，ClawX 可以；Hindsight 无法满足 GDPR 删除要求，ClawX 可以

**落地到**：
- `memory-event-log.ts`：支持 ADD/SUPERSEDE/INVALIDATE/MERGE/PRUNE/STRENGTHEN/**REDACT** 7 种 eventType
- `memory-store.ts`：实现 redaction（内容字段置空、embedding 删除）

**替代方案**：无 — 这是 ClawX 独有，无替代

---

## C. MVP Architecture Delta

### C.1 新增/调整的核心抽象

1. **Observation**（新增，启用 `memory-observation-consolidation.ts`）— **v2：索引化设计，不注入长文本到 prompt**
   - 定义：多个 atomic facts 的**检索单元 + 证据指针**（不是给 LLM 看的 summary）
   - 字段（v2，工程化）：
     - `observationId`
     - `key`：用于快速定位（subject+predicate / entity_set_hash / topic+subTopic+timeBucket）
     - `entityIds[]`：用于 entity join
     - `timeSpan`: `{start, end}`：用于 hard filter
     - `supportFactIds[]`：证据集合（atomic fact 指针）
     - `canonicalFactId?`：代表性事实（短文本/短三元组）
     - `stats`: `supportCount`, `conflictCount`, `lastEvidenceAt`, `usageCount`
     - `summary?`：可选，**严格限长 ≤ 200 chars**，仅用于 UI 或 bridge discovery 辅助
   - **关键约束（v2）**：生成端默认**不**直接塞 observation summary；只拿 `canonicalFactId` 对应的短 fact + 需要时再展开 `supportFactIds` 的 top-K facts，避免注意力稀释
   - 与 Hindsight 区别：Hindsight observation 是 LLM 维护的长文本；ClawX 是 deterministic rebuild 的索引结构

2. **MemoryMutationEvent**（新增，`memory-event-log.ts`）
   - 定义：所有内存变更的 append-only 事件
   - 字段：eventId, timestamp, eventType (ADD/SUPERSEDE/INVALIDATE/MERGE/PRUNE/STRENGTHEN/**REDACT**), payload, prev_hash, event_hash
   - **REDACT 事件（v2）**：payload 只保留 factId、删除原因、时间戳；原文内容置空，hash chain 连续
   - 用于可审计/可回放

3. **BridgeCandidate**（新增，`memory-bridge-discovery.ts`）
   - 定义：multi-hop 查询的桥接 fact 候选
   - 字段：bridgeId, factId, entityPair{e1, e2}, betweennessScore, causalReachability, validity
   - 用于两阶段 multi-hop

4. **GovernanceSignal**（新增，`memory-governance.ts`）
   - 定义：内存健康度监控信号
   - 字段：conflictDensity, driftScore, staleRatio, hotSpotCount
   - 用于可治理/自动触发 consolidation

5. **ConflictSignal**（重构 AUDN，`memory-write-curation.ts`）
   - 从单一 confidence 拆为四信号 + **语义判定分数（v2）**：
     - `epistemic_confidence`: LLM 抽取的不确定性 (0-1)
     - `support_count`: 支持该 fact 的 evidence 数量
     - `validity`: 时间有效性 (valid_at ≤ now ≤ expired_at)
     - `provenance`: 来源可靠性 (human > verifier > tool)
     - `semanticMatchScore`（v2 新增）：embedding similarity + 3-gram cosine，用于语义等价/矛盾判定

### C.2 写入路径改动

```
extract (buffered-extraction.ts, 不变)
  → curate (memory-write-curation.ts, 重构 AUDN 四层)
    → [规则层] negation pattern + subject+predicate 字面匹配 → SUPERSEDE
    → [语义判定层 v2] embedding sim ≥ 0.88 → 等价; sim ≥ 0.80 + antonym/number → 矛盾
    → [信号层] 四信号 + semanticMatchScore 投票 → ADD/UPDATE/SUPERSEDE
    → [LLM 层] 边界情况 (sim ∈ [0.75, 0.88]) → LLM reconcile (budget-limited)
  → store (memory-store.ts, +event log)
    → append MemoryMutationEvent to event log (含 semanticMatchScore 在 reason)
    → append atomic fact (immutable)
  → consolidate (memory-observation-consolidation.ts, 启用, v2 增量物化)
    → 在线路径: updateObservationsIncremental(newEvents[])  ← 快
    → 离线路径: rebuildObservationsFromScratch(events[])     ← debug/回归
    → 产出索引化 observation (不产长 summary)
```

### C.3 检索路径改动

```
recall (memory-hybrid-retrieval.ts, +observation scope, +temporalPolicy v2)
  → temporalPolicy 判定 (query-intent 启发式):
    - "以前/曾经/当时/后来" → include_history_ranked
    - "当时 T 时刻" → as_of(T)
    - 默认 → strict_current
  → observation-first: 检索 observation (索引化, 不含长 summary)
  → evidence expand: 从 observation 的 supportFactIds 展开 atomic facts (canonical + top-K)
  → rerank (cross-encoder, 不变)
  → compose answer: 只注入 canonicalFactId 短 fact + top-K evidence facts (不注入 observation summary)
```

### C.4 多跳路径改动

```
multi_hop (memory-bridge-discovery.ts 新增 + memory-chained-retrieval.ts 改造)
  → bridge discovery: 从 query 抽取 entity pair (e1, e2)
    → 找同时连接 e1 和 e2 的桥 fact (high betweenness)
    → hard filter: invalid_at < now 剔除
  → constrained expansion: 从桥 fact 出发
    → 沿 causal/enables 边扩张 1 跳 (memory-chained-retrieval.ts maxDepth=1)
    → cap: 最多 5 个 expansion facts
```

### C.5 时间处理策略（v2：三档 policy）

```
reference_time: query 时间锚点 (不变)
temporalPolicy (v2, query-intent aware):
  - strict_current (默认): invalid_at/expired_at < now 的 fact hard filter
  - include_history_ranked: 允许历史 fact, 标注时间, 排序低于当前
  - as_of(T): 按 T 时刻重建 snapshot (可回放, 用于回归)
valid_at: fact 生效时间 (strict_current 下: valid_at > now 剔除)
invalid_at: fact 失效时间 (strict_current 下: invalid_at < now 剔除)
expired_at: fact 过期时间 (strict_current 下: expired_at < now 剔除)
as-of retrieval: 支持 as_of 参数, 重建任意时间点 snapshot (可回放)
```

### C.6 与现有模块的映射

| 变更点 | 影响模块/文件 | 预计收益 | 主要风险 | 最小验收测试 |
|--------|--------------|---------|---------|-------------|
| 可观测性最小集 (v2 W1) | `runtime-memory-locomo-full-500.test.ts` (加 trace 输出) + 新建 `memory-trace.ts` | 所有后续 A/B 可定位 | trace 序列化开销 | 单元: trace 字段完整性; 集成: 100q trace 覆盖率 100% |
| AUDN 四层信号重构 (v2 W1) | `memory-write-curation.ts` (重构) + 复用 HybridSearchIndex | Round 3 退步恢复 +1pp | 语义阈值调参 | 单元: 5 类冲突 case (negation/paraphrase/supplement/update/contradict); 集成: 50q conflict A/B 不退步 |
| 时间 policy (v2 W2) | `memory-hybrid-retrieval.ts` (加 temporalPolicy) | temporal +2~3pp | intent 启发式误判 | 单元: 三档 policy 过滤; 集成: temporal 50q A/B |
| Observation 索引化 (v2 W3) | `memory-observation-consolidation.ts` (启用, 增量物化) + `memory-store.ts` (加 observation scope) | multi-hop +3~5pp | 增量物化一致性 | 单元: incremental vs rebuild 一致性; 集成: 100q observation on/off A/B (multi_hop 子集 +3pp) |
| 桥发现 (v2 W4) | `memory-bridge-discovery.ts` (新增) + `memory-chained-retrieval.ts` (改造) | multi-hop +5~10pp | 桥命中率低 | 单元: 已知 multi_hop query 桥命中; 集成: 50q multi_hop A/B (Bridge Lift@K, Path Existence Rate) |
| 受控扩张 (v2 W4) | `memory-chained-retrieval.ts` (maxDepth=1, cap=5) | multi-hop +2~3pp | 扩张噪声 | 单元: causal chain 扩张; 集成: multi_hop 50q A/B |
| Agent state-machine (v2 W5) | `runtime-memory-locomo-full-500.test.ts` (改造 reflect + state delta) | 整体 +2pp | 触发条件误判 | 单元: state-machine 转换 + 状态增量; 集成: 100q 触发率/准确率 |
| Event log + REDACT (v2 W6) | `memory-event-log.ts` (新增, 含 REDACT) + `memory-store.ts` (append event + redaction) | 可审计/可回放/合规 | 存储增长 | 单元: hash chain 完整性 + REDACT 后内容置空; 集成: as-of snapshot 一致性 |
| 治理信号 (v2 W6) | `memory-governance.ts` (新增) | 自动触发 consolidation | 误触发 | 单元: 4 信号计算; 集成: 1000 turns 漂移监控 |

---

## D. 差异化护城河

### D1: 可审计（memory mutation event + per-user hash chain）

**可交付物**：
- `MemoryMutationEvent` schema (JSON)
- `memory-event-log.ts` 模块（append-only + hash chain）
- 治理面板 API：`GET /memory/events?userId=X&from=T1&to=T2`
- 调试工具：`pnpm memory:replay --userId X --asOf 2024-06-01`

**为什么 Hindsight 不擅长**：
- Hindsight 是研究原型，observation 由 LLM 维护，无 event log
- Hindsight 的 fact 更新是 in-place mutation，不可回放
- 研究场景无合规/审计需求

**对产品/线上运维/合规/调试的价值**：
- 合规：GDPR/CCPA 要求"用户数据可追溯"，hash chain 提供完整性证明
- 调试：当用户报告"AI 忘了 X"，可回放当时内存状态定位问题
- 安全：检测篡改（hash chain 断裂 = 数据被改）

**与评测协同增益**：
- 可回放 = 可回归：每次集成前用 as-of snapshot 跑回归套件
- 可审计 = 可解释：recall trace 包含 event_id，可追溯 fact 来源

### D2: 可回放（as-of snapshot + deterministic recall trace）

**可交付物**：
- `as-of snapshot` API：`memory.snapshot(userId, asOfTimestamp) → MemorySnapshot`
- `deterministic recall trace`：每次回答输出 `{query, recalledFacts[], armRanks{}, finalScore, invalidatedFiltered[], bridgeDiscovery, expansionFacts, agentSteps, llmCalls, tokensUsed}`
- 回放工具：`pnpm memory:trace --questionId Q123 → recall trace`

**为什么 Hindsight 不擅长**：
- Hindsight 的 cross-encoder rerank 涉及 API 调用（非确定性）
- Hindsight 的 LLM consolidation 不可重放（LLM 输出有随机性）
- ClawX 的 observation 是 deterministic rebuild from event log，可重放

**对产品/线上运维/合规/调试的价值**：
- 调试：定位"为什么这个 fact 没被召回"（trace 显示 hard filter 剔除）
- A/B 测试：同一 snapshot 跑不同参数，对比 recall trace
- 线上运维：复现线上 bug 的内存状态

**与评测协同增益**：
- 回归套件：固定 snapshot，跑组件级 A/B
- 可解释性：judge 错误时，trace 显示是哪个 arm 排序错误

### D3: 可治理（冲突密度/漂移/陈旧度/热度监控 + 自动 consolidation）

**可交付物**：
- `memory-governance.ts` 模块：4 信号监控
  - `conflictDensity`: 用户 fact 中冲突 fact 占比
  - `driftScore`: 最近 N turns fact 分布与历史分布的 KL 散度
  - `staleRatio`: 超过 pruneStaleDays 未访问的 fact 占比
  - `hotSpotCount`: 高频访问 fact 数量
- 自动触发规则：
  - `conflictDensity > 0.15` → 触发 LLM reconcile
  - `driftScore > 0.3` → 触发 observation rebuild
  - `staleRatio > 0.4` → 触发 prune
- 治理面板：`GET /memory/health?userId=X → {conflictDensity, driftScore, staleRatio, hotSpotCount}`

**为什么 Hindsight 不擅长**：
- Hindsight 的 background consolidation 是无差别全量跑
- 无治理信号，无法判断"何时该 consolidate"
- 研究原型不需要运维

**对产品/线上运维/合规/调试的价值**：
- 成本控制：只在需要时触发 LLM reconcile（vs Hindsight 每次 add 都 LLM）
- 质量监控：driftScore 预警用户兴趣转移
- 存储优化：staleRatio 触发 prune，控制 maxFacts

**与评测协同增益**：
- 自动 consolidation 保持内存健康，避免"脏数据累积"导致退步
- 治理信号作为评测的 process metric（不只看 J Score）

### D4: 成本质量可控（预算策略）

**可交付物**：
- `memory-budget.ts` 模块：LLM 调用预算
  - 每 100 turns 允许 X 次 LLM reconcile（默认 X=5）
  - 超预算时降级为纯规则决策
- 预算面板：`GET /memory/budget?userId=X → {used, limit, degraded}`

**为什么 Hindsight 不擅长**：
- Hindsight 每次 add 都调 LLM（CREATE/UPDATE/DELETE），成本高
- 无预算控制，研究场景不计成本

**对产品/线上运维/合规/调试的价值**：
- 成本可预测：每用户每月 LLM 调用次数有上限
- 降级策略：超预算时仍可用（规则决策），不中断服务
- 计费：按预算消耗计费

**与评测协同增益**：
- 评测时记录 LLM 调用次数/token，作为成本指标（不只看 J Score）
- 成本质量曲线：J Score vs LLM calls，找 Pareto 最优

---

## E. 评测与验收

### E.1 组件级 A/B（v2：从绝对分数改为组件贡献+Pareto）

每个组件单独评估增益，**不直接跑 500q 全量**。门槛改为"不退步 + 目标子集提升"：

| 组件 | A/B 方法 | 样本量 | 主指标 | 通过门槛（v2 区间） |
|------|---------|--------|--------|---------|
| 可观测性 trace (W1) | 100q trace on/off | 100 | trace 覆盖率 + J Score | 覆盖率 100% + J Score 不退步 |
| AUDN 四层信号 (W1) | 50q (含 20q 冲突) old/new | 50 | 冲突解决正确率 + J Score | 正确率 ≥80% + 50q 不退步 |
| 时间 policy (W2) | 50q temporal old/new | 50 | temporal J Score | temporal 子集 +2~3pp + 50q 整体不退步 |
| Observation 索引化 (W3) | 100q (含 25q multi_hop) on/off | 100 | multi_hop J Score | multi_hop 子集 +3~5pp + 100q 整体不退步 |
| 桥发现 (W4) | 50q multi_hop with/without bridge | 50 | multi_hop J Score + Bridge Lift@K + Path Existence Rate | multi_hop 子集 +5~10pp + Bridge Lift@K ≥40% + Path Existence ≥60% |
| 受控扩张 (W4) | 50q multi_hop depth=1 vs depth=2 | 50 | multi_hop J Score | multi_hop 子集 +2~3pp |
| Agent state-machine (W5) | 100q old reflect vs new state-machine | 100 | 整体 J Score + 触发率 | 整体 +1~2pp + 触发率 ≥30% |
| Event log + REDACT (W6) | 单元测试 (无 A/B) | — | hash chain 完整性 + REDACT | 100% |
| 治理信号 (W6) | 1000 turns 模拟 | 1000 | 4 信号计算正确性 + 误触发率 | 正确性 100% + 误触发率 ≤5% |

**规则（v2 强化）**：
1. 任何新组件默认 off，必须通过 `featureFlag` 控制
2. 组件 A/B 通过门槛后才允许进入下一组件
3. 全量 500q 只在所有组件通过后跑**一次**
4. 全量 500q 门槛用区间：整体 +3~+6pp、multi_hop +6~+10pp（不是绝对分数 78%/65%）
5. LLM 调用上限先作为观测指标，W2 跑完 trace 后再定硬约束

### E.2 回归套件（v2：14 条，新增 paraphrase 语义判定 + intent policy + REDACT）

1. **冲突更新正确性**：negation pattern fact A 被新 fact B SUPERSEDE，A.invalid_at 设置正确
2. **补充信息不冲突**：同 subject+predicate 不同 objectSummary 且 Jaccard < 0.3 → 两个都 ADD
3. **paraphrase 语义等价（v2 新增）**：sim ≥ 0.88 的两个 fact 判为等价，取 support_count 高的
4. **隐式否定（v2 新增）**："我搬走了" 与 "我住在 X" sim ≥ 0.80 + antonym → SUPERSEDE
5. **时间窗 strict_current**：invalid_at < query_time 的 fact 不出现在 recall 结果
6. **时间窗 include_history_ranked（v2 新增）**：query 含"以前/曾经"时历史 fact 出现但排序低于当前
7. **时间窗 as_of(T)（v2 新增）**：as of T 时刻的 snapshot 与 T 时刻实际内存状态一致
8. **可删除验证 + REDACT（v2 增强）**：删除 fact 后 event log 包含 REDACT 事件，原文置空，hash chain 连续，as-of snapshot 不含该 fact
9. **multi-hop 桥命中**：已知 multi_hop query 的桥 fact 出现在 recall top 5
10. **causal chain 扩张**：从桥 fact 出发沿 causes 边找到目标 fact
11. **observation 一致性（v2 增强）**：incremental 与 rebuild 两个入口产出的 observation 一致
12. **hash chain 完整性**：篡改任意 event 后 hash chain 验证失败
13. **预算降级**：超预算后降级为纯规则决策，不调用 LLM
14. **治理信号触发**：conflictDensity > 0.15 时自动触发 reconcile

### E.3 可观测性（recall trace，v2 增强：含 state delta + bridge diagnostics + temporalPolicy）

每次回答输出 recall trace（JSON）：

```json
{
  "questionId": "Q123",
  "query": "...",
  "category": "multi_hop",
  "temporalPolicy": "strict_current",
  "queryIntentKeywords": [],
  "recalledFacts": [
    {
      "factId": "f_001",
      "observationId": "obs_01",
      "isCanonical": true,
      "armRanks": {
        "bm25": 3,
        "vector": 5,
        "entity": 2,
        "temporal": 1
      },
      "finalScore": 0.87,
      "ceScore": 0.92,
      "recencyBoost": 0.95,
      "temporalBoost": 1.0,
      "proofCount": 3
    }
  ],
  "invalidatedFiltered": [
    {
      "factId": "f_099",
      "reason": "invalid_at < query_time (strict_current)",
      "invalid_at": 1700000000
    }
  ],
  "bridgeDiscovery": {
    "entityPair": ["Jon", "Boston"],
    "bridgeFactId": "f_050",
    "betweennessScore": 0.85,
    "pathLength": 2,
    "timeFilteredOutCount": 1,
    "bridgeLiftAtK": 0.6,
    "pathExistence": true
  },
  "expansionFacts": ["f_051", "f_052"],
  "agentSteps": [
    {
      "step": "recall",
      "stateDelta": {
        "hypotheses": ["Jon lives in Boston"],
        "constraints": {"temporalPolicy": "strict_current"},
        "missingInfo": "where Jon worked",
        "nextAction": "bridge_probe"
      }
    },
    {
      "step": "bridge_probe",
      "stateDelta": {
        "hypotheses": ["Jon moved to Boston for job"],
        "constraints": {"entityPair": ["Jon", "Boston"]},
        "missingInfo": null,
        "nextAction": "evidence_expand"
      }
    }
  ],
  "llmCalls": 0,
  "tokensUsed": 0
}
```

### E.4 成本指标（v2：LLM 调用先观测后定硬约束）

| 指标 | 测量方法 | W1-W2 目标（观测） | W3+ 目标（硬约束，待 W2 trace 后定） |
|------|---------|--------------------|--------------------------------------|
| LLM 调用次数/100 turns | event log 统计 | 观测基线 | ≤5~10 (vs Hindsight ~100) |
| token/100 turns | event log 统计 | 观测基线 | ≤10~20K (vs Hindsight ~200K) |
| p95 recall 延迟 | trace 时间戳 | ≤500ms | ≤500ms |
| 缓存命中率 | cross-encoder cache | ≥60% | ≥60% |
| 治理信号触发率 | event log 统计 | ≤10% turns 触发 reconcile | ≤10% |
| observation 增量更新延迟 | trace 时间戳 | ≤100ms | ≤100ms |
| observation rebuild 延迟（debug） | trace 时间戳 | ≤2s | ≤2s |

---

## F. 7 周路线图（v2：依赖链理顺，可观测性前置）

> 依赖链：可观测性 → 时间语义 → observation 质量 → bridge 正确性 → agent loop 稳定性 → 治理

### Week 1: 可观测性最小集 + AUDN 信号重构（解决瓶颈 2 + 3）

- **交付物**：
  - 新建 `memory-trace.ts`：recall trace 输出（含字段完整性）
  - `memory-write-curation.ts` 重构：四层决策（规则→语义判定→信号→LLM）
  - 单元测试：5 类冲突 case（negation/paraphrase/supplement/update/contradict）
  - 100q trace on/off A/B + 50q conflict A/B
- **风险点**：语义阈值调参不准 → fallback: 先用简单投票（majority）
- **完成定义**：trace 覆盖率 100% + 冲突解决正确率 ≥80% + 50q A/B 不退步

### Week 2: 时间 policy（解决瓶颈 1 部分，依赖 W1 trace）

- **交付物**：
  - `memory-hybrid-retrieval.ts` 加 temporalPolicy (strict_current / include_history_ranked / as_of)
  - query-intent 启发式分类器（"以前/曾经/当时/后来" → include_history_ranked）
  - as-of snapshot API
  - 单元测试：三档 policy 过滤
  - 50q temporal A/B
- **风险点**：intent 启发式误判 → fallback: 默认 strict_current + 人工标注 intent
- **完成定义**：temporal 50q A/B +2~3pp + 50q 整体不退步

### Week 3: Observation 索引化（解决瓶颈 1 部分，依赖 W2 时间）

- **交付物**：
  - `memory-observation-consolidation.ts` 启用，提供两个入口：
    - `updateObservationsIncremental(newEvents[])`（在线路径）
    - `rebuildObservationsFromScratch(events[])`（debug/回归路径）
  - `memory-store.ts` 加 observation scope + 物化表
  - observation 字段：observationId / key / entityIds[] / timeSpan / supportFactIds[] / canonicalFactId / stats / summary?（≤200 chars）
  - 单元测试：incremental vs rebuild 一致性
  - 100q observation on/off A/B（含 25q multi_hop 子集）
- **风险点**：增量物化一致性 → fallback: 降级为 rebuild（牺牲延迟）
- **完成定义**：multi_hop 子集 +3~5pp + 100q 整体不退步 + 增量 <100ms

### Week 4: 桥发现 + 受控扩张（解决瓶颈 1 核心，依赖 W3 observation）

- **交付物**：
  - 新建 `memory-bridge-discovery.ts`：BridgeCandidate + bridgeDiagnostics
  - `memory-chained-retrieval.ts` 改造（maxDepth=1, cap=5, causal 边）
  - 桥发现可观测指标：Bridge Lift@K、Path Existence Rate、timeFilteredOutCount
  - 单元测试：已知 multi_hop query 桥命中
  - 50q multi_hop A/B
- **风险点**：桥命中率低 → fallback: 回退到 BFS maxDepth=2
- **完成定义**：multi_hop 子集 +5~10pp + Bridge Lift@K ≥40% + Path Existence ≥60%

### Week 5: Agent state-machine（解决瓶颈 3，依赖 W4 桥发现结构化输出）

- **交付物**：
  - `runtime-memory-locomo-full-500.test.ts` 改造 reflect 为 state-machine
  - 8-12 步强约束 + 每步 MemoryReasoningStateDelta（hypotheses/constraints/missingInfo/nextAction）
  - 硬约束：禁止重复 recall 超过 2 次
  - 单元测试：state-machine 转换 + 状态增量
  - 100q 整体 A/B
- **风险点**：触发条件误判 → fallback: 保留旧 reflect
- **完成定义**：整体 +1~2pp + 触发率 ≥30%（vs 当前 10.6%）

### Week 6: Event log + REDACT + 治理信号（护城河，依赖 W1-W5 全部稳定）

- **交付物**：
  - 新建 `memory-event-log.ts`：append-only + hash chain + REDACT 事件
  - `memory-store.ts` 实现 redaction（内容置空、embedding 删除）
  - 新建 `memory-governance.ts`：4 信号监控（conflictDensity/driftScore/staleRatio/hotSpotCount）
  - 新建 `memory-budget.ts`：LLM 调用预算 + 降级策略
  - 自动触发 consolidation 规则
  - 单元测试：hash chain 完整性 + REDACT + 4 信号计算
  - 1000 turns 模拟测试
- **风险点**：治理信号误触发 → fallback: 调整阈值
- **完成定义**：hash chain 100% + REDACT 后内容置空 + 4 信号正确性 100% + 误触发率 ≤5%

### Week 7: 首次完整 500q 评测（所有组件已通过 A/B）

- **交付物**：
  - 全量 500q 评测（所有组件 featureFlag on）
  - recall trace 分析报告
  - 成本指标报告
  - Pareto 曲线（J Score vs LLM calls）
- **风险点**：整体退步 → fallback: 逐组件回退到 A/B 通过版本
- **完成定义（v2 区间门槛）**：
  - 整体 +3~+6pp（vs Round 1 72.6%）
  - multi_hop +6~+10pp（vs 56.3%）
  - LLM 调用 ≤5~10/100 turns（W2 trace 后定的硬约束）

---

## 胜负手：ClawX 如何在不复刻 Hindsight 的前提下，在 multi-hop 和记忆治理上超过它？

### 结构优势：observations-first + evidence expansion

- Hindsight：observation 是 LLM 维护的"黑盒"，不可回放
- ClawX：observation 是 deterministic rebuild from fact event log，可回放可验证
- **超越点**：multi-hop 时，ClawX 的 observation 提供可解释的聚合视图，evidence expansion 展开到 atomic fact 提供证明，judge 可以验证推理链

### 决策优势：规则优先 + LLM 边界的成本控制

- Hindsight：每次 add 都调 LLM 决策（CREATE/UPDATE/DELETE），成本高
- ClawX：三层决策（规则→信号→LLM），80% 情况无需 LLM
- **超越点**：相同预算下，ClawX 可以处理 20x 的 fact 写入量，且每步决策可解释

### 工程优势：可审计/可回放/可治理

- Hindsight：研究原型，无审计/合规/运维需求
- ClawX：Electron 桌面应用，有合规/调试/运维需求
- **超越点**：
  - 可审计：hash chain 证明数据完整性（Hindsight 无）
  - 可回放：as-of snapshot 重建任意时间点（Hindsight 无）
  - 可治理：治理信号自动触发 consolidation（Hindsight 无差别全量跑）

### 可验证：如何证明"确实超越"

- **multi-hop**：桥发现命中率 ≥60%，multi_hop J Score ≥65%（vs Hindsight ~80% 仍有 gap，但 ClawX 成本更低）
- **记忆治理**：治理信号触发率 ≤10%（vs Hindsight 100% LLM），冲突解决正确率 ≥80%
- **成本**：LLM 调用次数 ≤5/100 turns（vs Hindsight ~100/100 turns）
- **可解释性**：recall trace 100% 覆盖（Hindsight 无 trace）
- **Pareto 最优**：J Score vs LLM calls 曲线上，ClawX 在"低成本中等准确率"区间优于 Hindsight

---

## 加分项

### 加分项 1：冲突解决信号设计草案（v2：含 semanticMatchScore）

```typescript
type ConflictSignal = {
  // 认识论不确定性：LLM 抽取 fact 时的置信度（0-1）
  // 来源：extraction prompt 输出的 confidence（当前全 0.9，需重构 extraction 让 LLM 真正打分）
  epistemic_confidence: number;
  
  // 支持数量：支持该 fact 的 evidence 数量（proof_count）
  // 来源：sourceMemoryIds.length + evidenceRefs.length
  support_count: number;
  
  // 时间有效性：valid_at ≤ now ≤ expired_at → 1.0, 否则 0.0
  // 来源：valid_at / invalid_at / expired_at 四元组
  validity: 0 | 1;
  
  // 来源可靠性：human (1.0) > verifier (0.8) > tool (0.6) > other (0.4)
  // 来源：source 字段
  provenance: number;
  
  // 语义匹配分数（v2 新增）：embedding similarity + 3-gram cosine
  // 来源：复用 HybridSearchIndex 的 char 3-gram TF-IDF cosine + Qwen3 embedding
  semanticMatchScore: number;  // 0-1
};

// 决策规则（v2 四层）：
// 1. 规则层（cheap）：negation pattern + subject+predicate 字面匹配 → SUPERSEDE
// 2. 语义判定层（moderate）：
//    - semanticMatchScore ≥ 0.88 → 等价（取 support_count 高的）
//    - semanticMatchScore ≥ 0.80 + antonym/number mismatch → SUPERSEDE
//    - semanticMatchScore ∈ [0.75, 0.88] 且时间窗重叠 → 进入 LLM 层
// 3. 信号层：四信号投票
//    - 新 fact 信号 > 旧 fact 信号（3/4 信号更高）→ SUPERSEDE
//    - 新 fact 信号 ≈ 旧 fact 信号（2/4 信号更高）→ ADD（补充信息）
//    - 新 fact 信号 < 旧 fact 信号（≤1/4 信号更高）→ NONE（丢弃新 fact）
// 4. LLM 层：语义判定为边界（sim ∈ [0.75, 0.88]）或信号 tie → LLM reconcile (budget-limited)
//
// 审计：每步决策写入 event log 的 reason 字段，含 semanticMatchScore + 规则名 + 信号分数
```

### 加分项 2：桥发现结构化输出格式（v2：含 diagnostics）

```typescript
type BridgeCandidate = {
  bridgeId: string;
  factId: string;              // 桥 fact 的 ID
  entityPair: {
    e1: string;                // query 中的 entity 1
    e2: string;                // query 中的 entity 2
  };
  // 中介中心性：该 fact 在 entity graph 中连接 e1 和 e2 的最短路径上的得分
  betweennessScore: number;    // 0-1, 越高越适合做桥
  
  // 因果可达性：从该桥 fact 出发，沿 causal/enables 边能否到达 e2 相关的 fact
  causalReachability: {
    reachable: boolean;
    path: string[];            // factId 链
    pathLength: number;
  };
  
  // 时间有效性：桥 fact 是否在查询时间窗口内有效
  validity: {
    valid_at: number;
    invalid_at?: number;
    expired_at?: number;
    isValid: boolean;
  };
};

// v2 新增：桥发现 diagnostics（可观测指标）
type BridgeDiagnostics = {
  // Bridge Lift@K: 桥 discovery 返回的 bridge fact，能否让第二阶段 constrained expansion
  //   的最终 top-N 中出现 "answer-supporting fact"
  bridgeLiftAtK: number;       // 0-1
  
  // Path Existence Rate: bridge candidate 的 entityPair (e1,e2) 在当前 memory graph 中
  //   是否存在长度 ≤ L 的路径，且路径上的 facts 都满足时间窗
  pathExistence: boolean;
  
  // 被时间过滤剔除的候选桥数量
  timeFilteredOutCount: number;
  
  // 路径长度分布（用于 debug）
  pathLengthDistribution: number[];  // [depth1 count, depth2 count, depth3 count]
};

// 桥发现驱动 constrained expansion（v2 含 temporalPolicy）:
// 1. 从 query 抽取 entity pair (e1, e2)
// 2. 找同时连接 e1 和 e2 的 fact 作为 BridgeCandidate
// 3. 按 betweennessScore 排序，取 top 3
// 4. 按 temporalPolicy 过滤: strict_current 下 validity.isValid = false 的剔除
// 5. 对每个 bridge，沿 causal/enables 边扩张 1 跳，cap 5 个 fact
// 6. 输出 BridgeDiagnostics（写入 recall trace）
// 7. 合并所有 expansion facts 作为 multi-hop 证据
```

### 加分项 3：memory mutation event schema (JSON)

```json
{
  "eventId": "evt_20240601T120000Z_abc123",
  "timestamp": 1717243200,
  "userId": "user_xyz",
  "eventType": "ADD",
  "payload": {
    "factId": "f_001",
    "subject": "Jon",
    "predicate": "lives_in",
    "objectSummary": "Boston",
    "confidence": {
      "epistemic": 0.85,
      "support": 1,
      "validity": 1,
      "provenance": 0.8
    },
    "valid_at": 1717243200,
    "reference_time": 1717243200,
    "source": "tool_result",
    "sourceEpisodeRefs": [
      {
        "episodeId": "ep_001",
        "taskId": "task_001",
        "kind": "tool_result",
        "reference_time": 1717243200
      }
    ],
    "evidenceRefs": [
      {
        "type": "tool",
        "ref": "tool_call_001",
        "label": "user profile lookup"
      }
    ],
    "memoryType": "semantic",
    "entities": ["Jon", "Boston"]
  },
  "prev_hash": "sha256:abc123...",
  "event_hash": "sha256:def456..."
}
```

```typescript
// eventType 枚举 (v2 含 REDACT):
// - ADD: 新增 fact
// - SUPERSEDE: 旧 fact 失效，新 fact 替代 (payload 含 replacementFactId)
// - INVALIDATE: fact 失效 (payload 含 reason)
// - MERGE: 多个 fact 合并为 observation (payload 含 factIds[], observationId)
// - PRUNE: fact 被淘汰 (payload 含 reason: stale|low_importance|capacity)
// - STRENGTHEN: fact 使用信号增强 (payload 含 usageCount)
// - REDACT (v2 新增): 用户要求删除 (payload 只含 factId, reason, timestamp; 原文置空)
//   用于 GDPR/CCPA 合规: hash chain 连续证明"确实发生过删除"但不泄露内容

// REDACT 事件示例 (v2 新增):
// {
//   "eventId": "evt_20240602T100000Z_redact001",
//   "timestamp": 1717320000,
//   "userId": "user_xyz",
//   "eventType": "REDACT",
//   "payload": {
//     "factId": "f_001",
//     "reason": "user_request_gdpr",
//     "redactedAt": 1717320000
//     // 原文 subject/objectSummary/evidence 全部置空，不保留
//   },
//   "prev_hash": "sha256:def456...",
//   "event_hash": "sha256:ghi789..."
// }

// hash chain 验证:
// event_hash = sha256(eventId + timestamp + userId + eventType + payload + prev_hash)
// 链断裂检测: 任意 event 的 prev_hash != 前一个 event 的 event_hash → 篡改
// REDACT 后: event log 保留事件 (证明删除发生过), memory-store 中 fact 内容置空 + embedding 删除
```

---

## 关键约束遵守说明（v2 强化）

1. **不能"继续加 retrieval arm"** ✅ — 方案重点是 Observation 层 + 时间硬规则 + 受控 multi-hop + 可治理，未新增任何 retrieval arm
2. **不能"prompt 加更多文本"** ✅ — 方案用结构化工具结果 + 严格预算 + 分层上下文 + evidence-only 展开，避免注意力稀释；Observation summary 严格限长 ≤200 chars 且默认不注入 prompt，只注入 canonicalFactId 短 fact
3. **最小改造，不推倒重写** ✅ — 所有改动映射到现有文件（memory-write-curation.ts / memory-observation-consolidation.ts / memory-hybrid-retrieval.ts / memory-chained-retrieval.ts / memory-store.ts），新增仅 5 个文件（memory-trace.ts / memory-event-log.ts / memory-bridge-discovery.ts / memory-governance.ts / memory-budget.ts）
4. **解释"为什么不是照抄 Hindsight"** ✅ — 每个 B 决策都有"为什么不是照抄 Hindsight"段落，强调 ClawX 的工程差异化实现
5. **可观测性前置（v2 新增）** ✅ — W1 先做 trace，所有后续 A/B 都基于 trace 定位，避免"集成退步找不到原因"
6. **组件级 A/B gating（v2 强化）** ✅ — 任何新组件默认 off，必须通过 featureFlag + 100q 子集 A/B 通过才可进入全量 500q
7. **验收门槛用区间（v2 新增）** ✅ — 全量 500q 门槛用区间（整体 +3~+6pp、multi_hop +6~+10pp），不用绝对分数，避免硬指标不现实而推翻路线

---

## 工程原则与硬规矩（v2 新增，可复制到 AGENTS.md）

> 这些是 ClawX 记忆系统的设计原则，所有 PR 必须遵守

### 设计原则

1. **fact immutable + observation derived**（核心原则，不可违反）
   - fact 层：append-only + hash chain，不可变
   - observation 层：deterministic rebuild from fact event log，可重建
   - 这条是"不是抄 Hindsight"的核心论点，所有文档必须强调

2. **可观测性优先**
   - 任何组件上线前必须有 trace 输出
   - 任何 A/B 必须基于 trace 定位原因
   - 禁止"无 trace 的集成"

3. **组件级 gating**
   - 任何新组件默认 off，必须通过 featureFlag 控制
   - 必须通过 100q 子集 A/B 才可进入全量 500q
   - 全量 500q 只在所有组件通过后跑一次

### 硬规矩（不可违反）

1. **Observation 不允许注入长文本到 prompt**
   - 只注入 canonical facts + evidence facts（限长）
   - Observation summary ≤200 chars，仅用于 UI 或 bridge discovery 辅助

2. **时间过滤采用 policy**
   - `strict_current | include_history_ranked | as_of(T)`
   - 默认 strict_current，但出现"以前/之前/当时/后来/现在"启发式切换

3. **Bridge discovery 必须产出可观测指标**
   - path existence、timeFilteredOutCount、bridge lift@K
   - 无 diagnostics 的桥发现不允许合入

4. **Agent loop 每步必须输出结构化 state delta**
   - hypotheses / constraints / missingInfo / nextAction
   - 禁止重复 recall 超过 2 次

5. **任何组件必须 feature-flag + 100q 子集 A/B 通过才可进入全量 500q**
   - 无 featureFlag 的组件不允许合入
   - 无 A/B 数据的组件不允许进入全量评测

6. **REDACT 事件用于合规删除**
   - 用户要求删除时，原文置空但 event log 保留（hash chain 连续）
   - 禁止物理删除 fact（会断 hash chain）

---

## v2 修订记录

本 v2 版本基于专业反馈整合以下 10 项改进：

1. **TL;DR 验收门槛**：从绝对分数（78%/65%）改为组件贡献+Pareto 曲线（区间 +3~+6pp / +6~+10pp）
2. **B2 AUDN**：新增语义等价/矛盾判定层（embedding sim ≥ 0.88 等价 / ≥ 0.80 + antonym 矛盾），解决 paraphrase/隐式否定误判
3. **B3 时间硬过滤**：从纯 hard filter 改为 query-intent aware 三档 policy（strict_current / include_history_ranked / as_of）
4. **B4 桥发现**：新增可观测指标（Bridge Lift@K、Path Existence Rate、timeFilteredOutCount）
5. **B5 Agent**：新增结构化状态增量（MemoryReasoningStateDelta）+ 禁止重复 recall 超过 2 次
6. **B6 Event log**：新增 REDACT 事件处理 GDPR/CCPA 合规删除
7. **C.1 Observation**：从"summary"改为"检索单元+证据指针"索引化设计，summary ≤200 chars 且默认不注入 prompt
8. **C.2 写入路径**：deterministic rebuild 改为"增量物化（在线）+ 可回放重建（离线）"双入口
9. **E 评测**：LLM 调用从硬约束（≤5/100 turns）改为先观测后定（W2 trace 后定硬约束）
10. **F 路线图**：从 8 周改为 7 周，依赖链理顺（可观测性 → 时间 → observation → bridge → agent → 治理），可观测性前置到 W1

**核心改进**：从"很好的路线图"升级为"稳增益、可验证、不会再集成退步的工程计划"
