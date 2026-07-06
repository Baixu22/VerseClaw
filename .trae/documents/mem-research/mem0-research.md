# Mem0 源码扒取设计规范

## 0. 元信息

- 研究对象：`C:\Users\27933\Desktop\mem\mem0-main`
- 输出目标：Mem0 实体链接检索、ADD-only 抽取、评测框架对齐
- 研究时间：2026-07-04
- 只读约束：未修改 Mem0 源码；仅在本仓库生成本文档
- 重要边界：`evaluation/` 是 `mem0ai/memory-benchmarks` 子模块入口但本地目录为空；实际 benchmark 源码已补齐在 `C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks`。可证信息来自 Mem0 仓库 README、AGENTS、docs、SDK 源码与 `memory-benchmarks` 源码。

## 1. 一句话结论

Mem0 v3 的 OSS 核心是“单次 LLM ADD-only 批量抽取 + 向量候选池 + BM25 归一化 + Entity Boost 加性融合 + 可选 reranker”。它不是传统三路 RRF，也不是 add() 内自动 UPDATE/DELETE；旧记忆通过累积、过期时间、外部 delete/update API 和平台侧 temporal/latest 语义处理。

对我们当前系统最高 ROI 的改造顺序：

1. 先把抽取从“单轮单条 + UPDATE/DELETE”改为“buffer 后单次批量 ADD-only”，目标从 `0.3 facts/turn` 拉到接近 `1.5+ facts/turn`。
2. 增加 entity store：SpaCy 抽实体，实体独立 embedding，payload 维护 `linked_memory_ids`，search 时作为第三信号 boost。
3. 在 search 中先扩大候选池，再做 cross-encoder rerank；Mem0 OSS 当前 rerank 只重排最终 top_k，建议我们实现 `retrieve_k > rerank_k`。

## 2. 关键问题速答

### 技术1：实体链接第 3 路 + 重排

| 问题 | 结论 | 证据 |
|---|---|---|
| Mem0 检索几路并行 | OSS 代码实际是 1 路 semantic 候选池 + 1 路 BM25 keyword 分数 + 1 路 entity boost；BM25/entity 不扩充候选集合，只给 semantic 候选加分。文档/README 称 multi-signal 并行。 | `C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1585-1639`，`C:\Users\27933\Desktop\mem\mem0-main\README.md:56-61` |
| RRF 公式/k 值 | OSS `mem0/utils/scoring.py` 没有 RRF；使用加性归一化：`combined = min((semantic + bm25 + entity_boost) / max_possible, 1.0)`。RRF k 不适用。 | `C:\Users\27933\Desktop\mem\mem0-main\mem0\utils\scoring.py:60-139` |
| Entity Match 怎么做 | SpaCy `en_core_web_sm` 抽 `PROPER/QUOTED/TOPIC/IDENTIFIER`；独立 entity collection，entity payload 存 `data/entity_type/linked_memory_ids/user_id...`；query 抽最多 8 个实体，每个 entity search top_k=500，score>=0.5 才 boost。 | `C:\Users\27933\Desktop\mem\mem0-main\mem0\utils\spacy_models.py:21-60`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\utils\entity_extraction.py:731-772`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1038-1142`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1685-1765` |
| reranker 类型 | 可选 provider，默认 config 为 `None`，不是默认启用。支持 Cohere API、Zero Entropy API、LLM scorer、SentenceTransformer CrossEncoder、HuggingFace cross-encoder。 | `C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\base.py:46-49`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\reranker\sentence_transformer_reranker.py:47-106`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\reranker\huggingface_reranker.py:56-161` |
| fact→fact 图边 | OSS search 主要靠 entity→linked_memory_ids 反向索引跨 fact 连接。Prompt 要求 LLM 输出 `linked_memory_ids`，但 OSS v3 add 持久化 record 时只保存 `attributed_to`，没有把 LLM 输出的 `linked_memory_ids` 存入 memory payload；平台 client 文档提到 v3 linked chain。 | `C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\prompts.py:513-516`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:967-991`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\client\main.py:375-382` |

### 技术2：ADD-only + Schema

| 问题 | 结论 | 证据 |
|---|---|---|
| v3 add() 是否 ADD-only | 是，`_add_to_vector_store()` v3 pipeline 只解析 `memory[].text`，hash 去重后 batch insert，并写 history `ADD`；没有 update/delete 分支。系统整体仍有独立 `update()`/`delete()` API。 | `C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:868-930`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:943-1035`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1767-2050` |
| Prompt/Schema | System prompt 是 `ADDITIVE_EXTRACTION_PROMPT`；输出 JSON schema：`{"memory":[{"id":"0","text":"...","attributed_to":"user|assistant","linked_memory_ids":[...]}]}`。 | `C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\prompts.py:464-472`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\prompts.py:918-942` |
| 一次 add 抽几条 fact | 任意多条；LLM 单次调用返回 `memory` 数组，然后 batch embed、batch insert。Prompt 明示 10+ messages 通常应抽 5-15 条。 | `C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:892-914`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:943-1007`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\prompts.py:907-915` |
| facts/turn 实测密度 | unit tests 多为 mock；LoCoMo runner 是一 turn 一次 add，并在 debug 文件里可写出 extracted memories，但源码没有汇总 facts/turn 指标，不能直接得出真实密度。可借鉴的是 prompt 的“全维度、宁可略冗余、10+ messages 5-15 memories”策略。 | `C:\Users\27933\Desktop\mem\mem0-main\tests\memory\test_main.py:51-83`，`C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\run.py:340-350`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\prompts.py:578-595` |
| 过时 fact 如何处理 | OSS add 不删除旧 fact；可用 `expiration_date` 控制 search/get_all 是否隐藏过期记忆，独立 update/delete API 会清理 entity links。平台文档称 ADD-only 保留时间上下文，memory count 增长是设计。 | `C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:745-746`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1621-1623`，`C:\Users\27933\Desktop\mem\mem0-main\docs\migration\platform-v2-to-v3.mdx:277-279` |

### 评测对齐

| 问题 | 结论 |
|---|---|
| LoCoMo 采样策略 | `locomo10.json`，10 个 conversation；默认 conversations `0..9`、categories `1,2,3,4`，排除 adversarial category 5；每个 turn 作为 1 个 ingestion chunk；top_k 默认 200，cutoffs 默认 `10,20,50,200`。 |
| Judge prompt | 有统一 binary judge prompt，不分 category 特化；输出 JSON：`reasoning` + `label=CORRECT|WRONG`。规则明显比 frozen-v1 更宽松：任一正确 item 即 CORRECT，日期 14 天容忍，证据只用于放宽接受。 |
| 多 judge 投票 | 未发现多 judge 投票；每个 cutoff 调一次 `generate_structured()`，`label == CORRECT` 即 1.0，否则 0.0。 |
| 生成模型/温度 | `run.py` 当前 CLI 默认 answerer/judge 都是 `gpt-5`；README 仍写 common flags 默认 `gpt-4o`，以源码为准。`LLMClient.generate()` 与 `generate_structured()` 默认 temperature=0；但 gpt-5/o-series 会省略 temperature 参数。 |

## 3. 技术1 设计规范：Entity Link + Hybrid Search + Rerank

### 3.1 推荐目标架构

```text
query
  -> lemmatize_for_bm25(query)
  -> extract_entities(query)                      # max 8
  -> embed(query)
  -> vector.search(top_k=max(k*4, 60))             # 候选池
  -> keyword_search(BM25, same top_k)              # 分数表
  -> entity_store.search(each entity, top_k=500)   # memory_id boost 表
  -> score_and_rank
  -> optional cross_encoder_rerank(retrieve_k -> final_k)
```

Mem0 OSS 的 `_search_vector_store()` 关键片段：

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1585
query_lemmatized = lemmatize_for_bm25(query)
query_entities = extract_entities(query)
embeddings = self.embedding_model.embed(query, "search")
internal_limit = max(limit * 4, 60)
semantic_results = self.vector_store.search(query=query, vectors=embeddings, top_k=internal_limit, filters=filters)
keyword_results = self.vector_store.keyword_search(query=query_lemmatized, top_k=internal_limit, filters=filters)
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1631
scored_results = score_and_rank(
    semantic_results=candidates,
    bm25_scores=bm25_scores,
    entity_boosts=entity_boosts,
    threshold=threshold,
    top_k=limit,
    explain=explain,
)
```

### 3.2 融合公式

Mem0 OSS 不使用 RRF；用 normalized additive scoring。

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\utils\scoring.py:57
ENTITY_BOOST_WEIGHT = 0.5
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\utils\scoring.py:94
max_possible = 1.0
if has_bm25:
    max_possible += 1.0
if has_entity:
    max_possible += ENTITY_BOOST_WEIGHT
...
raw_combined = semantic_score + bm25_score + entity_boost
combined = min(raw_combined / max_possible, 1.0)
```

BM25 原始分使用 query-length adaptive sigmoid：

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\utils\scoring.py:31
if num_terms <= 3:
    return 5.0, 0.7
elif num_terms <= 6:
    return 7.0, 0.6
...
return 1.0 / (1.0 + math.exp(-steepness * (raw_score - midpoint)))
```

### 3.3 Entity Store 规范

写入侧：

- 每条新 memory 先抽实体，跨 batch 全局去重。
- 每个实体独立 embedding。
- entity collection 名称由主 collection 派生，例如 Qdrant `mem0_entities`。
- entity payload 字段：`data`、`entity_type`、`linked_memory_ids`、scope filters。
- exact match 优先，semantic match 阈值 `>=0.95` 复用旧 entity，否则插入新 entity。

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1038
all_texts = [r[1] for r in records]
all_entities = extract_entities_batch(all_texts)
global_entities = {}
...
entity_embeddings = self.embedding_model.embed_batch(entity_texts, "add")
existing_matches = self.entity_store.search_batch(..., top_k=1, filters=search_filters)
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1124
to_insert_payloads.append({
    "data": entity_text,
    "entity_type": entity_type,
    "linked_memory_ids": sorted(memory_ids),
    **search_filters,
})
```

检索侧：

- query entity 最多取前 8 个，先 normalize/dedup。
- 每个实体搜索 entity_store `top_k=500`。
- 只接收 similarity `>=0.5`。
- boost = `similarity * 0.5 * memory_count_weight`。
- `memory_count_weight = 1 / (1 + 0.001 * (num_linked - 1)^2)`，避免超大泛实体压倒排序。

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1699
for entity_type, entity_text in query_entities[:8]:
...
return entity_store.search(query=entity_text, vectors=embedding, top_k=500, filters=search_filters)
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1743
for match in matches:
    similarity = match.score if hasattr(match, 'score') else 0.0
    if similarity < 0.5:
        continue
    linked_memory_ids = payload.get("linked_memory_ids", [])
    num_linked = max(len(linked_memory_ids), 1)
    memory_count_weight = 1.0 / (1.0 + 0.001 * ((num_linked - 1) ** 2))
    boost = similarity * ENTITY_BOOST_WEIGHT * memory_count_weight
```

### 3.4 SpaCy 抽取规范

Mem0 使用 `en_core_web_sm`，缺失时尝试下载；失败则 entity extraction 返回空数组。

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\utils\spacy_models.py:30
if not spacy.util.is_package("en_core_web_sm"):
    from spacy.cli import download
    download("en_core_web_sm")
...
_nlp_full = spacy.load("en_core_web_sm")
```

实体类型：

- `PROPER`：SpaCy NER 安全标签、proper-name span
- `QUOTED`：单双引号里的标题/术语
- `TOPIC`：名词短语/compound noun phrase
- `IDENTIFIER`：技术标识符，如 `person.properties.email`

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\utils\entity_extraction.py:731
tokens = list(doc)
candidates = []
_add_ner_candidates(doc, candidates)
_add_technical_identifier_candidates(tokens, candidates)
_add_proper_name_candidates(tokens, candidates)
_add_quoted_candidates(doc.text, candidates)
_add_topic_phrase_candidates(doc, candidates)
return _resolve_candidates(candidates)
```

不可直接照抄点：

- 当前实现主要英文；中文/日文/俄文实体抽取需替换为多语 NER 或 LLM/规则混合。
- `en_core_web_sm` 自动下载不适合离线/企业环境，应改为启动检查或可选依赖提示。
- TOPIC 抽取规则较长，迁移时先实现 PROPER/QUOTED/IDENTIFIER，TOPIC 作为二期。

### 3.5 Reranker 规范

Mem0 初始化时只有配置了 `config.reranker` 才创建 reranker，search 时也必须传 `rerank=True`。

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:462
self.reranker = None
if config.reranker:
    self.reranker = RerankerFactory.create(config.reranker.provider, config.reranker.config)
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:1451
if rerank and self.reranker and original_memories:
    reranked_memories = self.reranker.rerank(query, original_memories, limit)
```

Cross-encoder choices：

- SentenceTransformer：默认 `cross-encoder/ms-marco-MiniLM-L-6-v2`，本地 `CrossEncoder.predict()`。
- HuggingFace：默认 `BAAI/bge-reranker-base`，`AutoModelForSequenceClassification` logits，经 sigmoid 归一化。

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\rerankers\sentence_transformer.py:13
model: Optional[str] = Field(default="cross-encoder/ms-marco-MiniLM-L-6-v2", ...)
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\rerankers\huggingface.py:13
model: Optional[str] = Field(default="BAAI/bge-reranker-base", ...)
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\reranker\huggingface_reranker.py:63
return (1.0 / (1.0 + np.exp(-arr))).tolist()
```

对我们系统的建议：

- 不照抄 Mem0 的“先截到 top_k 再 rerank”；我们应引入 `retrieve_k=50/100` 与 `final_k=5/10`。
- 推荐首选 cross-encoder，而不是 LLM reranker，降低成本并减少 judge_error 干扰。
- LLM reranker 可保留为 debug/低吞吐 fallback。

## 4. 技术2 设计规范：Schema Buffer + Flush + ADD-only

### 4.1 Mem0 v3 add 管线

```text
messages
  -> save rolling last_messages window
  -> vector search existing top10 for dedup/link context
  -> one LLM call with ADDITIVE_EXTRACTION_PROMPT
  -> parse {"memory": [...]}
  -> batch embed memory texts
  -> hash dedup against existing + current batch
  -> batch insert vector store
  -> batch history ADD
  -> batch entity linking
  -> save source messages
```

关键代码：

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:868
# === V3 PHASED BATCH PIPELINE ===
last_messages = self.db.get_last_messages(session_scope, limit=10)
parsed_messages = parse_messages(messages)
existing_results = self.vector_store.search(..., top_k=10, filters=search_filters)
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:900
user_prompt = generate_additive_extraction_prompt(
    existing_memories=existing_memories,
    new_messages=parsed_messages,
    last_k_messages=last_messages,
    custom_instructions=custom_instr,
)
response = self.llm.generate_response(..., response_format={"type": "json_object"})
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\memory\main.py:997
self.vector_store.insert(vectors=all_vectors, ids=all_ids, payloads=all_payloads)
...
"event": "ADD"
self.db.batch_add_history(history_records)
```

### 4.2 Prompt 策略

核心策略：

- Sole operation is ADD。
- 从 New Messages 提取，不从 Existing Memories 衍生新事实。
- 当事实近似重复时跳过。
- 变化/替代关系不 UPDATE 旧事实，而是写成自包含新事实。
- “When in doubt, extract”，宁可略冗余，不丢事实。
- 10+ messages 通常抽 5-15 memories。
- 输出严格 JSON。

```text
C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\prompts.py:472
Your sole operation is ADD: identify every piece of memorable information and produce self-contained, contextually rich factual statements.
```

```text
C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\prompts.py:578
When in doubt, extract. A slightly redundant memory is far less costly than a missing one.
```

```json
// C:\Users\27933\Desktop\mem\mem0-main\mem0\configs\prompts.py:924
{
  "memory": [
    {"id": "0", "text": "First extracted memory", "attributed_to": "user", "linked_memory_ids": ["uuid-of-related-existing-memory"]},
    {"id": "1", "text": "Second extracted memory", "attributed_to": "assistant"}
  ]
}
```

### 4.3 对我们系统的迁移规格

输入 buffer：

- 以 conversation turn 或短时间窗口聚合，建议 flush 粒度 4-12 messages 或对话结束。
- 保留最近 10 条 source messages 作为 pronoun/context resolver。
- 每次 flush 查询现有 memory top10，仅用于 dedup/link，不允许从旧 memory 生成新 fact。

输出 schema：

```json
{
  "memory": [
    {
      "id": "0",
      "text": "自包含事实，15-80 words 或等价中文长度",
      "attributed_to": "user|assistant|speaker:<name>",
      "source_message_ids": ["..."],
      "linked_memory_ids": ["..."],
      "entities": [{"type": "PROPER", "text": "..."}],
      "confidence": 0.0
    }
  ]
}
```

落地原则：

- add() 内禁止 UPDATE/DELETE 分支。
- 相同 hash 去重；近似重复依赖 existing context prompt 和后处理相似度。
- 旧事实过时不删：靠新 fact 表达变化，例如“用户从 almond milk 改为 oat milk”。
- 用户主动删除、隐私删除、TTL/expiration 是独立生命周期 API，不属于抽取策略。

## 5. 评测对齐规范

### 5.1 本地可证事实

- `evaluation/` 仍是空子模块入口：`C:\Users\27933\Desktop\mem\mem0-main\.gitmodules:1-4`；实际可读 benchmark 源码在 `C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks`。
- Mem0 主 README 标称新算法 LoCoMo `71.4 -> 91.6`，tokens 7.0K，p50 0.88s：`C:\Users\27933\Desktop\mem\mem0-main\README.md:45-54`。
- `memory-benchmarks` README 对 LoCoMo 的开源结果写成 Top 200 `92.5% (1425/1540)`、Top 50 `91.8% (1414/1540)`：`C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\README.md:179-184`。这里的 `1540` 对应 categories 1-4 全量问题数，不是“约 300 questions”的 README 摘要值。
- pipeline 是 `Ingest -> Search -> Evaluate`；search 分数由 semantic similarity + BM25 + entity boost 组成：`C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\README.md:91-99`。
- common flags 文档写 answerer/judge 默认 `gpt-4o`，top_k=200，cutoffs=`10,20,50,200`：`C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\README.md:107-119`；但 `locomo/run.py` 源码当前默认 answerer/judge 是 `gpt-5`：`C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\run.py:681-688`。

### 5.2 LoCoMo 采样与执行流程

数据集固定为 Snap LOCOMO-10：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\run.py:85
DATASET_URL = "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json"
DEFAULT_DATASET_FILE = "locomo10.json"
CHUNK_SIZE = 1  # turns per ingestion chunk
```

`download_dataset()` 会校验必须是 10 个 conversations：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\run.py:107
data = json.load(f)
if not isinstance(data, list) or len(data) != 10:
    os.remove(path)
    raise RuntimeError(f"Invalid dataset: expected 10 conversations, got {len(data)}")
```

每条 conversation turn 会被映射成单条 Mem0 message；speaker_a 是 `user`，另一个 speaker 是 `assistant`，但 content 保留真实 speaker 名称。`CHUNK_SIZE=1` 表示 benchmark 不是多 turn buffer ingest，而是一 turn 一次 `add()`：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\run.py:165
role = "user" if speaker == speaker_a else "assistant"
messages.append({"role": role, "content": f"{speaker}: {text}"})
...
for i in range(0, len(messages), CHUNK_SIZE):
    chunk = messages[i : i + CHUNK_SIZE]
```

ingest 时把 session date 转为 epoch timestamp 传给 Mem0，保证时间推理与记忆创建时间对齐：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\run.py:307
session_epoch = locomo_date_to_epoch(date_str)
...
response = await mem0.add(messages, user_id, timestamp=session_epoch)
```

问题范围默认是 conversations `0..9`、categories `1,2,3,4`，category 5 adversarial 被排除：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\prompts.py:10
1 = multi-hop (282 questions)
2 = temporal reasoning (321 questions)
3 = open-domain (96 questions)
4 = single-hop (841 questions)
5 = adversarial (446 questions) — excluded from scoring
```

### 5.3 Search、Answer、Judge 产物规范

每题先调用 Mem0 search，一次拉 `top_k` 个结果；默认 `top_k=200`。候选被统一格式化后，对每个 cutoff 分别生成答案和 judge：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\run.py:417
search_results = await mem0.search(question, user_id, top_k=top_k, score_debug=score_debug)
formatted, query_debug = format_search_results(search_results)
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\run.py:460
for c in cutoffs:
    sliced = formatted[:c]
    gen_prompt = get_answer_generation_prompt(question, sliced, reference_date=reference_date_human, user_profile=user_profile)
    generated_answer = await answerer.generate(system="", user=gen_prompt)
```

Mem0 benchmark client 对 OSS 的 search payload 是 `/search` + `limit=top_k`，Cloud 是 `/v3/memories/search/` + `top_k`，两者都支持可选 rerank；格式化结果保留 `memory/score/id/created_at/updated_at/score_debug`：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\common\mem0_client.py:255
payload = {
    "query": query,
    "user_id": user_id,
    "limit": top_k,
}
if rerank:
    payload["rerank"] = True
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\common\mem0_client.py:448
sorted_results = sorted(search_results, key=lambda x: x.get("score", 0), reverse=True)
entry = {
    "memory": r.get("memory", ""),
    "score": r.get("score", 0),
    "id": r.get("id", ""),
}
```

### 5.4 Judge prompt 与 frozen-v1 差异

Mem0 LoCoMo judge 是统一 binary prompt，system 要求只返回 JSON：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\prompts.py:203
JUDGE_SYSTEM_PROMPT = "You are evaluating conversational AI memory recall. Return JSON only with the format requested."
```

关键规则比常见 frozen judge 更宽：任一正确 item 即 CORRECT、同义改写算正确、额外细节不扣分、日期有 14 天容忍、同一 referent 可接受：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\prompts.py:222
1. **PARTIAL CREDIT**: If the generated answer includes AT LEAST ONE correct item from the gold answer's list, mark CORRECT.
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\prompts.py:228
4. **DATE TOLERANCE**: Dates within 14 days of each other are CORRECT. Durations within 50% are CORRECT ...
```

带 evidence 模式会注入原始证据，并明确“只用于接受，不用于更严格拒绝”：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\prompts.py:211
5. **EVIDENCE SUPPORTS ANSWER**: If the evidence corroborates the generated answer, mark CORRECT ...
Use evidence only to ACCEPT answers, never to reject them more strictly.
```

最终只看结构化输出的 `label`，没有多 judge 投票：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\run.py:476
raw = await judge_llm.generate_structured(
    system=JUDGE_SYSTEM_PROMPT,
    user=judge_prompt,
)
label_val = raw.get("label", "").upper()
correct = label_val == "CORRECT"
score = 1.0 if correct else 0.0
```

### 5.5 模型、温度与可复现性

`LLMClient` 自身默认 model 是 `gpt-4o`，但 LoCoMo runner 传入 CLI 默认 `gpt-5`。结论：评测报告必须记录实际 CLI 参数，不能只信 README 默认值。

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\common\llm_client.py:48
model: str = "gpt-4o",
provider: str = "openai",
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\locomo\run.py:682
parser.add_argument("--answerer-model", default="gpt-5", help="Model for answer generation")
parser.add_argument("--judge-model", default="gpt-5", help="Model for judging")
```

answer 与 judge 默认 temperature 都是 0；但 gpt-5/o-series 会省略 temperature 参数，让 API 使用模型默认温度：

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\common\llm_client.py:78
if m.startswith(("gpt-5", "o1", "o3", "o4")):
    return {}
return {"temperature": temperature}
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\common\llm_client.py:136
async def generate(..., temperature: float = 0, max_tokens: int = 4096)
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\common\llm_client.py:225
async def generate_structured(..., temperature: float = 0, max_tokens: int = 4096)
```

ingestion 服务默认配置是 OpenAI `gpt-4o-mini` + temperature `0.1` + `text-embedding-3-small`，这会影响抽取密度与检索质量：

```yaml
# C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\configs\openai.yaml:7
llm:
  provider: openai
  config:
    model: gpt-4o-mini
    temperature: 0.1
embedder:
  provider: openai
  config:
    model: text-embedding-3-small
```

### 5.6 对 frozen-v1 judge 的修复建议

1. 引入 `predict-only` 与 `evaluate-only` 分段产物，先固定检索结果，再单独比较 judge 差异。
2. 评测结果 JSON 必须保存 `answerer_model/judge_model/provider/top_k/top_k_cutoffs`，并保留每题 `retrieval.search_results`、`cutoff_results.generated_answer`、`judgment/reason`。Mem0 schema 明确这些字段：`C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\common\schema.py:54-64`、`C:\Users\27933\Desktop\mem\mem0-main\memory-benchmarks\benchmarks\common\schema.py:111-124`。
3. 将 frozen-v1 judge 改成 Mem0 风格的宽松二分类，至少补齐 partial credit、paraphrase、extra detail、date tolerance、same referent、evidence-only-accept 规则。否则 20% judge_error 很可能把“答对但不完全匹配”的样本误判为错。
4. 对关键报告分数保留单 judge baseline，同时增加双 judge/抽样人工仲裁列；Mem0 源码未做多 judge，所以多 judge 是我们的稳健性增强，不是 Mem0 原样复刻。
5. 固定 answerer/judge 的实际模型、provider、temperature 行为；若使用 gpt-5/o-series，要在报告里标注 temperature 参数被省略，而不是写成严格 temp=0。

## 6. 不可直接借鉴点

- Platform 分数不等于 OSS 分数：docs 明说 managed platform 包含 proprietary optimizations，OSS 用户只能期待方向性收益。证据：`C:\Users\27933\Desktop\mem\mem0-main\docs\core-concepts\memory-evaluation.mdx:136-138`。
- Temporal Reasoning 在 docs/README 中是新算法关键，但本次重点源码路径的 OSS `main.py` 未见完整 temporal scoring 实现；不能把 91.6 全归因于 entity + ADD-only。
- Mem0 默认 LLM/embedding 依赖 OpenAI：README 写 LLM 默认 `gpt-5-mini`，embedding 默认 `text-embedding-3-small`。证据：`C:\Users\27933\Desktop\mem\mem0-main\README.md:196-198`。
- Qdrant BM25 依赖 fastembed `SparseTextEmbedding(model_name="Qdrant/bm25")`，不是所有向量库可用；旧 collection 没有 `bm25` sparse slot 会关闭 BM25。证据：`C:\Users\27933\Desktop\mem\mem0-main\mem0\vector_stores\qdrant.py:93-109`，`C:\Users\27933\Desktop\mem\mem0-main\mem0\vector_stores\qdrant.py:143-150`。
- English SpaCy 抽实体不适合多语生产，需要替换或补充。
- Mem0 OSS rerank 位置偏晚，只重排 `limit` 条结果；我们应重排更大的候选池。

## 7. DeepSeek 对比

Mem0 DeepSeek provider 使用 OpenAI 兼容 SDK，而不是 undici 直连：

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\llms\deepseek.py:36
if not self.config.model:
    self.config.model = "deepseek-chat"
api_key = self.config.api_key or os.getenv("DEEPSEEK_API_KEY")
base_url = self.config.deepseek_base_url or os.getenv("DEEPSEEK_API_BASE") or "https://api.deepseek.com"
self.client = OpenAI(api_key=api_key, base_url=base_url)
```

```python
# C:\Users\27933\Desktop\mem\mem0-main\mem0\llms\deepseek.py:94
params = self._get_supported_params(messages=messages, **kwargs)
params.update({"model": self.config.model, "messages": messages})
if response_format:
    params["response_format"] = response_format
response = self.client.chat.completions.create(**params)
```

对我们系统：可继续保留 undici 直连，但应补齐 Mem0 的 `response_format={"type":"json_object"}` 等强 schema 能力、tool call JSON 解析和 provider fallback。

## 8. 我们系统落地差距表

| 维度 | 当前系统 | Mem0 可证做法 | 建议目标 |
|---|---|---|---|
| 检索 | BM25 + Vector RRF，2 路 | Semantic 候选 + normalized BM25 + entity boost，加性融合 | 保留 RRF 可选，但增加 entity boost；或切到可解释加性融合 |
| 候选池 | top5/小池 | internal_limit=max(top_k*4,60) | retrieve_k>=50，再 final top5 |
| 实体 | 无 | SpaCy entity store，payload `linked_memory_ids` | 多语 entity extractor + entity vector store |
| 重排 | 无 | 可选 CE/LLM/API reranker | cross-encoder 默认开启于高质量模式 |
| 抽取 | 单轮单条，0.3 facts/turn | 单次 LLM 返回多条 memory | buffer+flush，目标 1.5+ facts/turn |
| 变更处理 | UPDATE/DELETE | add() ADD-only，update/delete 独立 API | add-only 默认，显式生命周期 API |
| Judge | frozen-v1，20% error | predict/evaluate 分离，单结构化 judge，宽松 CORRECT/WRONG prompt | 先复刻宽松 judge，再加双 judge/人工抽样稳健性列 |

## 9. 最高 ROI 实施切片

### Slice A：ADD-only 批量抽取

验收：

- 单次 flush 返回 `memory[]`，允许 0-N 条。
- add path 不出现 UPDATE/DELETE action。
- 每条 memory 写 hash、created_at、updated_at、source ids。
- 对 100 个真实 turn 统计 facts/turn，目标先到 1.0，再到 1.5。

### Slice B：Entity Boost

验收：

- `entity_store` 支持 `data/entity_type/linked_memory_ids/scope`。
- 写入时抽实体并 batch upsert。
- search 时 query entities top8，每个 top500，阈值 0.5。
- explain 输出 `semantic_score/bm25_score/entity_boost/final_score`。
- Recall@5 对实体型问题单独提升。

### Slice C：Cross-encoder Rerank

验收：

- retrieve_k 与 final_k 分离。
- 默认候选：BM25+Vector+Entity 融合 top50。
- reranker：`BAAI/bge-reranker-base` 或轻量 MiniLM cross-encoder。
- 记录 rerank_score，并保留 pre-rerank score 用于 debug。

## 10. 未决问题

- 需要确认 Mem0 Platform 的 temporal reasoning 与 `linked_memory_ids` chain 是否有未开源服务端实现；OSS 本地证据不足以复刻 91.6 全量算法。
- 需要为中文/日文/俄文实体抽取选择替代模型或 LLM fallback。
