# DCS-v1.0 规范对抗性审阅意见

**审阅对象**：`C:\Users\27933\Desktop\clawx\team\README.md`（ClawX Working Context × Memory 统一设计约束规范 DCS-v1.0）
**审阅日期**：2026-07-10
**审阅基础**：codegraph 全量扫描（11,381 文件 / 254,192 节点）+ 关键子系统代码事实审计
**审阅立场**：对抗性思维，重点找未考虑的边界、与现有代码冲突的点、以及"听起来对但落地会出问题"的设计

---

## 0. 总体判断

**规范方向正确**：去孤岛、统一 ContextBlock 通货、budget 集中管理，这三个核心诉求与你的目标一致。

**但有 7 个关键问题**，其中 3 个会导致落地失败，4 个会在中期反噬。下面逐条说明。

---

## 1. 【致命】ContextBlock 没有"准入门槛"——这正是你担心的"什么都往里塞"

### 问题

规范定义了 7 种 BlockType，但**没有任何一种有写入准入条件**。规范只规定了：
- `persona` → session_start 时由 role-contract 写入
- `task_state` → task_phase_change 时由 task-loop 写入
- `working_memory` → post_tool_call 时由 working-memory-handler 写入
- `knowledge` → compass / role-memory 写入
- `experience` → SEKB 蒸馏后写入
- `environment` → codegraph 按需写入

**每个 source_system 都有写入权，但没有"是否值得写入"的判断**。这会导致：

1. **working_memory 滚动窗口变成垃圾箱**：规范说"significance='low' 不写入 COMPASS，只保留在 working_memory Block 的滚动窗口中"。但 low significance 的操作（读取、bash echo）为什么要占用 always_on 的 400 token？你的诉求是"不能什么中间信息都往里塞"，而规范恰恰把低价值中间信息塞进了 always_on。
2. **SEKB 蒸馏的每一条 principle 都变 Block**：规范 [P3] 说"蒸馏必须形成回写闭环"，但没说蒸馏结果需要经过质量过滤才写 BlockStore。SEKB 的 `suggest_principles_from_trajectories` 返回的是 advisory only 建议列表，其中很多是低质量或重复的。全量写入会让 experience Block 膨胀。
3. **COMPASS 的 TemporalFact 无差别转 Block**：规范 [P3] 说"significance='high' 的工具调用必须触发 COMPASS TemporalFact 写入"。但 COMPASS 自己的 AUDN 已经在做质量治理，如果再无差别转 Block，等于在 BlockStore 里重建一份未经治理的事实副本。

### 修复建议

在第二章增加约束 **[P0] Block 准入门槛（新增）**：

```
[P0] Block 准入门槛

[MUST] 每个 BlockType 必须定义明确的准入条件，不满足条件的信息不允许写入 BlockStore。

[MUST] working_memory Block 的准入条件：
  - significance='high' 或 'medium' 才写入滚动窗口
  - significance='low' 的操作只写入 observability trace，不进入 Block
  - 滚动窗口满 5 条时，significance='low' 的条目优先被挤出

[MUST] experience Block 的准入条件：
  - SEKB principle 必须经过 confirm_and_save（人工或 agent 确认）才写 BlockStore
  - suggest_principles_from_trajectories 的 advisory 结果不直接写 Block
  - 单个 session 的 experience Block 数量上限 = 3

[MUST] knowledge Block 的准入条件：
  - COMPASS TemporalFact 转 Block 必须经过 evidence-discipline 验证
  - confidence < 0.6 的 fact 不转 Block
  - AUDN 判定为 superseded 的 fact 不转 Block

[MUST] environment Block 的准入条件：
  - 只在 hint_entities 命中文件路径时触发
  - 单次 session 的 environment Block 数量上限 = 2
```

---

## 2. 【致命】HookBus 是新的单点故障，且与现有 plugins/hooks/ 职责重叠

### 问题

规范说"HookBus 是各子系统与 context 系统的唯一接入点"，并且"子系统不直接调用 BlockStore.upsert()，而是注册 HookHandler"。

**但现有代码已经有 3 套 hook 机制**：

1. `openclaw_runtime/src/hooks/`（20+ 模块）：plugin 生命周期 hook，含 `before_agent_start` / `before_tool_call` / `tool_result` / `agent_end`
2. `openclaw_runtime/src/agents/harness/`（21 模块）：agent harness hook，含 `hook-context` / `hook-helpers` / `hook-history` / `native-hook-relay` / `lifecycle-hook-helpers`
3. `openclaw_runtime/src/plugins/` 的 `hooks/`（15+ 模块）：plugin runtime hook，含 `host-hook-runtime` / `host-hook-cleanup` / `host-hook-scheduled-turns`

**SEKB 的 `harness-integration.ts` 已经接入了第 1 套 hook**（`installSekbHarnessHooks` 订阅 `before_agent_start` / `before_tool_call` / `tool_result_persist` / `tool_result` / `agent_end`）。

规范新增第 4 套 HookBus，事件类型还与现有 hook 部分重叠（`session_start` ≈ `before_agent_start`，`post_tool_call` ≈ `tool_result`，`task_phase_change` 是新的）。

**后果**：
- 4 套 hook 系统并存，开发者不知道该注册哪个
- SEKB 等已接入现有 hook 的子系统需要双重注册（现有 hook 做原有逻辑 + HookBus 做 Block 写入）
- HookBus 故障会导致所有 Block 写入失败，而现有 hook 不受影响——这种部分失效比全失效更难排查

### 修复建议

**不要新建 HookBus，而是复用现有 `agents/harness/` 的 hook 机制**。具体：

1. 在 `agents/harness/hook-context.ts` 增加 `contextBlockSink` 字段，让现有 hook handler 可以选择产出 `ContextBlock[]`
2. 在 `agents/harness/lifecycle.ts` 的 hook 调度点收集 Block 产出，统一写入 BlockStore
3. 保留规范中 HookBus 的**事件类型定义**（`session_start` / `pre_llm_call` / `post_tool_call` / `task_phase_change` / `role_handoff`），但作为现有 hook 的**语义别名**，不是新的总线
4. 新增 `task_phase_change` 事件确实需要加到现有 hook 中（这个是规范正确指出的缺失点）

---

## 3. 【致命】Assembler 替换 `computeMemoryExtraSystemPrompt` 的迁移路径有隐藏陷阱

### 问题

规范说"`computeMemoryExtraSystemPrompt` 最终被替换为 `Assembler.assemble()`"，并且阶段 0 让"Assembler 暂时调用现有 `computeMemoryExtraSystemPrompt`"作为 pass-through。

**但代码事实是**：`computeMemoryExtraSystemPrompt` **不在 `runtime-core/memory-pre-reply-injection.ts` 中**，而在 `context-engine/chat-turn-memory-injection.ts:219`，签名是 `(extraSystemPrompt, cfg, sessionKey, providerFactory, log?) => Promise<string | undefined>`。

更关键的是：**COMPASS 的 pre-reply 注入和 chat-turn memory injection 是两条独立路径**：

1. **COMPASS pre-reply 注入**（`runtime-core/memory-pre-reply-injection.ts`）：`buildPreReplyInjection` 产出 `PreReplyInjection` 结构体（含 `sspString` / `top5FactsString` / `updatedSSP`），由调用方 unshift 到 `extraSystemPromptParts`
2. **Chat-turn memory injection**（`context-engine/chat-turn-memory-injection.ts`）：`computeMemoryExtraSystemPrompt` 调用 `assembleChatTurnMemoryInjection`（provider 工厂模式），是另一条 pilot 路径

规范把它们当成同一条路径来替换，会导致：
- Assembler pass-through 时不知道该调哪个（两个函数签名完全不同）
- 迁移过程中两条路径的注入顺序可能错乱（COMPASS 是 unshift 到头部，chat-turn 是 append）
- `runtime.memory.injectPilot` 的 `main-only` scope 门控在 chat-turn 路径里，不在 COMPASS 路径里——规范 [ANTI-3] 说"subagent 不触发 COMPASS Handler"，但 COMPASS 自己根本没这个门控

### 修复建议

1. **修正规范的事实错误**：明确 `computeMemoryExtraSystemPrompt` 位于 `context-engine/chat-turn-memory-injection.ts`，不是 `runtime-core/memory-pre-reply-injection.ts`
2. **分别处理两条路径**：
   - COMPASS pre-reply 注入 → 改造为 `compass-handler.ts`，产出 knowledge Block
   - chat-turn memory injection → 改造为 `chat-turn-memory-handler.ts`，产出 working_memory Block（或合并到 working_memory Block）
3. **main-only scope 门控必须显式实现**：规范 [ANTI-3] 的约束"subagent 不触发 COMPASS Handler"在当前代码中**不存在**（COMPASS 只有 feature flag 和 persist flag）。这个门控必须新建，不能假设已有。建议在 Assembler 层根据 `session_id` 模式（`agent:<id>:<role>` = subagent）判断，不是在 Handler 层。

---

## 4. 【中等】摘要链深度为 1 的约束会破坏 COMPASS 的 SSP 机制

### 问题

规范 [P4] 说"不允许用另一个 ContextBlock 的 summary 作为输入来生成新的 summary"，并且"Dreaming 系统产出在写入 COMPASS 或 BlockStore 之前不允许经历超过 1 次摘要压缩"。

**但 COMPASS 的 SSP（Session State Protocol）机制本身就是一个摘要链**：

- `memory-session-state.ts` 的 `updateSSPPostReply` 会从 reply payload 提取可见文本（`observePostReplyInjection`），然后更新 SSP
- SSP 本身是对会话历史的压缩摘要
- `buildSSPInjection` 把 SSP 渲染为 string 注入 prompt

如果 SSP 是 Block 的 summary 来源，而 SSP 本身又是会话历史的摘要，那 summary 就经历了"会话历史 → SSP → Block summary"两次压缩，违反 [P4]。

**更深的问题**：COMPASS 的 `TemporalFact` 也不是原始数据——它是从 LLM 回复或工具结果中抽取的结构化事实，已经经历了一次"提取"（不是摘要，但类似）。如果 TemporalFact 转 knowledge Block，Block 的 summary 是 TemporalFact 的再压缩，又是两次。

### 修复建议

[P4] 约束需要细化，区分"摘要"和"提取"：

```
[P4] 摘要链最大深度为 1（修订）

[MUST] 区分"摘要压缩"（有损）和"结构化提取"（无损或低损）：
  - SSP 更新属于摘要压缩（有损）
  - TemporalFact 抽取属于结构化提取（低损，保留原始字段）
  - SEKB principle 蒸馏属于摘要压缩（有损）

[MUST] 摘要压缩链最大深度为 1：
  - 会话历史 → SSP → Block summary ✓（1 次摘要）
  - 会话历史 → SSP → Block summary → 另一个 Block summary ✗（2 次摘要）

[MUST] 结构化提取不计入摘要深度：
  - LLM 回复 → TemporalFact → Block summary ✓（1 次摘要 + 1 次提取）
  - 但 TemporalFact → Block summary → 另一个 Block summary ✗（2 次摘要）

[MUST] SSP 作为 Block summary 来源时，必须记录 `derivation_chain` 元数据：
  - source_type: 'raw_transcript' | 'ssp' | 'temporal_fact' | 'sekb_principle'
  - compression_count: number  // 摘要次数，最大 1
```

---

## 5. 【中等】BlockStore 的 entity 索引假设了 entity 提取的可靠性，但现有实现不稳定

### 问题

规范 [P2] 说"每次写入 Block 时必须提取 entities，用于 SAG 式 SQL 查询"，并且"context_search 必须先 SQL 候选筛选再向量排序"。

**但现有 entity 提取实现有已知问题**（来自项目 memory）：

1. `memory-entity-extraction.ts` 的提取依赖规则（文件路径、函数名、角色名、任务 ID、工具名），但**多跳问题的实体链接质量差**（J Score ~53-56%，LLM classifier 误分类率 53.1%）
2. `memory-entity-resolver.ts` 的 entity resolution 是 feature flag 控制的（`enableEntityResolverInBridge` 默认 false），说明它本身还没达到生产质量
3. `memory-bridge-discovery.ts` 的桥发现也依赖 entity 匹配，但 multi_hop 仍是 critical bottleneck

如果 BlockStore 的 SAG 查询完全依赖 entity 索引，而 entity 提取质量不达标，会导致：
- `context_search` 召回率低（entity 没提取出来 → SQL 候选为空 → 返回空数组）
- 规范 [P2] 的 `[MUST NOT]` "entity 候选为空时不做全量向量检索"会变成硬性障碍——entity 提取失败时 agent 完全无法搜索

### 修复建议

1. **SAG 查询增加 fallback 路径**：entity 候选为空时，允许降级为纯向量检索，但标记 `fallback_mode: 'vector_only'` 到 observability trace
2. **entity 提取质量门控**：BlockStore 写入时如果 entity 提取失败或为空，记录 `entity_extraction_status: 'failed' | 'empty' | 'success'`，不阻塞写入
3. **推迟 [P2] 的强制 SAG 约束**：在 entity 提取质量达到 J Score ≥ 65% 之前，SAG 是优化项不是硬约束

---

## 6. 【中等】quality gate 的 maturity 评分没有给出评估方法

### 问题

规范第五章定义了 quality gate：评分低于阈值的 source_system 的 `always_on` 能力被关闭。各 source_system 的初始状态也给出了（compass/sekb/codegraph/agent-map 是 on_demand only）。

**但没有定义**：
- 评分怎么算？指标是什么？
- 什么时候重新评估？周期还是事件触发？
- 评分下降时已经在 BlockStore 里的 Block 怎么处理？
- 评分上升时 on_demand 升级 always_on 的触发条件是什么？

### 修复建议

补充 quality gate 的评估方法：

```
quality gate 评估方法（新增）

[MUST] 评分指标（每个 source_system 独立计算）：
  - injection_hit_rate: Block 被 Assembler 选中注入 prompt 的比例
  - agent_usage_rate: on_demand Block 被 context_read/context_search 展开的比例
  - token_efficiency: Block 的 summary token 数 / 实际有用信息量
  - freshness: Block 的 valid_at 与当前时间的差值

[MUST] 评估周期：
  - 每 100 次 LLM call 重新计算一次
  - 评分下降到阈值以下时立即降级（不等周期）
  - 评分上升到阈值以上时需要连续 2 个周期稳定才升级

[MUST] 降级处理：
  - always_on → on_demand：Block 保留在 BlockStore，只是不自动注入
  - on_demand → disabled：Block 标记 stale，context_search 不返回
```

---

## 7. 【中等】role_handoff 的 handoff_pack 假设了不存在的 handoff 机制

### 问题

规范第四章定义了 `role_handoff` 事件和 `handoff_pack`，要求打包 task_state / working_memory / block_id 列表。

**但代码事实是**：`team-orchestrate-tool.ts` 的实际产出是大型 JSON（含 30+ 字段：status/plan/synthesisContract/routeDiagnostics/taskGraph/resultBundle/blackboardState 等），**完全没有 handoff_pack 概念**。

更关键的是：**Role-First 的角色切换机制是通过 `spawnRoleSubagent` 生成新 subagent，不是"handoff"**。新 subagent 有自己的 session_id、自己的 system prompt、自己的工具白名单——它不接收父 session 的 task_state 或 working_memory 作为"handoff"。

现有的 subagent spawn 路径（`role-spawn.ts`）只传递：
- `roleSystemPrompt`（角色契约编译的 SOUL）
- `memoryCards`（role memory，按 role name 查询）
- `extra`（调用方传入的额外 prompt）

**不传递父 session 的 task_state 或 working_memory**。

规范假设的 handoff 机制在当前架构中不存在，要实现它需要：
1. 改造 `spawnRoleSubagent` 接受 handoff_pack 参数
2. 新 subagent 的 `session_start` hook 能解析 handoff_pack
3. 多个 subagent 之间的 task_state 共享需要跨 session 的 BlockStore 查询

### 修复建议

1. **明确 handoff 的两种模式**：
   - **spawn handoff**（父 → 子）：通过 `spawnRoleSubagent` 的 `extra` 参数传递 handoff_pack
   - **sequential handoff**（前 → 后，同一 session 内角色切换）：当前不支持，需要新增
2. **阶段 2 的 handoff 交付物应该拆分**：
   - 先实现 spawn handoff（改造 spawnRoleSubagent）
   - sequential handoff 推迟到阶段 3 之后
3. **handoff_pack 格式应该最小化**：不要打包整个 task_state full_content，只打包：
   - objective（≤2000 chars）
   - 最近 5 条 working_memory entry
   - 当前 phase
   - 这比规范的"完整 JSON task_state + 10 条 entry + block_id 列表"轻量得多

---

## 8. 【次要】context_write tool 的初始白名单过窄

### 问题

规范说 context_write 的初始白名单只有 `planner` 和 `architect`。

**但 implementer 是实际执行任务的角色**，它需要更新 task_state（标记进度）、记录 working_memory（记录操作）。如果 implementer 不能 context_write，那 working_memory Block 只能靠 system_managed 的 HookHandler 自动更新——但规范 [working_memory Block] 说 `mutability='system_managed'`，本来就不允许 agent 写。

那 context_write 到底写什么？规范说"编辑 agent_writable Block"，但没有定义哪个 BlockType 是 agent_writable。如果只有 task_state 和 working_memory 需要 agent 写，但它们都是 system_managed——那 context_write 实际上没有可写的 Block。

### 修复建议

1. **明确 agent_writable 的 BlockType**：建议新增 `notes` BlockType（agent 的个人笔记），`mutability='agent_writable'`
2. **扩展白名单**：至少 implementer 应该能写 notes Block（记录实现决策、TODO 等）

---

## 9. 【次要】SQLite Schema 缺少必要索引和约束

### 问题

规范的 schema 有 `idx_entity` / `idx_block_type_valid` / `idx_session` 三个索引，但缺少：

1. `source_system` 索引（`stats(source_system)` 查询会全表扫描）
2. `(block_type, source_system)` 复合索引（Assembler 按 BlockType + SourceSystem 筛选时需要）
3. `invalid_at` 单独索引（quality gate 查询有效 Block 时需要）
4. `block_entity_map` 的 `entity` 列没有 COLLATE NOCASE（entity 大小写不一致会导致 SAG 查询漏召回）

### 修复建议

```sql
CREATE INDEX idx_source ON context_blocks(source_system);
CREATE INDEX idx_block_type_source ON context_blocks(block_type, source_system);
CREATE INDEX idx_invalid ON context_blocks(invalid_at) WHERE invalid_at IS NULL;
-- entity 列改为
entity TEXT NOT NULL COLLATE NOCASE
```

---

## 10. 迁移顺序的依赖问题

### 问题

规范的阶段 1（working_memory Handler）在阶段 4（knowledge Block 统一）之前。但 working_memory 的 `significance='high'` 条目需要触发 COMPASS TemporalFact 写入（规范 [working_memory Block] 的 [MUST]）。

**如果阶段 1 完成但阶段 4 未完成**，working_memory Handler 会直接调用 COMPASS 的写入路径（绕过 BlockStore），这违反了 [P1] Block 原子性——虽然写入 COMPASS 不是注入 prompt，但它是 context 系统的写入路径。

### 修复建议

调整阶段 1 的验收标准：

```
阶段 1 验收（修订）：
  - working_memory Block 注入 Assembler ✓
  - significance='high' 的 COMPASS 写入暂不接入（推迟到阶段 4）
  - 只更新 working_memory Block 滚动窗口，不触发 COMPASS
```

---

## 总结：7 个问题的优先级

| # | 问题 | 严重度 | 阻塞阶段 |
|---|------|--------|---------|
| 1 | Block 没有准入门槛 | 致命 | 阶段 1 |
| 2 | HookBus 与现有 3 套 hook 重叠 | 致命 | 阶段 0 |
| 3 | Assembler 迁移路径事实错误 | 致命 | 阶段 0 |
| 4 | 摘要链深度约束破坏 SSP | 中等 | 阶段 4 |
| 5 | entity 索引假设提取质量达标 | 中等 | 阶段 4 |
| 6 | quality gate 没有评估方法 | 中等 | 阶段 3+ |
| 7 | role_handoff 假设不存在的机制 | 中等 | 阶段 2 |
| 8 | context_write 白名单过窄 | 次要 | 阶段 1 |
| 9 | SQLite Schema 索引不足 | 次要 | 阶段 0 |
| 10 | 迁移顺序依赖问题 | 次要 | 阶段 1 |

**建议**：在开始阶段 0 实现之前，先修订规范解决 #1/#2/#3 三个致命问题。否则阶段 0 的 pass-through Assembler 和 HookBus 骨架会建在错误的基础上，后续返工成本很高。
