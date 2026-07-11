# ClawX Working Context × Memory 统一设计约束规范
**DCS-v1.0 · 交付 Agent 执行版**

---

## 文档说明

**用途**：交给实现 Agent 的开发约束规范。不描述"如何实现"，只描述"实现必须满足什么"。
**语言**：TypeScript（ClawX 全栈语言），SQLite + Kysely（持久化层）。
**范围**：`openclaw_runtime/src/context-engine/` 为主改造区域，其余子系统通过 Adapter 接入，不重写。
**执行原则**：约束是边界，边界内的实现细节由 Agent 自主决定。违反任何 `[MUST]` 约束视为实现失败。

---

## 第一章：术语定义

在阅读约束之前，必须对以下术语有精确理解。术语定义是约束的语义基础。

### ContextBlock

**定义**：系统中所有可注入 LLM context window 的信息单元的统一抽象。不是字符串，不是 prompt 片段，是一个带有元数据的结构化对象。

**语言层预期**：系统中不存在任何直接把 `string` 拼接进 system prompt 的路径。所有注入必须先成为 `ContextBlock`，再经过 Assembler 统一处理。

```typescript
// 位置：openclaw_runtime/src/context-engine/block.ts（新建）
interface ContextBlock {
  block_id: string           // 全局唯一，格式：{source_system}:{block_type}:{scope_id}
  block_type: BlockType
  source_system: SourceSystem

  // 物理形态声明（三选一或组合）
  presence: PresenceConfig

  // 记忆治理元数据
  entities: string[]         // 涉及的实体名称，用于 SAG 式 SQL 查询
  valid_at: Date
  invalid_at?: Date
  role_scope?: string[]      // undefined = 所有 role 可见
  mutability: Mutability

  // 内容
  summary: string            // 始终存在，always_on 时注入 prompt
  full_content?: string      // 按需存在，on_demand 时通过 tool 展开
}

type BlockType =
  | 'persona'           // 角色身份与权限边界
  | 'task_state'        // 当前任务执行状态
  | 'working_memory'    // 最近 N 步操作记录（滚动窗口）
  | 'tool_registry'     // 可用工具视图
  | 'knowledge'         // 检索到的历史知识
  | 'experience'        // SEKB 蒸馏的行为模式
  | 'environment'       // 环境状态（代码结构/Shell/Browser）

type SourceSystem =
  | 'role-contract'
  | 'compass'
  | 'role-memory'
  | 'sekb'
  | 'cvk'
  | 'task-loop'
  | 'working-memory'    // 新增子系统
  | 'codegraph'
  | 'agent-map'

type Mutability =
  | 'agent_writable'    // agent 可通过 context_write tool 修改
  | 'system_managed'    // 只由 Hook 系统自动更新
  | 'readonly'          // 只由外部系统写入，agent 不可修改

interface PresenceConfig {
  always_on: boolean          // 是否始终在 prompt 中
  token_budget?: number       // always_on=true 时必填，单位 token
  priority?: number           // 1-10，budget 压缩时的保留优先级
  on_demand?: {
    expand_tool: string       // agent 调用此 tool 名展开 full_content
    auto_register: boolean    // 是否自动加入当前 session tool 列表
  }
  background?: boolean        // 是否进入 entity 索引（可被 context_search 关联）
}
```

**架构层预期**：`ContextBlock` 是整个 Working Context 层的通货。任何子系统与 context 系统的交互，无论读写，都通过 `ContextBlock` 进行。不存在绕过 `ContextBlock` 直接操作 prompt 的合法路径。

---

### BlockStore

**定义**：所有 `ContextBlock` 的统一存储与索引层。负责持久化、entity 索引维护、时间有效性过滤。

**语言层预期**：一个 class，暴露四个方法。不是数据库的直接映射层，是带有业务语义的存储抽象。

```typescript
// 位置：openclaw_runtime/src/context-engine/block-store.ts（新建）
interface BlockStore {
  // 写入（同时更新 entity 索引）
  upsert(block: ContextBlock): Promise<void>

  // 查询（SAG 式：entity 候选 + 时间过滤）
  query(params: BlockQuery): Promise<ContextBlock[]>

  // 失效（不删除，设置 invalid_at）
  invalidate(block_id: string): Promise<void>

  // 统计（用于 quality gate）
  stats(source_system: SourceSystem): Promise<BlockSourceStats>
}

interface BlockQuery {
  block_types?: BlockType[]
  source_systems?: SourceSystem[]
  role_scope?: string             // 过滤 role_scope
  entities?: string[]             // SAG：只返回 entities 有交集的 Block
  valid_at?: Date                 // 默认 now()
  presence_filter?: 'always_on' | 'on_demand' | 'background'
  limit?: number
}
```

**架构层预期**：SQLite 底层存两张表：`context_blocks`（Block 数据）和 `block_entity_map`（entity 索引）。`block_entity_map` 支持 `SELECT block_id FROM block_entity_map WHERE entity IN (?)` 的 SQL 查询，这是 SAG 约束的核心实现基础。

---

### HookBus

**定义**：跨子系统的事件调度总线。不替换 `plugins/hooks/`（那是 plugin 生命周期专用），是在其上层的系统级 Hook 协调器。

**语言层预期**：轻量的发布/订阅实现。每个 HookHandler 返回它要更新的 `ContextBlock[]`，HookBus 收集后交给 Assembler。

```typescript
// 位置：openclaw_runtime/src/context-engine/hook-bus.ts（新建）

type HookEvent =
  | { type: 'session_start'
      role: string            // role id
      session_id: string
      initial_task?: string }
  | { type: 'pre_llm_call'
      session_id: string
      turn: number
      available_budget: number }
  | { type: 'post_tool_call'
      session_id: string
      tool_name: string
      args_summary: string    // 压缩的参数描述，不是完整参数
      result_summary: string  // 压缩的结果描述
      significance: 'high' | 'medium' | 'low' }
  | { type: 'task_phase_change'
      session_id: string
      task_id: string
      from_phase: TaskPhase
      to_phase: TaskPhase }
  | { type: 'role_handoff'
      from_session: string
      to_session: string
      from_role: string
      to_role: string }

interface HookHandler {
  name: string                        // handler 标识，用于 debug
  handles: HookEvent['type'][]        // 声明处理哪些事件类型
  handle(event: HookEvent): Promise<ContextBlock[]>
  // 返回：这次事件导致的 Block 变更列表（新增/更新）
  // 空数组 = 这个 handler 对此事件无响应
}
```

**架构层预期**：HookBus 是各子系统与 context 系统的唯一接入点。子系统不直接调用 `BlockStore.upsert()`，而是注册 HookHandler，由 HookBus 在事件触发时收集 Block 变更，统一提交给 BlockStore。这保证了写入的可观测性和 budget 的集中管理。

---

### Context Assembler

**定义**：将 `BlockStore` 中的 Block 组装为 LLM system prompt 的唯一出口。

**语言层预期**：一个纯函数（或无副作用的 class），输入是请求描述，输出是 prompt 片段列表和可注册工具列表。

```typescript
// 位置：openclaw_runtime/src/context-engine/assembler.ts（新建）
interface AssembleRequest {
  session_id: string
  role_id: string
  task_id?: string
  token_budget: number          // 本次 LLM call 可用于 context 的总 token 数
  hint_entities?: string[]      // 当前 turn 的主题实体，用于 SAG 查询
}

interface AssembleResult {
  system_prompt_parts: string[] // 按优先级排序的 prompt 片段
  register_tools: string[]      // on_demand Block 需要注册的 tool 名列表
  budget_used: number           // 实际使用的 token 数
  blocks_included: string[]     // 包含的 block_id 列表（用于 observability）
}
```

**架构层预期**：`computeMemoryExtraSystemPrompt`（当前唯一注入缝）最终被替换为 `Assembler.assemble()`。替换过程是渐进的——先让 `computeMemoryExtraSystemPrompt` 调用 Assembler 并把结果 pass through，再逐步把注入逻辑迁移到各 HookHandler。

---

## 第二章：核心约束（不可违反项）

### [P1] Block 原子性

**`[MUST]`** 所有进入 LLM system prompt 的信息必须以 `ContextBlock` 为单位产生。

**`[MUST NOT]`** 不允许在任何 Handler、Service、或 spawn 函数中直接构造 prompt string 并注入。

**检查方式**：在 `context-engine/` 之外，不应存在任何直接构造 system prompt string 的代码路径。`buildRoleSystemPrompt`、`computeMemoryExtraSystemPrompt`、`buildContextPack` 这三个现有函数必须最终成为 Block 的产出端，而非 prompt 的直接生产者。

**允许的过渡态**：在迁移期间，上述函数可以暂时既产出 Block、也产出 string（用 feature flag 切换）。但完成态只保留 Block 路径。

---

### [P2] 查询时组织关系，写入时提取实体

**`[MUST]`** 每次向 BlockStore 写入 Block 时，必须同时提取并写入 `entities[]`。实体提取的最低要求：文件路径、函数名、角色名、任务 ID、工具名——这些可以通过规则提取，不要求 LLM 参与。

**`[MUST]`** `context_search` tool 的实现必须先执行 SQL 候选筛选（`WHERE entity IN (?)`），再对候选结果执行向量相似度排序。不允许跳过 SQL 候选层直接做全量向量检索。

**`[MUST NOT]`** 不允许在写入时预建 Block 之间的静态关系图（如提前计算 "Block A 与 Block B 相关"）。关系只在查询时通过共享 entity 动态发现。

**架构层预期**：BlockStore 的查询性能瓶颈在 SQL 层（有索引），而非向量层（全量扫描）。entity 索引是这个架构的性能保障，不是可选项。

---

### [P3] 蒸馏必须形成回写闭环

**`[MUST]`** `knowledge/sekb/distillation-tool.ts` 产出的 `SekbPrinciples` 必须以 `BlockType='experience'、source_system='sekb'` 写入 BlockStore。

**`[MUST]`** `BlockType='experience'` 的 Block 必须出现在 Assembler 的 Block 候选池中，并在 `on_demand` 路径下可被 agent 展开。

**`[MUST NOT]`** SEKB 的蒸馏结果不允许只写入 `SekbPrinciples` SQLite 表而不写入 BlockStore。两者可以同时写入，但 BlockStore 写入是必须的。

**当前断层**：`sekb/distillation-tool.ts` 目前不写入任何 context 路径。这是需要修复的断层，不是可选优化。

---

### [P4] 摘要链最大深度为 1

**`[MUST]`** `ContextBlock.summary` 字段必须由 `full_content` 压缩而来，或由原始数据直接生成。

**`[MUST NOT]`** 不允许用另一个 `ContextBlock` 的 `summary` 作为输入来生成新的 `summary`。

**`[MUST NOT]`** Dreaming 系统（`memory-core/dreaming/`）产出的内容在写入 COMPASS 或 BlockStore 之前，不允许经历超过 1 次摘要压缩。

**检查方式**：Block 的写入来源（`source_system`）必须可追溯到原始数据，不允许存在 `source_system='compass'` 的 Block 的 `summary` 是另一个 `source_system='compass'` Block 的 `summary` 的摘要。

**架构层预期**：防止 Dreaming 系统反复摘要导致的事实失真。Dreaming 的职责是发现矛盾、生成修复提案，而非反复压缩信息。

---

### [P5] 工具定义必须分层注入

**`[MUST]`** 所有工具的注入必须分两层：
- **摘要层**（`always_on`）：工具名 + 单行描述，≤ 30 token/工具，始终在 prompt 中
- **详情层**（`on_demand`）：完整 schema + 示例，通过 `context_read` tool 展开

**`[MUST]`** 每个 session 的 `BlockType='tool_registry'` 必须存在，且 `always_on=true`。

**`[MUST NOT]`** 不允许把超过 5 个工具的完整 JSON schema 同时注入 always_on prompt。

**与 Role-First 的兼容**：工具分层不影响角色白名单机制。白名单过滤发生在 tool 注册阶段，分层注入发生在 context 组装阶段，两者是串行的：先过滤，再分层。

---

### [P6] 角色权限不可被 context 机制绕过

**`[MUST]`** `mutability='agent_writable'` 的 Block 只能被白名单中包含对应 write tool 的 role 修改。

**`[MUST]`** `context_write` tool 在执行前必须检查 `RoleContract.tools[]` 白名单，未列出则拒绝并返回 permission error。

**`[MUST NOT]`** Assembler 不允许因为 Block 的 `role_scope` 与当前 role 不匹配而 silently skip——必须记录到 observability trace。

**`[MUST NOT]`** HookBus 的任何 Handler 不允许直接修改 `persona` Block 的内容。`persona` Block 的 `mutability='readonly'`，只由 `role-contract` source_system 在 `session_start` 时写入。

---

## 第三章：Block 规范

每个 BlockType 的完整约束：

### persona Block

| 属性 | 值 |
|------|-----|
| source_system | `role-contract` |
| presence.always_on | `true` |
| presence.token_budget | `300` |
| presence.priority | `10`（最高） |
| mutability | `readonly` |
| role_scope | `undefined`（自身可见） |
| valid_at | session 开始时间 |
| invalid_at | session 结束时间 |

**summary 格式约束**：
```
## Role: {role_name}
{role_description_1_sentence}
Permissions: {permission_summary}
Tools: {tool_count} available (use context_read('tool_registry') for details)
```

**现有映射**：由 `role-spawn.ts:buildRoleSystemPrompt` 改造为产出此 Block。

---

### task_state Block

| 属性 | 值 |
|------|-----|
| source_system | `task-loop` |
| presence.always_on | `true` |
| presence.token_budget | `500` |
| presence.priority | `9` |
| presence.on_demand.expand_tool | `context_read` |
| mutability | `system_managed` |
| background | `true` |

**summary 格式约束**（复用现有 CHAR 常量）：
```
## Current Task
Objective: {≤2000 chars}
Phase: {phase}
Progress: {completed_steps}/{total_steps}
Blockers: {blocker_summary_if_any}
```

**full_content 包含**：完整 `TaskState` JSON，含 `evidence_summary`（≤12000 chars）、`repair_brief`（≤4000 chars）。

**触发更新的 Hook 事件**：`task_phase_change`、`session_start`。

**现有映射**：`task-loop-context.ts:buildTaskLoopContextPack` 改造为产出此 Block 的 adapter。现有 4 个 CHAR 常量保留，映射为 Block 字段上限。

---

### working_memory Block

| 属性 | 值 |
|------|-----|
| source_system | `working-memory` |
| presence.always_on | `true` |
| presence.token_budget | `400` |
| presence.priority | `8` |
| mutability | `system_managed` |
| background | `true` |

**summary 格式约束**（滚动窗口，最近 5 条）：
```
## Recent Actions
[{step}] {tool_name}({args_summary}) → {status}: {result_summary}
...
```

**`[MUST]`** 每条 entry 的 `result_summary` ≤ 100 chars，`args_summary` ≤ 50 chars。不是截断原始输出，是结构化压缩。

**`[MUST]`** `significance='high'` 的条目必须同时触发 COMPASS `TemporalFact` 写入（经过 entity 提取 + AUDN 检查），不允许直接 bypass。

**`[MUST NOT]`** `significance='low'` 的条目不写入 COMPASS，只保留在 working_memory Block 的滚动窗口中。

**触发更新的 Hook 事件**：`post_tool_call`。

**这是当前完全缺失的 Block**，需要新建 `context-engine/handlers/working-memory-handler.ts`。

---

### tool_registry Block

| 属性 | 值 |
|------|-----|
| source_system | `cvk` |
| presence.always_on | `true` |
| presence.token_budget | `200` |
| presence.priority | `7` |
| presence.on_demand.expand_tool | `context_read` |
| presence.on_demand.auto_register | `true` |
| mutability | `system_managed` |

**summary 格式约束**：
```
## Tools ({count} available)
{category}: {tool_1}✓ {tool_2}✓ ... ({n})
...
→ context_read('tool_registry', category) for full schema
```

**`[MUST]`** 使用频率权重：最近 3 次 session 使用过的工具在 summary 中排名靠前。未使用超过 5 次 session 的工具移入 background（仍可通过 `context_read` 访问，不出现在 summary）。

**现有映射**：`context-engine/cvk/views.ts` 升级为产出此 Block 的实现。这是改动量最大的现有组件，但基础已有（views.ts 已存在）。

---

### knowledge Block

| 属性 | 值 |
|------|-----|
| source_system | `compass` 或 `role-memory` |
| presence.always_on | `false` |
| presence.on_demand.expand_tool | `context_search` |
| presence.background | `true` |
| mutability | `readonly`（compass）/ `system_managed`（role-memory） |
| role_scope | role-memory 的 Block 根据 `applicableRoles` 填充 |

**`[MUST]`** main session 的 knowledge Block 来自 `compass`。

**`[MUST]`** subagent session 的 knowledge Block 来自 `role-memory`，通过 `role-spawn` 的 HookHandler 在 `session_start` 时写入，不来自 COMPASS。

**`[MUST NOT]`** 同一个 session 中不允许同时存在来自 compass 和 role-memory 的 `always_on` knowledge Block（防止 double-injection）。

**现有映射**：`memory-pre-reply-injection.ts` 和 `memory/context-pack.ts` 分别改造为两个独立的 HookHandler，产出各自的 knowledge Block。

---

### experience Block

| 属性 | 值 |
|------|-----|
| source_system | `sekb` |
| presence.always_on | `false` |
| presence.on_demand.expand_tool | `context_read` |
| presence.background | `true` |
| mutability | `readonly` |

**`[MUST]`** 在 `session_start` 时，SEKB HookHandler 必须查询与当前任务相关的 `SekbPrinciples`，产出 experience Block 并写入 BlockStore。

**`[MUST]`** experience Block 的 `summary` 格式为：
```
## Relevant Experience ({n} principles)
- {principle_title}: {one_line_summary}
...
→ context_read('experience') for full principles
```

**现有映射**：`knowledge/sekb/retrieval-engine.ts` 改造为 SEKB HookHandler 的后端，产出此 Block。`knowledge/sekb/harness-integration.ts` 的 `SekbHarnessHookTarget` 改造为 HookBus 注册接口。

---

### environment Block

| 属性 | 值 |
|------|-----|
| source_system | `codegraph` 或 `agent-map` |
| presence.always_on | `false` |
| presence.on_demand.expand_tool | `context_read` |
| presence.background | `true` |
| mutability | `system_managed` |

**`[MUST]`** 只在 `hint_entities` 包含文件路径时，Assembler 才触发 codegraph HookHandler 产出此 Block。不主动产出，按需触发。

---

## 第四章：Hook 触发规范

### session_start

**触发条件**：每次 session 初始化。

**`[MUST]`** 触发后必须产出的 Block：
1. `persona`（来自 role-contract Handler）
2. `tool_registry`（来自 CVK Handler）
3. `experience`（来自 SEKB Handler，允许异步，完成前返回空 Block）

**`[MUST]`** 如果是 subagent session（session_id 匹配 `agent:<id>:<role>`），还必须产出：
4. `knowledge`（来自 role-memory Handler）

**`[MUST NOT]`** subagent session 的 `session_start` 不触发 COMPASS Handler。

---

### pre_llm_call

**触发条件**：每次 LLM call 发起前。

**`[MUST]`** Assembler 在此时点执行 Block 收集和 budget 分配：
1. 收集所有 `always_on` Block
2. 按 `priority` 降序排列
3. 累计 token_budget，超出 `available_budget` 时将超出部分的 Block 降级为 `on_demand`
4. 构造 `system_prompt_parts[]`

**`[MUST]`** budget 分配日志必须写入 observability trace（包含：每个 Block 的 budget 分配结果、降级情况）。

---

### post_tool_call

**触发条件**：每次工具调用完成后。

**`[MUST]`** working-memory Handler 必须响应此事件，更新 working_memory Block。

**`[MUST]`** 如果 `significance='high'`：
1. 调用 `memory-entity-extraction.ts` 提取 entities（现有模块）
2. 构造 `TemporalFact`，经 AUDN 检查后写入 COMPASS（现有流程）
3. 同时更新 BlockStore 中对应 knowledge Block 的 `background` 索引

**significance 判断规则**（Agent 自行实现具体阈值，但规则类型固定）：
- 文件写入/删除操作 → 至少 `medium`
- 测试失败/通过 → `high`
- 外部 API 调用成功 → `medium`
- 读取操作 → `low`
- 错误发生 → `high`

---

### task_phase_change

**触发条件**：`TaskState.phase` 发生变化。

**`[MUST]`** task-loop Handler 必须响应，更新 task_state Block 的 `summary` 和 `full_content`。

**`[MUST]`** 当 `to_phase='done'` 或 `to_phase='failed'` 时，SEKB Handler 必须响应：
1. 调用 `trajectory-capture.ts` 记录本次任务轨迹（现有模块）
2. 异步触发 `distillation-tool.ts` 蒸馏（不阻塞主流程）
3. 蒸馏完成后将结果写入 BlockStore（`BlockType='experience'`）

**`[MUST]`** `from_phase='planning', to_phase='executing'` 的转移必须先经过 consistency check（现有 `task-loop-self-check.ts:runTaskLoopSelfCheck`），check 失败则阻止转移并保持 `planning` 状态。

---

### role_handoff

**触发条件**：角色切换或 subagent spawn 时。

**`[MUST]`** handoff Handler 必须打包以下内容为 handoff_pack：
1. `task_state` Block 的完整 JSON（`full_content`）
2. `working_memory` Block 的最近 10 条 entry
3. 当前 session 的 `block_id` 列表（新 session 可通过 `context_search` 关联）

**`[MUST]`** handoff_pack 写入 BlockStore，`block_type='task_state'`，`session_id` 指向新 session。

**`[MUST NOT]`** handoff 格式不允许是自由文本。必须是可机器解析的结构（JSON），让接收方的 `session_start` Hook 能从中恢复 task_state Block。

---

## 第五章：存储约束

### BlockStore SQLite Schema

```sql
-- Block 主表
CREATE TABLE context_blocks (
  block_id      TEXT PRIMARY KEY,
  block_type    TEXT NOT NULL,
  source_system TEXT NOT NULL,
  session_id    TEXT,          -- null = 跨 session 持久 Block
  summary       TEXT NOT NULL,
  full_content  TEXT,
  presence_json TEXT NOT NULL, -- JSON: PresenceConfig
  mutability    TEXT NOT NULL,
  role_scope    TEXT,          -- JSON array or null
  valid_at      INTEGER NOT NULL,  -- unix timestamp
  invalid_at    INTEGER,           -- null = 当前有效
  created_at    INTEGER NOT NULL
);

-- Entity 索引表（SAG 的关键结构）
CREATE TABLE block_entity_map (
  block_id  TEXT NOT NULL REFERENCES context_blocks(block_id),
  entity    TEXT NOT NULL,
  PRIMARY KEY (block_id, entity)
);

CREATE INDEX idx_entity ON block_entity_map(entity);
CREATE INDEX idx_block_type_valid ON context_blocks(block_type, valid_at, invalid_at);
CREATE INDEX idx_session ON context_blocks(session_id, block_type);
```

**`[MUST]`** `block_entity_map` 的 `entity` 列必须有索引（`idx_entity`）。这是 SAG 约束的物理保障。

**`[MUST NOT]`** 不允许在查询时做全表 scan（没有 WHERE 子句的查询视为实现错误）。

---

### 写入事务约束

**`[MUST]`** `BlockStore.upsert()` 必须在单个 SQLite 事务中完成：
1. 写入 `context_blocks`
2. 删除旧的 `block_entity_map` 条目（同 block_id）
3. 写入新的 `block_entity_map` 条目

**`[MUST]`** 写入前如果存在 `block_id` 相同的有效 Block（`invalid_at IS NULL`），必须先将其 `invalid_at` 设为当前时间，再写入新 Block（append-only 语义）。

---

### quality gate

**`[MUST]`** 每个 `source_system` 在 Assembler 中有一个 maturity 评分。评分低于阈值的 source_system，其 Block 的 `always_on` 能力被关闭（降级为 `on_demand`）。

**当前各 source_system 的初始 maturity 状态**：

| source_system | 初始状态 | 说明 |
|---------------|---------|------|
| role-contract | always_on 可用 | 已稳定 |
| role-memory | always_on 可用 | 已稳定 |
| task-loop | always_on 可用（adapter 完成后） | 需要 adapter |
| working-memory | always_on 可用（新建后） | 新建 |
| cvk | always_on 可用 | 已有 views.ts |
| compass | on_demand only | 质量门未达标，保持现状 |
| sekb | on_demand only | 新接入，保守启动 |
| codegraph | on_demand only | 按需触发 |
| agent-map | on_demand only | 实验阶段 |

---

## 第六章：三个新增工具规范

这三个工具是 Working Context 层对 agent 暴露的操作接口。

### context_read

```typescript
// 展开 on_demand Block 的详细内容
{
  name: 'context_read',
  description: 'Read the full content of a context block. Use when you need details beyond the summary shown in your system prompt.',
  parameters: {
    block_type: BlockType,
    category?: string     // tool_registry 用：展开特定分类
  },
  returns: string  // Block 的 full_content
}
```

**`[MUST]`** 此 tool 不受 role 白名单过滤。所有 role 都可以使用（读取是安全操作）。

**`[MUST]`** 调用此 tool 不触发 `post_tool_call` Hook（避免把"查看上下文"记录为工作记忆条目）。

---

### context_write

```typescript
// 编辑 agent_writable Block
{
  name: 'context_write',
  description: 'Update a writable context block. Only available for blocks with agent_writable mutability.',
  parameters: {
    block_type: BlockType,
    operation: 'append' | 'replace_section' | 'clear',
    content: string,
    section_id?: string  // replace_section 时指定
  },
  returns: { success: boolean; error?: string }
}
```

**`[MUST]`** 执行前检查：
1. Block 的 `mutability` 必须是 `agent_writable`，否则返回 permission error
2. 当前 role 的白名单必须包含 `context_write`，否则返回 permission error
3. 写入内容必须通过 entity 提取，更新 `block_entity_map`

**`[MUST]`** 此 tool 的调用触发 `post_tool_call` Hook，`significance='medium'`。

**初始白名单**：只有 `planner` 和 `architect` 角色包含此 tool。

---

### context_search

```typescript
// SAG 式跨 Block 搜索
{
  name: 'context_search',
  description: 'Search across background context blocks. Returns blocks related to your query via entity matching and semantic similarity.',
  parameters: {
    query: string,
    block_types?: BlockType[],   // 不填 = 搜索所有类型
    scope?: 'session' | 'all'   // 是否限制在当前 session
  },
  returns: ContextBlock[]  // 按相关度排序
}
```

**`[MUST]`** 实现顺序：
1. 从 `query` 中提取候选 entities（规则提取，不调 LLM）
2. SQL：`SELECT DISTINCT block_id FROM block_entity_map WHERE entity IN (candidates)`
3. 向量：对 SQL 候选结果做 semantic rerank
4. 返回 top-K 结果（K ≤ 5）

**`[MUST NOT]`** 不允许跳过步骤 2 直接做步骤 3。如果 entity 候选为空，返回空数组，不做全量向量检索。

**初始白名单**：`planner`、`architect`、`researcher`（如有）。

---

## 第七章：禁止项（反模式清单）

以下行为在任何实现中均不允许出现：

```
[ANTI-1] 直接 string 注入
  禁止：`systemPrompt += someContent`
  必须：通过 ContextBlock + Assembler

[ANTI-2] 链式摘要
  禁止：summary = summarize(otherBlock.summary)
  必须：summary 来自 full_content 或原始数据

[ANTI-3] subagent 接收 COMPASS 注入
  禁止：subagent session 触发 COMPASS Handler
  必须：subagent knowledge Block 来自 role-memory Handler

[ANTI-4] 工具全量 schema 注入 always_on
  禁止：tool definition JSON 出现在 always_on Block 的 summary 中
  必须：summary 只有工具名 + 单行描述

[ANTI-5] Dreaming bypass AUDN
  禁止：Dreaming 产出直接写入 TemporalFact 跳过冲突检测
  必须：所有 Dreaming 产出经过 AUDN 检查

[ANTI-6] 无索引全表查询
  禁止：BlockStore.query() 产生全表 scan
  必须：所有查询有 WHERE 子句且命中索引

[ANTI-7] 角色权限通过 context 绕过
  禁止：通过修改 persona Block 来扩展工具权限
  必须：权限判断永远从 RoleContract 原始定义读取

[ANTI-8] 蒸馏结果不回写
  禁止：SEKB distillation 只写 SekbPrinciples 表
  必须：同时写入 BlockStore 作为 experience Block

[ANTI-9] handoff 自由文本
  禁止：handoff_pack 是 markdown 或自然语言段落
  必须：handoff_pack 是可机器解析的 JSON，含 task_state full_content
```

---

## 第八章：迁移顺序与验收标准

### 阶段 0：接口层（不动任何现有逻辑）

**交付物**：
- `context-engine/block.ts`（`ContextBlock` interface）
- `context-engine/block-store.ts`（`BlockStore` interface + SQLite 实现）
- `context-engine/hook-bus.ts`（`HookBus` + `HookHandler` interface）
- `context-engine/assembler.ts`（`Assembler` 骨架，内部暂时调用现有 `computeMemoryExtraSystemPrompt`）

**验收**：TypeScript 编译通过，现有功能零回归（Assembler 暂时是 pass-through）。

---

### 阶段 1：working_memory Handler（收益最高的新增）

**交付物**：
- `context-engine/handlers/working-memory-handler.ts`
- 注册到 HookBus 的 `post_tool_call` 事件
- working_memory Block 在 `pre_llm_call` 时注入 Assembler

**验收**：执行任意工具调用后，system prompt 中出现 `## Recent Actions` 段落，内容准确反映最近 5 步操作。

---

### 阶段 2：task_state Adapter（解决 Loop 断代）

**交付物**：
- `context-engine/handlers/task-loop-handler.ts`（适配 `task-loop-context.ts`）
- `task_phase_change` Hook 触发 SEKB trajectory-capture
- handoff 格式从自由文本改为 JSON

**验收**：Task Loop 运行时，`task_state` Block 的 `phase` 字段准确反映当前执行阶段。Loop 完成后 SEKB `SekbTrajectories` 表有新记录。

---

### 阶段 3：tool_registry Block（CVK 升级）

**交付物**：
- `context-engine/cvk/views.ts` 升级为产出 `ContextBlock`
- always_on summary 格式符合第三章规范
- `context_read` tool 注册并可展开详情

**验收**：system prompt 中工具部分 ≤ 200 tokens（现状通常 500+ tokens）。调用 `context_read('tool_registry', 'Files')` 返回完整文件工具 schema。

---

### 阶段 4：knowledge Block 统一（COMPASS + Role Memory）

**交付物**：
- `context-engine/handlers/compass-handler.ts`（适配 `memory-pre-reply-injection.ts`）
- `context-engine/handlers/role-memory-handler.ts`（适配 `memory/context-pack.ts`）
- double-injection 防护（main session 用 compass，subagent 用 role-memory）

**验收**：main session 和 subagent session 的 knowledge Block 来源互斥，observability trace 中无重复注入记录。

---

### 阶段 5：SEKB 蒸馏回写（闭合 [P3] 约束）

**交付物**：
- SEKB distillation 产出写入 BlockStore（`experience` Block）
- `context_read('experience')` 可展开蒸馏结果

**验收**：完成一次 Task Loop（`to_phase='done'`）后，24 小时内（异步蒸馏完成后），`experience` Block 在 BlockStore 中可查询到对应的 principle。

---

## 预期架构效果（最终态）

```
当前（信息孤岛）：

  role-spawn → prompt string（直接）
  computeMemoryExtraSystemPrompt → prompt string（直接）
  buildContextPack → prompt string（直接）
  task-loop-context → prompt string（直接）
  ↓
  LLM 看到：东拼西凑、预算不协调、来源不透明的 system prompt

目标（统一联邦）：

  role-spawn → [persona Block]
  working-memory-handler → [working_memory Block]（新增）
  task-loop-handler → [task_state Block]
  cvk-handler → [tool_registry Block]
  compass-handler → [knowledge Block]（main only）
  role-memory-handler → [knowledge Block]（subagent only）
  sekb-handler → [experience Block]（on_demand）
       ↓
  BlockStore（entity 索引 + 时间有效性）
       ↓
  Assembler（budget 分配 + priority 排序 + 降级决策）
       ↓
  LLM 看到：预算受控、来源清晰、按角色裁剪的 system prompt
  LLM 可调用：context_read / context_write / context_search
              主动展开或编辑自己的上下文
```

**最终 system prompt 的结构**（目标态）：

```
## Role: implementer          ← persona Block (always_on, 300 tok)
...

## Current Task               ← task_state Block (always_on, 500 tok)
Objective: ...
Phase: executing (3/7)

## Recent Actions             ← working_memory Block (always_on, 400 tok)
[5] write(src/x.ts) → success: updated 3 functions
[4] bash(tsc --noEmit) → success: 0 errors
...

## Tools (12 available)       ← tool_registry Block (always_on, 200 tok)
Files: read✓ write✓ search✓ (3)
Code: ast_query✓ codegraph✓ (2)
...
→ context_read('tool_registry', category) for full schema

                              ← knowledge/experience: on_demand only
                                 agent 按需调用 context_search 获取
```

这份规范是 ClawX Working Context 系统的唯一设计真相源。所有实现决策以此为准，与此约束冲突的设计需要在实现前提出修改申请并更新规范版本。