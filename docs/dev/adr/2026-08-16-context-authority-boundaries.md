# ADR-2026-08-16：上下文权威边界（V3 / DCS / Mem / Working Context）

| 字段 | 值 |
|---|---|
| 状态 | `accepted-in-principle`（已接受北星与六 artifact；经最终裁决修正，实施仍未授权） |
| 日期 | 2026-08-16 |
| 基线 | `033469f07cd4810f5fb6e521fc3c600a0d4d2cfc`（当前工作树 dirty） |
| 范围 | Tool/Skill 能力目录、DCS 上下文投影、Mem 语义记忆、Working Context、Provider Guard、Receipt |
| 关联文档 | `docs/dev/context-capability-blueprint.md`、`docs/dev/dcs-first-context-engineering.md`、`docs/dev/capability-registry-v3-development-plan.md`、`docs/context-family/axioms.md` |

## 0. 最终裁决修订记录（rev3）

2026-08-16 最终裁决：**总体认可约 80%**，但不把初稿直接当作可执行路线。本 ADR 按裁决做如下修订：

1. “不新增 authority 组件”改为“不新增真相源，但必须新增统一逻辑契约与适配层”；
2. Tool Guard 契约提前到 Stage 0 冻结；黄金路径必须包含至少一个真实工具调用；
3. DCS 服务可丢弃，但 `CompilationSnapshot / PromptPlan / Receipt` 必须可恢复；
4. 现有 ReceiptStore / EffectReceipt / approval ledger 是可复用工程资产，不是已闭合的可信控制平面；
5. 硬门槛禁止“未声明、未登记、未经过 sealed plan 的 mutation”，并限定 egress 证明范围与 break-glass 审计；
6. Memory 检索可后接，但 Memory 写入从黄金路径开始必须经过 effect boundary。

---

## 1. 背景

独立审计对 `context-capability-blueprint.md` 的结论为 **revise**。核心问题是：

> 蓝图将 Mem 定义为“所有 ContextUnit 的索引、freshness、provenance 与生命周期骨干”，这与既有 DCS-first 定义（DCS 是编译与策略边界、Mem 是选择性语义处理器）形成新的权威重叠。

如果不先裁决权威边界，后续的 Provider Guard、ContextUnit、Working Context、Memory 收敛都会继续争夺“何时有效、何时过期、为何入选”的裁决权。

本 ADR 先冻结四类权威，作为所有后续实施的约束。

---

## 2. 决策

### 决策 1：V3 拥有能力目录，不拥有运行时事实

- V3 `CapabilityDescriptor` 只描述 **Tool / Skill / Context-provider 的发现元数据**：
  - id、revision、manifest hash、schema hash、permissions、dependsOn、stickiness、execution topology。
- V3 目录不承载：
  - 单条事实、工具输出、Working Context 状态、转录内容、原始 payload。
- 现有 native tool schema、Skill loader、MCP 协议仍是执行/正文 owner；V3 只发布 descriptor 投影。

### 决策 2：DCS 拥有上下文权威

DCS 是唯一决定“哪些 ContextUnit 进入本轮模型请求、以什么顺序/形式、在什么预算下、被丢弃的原因是什么”的 authority。

DCS 的职责：

- admission；
- resolve（dedup / conflict / freshness / sensitivity）；
- token-aware pack；
- compile 为 PromptPlan；
- 生成 Receipt 所需的 selected/omitted/truncated 信息。

DCS 不拥有：

- 长期记忆存储；
- 能力目录的 canonical metadata（那是 V3）；
- 工具执行；
- Skill 正文；
- 最终 provider wire 序列化（那是 Provider Guard）。

### 决策 3：Mem 拥有持久语义记忆与检索，不做通用 ContextUnit 目录

Mem 的职责：

- 保存经过 governance 的长期事实、决策、经验与程序性知识；
- 对长文本、冲突、事实/决策/风险类输入做选择性语义压缩/归纳；
- 以 provider/adapter 身份向 DCS 提交候选；
- 提供检索和 summarization，结果带 evidence/provenance。

Mem 不拥有：

- 所有 ContextUnit 的索引；
- 全局 freshness / lifecycle authority；
- Tool/Skill capability descriptor 的 canonical 目录；
- transcript / workspace / tool schema / Skill 正文。

“freshness、scope、conflict、merge、budget、lineage、最终投影”这些裁决权属于 DCS。Mem 只对“自己拥有的持久语义记忆”提供本地 freshness 和证据，不能决定其他来源是否过期。

### 决策 4：Working Context 是任务账本，不是另一个记忆库

Working Context 实现为 **版本化 Task Context Ledger**：

- task-scoped；
- 字段：Objective / Constraints / ConfirmedFacts / Decisions / OpenRisks / ActiveFiles / Evidence / NextAction；
- 每个字段有更新者、证据、版本、TTL；
- 支持 fork / compact / handoff 合并规则；
- 任务结束后，只有经确认的单元可以晋升到 Mem。

Working Context 的 owner 是任务账本，不是 Mem；它消费 user intent、tool result、task state 和 Mem provider 结果。

### 决策 5：Provider Guard 拥有最终 RequestEnvelope 权威

在 DCS compile 之后、provider 发送之前增加 Provider Guard：

- 生成完整 `RequestEnvelope` digest，覆盖：
  - system prompt；
  - messages；
  - tools；
  - 媒体内容；
  - 所有 registered transforms；
  - cache boundary / model identity 等最终 wire 字段。
- 所有遗留 hook 的 `systemPrompt` 覆盖必须迁移为 `PromptContribution`：
  - contribution 进入 DCS 或登记为 declared transform；
  - 禁止绕过 DCS 直接 mutation。
- 先以 **observational / read-only** 上线，只计算 digest 和登记 bypass；不因新增观测改变发送行为。
- 后续在证据充分后，才允许 fail-closed 拒绝未登记旁路。
- 覆盖范围分阶段：
  - Stage 1：黄金路径范围内未登记 egress 为 0；
  - 后续阶段：逐 provider、逐 channel、逐 plugin 扩大覆盖；
  - 最终全局不变量：系统级未登记旁路为 0，break-glass 必须有审计记录。
- Stage 1 的工具调用使用现有 approval/effect 链派生**临时最小 grant**；Stage 4 才将该临时适配提升为统一、可衰减、可撤销的 `CapabilityGrant` 契约。

### 决策 6：Receipt 只做审计可追溯，不承诺无条件下重放

- Receipt 保存 digest / ref / policy digest / budget / lineage。
- Receipt 不保存原始内容。
- 重放分两档：
  - `audit-traceable`：能解释选择了什么、丢掉了什么、为什么；
  - `reproducible`：仅当所有 owner 内容、版本和配置不变时可重建同一 digest。
- 不承诺“仅凭 receipt 恢复 prompt 原文”。

---

## 3. 权威矩阵

| 对象 | 权威 | 职责 |
|---|---|---|
| CapabilityDescriptor | V3 Capability Catalog | Tool/Skill/Context-provider 发现元数据 |
| 原始 payload | Owner stores | transcript、workspace、tool registry、skill loader、memory stores、archive |
| ContextRef | Owner stores | owner、source reference、revision、content digest、ACL、retention、provenance |
| CompilationSnapshot | DCS | 编译输入冻结：refs、catalog epoch、policy epoch、model profile、Task Ledger revision |
| PromptPlan | DCS | selected/omitted/order/budget/why |
| RequestEnvelope | Provider Guard | provider 最终请求 |
| CapabilityGrant | 现有 policy/approval/session identity 派生 | 主体、任务分支、资源、动作、purpose、TTL、revocation epoch |
| EffectReceipt | Effect boundary | 工具/写入真实执行后的证据 |
| 持久语义记忆 | Mem | durable memory、retrieval、summarization candidates |
| Working Context | Task Context Ledger | task-scoped 工作集、版本、TTL、晋升 |
| 审计链 | Receipt / Archive journal | selected/omitted、digest、provenance |

### 决策 7：六 artifact 取代“万能 ContextUnit”

`ContextUnit` 不承载全部职责。拆为：

- `ContextRef`：owner、revision、content digest、ACL、retention、provenance；
- `CompilationSnapshot`：refs、catalog epoch、policy epoch、model profile、Task Ledger revision；
- `PromptPlan`：DCS 的 selected/omitted/order/budget/why；
- `RequestEnvelope`：provider adapter 的规范化最终请求；
- `CapabilityGrant`：主体、任务分支、资源、动作、purpose、TTL、revocation epoch；
- `EffectReceipt`：工具或写入真实执行后的证据。

### 决策 8：现有资产必须降级为工程资产

- ReceiptStore / EffectReceipt / approval ledger 是**可复用工程资产**；
- 它们不是已经闭合的可信控制平面；
- Tool-call gate 仍 `report_only`；
- TaskFlow CAS 仍 candidate；
- runtime-convergence 仍 `human_acceptance_pending`、产品锁 false；
- 统一逻辑契约和真实 runtime enforcement 补齐后，才可称为控制平面能力。

---

## 4. 实施顺序（rev3 最终裁决后）

```text
Stage 0  冻结五平面、六 artifact、policy/grant/effect 契约
Stage 1  Provider Guard + 一个真实工具调用 + EffectReceipt
Stage 2  ContextRef -> CompilationSnapshot -> DCS -> PromptPlan
Stage 3  Task Ledger proposal / accept / reject + 物化投影
Stage 4  CapabilityGrant、子 agent 衰减授权、重启恢复
Stage 5  Memory 收敛、unit-aware packing、真实任务对照
Stage 6  Context diff、why-included、policy simulation、replay debugger
```

细节见 `docs/dev/context-capability-blueprint.md`（rev3）。

---

## 5. 后果

### 正面

- 消除 Mem 与 DCS 的权威重叠；
- CapabilityDescriptor 不会膨胀为通用数据目录；
- Provider Guard 给“单一权威”一个可机器验证的边界；
- Working Context 成为可版本、可合并、可晋升的任务账本；
- replay 语义诚实。

### 成本与风险

- Provider Guard 增加一次 digest/登记开销，必须先做观测并证明零/低性能影响；
- 六 artifact 最小契约增加 producer/authority 适配成本；
- Task Context Ledger 增加 fork/compact/handoff 合并复杂度；
- legacy hook 迁移可能改变插件行为，需要兼容窗口。

---

## 6. 红线

- 不翻默认，不宣称 GA；
- 不新增第四个能力目录；
- 不新增第二个上下文投影 authority；
- 不新增第三个 durable memory writer；
- 最终全局不变量：系统级未登记旁路为 0；break-glass 必须有审计记录。
- Stage 1：黄金路径范围内未登记 egress 为 0；后续逐 provider/channel/plugin 扩大覆盖。
- 不用 synthetic/agent-surrogate 证据推进 default-on。

---

*本 ADR 与 `context-capability-blueprint.md` rev3 一并提交独立审计。*
