# DCS-first 架构竞争评审提示词

完整的阅读顺序、源码追踪、证据等级、交付文件和质量门槛见 [DCS-first 架构独立评审任务书](C:\Users\27933\Desktop\clawx\ClawX\docs\dev\dcs-first-architecture-review-assignment.md)。本文件保留为可快速复制的精简版。

将下面内容交给其他 agent，要求其独立评审 ClawX 的 DCS-first 方案。评审 agent 不应只复述方案，而应主动寻找反例、成本陷阱和更简单的替代设计。

```text
你正在评审 ClawX 的 DCS-first Context Engine 方案。

设计背景：
- DCS 是上下文编译层，不是普通 context provider。
- Mem 是选择性语义处理器，不是所有信息的必经通道。
- 简单结构化信息可以走 deterministic fast path。
- 需要抽取、去重、合并、冲突判断或语义压缩的信息才进入 Mem path。
- 所有进入 provider 的内容都必须先进入统一 Context IR。
- 每个 agent turn 只生成一个不可变 provider-bound ContextBundle。
- Working Context 是 task/session scoped 的最小认知工作集。
- ContextCandidate/v1 是现有基础，但目标是升级为 ContextUnit/v1 + ContextBundle/v1。
- 所有候选都要有 source/version/epistemic status/scope/priority/freshness/lineage。
- Run、Session、Effect 是唯一权威；UI、Graph、Ledger、Observability 都是投影。
- 默认路径最小，增强能力显式升级。

请从以下角度独立评审：

1. 这个设计是否真的解决上下文成本、冗余、漂移和不可控注入？
2. DCS、Mem、Working Context、Context IR 之间是否存在职责重叠？
3. Fast Path / Mem Path 的 admission 判断是否可操作、可观测、可回放？
4. “一次编译、一次 provider 请求”是否会与流式工具调用、重试、compact、handoff、fork 冲突？
5. ContextUnit 的字段是否足够支撑事实、推断、冲突、过期、敏感性和证据？哪些字段是过度设计？
6. unit-aware packing 是否比字符预算更可靠？如何避免摘要损失关键约束？
7. 该方案是否会导致新的中央巨型编排器或高延迟瓶颈？
8. 哪些能力应该保留在 DCS 核心，哪些应该降为 adapter/profile？
9. Codex CLI、Aider 或其他成熟产品是否有更简单的实现可以替代某些设计？
10. 先做什么最能获得真实 E4/E5 证据？哪些工作应该明确拒绝？

请输出：

A. 你认为方案最强的 3 个点；
B. 最严重的 5 个风险，按 P0/P1/P2 排序；
C. 至少 1 个比当前方案更简单的替代架构；
D. 对 ContextUnit/v1、ContextBundle/v1、Admission Planner 的具体修改建议；
E. 一个 2-3 个阶段的最小实施路线，每阶段包含验收指标；
F. 明确判断：保留、修改、推翻，不能只给模糊建议。

评审规则：
- 不把“代码已经存在”当作“生产能力已经证明”；
- 不把 fixture、synthetic test 或旧报告当作 live evidence；
- 不建议通过增加更多 provider、flag、memory layer 或 UI 状态解决 authority 问题；
- 每个成本优化必须同时说明事实保真度、延迟、token、失败恢复和可观测性；
- 每个新增自治能力必须说明 capability profile、approval policy、effect receipt 和 rollback 边界；
- 如果认为 DCS-first 不成立，必须提出可落地的替代设计，而不是只指出问题。
```

## 评审结果汇总格式

多 agent 评审结束后，统一整理为：

```text
Decision: keep / revise / replace
Consensus:
Disagreements:
P0 risks:
Simpler alternative:
Chosen Context IR changes:
Chosen first milestone:
Rejected ideas:
Evidence required before default-on:
```
