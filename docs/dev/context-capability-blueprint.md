# Context Capability Convergence Blueprint（可信 Agent 控制平面收敛设计 · rev3 共识稿）

| 字段 | 值 |
|---|---|
| 文档状态 | `draft-rev3`（已吸收独立审计 `revise` 与最终裁决，**北星已接受，实施仍未授权**） |
| 审计结论 | 两轮共识：接受“可信 Agent 控制平面”北星、六 artifact、黄金路径；补齐逻辑 authority 契约与真实 runtime enforcement 后才可实施 |
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

### 1.1 最终裁决与 rev3 共识

最终裁决：**总体认可约 80%，但不把辩论稿直接当作可执行路线。**

接受：

- 五平面取代单纯上下文平面：数据 / 能力 / 上下文 / 效果 / 出口与证据；
- 六 artifact 拆分：`ContextRef / CompilationSnapshot / PromptPlan / RequestEnvelope / CapabilityGrant / EffectReceipt`；
- 黄金 coding turn 优先；
- DCS 服务可丢弃，但 `CompilationSnapshot / PromptPlan / Receipt` 必须可恢复；
- 安全不能交给 prompt；
- 先确定性规则，后 shadow，再学习型排序。

修正：

1. 不新增真相源，但必须新增统一的逻辑契约与适配层；`CapabilityGrant` 是派生凭证，派生规则必须唯一、版本化、可解释拒绝。
2. Tool Guard 契约必须在 Stage 0 冻结；黄金路径必须包含至少一个真实工具调用。
3. DCS “无状态”不等于“没有持久编译状态”：必须可保存/引用 source revisions、task ledger revision、catalog epoch、policy snapshot、model profile、transform graph、PromptPlan/RequestEnvelope digest。
4. 现有 ReceiptStore / EffectReceipt / approval ledger 是可复用工程资产，不是已闭合的可信控制平面。
5. 硬门槛禁止的是“未声明、未登记、未经过 sealed plan 的 mutation”，不是绝对 `direct mutation = 0`；egress 证明要结合 allowlist、静态约束、运行时 census、负向测试与 break-glass 审计。
6. Memory 检索可以晚接，但 Memory 写入从黄金路径开始就是 effect，必须经过 effect boundary。

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

当前已有局部 wire-digest 基础：`provider-transport-fetch.ts` 提供 `buildGuardedModelFetch`，RC-03 可产出 WireReceipt；但尚未形成覆盖全部 `RequestEnvelope`（system/messages/tools/media/all transforms）的完整 Guard。RC-03 当前只覆盖候选增量，不覆盖完整 wire body。

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


### 4.8 现有资产的准确成熟度

按最终裁决，现有资产必须降级表述：它们是**可复用工程资产**，不是已经闭合的“可信控制平面”。

| 资产 | 当前真实状态 |
|---|---|
| CVK tool-call gate | `report_only` 为默认；active blocking 尚未接入工具执行点（`docs/context-runtime-kit/README.md`） |
| TaskFlow CAS | 证明层完成，但未接入 active path（`docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md`） |
| RC-04 / RC-05 | 已实现，但工作包仍记录“not yet independently verified” |
| Runtime convergence 程序 | `human_acceptance_pending`，产品锁保持 false（`docs/dev/unified-agent-system/runtime-convergence/STATUS.md`） |
| ReceiptStore / EffectReceipt / approval ledger | 有真实实现，但不等价于已闭环的 Policy/Grant/Effect 模型 |

因此 Stage 0 不能只是“给现有模块改名”。必须补齐统一逻辑契约和适配层：每个逻辑 authority 都有唯一派生规则、版本和拒绝原因。

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

## 7. 解决方案（rev3 最终裁决后）

> 状态：北星与路线已达成共识；在 Stage 0 契约冻结和黄金路径验收完成前，不写生产代码、不翻默认、不改产品锁。

### Stage 0：冻结五平面、六 artifact 与 authority 契约

**目标**：先消除 authority 歧义。

**必须交付**：

1. 五平面 authority 矩阵（数据 / 能力 / 上下文 / 效果 / 出口与证据）。
2. 六 artifact 最小契约：
   - `ContextRef`：owner、revision、content digest、ACL、retention、provenance；
   - `CompilationSnapshot`：refs、catalog epoch、policy epoch、model profile、Task Ledger revision；
   - `PromptPlan`：selected/omitted/order/budget/why；
   - `RequestEnvelope`：provider adapter 的规范化最终请求；
   - `CapabilityGrant`：主体、任务分支、资源、动作、purpose、TTL、revocation epoch；
   - `EffectReceipt`：工具/写入真实执行后的证据。
3. 每个字段都有 source、policy、owner、生命周期。
4. 逻辑 authority 契约：
   - Identity：session/run/attempt + ReceiptStore identity；
   - Policy：config/policy digest + approval policy；
   - Grant：由现有 policy/approval/session identity 派生的短生命周期授权凭证；
   - Effect：approval ledger + EffectReceipt + operator slice。
   - 规则：不新增真相源，但新增唯一派生规则、版本与拒绝原因。
5. **Tool Guard 契约此刻冻结**：actor identity、grant scope、TTL、parent/child delegation、approval reference、revocation、effect idempotency。
6. **Memory 写入此刻声明为 effect class**，进入黄金路径的 effect boundary。

**硬门槛**：契约字段不能只有名字；每个字段能回答来源、策略、owner、生命周期。

### Stage 1：封住出口 + 一个真实工具调用

**目标**：让最终请求和至少一个工具效果成为事实。

**必须交付**：

- 基于 `buildGuardedModelFetch` / RC-03 扩展结构化 Guard，不重写；
- 黄金 coding turn 的 100% `RequestEnvelope` 覆盖；
- **至少一个真实工具调用**，且生成 `EffectReceipt`；
- 未登记 egress 在测试范围内为 0；
- 旁路证明同时使用：
  - provider 出口 allowlist；
  - 静态代码约束；
  - 运行时 census；
  - 负向测试；
  - 明确的 break-glass 审计路径。

**覆盖范围**：

- Stage 1：黄金路径范围内未登记 egress = 0；
- 后续阶段：逐 provider、逐 channel、逐 plugin 扩大覆盖；
- 最终全局不变量：系统级未登记旁路为 0，break-glass 必须有审计记录。

**硬门槛**：

- 黄金路径范围内的未登记 egress = 0；
- 禁止的是**未声明、未登记、未经过 sealed plan 的 mutation**，合法 provider transform / cache boundary / session transition 必须登记；
- 工具执行点验证 grant、scope、TTL、actor chain、审批状态；
- 观测模式下发送行为 byte-identical。

### Stage 2：DCS 真正编译

**目标**：从拼接字符串演进为 `ContextRef -> CompilationSnapshot -> PromptPlan`。

**必须交付**：

- 只接三类来源：用户意图、Task Ledger、工具结果；
- DCS 服务本身无状态、可丢弃；
- `CompilationSnapshot / PromptPlan / Receipt` 可恢复，至少保存或引用：
  - source revisions；
  - task ledger revision；
  - catalog epoch；
  - policy snapshot；
  - model profile；
  - transform graph；
  - PromptPlan digest；
  - RequestEnvelope digest；
- 相同输入得到稳定 `PromptPlan`；
- 未登记 direct system-prompt mutation 在黄金路径为 0。

**硬门槛**：source 变化后 receipt 仍能解释变化，而不是只剩一个不可解释的 hash。

### Stage 3：任务状态做对

**目标**：支持长任务、fork/handoff 与多 agent。

**必须交付**：

- Task Ledger 事件化 + 物化视图，不重写现有 store；
- 更新只能 proposal，accept/reject 有事件和 actor；
- fork/handoff 有事务边界；
- 并发、回滚、冲突、过期、handoff 都可解释。

**硬门槛**：任务状态可从事件重建；UI/工具兼容不破。

### Stage 4：权限与副作用控制

**目标**：让模型“知道”不等于“能做”。

**必须交付**：

- `CapabilityGrant` 作为派生凭证，不新增权限数据库；
- Tool Guard 执行点验证 grant、scope、TTL、actor chain、审批状态；
- delegation / attenuation；
- 子 agent 权限严格 ≤ 父 agent；
- 重启恢复与撤销 epoch。

**硬门槛**：子 agent 扩权测试为 0；grant 拒绝原因可查询。

### Stage 5：收敛 Mem 与预算

**目标**：质量、成本、长期记忆进入同一经济系统，但记忆写入早已受 effect boundary 约束。

**必须交付**：

- 每 namespace 一个 semantic-memory authority；
- 无并行 memory writer；
- 检索/语义压缩保持 provider/adapter 身份，不拥有 DCS 决策权；
- unit-aware token packer：覆盖 token、工具 schema、多模态、输出 reserve；
- critical/constraint/evidence 保留率；
- P95 编译延迟/成本；
- 真实任务对照（探索证据，不直接 default-on）。

**硬门槛**：`parallelMemoryWriters === 0`；critical 保留率与 P95 成本/延迟达标。

### Stage 6：进阶产品化

**目标**：把控制面变成用户价值。

**必须交付**：

- Context diff；
- why-this-was-included；
- policy simulation；
- replay debugger；
- 用户可理解、可控制上下文与权限。

**硬门槛**：普通用户可以解释一次 coding turn 的上下文与效果来源。

### 每阶段用户可感知证据

- 约束是否减少丢失；
- 是否减少重复读取和重复询问；
- 是否减少未授权工具调用；
- 是否能在重启后恢复任务事实；
- 是否能解释某段上下文和某个效果的来源；
- P95 延迟和 token 成本是否在预算内。

## 8. 需要审计 agent 重点裁决的开放问题

1. **权威矩阵是否仍重叠**：V3 descriptor 与 DCS ContextUnit 在 freshness/version 上的边界是否足够清楚？
2. **Provider Guard 何时可 fail-closed**：observational 数据达到什么条件才能阻止未登记旁路？
3. **六 artifact 最小契约**：`ContextRef / CompilationSnapshot / PromptPlan / RequestEnvelope / CapabilityGrant / EffectReceipt` 的首版字段是否足够小且可演进？
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
5. 禁止新增第二个权限数据库、第二个 approval ledger、第二个上下文投影 authority。
6. 禁止所有信息经过 LLM Mem 处理；Fast Path 必须存在。
7. 禁止模型、Skill 文本、DCS Block 或 renderer 输入注册 executor。
8. 禁止未声明、未登记、未经过 sealed plan 的 mutation；合法 transform 必须登记。
9. Receipt 不存原始内容；不承诺仅凭 Receipt 重放 prompt。
10. 禁止为演示或“证明可用”翻默认值。
11. 敏感信息未通过 sensitivity/redaction 判定，不得进入索引、Working Context 或 Receipt。
12. Memory 写入从黄金路径开始即视为 effect，未经 effect boundary 不得持久化。
## 10. 给独立审计的检查清单

1. 逐条验证 §4 现状锚点是否与当前工作树源码一致。
2. 检查 §4.1 数据流是否漏掉其他进入最终请求的路径（channel-specific、plugin hooks、compact/fork、media、provider suffix）。
3. 检查 ADR 的权威矩阵是否还有重叠或空档。
4. 检查 Stage 1 的 RequestEnvelope 范围是否完整，以及黄金路径是否包含至少一个真实工具调用。
5. 检查 Stage 2 的 `ContextRef -> CompilationSnapshot -> PromptPlan` 是否会让 DCS 重新变成状态拥有者。
6. 检查 Stage 3 的 Task Context Ledger 是否与 Task Ledger/ClawGraph 产生第二权威。
7. 检查 Stage 5/6 的指标是否可证伪，是否足以支持逐表面毕业。
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

## 12. 结论（rev3）

最终共识不是“上下文编译器”，而是**可信 Agent 控制平面**：

```text
每个模型可见 token、每次工具调用、每个持久化写入
都要能回答：
  从哪里来？为什么允许？以谁的权限？最终造成了什么效果？
```

执行路径：

1. 冻结五平面与六 artifact 契约；
2. 黄金 coding turn 先封出口，并带一个真实工具调用；
3. DCS 无状态编译，但快照/计划/receipt 可恢复；
4. Task Ledger proposal + 物化投影；
5. CapabilityGrant + Tool Guard + 子 agent 衰减授权；
6. Memory 收敛与 unit-aware packer；
7. 最后做 Context diff / why-included / replay debugger。

真正的壁垒不是 artifact 数量，而是 ClawX 能否让一次普通 coding turn 从输入、上下文、权限、provider 请求到工具副作用形成一条**可查询、可拒绝、可恢复的证据链**。

---

*本文为 rev3 共识稿，与 ADR 一并提交后续审计/实施评审。任何状态变更都不得突破产品锁或默认值。*
