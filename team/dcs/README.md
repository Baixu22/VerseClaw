# DCS 规范与阶段 0 实现索引

**用途**：Working Context × Memory 统一设计约束规范（DCS）的多轮对抗审阅与阶段 0 实现索引。

**最后更新**：2026-07-12
**当前状态**：v1.6 已收敛（致命问题 0），v1.6.1 正式增补已收编；阶段 0
接口层与 Stage 1 working-memory 已在 main 收口（R1 COMPLETE）；R2 producer
envelope vertical slice 已在 main 收口（R2 COMPLETE）；R3 Stage 2 task state
adapter 与 child-session handoff 已在 main 收口（R3 COMPLETE）；R4 Stage 3
tool_registry Block producer 与 Assembler injection 已在 main 收口（R4 COMPLETE）。
DCS working-memory infrastructure ready; production producer coverage = 3/3
（edit/write/apply_patch 均已产出 `details.working_memory` envelope）；
task_state adapter + child handoff + direct-parent authorization + terminal-phase
SEKB trajectory capture 已就位；tool_registry Block producer + Assembler
injection 已就位（flag-gated, default off）。

---

## 文档清单

### 规范版本

| 文件 | 版本 | 说明 |
|------|------|------|
| [dcs-v1.0-spec.md](./dcs-v1.0-spec.md) | v1.0 | 原始设计规范，agent 给出的未来设计规范 |
| [dcs-v1.1-spec.md](./dcs-v1.1-spec.md) | v1.1 | 接受 v1.0 审阅全部 10 条意见 |
| [dcs-v1.2-spec.md](./dcs-v1.2-spec.md) | v1.2 | 修复 HandoffPack、session 谓词、SSP、sink 时机和 notes 可见性 |
| [dcs-v1.3-spec.md](./dcs-v1.3-spec.md) | v1.3 | 修复共享 main 谓词、重复 agent_end 与 Assembler 输入契约 |
| [dcs-v1.4-spec.md](./dcs-v1.4-spec.md) | v1.4 | 闭合任务状态、upsert、准入事实与 mutability 契约 |
| [dcs-v1.5-spec.md](./dcs-v1.5-spec.md) | v1.5 | 闭合保留策略、公开 API、knowledge 准入与跨 session 授权 |
| [dcs-v1.6-spec.md](./dcs-v1.6-spec.md) | v1.6 | 统一 Assembler handler API；最终收敛版本 |
| [dcs-v1.6.1-addendum.md](./dcs-v1.6.1-addendum.md) | v1.6.1 | 三 flag 与命名统一、临时投影/exactly-once、诚实报告、mainKey、pilot 处置与双注入预算 |

### 审阅意见

| 文件 | 审阅对象 | 发现问题数 | 致命数 |
|------|---------|-----------|--------|
| [dcs-v1.0-review.md](./dcs-v1.0-review.md) | v1.0 | 10 | 3 |
| [dcs-v1.1-review.md](./dcs-v1.1-review.md) | v1.1 修订版 | 5（3 新增 + 2 次要） | 2 |
| [dcs-v1.2-review.md](./dcs-v1.2-review.md) | v1.2 修订版 | 3 | 3 |
| [dcs-v1.3-review.md](./dcs-v1.3-review.md) | v1.3 修订版 | 4 | 4 |
| [dcs-v1.4-review.md](./dcs-v1.4-review.md) | v1.4 修订版 | 3 | 3 |
| [dcs-v1.5-review.md](./dcs-v1.5-review.md) | v1.5 修订版 | 1 | 1 |
| [dcs-v1.6-review.md](./dcs-v1.6-review.md) | v1.6 最终版 | 0 | 0 |

---

## 对抗审阅历史

### 第 1 轮（v1.0 → v1.1）

**审阅方**：主 agent（对抗性思维）
**被审方**：原始 DCS-v1.0 规范
**结果**：发现 10 个问题（3 致命 + 4 中等 + 3 次要），v1.1 全部接受并修订

**v1.0 致命问题**：
1. Block 没有准入门槛（"什么都往里塞"问题）
2. HookBus 与现有 3 套 hook 机制重叠
3. Assembler 迁移路径事实错误（`computeMemoryExtraSystemPrompt` 文件位置错误）

### 第 2 轮（v1.1 → v1.2）

**审阅方**：主 agent（对抗性思维 + 代码事实验证）
**被审方**：DCS-v1.1 修订版
**结果**：发现 5 个新问题（2 致命 + 1 中等 + 2 次要），修订过程中引入

**v1.1 新致命问题**：
- A. HandoffPack 通过 extra 字符串注入是架构倒退，违反 [P1]
- B. session_id 正则与实际格式严重不匹配（漏掉所有多段 key）

**v1.1 中等问题**：
- C. SSP 不包含 evidence_summary，[P4] 的 compression_depth 推理基于错误假设

### 第 3 轮（v1.2 → v1.3）

**结果**：上一轮 A-E 已全部修复；新增发现 3 个实现阻塞问题，修订 v1.3。

- 共享 `isMainSessionKey` 谓词尚不存在
- `agent_end` 已存在，不应重复新增
- Assembler 缺少 legacy builder 完整输入契约

### 第 4 轮（v1.3 → v1.4）

**结果**：路由与 pass-through 已修复；BlockStore 和类型层仍有 4 个实现阻塞问题，修订 v1.4。

### 第 5 轮（v1.4 → v1.5）

**结果**：写入语义闭合；保留策略与公开 API 仍有 3 个实现阻塞问题，修订 v1.5。

### 第 6 轮（v1.5 → v1.6）

**结果**：存储、准入、授权、类型和 hook 契约已闭合；修复最后 1 个 Assembler handler API 致命矛盾。

### 最终审阅（v1.6）

**结果**：致命问题 0，中等问题 0，阻塞阶段 0 的未决项 0。DCS 规范正式收敛。

---

## 阶段 0 实现

阶段 0 接口层已实现，默认关闭两个 feature flag，保持现有运行路径不变。

| 交付物 | 路径 |
|--------|------|
| ContextBlock 类型与接口 | `openclaw_runtime/src/context-engine/block.ts` |
| SQLite BlockStore | `openclaw_runtime/src/context-engine/block-store.ts` |
| HookContext sink 扩展 | `openclaw_runtime/src/agents/harness/hook-context.ts` |
| Hook 事件与 harness 调度扩展 | `openclaw_runtime/src/plugins/hook-types.ts`、`openclaw_runtime/src/plugins/hooks.ts`、`openclaw_runtime/src/agents/harness/lifecycle-hook-helpers.ts` |
| Assembler pass-through | `openclaw_runtime/src/context-engine/assembler.ts` |

对应单元测试位于 `openclaw_runtime/src/context-engine/*.test.ts` 和 `openclaw_runtime/src/agents/harness/dcs-stage0-hooks.test.ts`。

---

## Stage 1 实现（working-memory，R1 收口）

Stage 1 于 2026-07-12 在 main 分支收口（DCS-ROUND1-COMPLETE）。默认关闭
（`runtime.contextBlock.working-memory.enabled` 缺省为 false，flag-off 为引用级
identity pass-through，零 BlockStore 构造/查询/写入）。

| 交付物 | 路径 |
|--------|------|
| working-memory handler（窗口合并/五条上限/确定性淘汰） | `openclaw_runtime/src/context-engine/handlers/working-memory-handler.ts` |
| context_blocks / block_entity_map schema | `openclaw_runtime/src/state/openclaw-state-schema.sql` |
| tool_result + context 双 hook 接线（S1-B 同 attempt 串行化队列） | `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts` |
| kebab/snake flag 唯一映射函数（增补 1） | `openclaw_runtime/src/context-engine/assembler.ts` `contextBlockFlagNameForSourceSystem` |
| exactly-once 注入护栏（增补 2） | `openclaw_runtime/src/context-engine/assembler.ts`（`## Recent Actions` 恰好 0/1 次） |
| config 面（strict schema/labels/help/types） | `openclaw_runtime/src/config/*` |
| attempt 消费 factory（session 身份接线） | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts` |

诚实声明：**DCS working-memory infrastructure ready; production producer
coverage = 0** —— runtime 中尚无任何生产者产出 `details.working_memory`，
测试中的合成 envelope 不代表真实 coding 增益。

---

## Stage 1 Producer Envelope（R2 收口）

R2 于 2026-07-12 在 main 分支收口（DCS-ROUND2-COMPLETE）。production
mutation tools（edit/write/apply_patch）在成功路径上显式产出
`details.working_memory` envelope，shape 为
`{ result_summary: string (≤100 chars), significance: "high" }`。
失败/部分恢复路径不发 envelope。read 等非 mutation 工具不发 envelope。

| 交付物 | 路径 |
|--------|------|
| WorkingMemoryEnvelope 类型 + WriteToolDetails | `openclaw_runtime/src/agents/sessions/tools/tool-contracts.ts` |
| edit producer envelope（success path） | `openclaw_runtime/src/agents/sessions/tools/edit.ts` |
| write producer envelope（success path） | `openclaw_runtime/src/agents/sessions/tools/write.ts` |
| apply_patch producer envelope（success path） | `openclaw_runtime/src/agents/apply-patch.ts` |
| RED→GREEN producer envelope 测试 | `openclaw_runtime/src/agents/dcs-producer-envelope.test.ts` |
| characterization test 更新 | `openclaw_runtime/src/agents/agent-tools.read.characterization.test.ts` |

诚实声明：**production producer coverage = 3/3**（edit/write/apply_patch）。
envelope 通过 `wrapToolParamValidation` pass-through 覆盖 host + sandbox 变体。
workspace authority propagation、session-workspace binding、matched off/on
replay evidence 由 R3 交付。

---

## Stage 2 Task State Adapter 与 Child-Session Handoff（R3 收口）

R3 于 2026-07-12 在 main 分支收口（DCS-ROUND3-COMPLETE）。TaskLoop phase
transition 持久化一个 system-managed `task_state` Block；parent 在 child
启动前将 HandoffPack 写入 child session key；child `before_agent_start` 通过
BlockStore 恢复状态并接收固定 context_read 指令；direct-parent authorization
验证 requester + child HandoffPack parent_session_id + target；仅 terminal phase
（completed/failed）触发一次 SEKB trajectory capture。

| 交付物 | 路径 |
|--------|------|
| task-loop handler（handleTaskPhaseChange / buildChildHandoffPack / writeChildHandoffPack / restoreChildState / isTerminalPhase / CHILD_CONTEXT_READ_INSTRUCTION） | `openclaw_runtime/src/context-engine/handlers/task-loop-handler.ts` |
| parseHandoffPack 导出（授权与恢复共用验证器） | `openclaw_runtime/src/context-engine/block-store.ts` |
| task_phase_change hook 接线 + terminal-phase SEKB trigger | `openclaw_runtime/src/agents/harness/lifecycle-hook-helpers.ts` |
| buildTaskStateFactory（parent-writes-before-spawn + before_agent_start restoration + context_read instruction） | `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts` |
| RED→GREEN task-loop handler 测试（16 tests） | `openclaw_runtime/src/context-engine/handlers/task-loop-handler.test.ts` |
| RED→GREEN extension wiring 测试（6 tests） | `openclaw_runtime/src/agents/embedded-agent-runner/extensions.task-state.test.ts` |
| RED→GREEN terminal-phase SEKB 测试（5 tests） | `openclaw_runtime/src/knowledge/sekb/harness-integration.test.ts` |

诚实声明：**task_state adapter + child handoff + direct-parent authorization +
terminal-phase SEKB trajectory capture 已就位**。direct-parent authorization
覆盖 self / direct parent / arbitrary target / recursive ancestor / malformed
HandoffPack 五条路径。context_read 指令为固定字符串，不含 HandoffPack JSON、
Block ids、transcript excerpt 或 raw tool output。tool registry（M4b+M5a）、
knowledge unification（M5b）、SEKB closure（M6+T1）由 R4+ 交付。

---

## Stage 3 Tool Registry Block Producer 与 Assembler Injection（R4 收口）

R4 于 2026-07-12 在 main 分支收口（DCS-ROUND4-COMPLETE）。`before_agent_start`
hook 产出一个 system-managed `tool_registry` Block（`source_system="cvk"`，
`always_on=true`，`token_budget=200`，`priority=7`，
`on_demand={ expand_tool: "context_read", auto_register: true }`）。Assembler
的 `#appendToolRegistry` 按 flag-guard + exactly-once + BlockStore-query 模式
注入 `## Tools (N available)` 摘要。现有 CVK
`ContextRuntimeKitContextEngine.assemble` 路径不变；Stage 3 Block 路径为并行的
flag-gated producer。Feature flag `runtime.contextBlock.tool-registry.enabled`
缺省为 false。

| 交付物 | 路径 |
|--------|------|
| tool-registry handler（buildToolRegistryBlock / handleBeforeAgentStartToolRegistry / formatToolRegistryInjection） | `openclaw_runtime/src/context-engine/handlers/tool-registry-handler.ts` |
| Assembler #appendToolRegistry + cvk flag mapping + exactly-once guard | `openclaw_runtime/src/context-engine/assembler.ts` |
| buildToolRegistryFactory（before_agent_start → ContextBlockSink） | `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts` |
| config 面（strict schema/labels/help/types） | `openclaw_runtime/src/config/*` |
| RED→GREEN handler 测试（12 tests） | `openclaw_runtime/src/context-engine/handlers/tool-registry-handler.test.ts` |
| RED→GREEN assembler 测试（5 new + 2 updated） | `openclaw_runtime/src/context-engine/assembler.test.ts` |
| RED→GREEN extension wiring 测试（5 tests） | `openclaw_runtime/src/agents/embedded-agent-runner/extensions.tool-registry.test.ts` |
| RED→GREEN config 测试（2 tests） | `openclaw_runtime/src/config/runtime-context-block-tool-registry.test.ts` |

诚实声明：**tool_registry Block producer + Assembler injection 已就位**
（flag-gated, default off）。toolEntries 由 factory closure 参数传入，当前
无 caller 传入真实 tool list。knowledge unification（M5b）、SEKB closure
（M6+T1）由 R5+ 交付。

---

## 审阅原则

1. **对抗性思维**：不假设规范正确，主动找漏洞
2. **代码事实优先**：所有审阅意见必须基于代码事实，不能凭空推理
3. **不争辩**：被审方接受意见直接修订，不在规范中为错误辩护
4. **致命问题优先**：任一致命问题未解决，不开始阶段 0 实现
5. **每轮修订后必须复审**：修订可能引入新问题，每轮修订后都需要对抗审阅

---

## 相关参考文档

| 文档 | 路径 | 用途 |
|------|------|------|
| 全量架构审计 | [team/architecture-audit-full.md](../architecture-audit-full.md) | 1142 行，覆盖整个体系的三层架构 + 子系统 + 调用链 + 治理矩阵 |
| CodeGraph 角色架构地图 | [team/codegraph-role-architecture.md](../codegraph-role-architecture.md) | 80 行，5 个区域的 Role/Agent/Memory 架构地图 |
| Role-First 设计文档 | [team/role-architecture-design/](../role-architecture-design/) | 6 个文件，Role-First 架构的权威设计文档 |
| DCS 总体执行编排计划 | `C:\Users\27933\Desktop\clawx\team\claude\DCS-MASTER-EXECUTION-PLAN.md` | M0-M6 依赖、门槛与交付编排 |
| DCS 轮次派单手册 | `C:\Users\27933\Desktop\clawx\team\claude\DCS-ROUND-DISPATCH.md` | R1-R6 串行执行、验收与 handoff |

---

## 后续工作

1. 后续阶段以 [dcs-v1.6-spec.md](./dcs-v1.6-spec.md) 与已收编的
   [dcs-v1.6.1-addendum.md](./dcs-v1.6.1-addendum.md) 为同级规范权威。
2. 阶段 1 及以后继续采用 TDD 和对抗审阅，新增契约不得回写为平行规范。
3. 保持 COMPASS / role-memory feature flag 默认关闭，直到对应迁移阶段具备完整回归证据。
