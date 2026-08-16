# Context Capability Convergence Blueprint（终极上下文能力收敛设计 · rev2 独立审计稿）

| 字段 | 值 |
|---|---|
| 文档状态 | `draft-rev2`（已吸收独立审计 `revise` 结论，**仍未授权实施**） |
| 审计结论 | `revise`：保留“关闭旁路、停止加模块、先拿窄场景证据”；改写 Mem/DCS 职责边界与 replay、安全、预算契约 |
| 关联 ADR | `docs/dev/adr/2026-08-16-context-authority-boundaries.md` |
| 创建日期 | 2026-08-16 |
| 修订日期 | 2026-08-16 |
| 代码基线 | `033469f07cd4810f5fb6e521fc3c600a0d4d2cfc`（当前工作树 dirty，见 §11） |
| 证据等级 | 本文所有结论最高 E0–E3（源码 / 接线 / 受控测试），不包含 E4/E5 真人生产证据 |
| 审计对象 | Tool 注册与披露、Skill 注册与披露、Mem 语义记忆、模块化上下文、Working Context、DCS 投影、Provider Guard 与观察/恢复 |
| 目标读者 | 独立审计 agent（可挑战本文任何事实、因果、权威矩阵与分期） |

---

## 0. 给审计 agent 的阅读说明

1. 本文分四类内容：
   - `现状`：只描述当前代码/文档中可验证的事实，并给源码锚点。
   - `问题`：本文作者对因果的推断，标注影响面。
   - `目标`：权威矩阵与目标架构。
   - `解决方案`：待审提案，不是已批准计划。
2. rev2 已修正 rev1 最重要的权威冲突：
   - 不再使用“Mem 是所有 ContextUnit 的索引与生命周期骨干”这一表述；
   - 明确 **V3 管能力目录、DCS 管上下文裁决、Mem 管持久语义记忆与检索、Working Context 是任务账本**；
   - 增加 Provider Guard 作为最终 RequestEnvelope 的机器边界。
3. 审计时请优先核验：
   - 权威矩阵是否仍有重叠；
   - 旁路清单是否完整；
   - replay 承诺是否与 receipt 只存 digest/ref 的事实一致；
   - 安全/敏感信息治理是否可执行；
   - 各 Phase 的验收门槛是否可证伪。
4. 本文不要求审计 agent 接受任何 default-on、GA、真人证据外推或联合放行结论。
5. 与代码冲突时，以当前工作树源码和最新 artifacts 为准。

---

## 1. rev1 独立审计结论与 rev2 响应

独立审计结论：**revise**。审计认可的问题点：

- 正确把 prompt 旁路列为最高优先级；
- Owner 与投影分离、禁止复制 payload、Fast Path 与 Mem Path 分流，方向正确；
- Working Context 应为任务级状态，而非“最近 N 条工具结果”；
- 分阶段、shadow、kill switch、单写入权威、逐表面毕业都稳健。

审计要求修正的点及本文响应：

| 审计意见 | rev2 处理 |
|---|---|
| Mem 不应拥有所有 ContextUnit 的索引、freshness、provenance、生命周期 | 权威改为：V3 = 能力目录，DCS = 上下文裁决，Mem = 持久语义记忆与检索，Working Context = 任务账本。见 ADR |
| CapabilityDescriptor 不应承载每条事实/工具输出/工作状态 | 明确 descriptor 只覆盖 Tool/Skill/Context-provider 发现元数据 |
| Provider Guard 必须先做，覆盖 system/messages/tools/media/所有 transform | 提升为 Phase B，先 observational，后 fail-closed |
| 完整 `ContextUnit/v1` 不应延后到最小三字段 | 提升为 Phase C，包含 scope/freshness/sensitivity/merge/evidence/trust；`ContextCandidate` 仅作最终渲染候选 |
| Working Context 应实现为版本化 Task Ledger | 提升为 Phase D，定义更新者、证据、冲突、TTL、fork/compact/handoff 合并、晋升 |
| replay 应区分“审计可追溯”和“可复现重放” | 明确 Receipt 只存 digest/ref；重放分两档 |
| 需补安全与数据治理 | 增加 sensitivity/trust/redaction/retention/权限与 prompt-injection 治理 |
| 预算需覆盖 token、工具 schema、媒体、输出 reserve；critical 超窗要有降级策略 | 改为 unit-aware token packer；critical 超窗显式失败/降级，不裸截断 |
| Phase E 10 个真人任务不足支持 default-on | 重新定义为探索证据；毕业需预设基线、对照、P95 延迟/成本、关键约束保留率、14–28 天 soak |

---

## 2. 执行摘要

### 2.1 一句话结论

项目已具备上下文能力的多数零件，但零件没有汇流成同一个上下文服务。工程成熟度约 6.5–7/10，集成为“终极上下文能力”的成熟度约 2.5–3/10。后续工作的本质是**接线、关闭旁路、补齐可执行契约、拿窄场景真实证据**，不是继续增加模块。

### 2.2 核心判断

1. **V3 只做能力目录**：Tool/Skill/Context-provider 的发现元数据统一由 `CapabilityDescriptor` 表达；执行/正文仍由 Runtime、MCP、Skill loader 拥有。
2. **DCS 做上下文权威**：admission、resolve、token pack、compile、lineage 的唯一 owner。
3. **Mem 做持久语义记忆与检索**：只对需语义处理的信息产出高密度候选；不做通用 ContextUnit 目录。
4. **Working Context 做任务账本**：task-scoped、版本化、可合并、可晋升，不是长期记忆。
5. **Provider Guard 做最终边界**：所有最终请求生成完整 `RequestEnvelope` digest；遗留 hook 迁移为 `PromptContribution`。
6. **先观测后强制，先窄场景后毕业**：新增边界先 observational，不得改变发送行为；任何 default-on 必须有真实证据。

### 2.3 综合成熟度

| 平面 | 现有实现代表 | 工程成熟度 | 集成成熟度 |
|---|---:|---:|
| 能力平面（Tool/Skill/Rule 注册与披露） | native tools、tool_registry、Tool Search、CVK、V3 | 8/10 | 3.5/10 |
| 记忆平面（持久语义记忆） | Role Memory、Runtime Memory、memory-core、BlockStore、SEKB | 7/10 | 2.5/10 |
| Working Context / 任务账本 | working-memory Block、task_state、HandoffPack | 3/10 | 1/10 |
| 投影/编译平面（DCS） | Context Orchestrator、turn budget、lineage、RC-03 | 7/10 | 3/10 |
| Provider Guard / 观察恢复 | transcript、ArchiveHandle、Context Family shadow、compaction | 6/10 | 2.5/10 |

---

## 3. 术语与目标语义模型

### 3.1 术语

| 术语 | 本文定义 |
|---|---|
| CapabilityDescriptor | Tool/Skill/Context-provider 的统一发现元数据：id、revision、hash、permissions、dependsOn、stickiness、execution topology。**不承载事实、工具输出或工作状态。** |
| ContextUnit | 任何可能进入模型请求的原子信息引用/内容：用户意图、工具结果、工具契约、Skill 摘要、规则、事实、记忆、工作状态、推导结果。 |
| ContextCandidate | DCS 最终渲染候选。由 ContextUnit 产生，只用于投影，不作为 canonical 数据模型。 |
| DCS | 上下文权威：admission、resolve、token pack、compile、lineage。 |
| Mem | 持久语义记忆与检索：durable memory owner、governance、retrieval、summarization candidates。 |
| Task Context Ledger | Working Context 的版本化任务账本。 |
| PromptPlan | DCS compile 输出：进入 provider 的上下文计划。 |
| RequestEnvelope | Provider Guard 覆盖的最终请求：system、messages、tools、media、所有 transform。 |
| Receipt | selected/omitted/truncated、digest/ref、policy digest、budget、lineage 的审计记录；不存原始内容。 |
| Trust status | 输入在 prompt-injection / provenance / sensitivity 维度上的治理等级。 |

### 3.2 目标语义模型

```text
V3 Capability Catalog
  Tool / Skill / Context-provider descriptor
                 |
Owner stores -> ContextUnit refs -> Task Context Ledger
                                      |
Mem provider <-> semantic retrieval / summarization candidates
                                      |
DCS admission -> resolve -> token pack -> PromptPlan
                                      |
Provider Guard -> final RequestEnvelope -> provider
                                      |
Receipt / Archive journal
```

说明：

- `Owner stores` 仍是唯一原始 payload owner；
- `Task Context Ledger` 是任务级工作集，不是全局上下文索引；
- `Mem provider` 只是 DCS 的候选来源之一；
- `Provider Guard` 是最终请求边界；
- `Receipt / Archive journal` 只做审计可追溯。

---

## 4. 现状

### 4.1 当前真实数据流（含旁路）

```text
                  ┌──────────────────────────────────────────────┐
                  │       最终 system prompt（attempt.ts）        │
                  └──────────────────────────────────────────────┘
来源：
  1) COMPASS pre-reply SSP + top5   ──直插 extraSystemPromptParts──┐
  2) Role-spawn 子代理注入          ──直拼 system prompt──────────┤ 绕过
  3) Context Orchestrator：memory pilot + VToken                  │ Orchestrator
  4) DCS Assembler：compass / role-memory /
     working-memory / tool-registry                               │
  5) CVK addition                   ──candidate 路径（正确）──────┤
  hooks / media / model-identity /
  runtime-context                   ──事后直接覆盖 systemPrompt────┘

持久化侧：
  - src/memory（Role Memory/MEMORY.md 卡片，SQLite）
  - src/runtime-core/memory-persistence（Runtime Memory，SQLite）
  - extensions/memory-core / memory-lancedb / memory-wiki（插件宿主）
  - context_blocks（BlockStore/working memory/knowledge/tool_registry/task_state）
  - FactStore（代码事实：symbols/edges/chunks + provenance/heat）
```

当前不存在覆盖最终 RequestEnvelope 的 Provider Guard；RC-03 只覆盖候选增量，不覆盖完整 wire body。

### 4.2 能力平面：Tool 与 Skill

#### 4.2.1 Tool

现状：

- 真实执行由 Runtime 工具注册和 MCP 协议把守，这个边界清楚。
- `tool_registry` DCS Block 默认关闭，开启后注入最多 40 条工具摘要，完整 schema 通过 `context_read('tool_registry')` 展开。
- Tool Search 提供搜索/展开 schema。
- CVK 默认引擎把 active tools 编译为 selector view 导航。
- V3 `CapabilityDescriptor` 已定义 `skill/tool/context` 统一身份，但生产上尚无统一调用方。

源码锚点：

- `openclaw_runtime/src/agents/tool-catalog.ts`
- `openclaw_runtime/src/context-engine/handlers/tool-registry-handler.ts`
- `openclaw_runtime/src/context-engine/cvk/runtime-adapter.ts`
- `openclaw_runtime/src/capabilities/v3/capability-descriptor.ts`
- `docs/dev/capability-registry-v3-development-plan.md`

#### 4.2.2 Skill

现状：

- Skill 发现、过滤、安装、版本、workspace 路径管理完整。
- 生产 prompt 使用 top-k / compact 目录，模型被告知“最多先读一个 SKILL.md”。
- Skill 目录通过二分搜索适配字符预算。
- CVK 同时编译 skill metadata 为 selector view；V3 另有 opt-in skill resolver。

源码锚点：

- `openclaw_runtime/src/skills/loading/workspace.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`
- `openclaw_runtime/src/agents/system-prompt.ts`
- `openclaw_runtime/src/capabilities/v3/skill-resolver.ts`

#### 4.2.3 判断

Tool/Skill 的**执行与加载层成熟**，但**发现层有四套投影**：native tool schema、`tool_registry`、Tool Search/CVK、V3 descriptor。它们预算独立、版本来源不同、缓存失效语义不同。

### 4.3 记忆平面：Mem 语义记忆现状

#### 4.3.1 存储系统

| 存储 | 权威路径 | 主要能力 | 默认状态 |
|---|---|---|---|
| Role Memory | `openclaw_runtime/src/memory/` | MemoryCard、governance、ContextPack | 注入 pilot 默认关 |
| Runtime Memory | `openclaw_runtime/src/runtime-core/memory-*` | 事实/episode 存储、AUDN、hybrid retrieval、governance、event log | `runtime.memory.persist` 默认 false |
| memory-core / lancedb / wiki | `openclaw_runtime/extensions/memory-*` | 插件宿主、语义搜索、向量库 | 插件 slot 决定 |
| BlockStore | `openclaw_runtime/src/context-engine/block-store.ts` | knowledge/working_memory/tool_registry/task_state | 相关 flag 默认关 |
| FactStore | `openclaw_runtime/src/context-engine/factstore/` | 代码符号/边/chunk，内容哈希新鲜度 | 新 View 无生产调用方 |

#### 4.3.2 写入与注入路径

- COMPASS pre-reply 在 `get-reply-run.ts` 直接构造 `extraSystemPromptParts`，注释明确“绕过 context-engine”。
- Role-spawn 在 `role-spawn.ts` 直接把 Role Memory pack 拼进子代理 system prompt。
- memory pilot 通过 `chat-turn-memory-injection.ts` 进入 Context Orchestrator。
- DCS Assembler 通过 BlockStore 处理 compass / role-memory / working-memory / tool-registry。
- CVK addition 通过 candidate 路径进入 Orchestrator。

#### 4.3.3 模型可见的记忆工具面

当前至少存在：

- `memory_search`：插件后端语义搜索；
- `memory_get`：读取记忆文件；
- `memory_query`：Runtime Memory 事实查询；
- `context_read / context_search`：DCS Block 读取/检索。

后端、数据、权限与预算不同，但模型视角是同域多个“记忆工具”。

#### 4.3.4 已实现但未接主流程的 Runtime Memory 模块

`memory-evidence-discipline`、`memory-budget`、`memory-event-log` 等模块在评测/trace 层验证充分，但生产调用链未完整接入。

#### 4.3.5 单写入权威约束

`slot-convergence.ts` 已建立 RC-07 census，并显式承认 `memory-core` 与 `runtime-memory-persistence` 是两个 durable authority；`runtime.memory.persist=true` 且 slot 不是 runtime-memory 时构成 parallel writer，启动期 fail-closed 拒绝。

### 4.4 Working Context 现状

- 生产实现只有 `working-memory-handler.ts`：
  - 读取 tool result envelope 中的 `result_summary`；
  - 只保留 high/medium；
  - 最多 5 条；
  - 注入为 `## Recent Actions`。
- `task_state` 只在 TaskLoop 路径产生。
- `HandoffPack` 只服务子代理切换。
- 普通 coding turn 没有 Objective/Constraints/ConfirmedFacts/Decisions/OpenRisks/ActiveFiles/Evidence/NextAction 的完整任务账本。

### 4.5 投影平面现状

- Context Orchestrator 是候选收集、去重、排序、预算和 lineage 的单一入口之一。
- precedence 固定：`knowledge -> working_memory -> tool_registry -> cvk_addition -> vtoken -> memory_pilot`。
- 预算为 6000 字符 flat pool，超限用 `text.slice(0, rem-1) + "…"` 前缀截断。
- `ContextCandidate/v1` 只有 `text/sourceId/channel/target/authority`，没有完整语义字段。
- RC-03 已实现 per-model-call `ContextBundle/v1` 与 `ContextReceipt/v1`，但默认关闭；开启时只封候选增量，不是最终 wire body。
- `attempt.ts` 在 Orchestrator 之后仍有多处 `setActiveSessionSystemPrompt` 直接覆盖。
- 候选集合、turn ledger、sealed plan 均为进程内 Map；compact/fork/handoff 后不可 replay。

源码锚点：

- `openclaw_runtime/src/context-engine/context-orchestrator.ts`
- `openclaw_runtime/src/context-engine/context-candidate.ts`
- `openclaw_runtime/src/context-engine/turn-injection-budget.ts`
- `openclaw_runtime/src/context-engine/injection-budget.ts`
- `openclaw_runtime/src/context-engine/rc03-seal-hook.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`

### 4.6 观察/恢复平面现状

- tool result truncation 会生成 checksum-backed ArchiveHandle，并写 lifecycle event。
- Context Family shadow registry 已在 agent-session 中摄入 system prompt、user/assistant/tool result、compaction summary。
- Context Family 语义词汇已定义。
- 这些主要是 shadow / diagnostics，尚未成为上下文投影和恢复的统一 authority。

源码锚点：

- `openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts`
- `openclaw_runtime/src/context-engine/registry/context-item-registry.ts`
- `docs/context-family/axioms.md`
- `docs/context-family/glossary.md`

### 4.7 近期完成但尚未并入主链的能力

| 能力 | 状态 |
|---|---|
| FactStore rebuild Views（context-pack / impact / reuse / verify） | 工程验收完成；`registerRebuildContextProviders` 无生产调用方 |
| codegraph extension | plugin 注册已解绑、描述标 RETIRED |
| CRK Phase 1–10 | 完成；Phase 09 codebase index 已移除，由 FactStore 替代 |
| V3 Capability Registry | V3-00～V3-08 实现落地，生产保持 opt-in / shadow |
| RC-03 seal | 实现完成，默认关闭 |
| Context Family registry | shadow 摄入已接线，无权威投影 |

---

## 5. 面临的问题

按对“实际收益低”的解释力排序。

### P1. 最终请求边界不闭合

**事实**：Orchestrator 之后仍有 direct system prompt mutation；COMPASS pre-reply 和 role-spawn 绕过 Orchestrator；RC-03 不覆盖 tools/media/transforms。

**影响**：预算和 lineage 不等于真实请求；同一记忆可能重复注入；无法审计“最终请求为什么包含/不包含某段内容”。

**严重度**：最高。

### P2. 能力目录四套并存

**事实**：Tool/Skill 的发现层由 native schema、`tool_registry`、Tool Search/CVK、V3 descriptor 分别投影。

**影响**：重复 token、重复维护、版本与缓存语义不一致。

**严重度**：高。

### P3. 记忆双权威、多注入路径、多工具面

**事实**：Role Memory 与 Runtime Memory 都是 durable；COMPASS/role-spawn/memory-pilot/Assembler 多条注入；`memory_search/memory_get/memory_query/context_*` 多个工具面。

**影响**：Mem 无法成为可信的语义记忆层；写入冲突、重复检索、重复注入。

**严重度**：高。

### P4. 成本门控在候选生产之后，且用字符前缀截断

**事实**：provider/Mem 先生成，再进 6000 字符账本；超限执行前缀截断。

**影响**：开启增强后可能“更慢、更贵、还截坏 JSON/代码/约束”。

**严重度**：高。

### P5. Working Context 名存实亡

**事实**：当前只有最近 5 条 `result_summary`；没有任务目标、约束、已确认事实、决策、风险、下一动作。

**影响**：记忆检索缺乏 task-scoped 绑定；注入相关性低；模型重复询问或重新推理。

**严重度**：高。

### P6. ContextUnit 语义契约不完整

**事实**：`ContextCandidate` 缺少 scope、freshness、sensitivity、merge policy、evidence refs、trust status。

**影响**：不能可靠处理 stale/conflict/critical/sensitive，admission 和 token packer 都缺少输入。

**严重度**：中高。

### P7. Receipt 与 replay 语义不匹配

**事实**：候选集在进程内 Map；RC-03 receipt 只保存 digest/ref，不保存原始内容。

**影响**：无法承诺“仅凭 receipt 重建 prompt”；必须区分审计可追溯与可复现重放。

**严重度**：中。

### P8. 安全与数据治理缺失

**事实**：当前索引、Working Context、Receipt 路径未统一处理 sensitivity、权限、脱敏、保留期、prompt-injection trust level。

**影响**：provenance、ArchiveHandle、descriptor 可能泄露路径/能力/秘密；记忆污染可能进入 prompt。

**严重度**：中高。

### P9. 高质量能力未接线，形成库存而非能力

**事实**：Runtime Memory 多个模块、FactStore Views、V3 resolver、Context Family registry 处于 shadow/opt-in/无生产调用方状态。

**影响**：工程投入不能转化为用户收益。

**严重度**：中。

---

## 6. 预期：目标架构

### 6.1 设计原则

1. **Owner 与投影分离**：谁拥有原始数据谁负责原始数据；任何模块只能投影，不能成为第二真相源。
2. **一个能力目录，多种投影**：V3 descriptor 是 Tool/Skill/Context-provider 的发现权威；其他视图消费它。
3. **DCS 是上下文权威**：admission/resolve/pack/compile 只属于 DCS；Mem、VToken、CVK、COMPASS 都是候选来源。
4. **Mem 是语义记忆与检索，不是通用目录**：Mem 只拥有持久语义记忆的本地 freshness/provenance，不裁决其他来源。
5. **Working Context 是任务账本**：task-scoped、版本化、可合并、可晋升。
6. **Provider Guard 是最终边界**：所有进入 provider 的字节都必须登记并生成 digest。
7. **Fast Path 默认，Mem Path 例外**：只有长文本、冲突、事实/决策/风险才走语义处理。
8. **先保真再压缩**：critical/constraint/evidence 整单元保留；超窗显式失败/降级，不裸截断。
9. **任何丢弃可解释**：selected/omitted/truncated/dropped 都有 lineage 和 receipt。
10. **敏感信息默认不进入**：进入索引、Working Context、Receipt 前先做 sensitivity/redaction/retention/trust 判定。

### 6.2 目标 authority 矩阵

| 对象 | Owner | 允许的行为 |
|---|---|---|
| Tool schema / 执行 | Runtime / MCP | 注册、校验、执行；发布 descriptor |
| Skill 正文 | Skill loader | 发现、版本、加载；发布 descriptor/selector |
| 记忆事实/卡片 | 被 slot 选中的 memory owner | capture/review/commit/retrieve |
| Working Context | Task Context Ledger | 由 tool/user/memory/task 更新，task-scoped 投影 |
| ContextUnit 裁决 | DCS | admission/resolve/pack/compile/lineage |
| CapabilityDescriptor | V3 Capability Catalog | Tool/Skill/Context-provider 发现元数据 |
| 最终请求 | Provider Guard | RequestEnvelope digest、transform 登记 |
| 观察与恢复 | transcript + journal + archive | 副作用证据、ArchiveHandle、恢复 receipt |

### 6.3 每个来源进入模型请求的路径

| 来源 | 目标路径 |
|---|---|
| User message | transcript owner -> DCS ContextUnit -> PromptPlan |
| Tool schema | Runtime/MCP owner -> V3 descriptor -> DCS token pack |
| Tool result | transcript/archive owner -> truncation/ArchiveHandle -> DCS ContextUnit |
| Skill 目录 | V3 descriptor -> DCS L0-L2 投影 |
| SKILL.md 正文 | Skill loader owner -> 按需 read tool，不预注入 |
| 持久记忆 | Mem owner -> governance/retrieval -> Mem candidate -> DCS |
| Working Context | Task Context Ledger -> DCS 高优先级候选 |
| hooks/transform | `PromptContribution` -> DCS 或 declared transform -> Provider Guard 登记 |
| media / cache boundary / model identity | Provider Guard 登记后进入 RequestEnvelope |

---

## 7. 解决方案

> 状态：全部为**待审提案**。ADR 和本 rev2 审计通过前不写生产代码、不翻默认、不改产品锁。

### Phase A：ADR 与库存冻结

**目标**：先冻结权威边界，并建立可审计的现状库存。

**交付**：

- ADR：`docs/dev/adr/2026-08-16-context-authority-boundaries.md`（本 rev2 配套）；
- `context-capability-inventory`：
  - 每个来源的 owner、生产调用方、默认值、注入路径、预算、lineage；
- `prompt entry-path` 清单：
  - 所有能进入 model request 的路径是否经过 DCS；
  - 所有 hook/transform 是否可登记。

**明确不做**：不写生产代码，不新增 provider/flag/store，不改变默认值。

**出口**：独立审计对 ADR 权威矩阵和旁路清单给出可复核意见。

### Phase B：Provider Guard（先 observational，后 fail-closed）

**目标**：给“单一最终请求权威”一个可机器验证的边界。

**范围**：

1. 定义 `RequestEnvelope` digest，覆盖：
   - system prompt；
   - messages；
   - tools；
   - media；
   - 所有 registered transforms；
   - cache boundary / model identity / runtime context 等最终 wire 字段。
2. 遗留 hook 的 `systemPrompt` 覆盖迁移为 `PromptContribution`：
   - contribution 进入 DCS；
   - 或登记为 declared transform；
   - 禁止绕过 DCS 直接 mutation。
3. COMPASS pre-reply、role-spawn 等旁路进入登记表；先观测、记录、不改发送行为。
4. 观测 digest 计算与旁路计数，证明零/低性能影响。

**验收**：

- 每个最终请求都有 RequestEnvelope digest；
- 旁路清单完整，未登记旁路计数为 0；
- 观测模式下发送行为 byte-identical；
- P95 digest/登记开销低于预设阈值。

**回滚**：关闭 observational Provider Guard 即可，不影响现有发送。

### Phase C：完整 `ContextUnit/v1`

**目标**：给 DCS 提供完整裁决输入，但保持 `ContextCandidate` 只是渲染候选。

**范围**：

1. 定义并实现 `ContextUnit/v1`，至少包含：
   - id、kind、text/ref；
   - source revision；
   - scope：`turn | task | session | workspace | profile`；
   - freshness：observedAt / expiresAt / stale policy；
   - epistemic status：confirmed / inferred / uncertain / stale；
   - sensitivity：public / workspace / secret-adjacent；
   - evidence refs；
   - merge policy：preserve / summarize / dedup / conflict-set；
   - trust status：prompt-injection / provenance 治理等级；
   - priority 与 token cost estimate。
2. `ContextCandidate` 降级为最终渲染候选，不承载 canonical 语义。
3. producer 适配顺序：DCS Assembler、memory providers、CVK、VToken、COMPASS、role-spawn。
4. 所有字段先 shadow 校验，不改变 prompt 行为。

**验收**：

- 全字段 normalize/validate 单测；
- 所有生产 producer 均产出 `ContextUnit`；
- 默认路径 prompt 与基线 byte-identical；
- sensitivity/trust 字段有明确治理规则，不只作装饰。

**回滚**：按 provider 关闭 ContextUnit 适配，legacy 候选路径保留。

### Phase D：Working Context = 版本化 Task Context Ledger

**目标**：把 Working Context 从“最近 5 条动作”升级为任务账本。

**范围**：

1. Task Context Ledger 字段：
   - Objective / Constraints / ConfirmedFacts / Decisions / OpenRisks / ActiveFiles / Evidence / NextAction。
2. 每个字段：
   - 更新者；
   - 证据 ref；
   - 版本；
   - TTL；
   - sensitivity/trust。
3. 更新来源：
   - user intent；
   - tool result envelope；
   - task phase；
   - Mem provider 结果；
   - 用户确认。
4. fork / compact / handoff 合并规则：
   - 只复制显式 task-scoped 字段；
   - 冲突保留来源与版本；
   - 不自动把 ledger 当 transcript 或记忆。
5. 晋升规则：
   - 任务结束后，只有用户/governance 确认的单元可晋升到 Mem；
   - 禁止自动晋升。

**验收**：

- 普通 coding turn 能稳定看到并利用 Objective/Constraints/Facts/NextAction；
- 每个字段可追溯到更新者和证据；
- fork/handoff 后 ledger 合并行为确定；
- 默认路径保持关闭或 shadow，直到 Phase E 证据支持。

**回滚**：关闭 Working Context 注入后回到 legacy 路径；ledger 数据保留。

### Phase E：Memory 收敛

**目标**：一个 durable memory owner，其他后端作为 provider/adapter。

**范围**：

1. 严格执行 RC-07 slot owner 约束；
2. Role Memory 与 Runtime Memory 收敛为：
   - 一个 slot owner；
   - 非 owner 降为只读 provider/adapter；
   - 所有写入走 `capture -> review -> commit -> retrieve -> inject -> observe`。
3. `memory_search / memory_get / memory_query / context_search / context_read` 保留工具名兼容，底层统一到 Memory Facade：
   - 结果标注 backend/source/freshness/evidence；
   - 不迁移用户数据；
   - 不把 `context_*` 伪装成 memory。
4. 已证明收益的 Runtime Memory 模块接入主链；其余显式标 `eval-only`。

**验收**：

- `parallelMemoryWriters === 0` 的机器检查；
- 记忆注入只来自一条权威路径；
- 工具兼容测试全绿；
- 所有 memory provider 产出 ContextUnit，并受 DCS 裁决。

**回滚**：flag 关闭后回 legacy；不删除旧 store 数据。

### Phase F：unit-aware token packer 与真实任务对照

**目标**：让预算和毕业指标成为可证伪契约。

**范围**：

1. 替换字符前缀截断为 unit-aware token packer：
   - 按 provider token 估算；
   - 覆盖工具 schema、多模态内容、输出 reserve；
   - `critical/constraint/evidence` 整单元保留；
   - 预算不足时 drop 低优先级单元；
   - critical 超过上下文窗口时显式失败/降级，不裸截断。
2. 记录每轮：
   - descriptor hits；
   - skill load；
   - memory query；
   - Working Context injection；
   - budget drop/truncation；
   - latency/cost；
   - kill/rollback。
3. 真实任务对照：
   - 基线（DCS preview 关）与试验（DCS preview 开）配对；
   - 真实 provider、单 workspace、Windows x64；
   - 至少 10 个真人 coding 任务作为探索证据。

**验收**：

- 关键约束保留率有明确指标；
- P95 编译延迟/成本有预算；
- 零未登记输入；
- 无 secret 泄漏、无未授权写入；
- 探索证据不能直接触发 default-on。

### Phase G：分表面毕业

只有 Phase F 数据满足，并且：

- 预先定义基线/对照；
- 关键约束保留率达标；
- P95 编译延迟/成本达标；
- 14–28 天 soak；
- 真人 A/B；
- 产品审批。

满足后逐面毕业：

- view tools；
- working-memory 注入；
- tool_registry；
- Memory 注入；
- Working Context。

每个面单独评审、单独 rollback、单独更新 `default-config-matrix`。禁止联合一次翻默认。

---

## 8. 需要审计 agent 重点裁决的开放问题

1. **权威矩阵是否仍重叠**：V3 descriptor 与 DCS ContextUnit 在 freshness/version 上的边界是否足够清楚？
2. **Provider Guard 何时可 fail-closed**：observational 数据达到什么条件才能阻止未登记旁路？
3. **ContextUnit 完整字段是否过度**：trust status、merge policy、evidence refs 是否全部进入 v1，还是分批？
4. **Task Context Ledger 的 owner**：放在 BlockStore 还是独立 ledger？与 Task Ledger / ClawGraph 是否重复？
5. **Role Memory 的处置**：保留为 slot owner、降级为 provider，还是与 Runtime Memory 继续并存但明确场景边界？
6. **三个记忆工具是否合并**：合并对兼容性和模型使用习惯的影响。
7. **hooks legacy 契约**：`PromptContribution` 迁移窗口多长？不迁移的 hook 如何处理？
8. **replay 目标**：产品需要 `audit-traceable` 还是 `reproducible`？
9. **安全治理的执行点**：sensitivity/redaction 应在 ContextUnit 注册时、DCS admission 时、还是 Provider Guard 前？
10. **FactStore Views 并网时机**：应在 Memory 收敛前还是后？

---

## 9. 红线

1. `defaultOn=false`、`liveReady=false`、`productApproved=false` 必须保持。
2. 禁止 SEKB 无人自动写回；禁止 Browser 无监督/私网默认。
3. 禁止用 synthetic canary、agent-surrogate、E2E fixture 替代真人生产证据。
4. 禁止新增第三个 durable memory writer 或第四个能力目录。
5. 禁止所有信息经过 LLM Mem 处理；Fast Path 必须存在。
6. 禁止模型、Skill 文本、DCS Block 或 renderer 输入注册 executor。
7. 禁止在 Provider Guard 上线前继续增加 provider/flag。
8. Receipt 不存原始内容；不承诺仅凭 Receipt 重放 prompt。
9. 禁止为演示或“证明可用”翻默认值。
10. 敏感信息未通过 sensitivity/redaction 判定，不得进入索引、Working Context 或 Receipt。

---

## 10. 给独立审计的检查清单

1. 逐条验证 §4 现状锚点是否与当前工作树源码一致。
2. 检查 §4.1 数据流是否漏掉其他进入最终请求的路径（channel-specific、plugin hooks、compact/fork、media、provider suffix）。
3. 检查 ADR 的权威矩阵是否还有重叠或空档。
4. 检查 Phase B 的 RequestEnvelope 范围是否完整。
5. 检查 Phase C 的 ContextUnit 字段是否有缺失或过度设计。
6. 检查 Phase D 的 Task Context Ledger 是否与 Task Ledger/ClawGraph 产生第二权威。
7. 检查 Phase F 的指标是否可证伪，是否足以支持 Phase G 毕业。
8. 检查本文是否隐藏任何默认开启、联合 GA 或证据外推。
9. 给出明确的 `accept / revise / reject` 结论与修订清单。

---

## 11. 证据索引与工作树说明

### 11.1 主要源码锚点

| 领域 | 路径 |
|---|---|
| Context Orchestrator | `openclaw_runtime/src/context-engine/context-orchestrator.ts` |
| Context Candidate | `openclaw_runtime/src/context-engine/context-candidate.ts` |
| Turn injection budget | `openclaw_runtime/src/context-engine/turn-injection-budget.ts` |
| Injection budget（前缀截断） | `openclaw_runtime/src/context-engine/injection-budget.ts` |
| RC-03 seal | `openclaw_runtime/src/context-engine/rc03-seal-hook.ts` |
| 最终 prompt 组装 | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts` |
| COMPASS pre-reply 旁路 | `openclaw_runtime/src/auto-reply/reply/get-reply-run.ts` |
| Role-spawn 旁路 | `openclaw_runtime/src/agents/role-spawn.ts` |
| Memory pilot seam | `openclaw_runtime/src/context-engine/chat-turn-memory-injection.ts` |
| Working memory handler | `openclaw_runtime/src/context-engine/handlers/working-memory-handler.ts` |
| Tool registry handler | `openclaw_runtime/src/context-engine/handlers/tool-registry-handler.ts` |
| Tool catalog | `openclaw_runtime/src/agents/tool-catalog.ts` |
| Skill prompt 构建 | `openclaw_runtime/src/skills/loading/workspace.ts` |
| CVK engine / adapter | `openclaw_runtime/src/context-engine/cvk/engine.ts`、`cvk/runtime-adapter.ts` |
| V3 CapabilityDescriptor | `openclaw_runtime/src/capabilities/v3/capability-descriptor.ts` |
| FactStore rebuild composition | `openclaw_runtime/src/context-engine/register-rebuild-providers.ts` |
| Slot convergence | `openclaw_runtime/src/agents/slot-convergence.ts` |
| Context Family shadow registry | `openclaw_runtime/src/context-engine/registry/context-item-registry.ts` |
| Tool result truncation + ArchiveHandle | `openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation.ts` |

### 11.2 主要文档锚点

| 文档 | 路径 |
|---|---|
| 本蓝图 | `docs/dev/context-capability-blueprint.md` |
| 权威边界 ADR | `docs/dev/adr/2026-08-16-context-authority-boundaries.md` |
| 全链路成熟度审计 | `docs/dev/full-chain-maturity-audit-2026-08-02.md` |
| DCS 独立架构评审 | `dcs-review-glm-output/dcs-first-architecture-review-glm-2026-08-02.md` |
| DCS-first 上下文工程设计 | `docs/dev/dcs-first-context-engineering.md` |
| Context Family 公理/词汇 | `docs/context-family/axioms.md`、`docs/context-family/glossary.md` |
| Context Engine Rebuild 状态 | `docs/CONTEXT_ENGINE_REBUILD_PROGRESS.md`、`docs/SEAM_MAP.md` |
| Capability Registry V3 | `docs/dev/capability-registry-v3-*.md` |
| 默认配置矩阵 | `docs/dev/default-config-matrix.md` |
| First Product 状态 | `docs/dev/first-product-controlled-preview/STATUS.md` |
| DCS visible production 状态 | `docs/dev/dcs-visible-production/STATUS.md` |

### 11.3 工作树说明

- 基线：`033469f07cd4810f5fb6e521fc3c600a0d4d2cfc`。
- 当前工作树存在约 180+ 处未提交修改，含 VerseShell、RC、DCS、context-engine、renderer 等多条线。
- 本文的现状描述以当前工作树源码为准，不把未提交 WIP 视为已验收能力。
- 本文没有复跑全量测试；所有测试结论均引用现有报告/文档，不构成新验证。

---

## 12. 结论

rev2 后的正确路径是：

1. 先以 ADR 冻结四类权威：**V3 = 能力目录，DCS = 上下文权威，Mem = 持久语义记忆与检索，Working Context = 任务账本**；
2. 先上只读 Provider Guard，把最终请求边界变成可观测事实；
3. 再补完整 `ContextUnit/v1`，让 DCS 有语义裁决输入；
4. 以版本化 Task Context Ledger 补 Working Context；
5. 再收敛 Memory；
6. 最后用 unit-aware token packer 和真实任务对照，逐表面毕业。

后续工作的本质仍是**接线、去重、关闭旁路、拿窄场景真实证据**，不是继续增加模块。

---

*本文为设计沉淀稿 rev2，与 ADR 一并提交独立审计。审计意见应回写到本文或另立 `docs/dev/context-capability-audit-*.md`，不应直接修改产品默认值或 readiness 锁。*

