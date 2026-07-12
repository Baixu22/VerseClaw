# DCS-v1.2 · 第三轮审阅意见响应与规范修订

**响应对象**：DCS-v1.1 二次审阅意见（2026-07-10）
**修订原则**：接受全部 5 条意见，2 条致命问题优先修订，不争辩，直接给出修正后的条款

---

## 意见响应矩阵

| # | 严重度 | 接受/驳回 | 处理方式 |
|---|--------|----------|---------|
| A HandoffPack 走 extra 字符串 | 致命 | ✅ 接受 | HandoffPack 写入 BlockStore；`extraSystemPrompt` 只保留读取提示 |
| B session_id 正则漏掉多段 key | 致命 | ✅ 接受 | 废弃正则，复用 `session-key-utils.ts` 谓词 |
| C SSP compression_depth 推理错误 | 中等 | ✅ 接受 | task_state 的 `compression_depth = 0`，按结构化提取处理 |
| D contextBlockSink 异步时机未定义 | 次要 | ✅ 接受 | 明确同步与异步 Block 的可见时机 |
| E notes 写入后不可见 | 次要 | ✅ 接受 | 在 working_memory 滚动窗口追加 notes 通知 |

---

# ClawX Working Context × Memory 统一设计约束规范
**DCS-v1.2 · Agent 执行版**
*相较 v1.1 的修订以 `【修订-v1.2】` 标注*

---

## 第一章：术语定义

（第一章内容与 v1.0 相同，以下仅展示有变化的部分）

### ContextBlock（新增 `notes` BlockType）【修订-#8】

```typescript
type BlockType =
  | 'persona'
  | 'task_state'
  | 'working_memory'
  | 'tool_registry'
  | 'knowledge'
  | 'experience'
  | 'environment'
  | 'notes'          // 【新增】agent 自主写入的笔记，agent_writable
```

### HookBus 废弃声明【修订-#2】

**`[MUST NOT]`** 不新建独立的 `hook-bus.ts`。

现有三套 hook 机制保持原职责，不做整合：

| 现有机制 | 职责 | 不变 |
|---------|------|------|
| `openclaw_runtime/src/hooks/` | plugin 生命周期 | 保持 |
| `agents/harness/hook-*` | agent harness 生命周期 | 扩展（见第三章） |
| `plugins/hooks/` | plugin runtime hook | 保持 |

**替代方案**：在 `agents/harness/hook-context.ts` 的 `HookContext` 类型中增加 `contextBlockSink` 字段。现有 hook handler 可选择产出 `ContextBlock[]`，由 `lifecycle.ts` 的调度点统一收集并写入 BlockStore。

```typescript
// 扩展现有 HookContext，不新建总线
// 位置：agents/harness/hook-context.ts（修改现有文件）
interface HookContext {
  // ...现有字段保持不变...

  // 【新增】Block 产出收集器
  // handler 可选择性地向此 sink 产出 ContextBlock[]
  // lifecycle.ts 在 hook 调度完成后统一写入 BlockStore
  contextBlockSink?: (blocks: ContextBlock[]) => void
}
```

**task_phase_change 事件**：这是 v1.0 正确识别的缺失点，需要新增到现有 `agents/harness/` 的 hook 事件类型中，不通过新总线。

---

## 第二章：核心约束（不可违反项）

### 【新增】[P0] Block 准入门槛【修订-#1】

**`[MUST]`** 每个 BlockType 有明确的准入条件。不满足条件的信息不允许写入 BlockStore，写入操作必须静默丢弃并记录 observability 计数器（不报错，不阻塞）。

**working_memory Block 准入条件**：

```
significance='high'   → 写入滚动窗口 + 触发 COMPASS 写入（阶段 4 完成后）
significance='medium' → 写入滚动窗口，不触发 COMPASS
significance='low'    → 只写入 observability trace，不进入 Block
```

滚动窗口满 5 条时，significance='medium' 的条目优先被挤出（保留 high）。

**experience Block 准入条件**：

```
SEKB distillation-tool 的产出分两类：
  - suggest_principles_from_trajectories（advisory）→ 不直接写 Block
  - confirm_and_save 确认后的 principle → 写 Block

单个 session 内 experience Block 数量上限 = 3
超出时，confidence 最低的 principle Block 标记 invalid_at = now
```

**knowledge Block 准入条件**：

```
COMPASS TemporalFact 转 Block 的准入：
  - verificationStatus != 'unverified'（排除未验证事实）
  - confidence >= 0.6
  - AUDN 状态 != 'SUPERSEDED'

不满足以上任一条件 → 不转 Block，COMPASS 内部自行保留该 Fact
```

**environment Block 准入条件**：

```
只在 AssembleRequest.hint_entities 包含文件路径时触发
单次 session 的 environment Block 数量上限 = 2
```

**notes Block 准入条件**：

```
只允许通过 context_write tool 写入（agent 主动调用）
不由任何 Handler 自动产出
```

---

### [P1] Block 原子性（内容不变，补充过渡态说明）

**`[MUST]`** 迁移期间，现有 `buildRoleSystemPrompt`、`buildPreReplyInjection`、`buildContextPack` 三个函数可以通过 feature flag 同时维护两条路径（原有 string 路径 + 新 Block 路径）。

**`[MUST]`** feature flag 命名格式：`runtime.contextBlock.{source_system}.enabled`，默认 false，逐 source_system 独立切换。

---

### [P2] 查询时组织关系，SAG 降级为优化项【修订-#5】

**`[MUST]`** BlockStore 写入时必须尝试提取 `entities[]` 并写入 `block_entity_map`。提取失败（空结果）时记录 `entity_extraction_status: 'failed' | 'empty' | 'success'`，不阻塞写入。

**`[SHOULD]`**（不再是 MUST）`context_search` 优先执行 SQL entity 候选筛选，再做向量 rerank。

**`[MUST]`** entity 候选为空时，允许降级为纯向量检索，但必须在结果中标记 `fallback_mode: 'vector_only'` 到 observability trace。

**SQL-first 升级条件**：当 `entity_extraction_status='success'` 的写入比例 ≥ 80%（通过 BlockStore.stats() 监测）且持续 200 次 LLM call 稳定后，可将此约束从 SHOULD 升级为 MUST。升级前不强制。

---

### [P3] 蒸馏必须形成回写闭环（补充准入前提）【修订-#1 联动】

**`[MUST]`** SEKB 的 `confirm_and_save` 确认路径产出的 principle，写入 BlockStore（experience Block）。

**`[MUST NOT]`** `suggest_principles_from_trajectories` 的 advisory 结果不直接写 BlockStore。必须经过确认步骤（agent 调用确认 tool 或人工审批）才写入。

---

### [P4] 摘要链最大深度，区分压缩与提取【修订-#4】

**定义区分**：

```
摘要压缩（有损，计入深度）：
  LLM 对长文本做自由摘要，信息有丢失
  例：会话历史 → SSP，SEKB 轨迹 → principle

结构化提取（低损，不计入深度）：
  从原始数据提取固定字段，无自由摘要
  例：LLM 回复 → TemporalFact（subject/predicate/object 字段提取）
      工具调用结果 → entity 列表提取
```

**`[MUST]`** 摘要压缩链最大深度 = 1：

```
允许：
  SSP → task_state Block summary（0次压缩，结构化提取）✓
  LLM 回复 → TemporalFact（提取）→ knowledge Block summary（1次压缩）✓

禁止：
  会话历史 → SSP（1次压缩）→ Block summary（2次压缩）→ 另一个 Block summary（3次）✗
  SEKB principle（1次压缩）→ experience Block summary（2次压缩）✗
```

**`[MUST]`** ContextBlock 必须记录 `compression_depth: 0 | 1` 元数据，由写入方负责填写。Assembler 在 pre_llm_call 时检查，compression_depth > 1 的 Block 不允许注入（记录 observability 告警）。

**SSP 作为 Block 来源的处理**【修订-v1.2】：SSP 的固定字段来自规则提取，evidenceText 来自数组格式化，二者都不是有损摘要。SSP → task_state Block summary 是结构化提取，task_state Block 的 `compression_depth = 0`。

---

### [P5] 工具定义分层注入（内容不变）

---

### [P6] 角色权限不可被 context 机制绕过（内容不变）

---

## 第三章：Block 规范

### persona Block（不变）

### task_state Block（不变）

### working_memory Block【修订-#1 #10】

**准入门控**：

```
significance='high'   → 写入滚动窗口（√）
significance='medium' → 写入滚动窗口（√）
significance='low'    → 只写 observability trace，不进入 Block（×）
```

**`[MUST]`** 阶段 1 期间，`significance='high'` 的 COMPASS 写入触发**暂不实现**，推迟到阶段 4。阶段 1 的 working_memory Handler 只更新 Block 滚动窗口，不触发 COMPASS。

### tool_registry Block（不变）

### knowledge Block【修订-#3】【修订-v1.2】

**两条路径明确分离**：

```
路径 A（main session）：
  文件位置：runtime-core/memory-pre-reply-injection.ts
  函数：buildPreReplyInjection → PreReplyInjection（含 sspString + top5FactsString）
  改造方式：compass-handler.ts 包装此函数，产出 knowledge Block
  session 判断：在 Assembler 层，复用 session-key-utils.ts 谓词判断
               isMainSessionKey(session_id) → 触发 compass-handler
               其他 session → 不触发

路径 B（subagent session）：
  文件位置：memory/context-pack.ts
  函数：buildContextPack
  改造方式：role-memory-handler.ts 包装此函数，产出 knowledge Block
  触发条件：isSubagentSessionKey(session_id)
```

**main-only scope 门控的实现位置**【修订-#3】：

**`[MUST]`** 门控实现在 **Assembler 层**，根据 `AssembleRequest.session_id` 判断。不在 Handler 内部实现。Handler 自身不感知 session 类型，只负责产出 Block。

```typescript
// 位置：assembler.ts
import {
  isMainSessionKey,
  isSubagentSessionKey,
} from "../sessions/session-key-utils.js"

function selectHandlers(request: AssembleRequest): HandlerConfig[] {
  const isMainSession = isMainSessionKey(request.session_id)
  const isSubagent = isSubagentSessionKey(request.session_id)

  return [
    { handler: roleContractHandler, always: true },
    { handler: cvkHandler, always: true },
    { handler: workingMemoryHandler, always: true },
    { handler: taskLoopHandler, always: true },
    { handler: compassHandler, enabled: isMainSession },         // main only
    { handler: roleMemoryHandler, enabled: isSubagent },         // subagent only
    { handler: sekbHandler, always: true },
    { handler: codegraphHandler, enabled: !!request.hint_entities?.length },
  ]
}
```

**`[MUST NOT]`** compass-handler 和 role-memory-handler 不同时激活于同一个 session。

### experience Block【修订-#1】

**准入**：只有 `confirm_and_save` 确认的 principle 写入。单 session 上限 3 条，超出时淘汰 confidence 最低的。

### environment Block（不变）

### 【新增】notes Block【修订-#8】

| 属性 | 值 |
|------|-----|
| source_system | `working-memory`（由 context_write tool 触发写入） |
| presence.always_on | `false` |
| presence.on_demand.expand_tool | `context_read` |
| presence.background | `true` |
| mutability | `agent_writable` |
| role_scope | `undefined`（当前 role 自己可见） |
| compression_depth | `0`（agent 直接写入，无压缩） |

**`[MUST]`** notes Block 是系统中**唯一**的 `agent_writable` BlockType。

**`[MUST]`** context_write tool 的初始白名单扩展为：`planner`、`architect`、`implementer`（仅限 notes Block）。

**白名单粒度**：

```
planner / architect → 可写 notes Block
implementer         → 可写 notes Block
所有其他 role       → context_write 被 role 白名单过滤，不可用
```

**写入可见性**【修订-v1.2】：

**`[MUST]`** notes Block 写入成功时，必须在同一 session 的 working_memory Block 滚动窗口追加一条通知：`[note] agent wrote: {first 50 chars}`。通知受 working_memory 的 5 条滚动窗口规则约束，不复制 notes 全文。

---

## 第四章：Hook 触发规范

**`[MUST]`** 以下 Hook 触发点通过扩展 `agents/harness/hook-context.ts` 的 `contextBlockSink` 实现，不新建总线。

### 现有 hook 事件与 Block 产出的映射【修订-#2】

```
现有 hook 事件                    → Block 产出 handler

before_agent_start               → roleContractHandler（persona Block）
                                 → cvkHandler（tool_registry Block）
                                 → sekbHandler（experience Block，异步）
                                 → roleMemoryHandler（knowledge Block，subagent only,
                                   由 Assembler 层 session 判断决定是否触发）

tool_result                      → workingMemoryHandler（working_memory Block）
                                 → compassHandler（knowledge Block，main only,
                                   significance='high' 时，阶段 4 后激活）

agent_end（新增到现有 hook 枚举） → sekbHandler（触发 trajectory-capture）

task_phase_change（新增到现有    → taskLoopHandler（task_state Block 更新）
hook 枚举）                      → sekbHandler（to_phase='done'/'failed' 时触发蒸馏）
```

**`[MUST]`** `task_phase_change` 和 `agent_end` 两个事件类型需要新增到 `agents/harness/` 现有的 hook 事件枚举中。这是规范对现有代码的唯一侵入性修改（enum 扩展）。

### contextBlockSink 可见时机【修订-v1.2】

**`[MUST]`** 同步 hook 通过 `contextBlockSink` 产出的 Block，必须在当前 hook 调度周期结束前写入 BlockStore，并在下一次 `pre_llm_call` 可见。

**`[MUST]`** 异步 hook 通过 `contextBlockSink` 产出的 Block 不阻塞当前 LLM call；异步写入完成后，在下一次 `pre_llm_call` 可见。

**`[MUST NOT]`** 调度器不得为了等待异步 Block 产出而延迟当前 LLM call。

### session_start（内容不变，实现方式改为 before_agent_start hook）

### pre_llm_call（不变）

### post_tool_call【修订-#10】

**`[MUST]`** 阶段 1 期间，post_tool_call 只更新 working_memory 滚动窗口。COMPASS 写入路径（significance='high' 触发 TemporalFact）推迟到阶段 4 激活。

### task_phase_change（不变）

### role_handoff【修订-#7】【修订-v1.2】

**`[MUST]`** 父 session 在 spawn 前将 HandoffPack 写入 BlockStore，BlockType 为 `task_state`，`session_id` 必须设置为新 session 的 key。

**`[MUST]`** `spawnRoleSubagent` 的 `extraSystemPrompt` 只允许传递以下提示文本，不承载 HandoffPack 结构化数据：

```text
## Handoff Available
Use context_read('task_state') to load parent session state.
```

**`[MUST]`** 新 session 的 `before_agent_start` hook 必须从 BlockStore 查询自己的 `session_id`，恢复 HandoffPack 对应的 task_state。

**handoff_pack 最小格式**：

```typescript
interface HandoffPack {
  objective: string           // ≤ 2000 chars，来自 task_state Block
  current_phase: TaskPhase
  recent_actions: Array<{     // 最近 5 条，来自 working_memory Block
    tool: string
    result_summary: string    // ≤ 100 chars
    significance: 'high' | 'medium'
  }>
  parent_session_id: string   // 新 session 可用此 id 查询父 session 的 Block
}
```

**`[MUST NOT]`** handoff_pack 不包含完整 task_state JSON、不包含 block_id 列表。只包含上述 4 个字段。

**`[MUST NOT]`** handoff 不是 sequential（同 session 内角色切换）。sequential handoff 不在本规范范围内，推迟到独立设计。

**实现方式**：

```typescript
// 父 session：先为 childSessionKey 写入 task_state Block
const handoffPack: HandoffPack = buildHandoffPack(parentSessionId, blockStore)
await blockStore.upsert(toTaskStateBlock(handoffPack, childSessionKey))

await spawnRoleSubagent({
  ...existingParams,
  extraSystemPrompt:
    "## Handoff Available\nUse context_read('task_state') to load parent session state."
})
```

**跨 session 查询权限**【修订-v1.2】：

**`[MUST]`** 默认查询只能读取 `requester_session_id` 自己的 Block。

**`[MUST]`** child session 只有在自己的 task_state HandoffPack 中记录了 `parent_session_id` 时，才允许读取该 parent session 的 Block；允许范围仅为该直接父 session，不允许任意 session_id 查询或递归祖先查询。

**`[MUST]`** BlockStore 必须在授权查询时同时校验 `requester_session_id`、HandoffPack 中的 `parent_session_id` 与被查询 `session_id` 三者一致；校验失败返回空结果并记录 observability 计数器。

---

## 第五章：存储约束

### BlockStore SQLite Schema【修订-#9】

```sql
CREATE TABLE context_blocks (
  block_id              TEXT PRIMARY KEY,
  block_type            TEXT NOT NULL,
  source_system         TEXT NOT NULL,
  session_id            TEXT,
  summary               TEXT NOT NULL,
  full_content          TEXT,
  presence_json         TEXT NOT NULL,
  mutability            TEXT NOT NULL,
  role_scope            TEXT,
  entities_json         TEXT,          -- JSON array，冗余存储（方便 debug）
  entity_extraction_status TEXT DEFAULT 'pending',  -- 【新增】#5
  compression_depth     INTEGER NOT NULL DEFAULT 0,  -- 【新增】#4，0 或 1
  fallback_mode         TEXT,          -- 【新增】#5，null | 'vector_only'
  valid_at              INTEGER NOT NULL,
  invalid_at            INTEGER,
  created_at            INTEGER NOT NULL
);

CREATE TABLE block_entity_map (
  block_id  TEXT NOT NULL REFERENCES context_blocks(block_id),
  entity    TEXT NOT NULL COLLATE NOCASE,  -- 【修订】#9 加 COLLATE NOCASE
  PRIMARY KEY (block_id, entity)
);

-- 原有索引
CREATE INDEX idx_entity ON block_entity_map(entity);
CREATE INDEX idx_block_type_valid ON context_blocks(block_type, valid_at, invalid_at);
CREATE INDEX idx_session ON context_blocks(session_id, block_type);

-- 【新增索引】#9
CREATE INDEX idx_source ON context_blocks(source_system);
CREATE INDEX idx_block_type_source ON context_blocks(block_type, source_system);
CREATE INDEX idx_invalid ON context_blocks(invalid_at) WHERE invalid_at IS NULL;
```

---

## 第六章：三个工具规范

### context_read（不变）

### context_write【修订-#8】

**`[MUST]`** 只允许写入 `notes` Block（当前唯一 agent_writable BlockType）。

```typescript
{
  name: 'context_write',
  parameters: {
    // block_type 固定为 'notes'，不是参数
    operation: 'append' | 'replace' | 'clear',
    content: string
  }
}
```

**白名单**：`planner`、`architect`、`implementer`。

### context_search【修订-#5】

**`[MUST]`** 实现顺序：

```
1. 从 query 中规则提取候选 entities
2. 如果 entities 非空：SQL entity 候选 → 向量 rerank（SAG 模式）
3. 如果 entities 为空：纯向量检索（fallback 模式），结果标记 fallback_mode='vector_only'
4. 返回 top-K（K ≤ 5）
```

---

## 第七章：禁止项（v1.1 更新）

在 v1.0 的 9 条反模式基础上修订：

```
[ANTI-1] 直接 string 注入（不变）

[ANTI-2] 链式摘要压缩（修订-#4）
  禁止：任何 Block 的 compression_depth > 1
  允许：structural extraction 不计入 compression_depth

[ANTI-3] subagent 接收 COMPASS 注入（修订-#3、修订-v1.2）
  门控位置：Assembler 层（不在 Handler 内）
  判断依据：复用 session-key-utils.ts 的 isMainSessionKey /
           isSubagentSessionKey 谓词，禁止自建正则

[ANTI-4] 工具全量 schema 注入 always_on（不变）

[ANTI-5] Dreaming bypass AUDN（不变）

[ANTI-6] 无索引全表查询（不变）

[ANTI-7] 角色权限通过 context 绕过（不变）

[ANTI-8] 蒸馏 advisory 结果直接写 Block（修订-#1）
  禁止：suggest_principles_from_trajectories 结果直接写 BlockStore
  必须：经过 confirm_and_save 确认

[ANTI-9] handoff 自由文本（修订-#7、修订-v1.2）
  禁止：handoff_pack 是 markdown 或大型 JSON（含 block_id 列表）
  禁止：通过 extraSystemPrompt 传递 HandoffPack JSON 或其他结构化状态
  必须：HandoffPack 4 字段结构写入 child session 的 task_state Block；
       extraSystemPrompt 只传递 context_read 提示

[ANTI-10] 新建第四套 Hook 总线（新增-#2）
  禁止：新建 hook-bus.ts 作为独立模块
  必须：通过 HookContext.contextBlockSink 扩展现有 harness hook
```

---

## 第八章：quality gate 评估方法【修订-#6】

### 评分指标（每个 source_system 独立计算）

```typescript
interface SourceSystemMetrics {
  injection_hit_rate: number    // Block 被 Assembler 选中注入 always_on 的比例
                                // 计算：被选中次数 / 总产出次数
  agent_usage_rate: number      // on_demand Block 被 context_read 展开的比例
                                // 计算：被展开次数 / 可展开次数
  entity_extraction_rate: number // entity_extraction_status='success' 的比例
  avg_compression_depth: number  // 平均 compression_depth（应 ≤ 1）
}
```

### 评估周期

```
定期评估：每 100 次 LLM call 重新计算一次
即时降级：injection_hit_rate < 0.1（连续 50 次调用）→ 立即从 always_on 降级为 on_demand
即时禁用：avg_compression_depth > 1（任意 Block）→ 该 source_system 立即禁用，记录告警

升级条件（on_demand → always_on）：
  injection_hit_rate ≥ 0.5
  agent_usage_rate ≥ 0.3
  连续 2 个评估周期（200 次 LLM call）稳定
```

### 降级处理

```
always_on → on_demand：Block 保留，只是不自动注入
on_demand → disabled：Block 标记 invalid_at=now，context_search 不返回
```

---

## 第九章：迁移顺序与验收标准（修订）

### 阶段 0：接口层【修订-#2 #3 #9】【修订-v1.2】

**交付物**：
- `context-engine/block.ts`（含 `notes` BlockType、`compression_depth`、`entity_extraction_status` 字段）
- `context-engine/block-store.ts`（含修订后的 Schema 和 6 个索引）
- `agents/harness/hook-context.ts` 修改（新增 `contextBlockSink` 字段）
- `agents/harness/` hook 枚举新增 `task_phase_change` 和 `agent_end` 事件
- `context-engine/assembler.ts`（`selectHandlers` 复用 session-key-utils.ts 谓词，不使用正则）

**验收**：TypeScript 编译通过。现有功能零回归。Assembler 是 pass-through（内部调用现有 `buildPreReplyInjection` 和 `buildContextPack`，通过 feature flag 切换）。

---

### 阶段 1：working_memory Handler【修订-#10】

**交付物**：
- `context-engine/handlers/working-memory-handler.ts`
- 注册到 `tool_result` hook 的 `contextBlockSink`
- working_memory Block 在 `pre_llm_call` 时注入 Assembler

**验收**：
- 工具调用后，significance='medium'/'high' 的操作出现在 `## Recent Actions`
- significance='low' 的操作不出现在 Block（验证 observability trace）
- COMPASS 写入**不触发**（阶段 1 暂不实现）

---

### 阶段 2：task_state Adapter + handoff【修订-#7】【修订-v1.2】

**交付物**：
- `context-engine/handlers/task-loop-handler.ts`
- `task_phase_change` hook 触发 SEKB `trajectory-capture`
- HandoffPack 以 child session key 写入 BlockStore
- `spawnRoleSubagent.extraSystemPrompt` 只传递 `context_read('task_state')` 提示
- child session 的 `before_agent_start` hook 从 BlockStore 恢复 task_state

**验收**：
- task_state Block 的 `current_phase` 准确反映执行阶段
- Loop 完成后 SEKB `SekbTrajectories` 有新记录
- subagent spawn 的 `extraSystemPrompt` 不包含 HandoffPack JSON，只包含读取提示
- child session 可读取自己的 HandoffPack，并仅可按授权读取直接 parent session 的 Block

---

### 阶段 3：tool_registry Block（CVK 升级）

（不变）

---

### 阶段 4：knowledge Block 统一【修订-#3 #10】

**交付物**：
- `context-engine/handlers/compass-handler.ts`（包装 `buildPreReplyInjection`）
- `context-engine/handlers/role-memory-handler.ts`（包装 `buildContextPack`）
- Assembler 的 `selectHandlers` session 类型判断激活
- working_memory Handler 的 COMPASS 写入路径激活（`significance='high'` 触发）

**验收**：
- main session：knowledge Block 来自 compass-handler，`## Recent Actions` 中 high-significance 条目同步写入 COMPASS
- subagent session：knowledge Block 来自 role-memory-handler
- observability trace 无重复注入记录

---

### 阶段 5：SEKB 蒸馏回写【修订-#1 #3】

**交付物**：
- `confirm_and_save` 路径写入 BlockStore（experience Block）
- context_read('experience') 可展开

**验收**：confirm_and_save 被调用后，`context_search(query='principles')` 能返回对应 experience Block。

---

## 版本变更摘要

| 章节 | v1.0 | v1.1 变更 |
|------|------|----------|
| 第一章 | 无 `notes` BlockType | 新增 `notes`；废弃 HookBus，改为扩展 HookContext |
| 第二章 | 无准入门槛 | 新增 [P0]；[P2] SAG 降为 SHOULD；[P4] 区分压缩/提取；[P3] 补充确认前提 |
| 第三章 | knowledge Block 路径模糊 | 两条路径明确分离；session 门控在 Assembler 层；新增 notes Block |
| 第四章 | HookBus 新总线 | 改为 HookContext.contextBlockSink；handoff 最小化 |
| 第五章 | Schema 缺少索引 | 新增 4 个索引；新增 `compression_depth`、`entity_extraction_status` 字段 |
| 第六章 | context_write 白名单过窄 | 扩展 implementer；限定只写 notes |
| 第七章 | 9 条反模式 | 10 条，新增 ANTI-10（禁止第四套 hook 总线） |
| 第八章 | quality gate 无评估方法 | 补充 4 个指标、评估周期、升降级条件 |
| 第九章 | 迁移阶段有依赖问题 | 阶段 1 COMPASS 写入推迟到阶段 4 |

### v1.1 → v1.2【修订-v1.2】

| 问题 | v1.2 处理 |
|------|-----------|
| HandoffPack 走 extra 字符串 | 改为写入 child session 的 task_state Block；extraSystemPrompt 仅提示读取 |
| session_id 正则漏多段 key | selectHandlers 改为复用 session-key-utils.ts 谓词 |
| SSP compression_depth 推理错误 | task_state 固定为 0，明确属于结构化提取 |
| contextBlockSink 异步时机 | 定义同步当前周期写入、异步完成后下一次 pre_llm_call 可见 |
| notes 写入不可见 | working_memory 滚动窗口追加 50 字符通知 |
