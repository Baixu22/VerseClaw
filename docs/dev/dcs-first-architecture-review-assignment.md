# DCS-first 架构独立评审任务书

**用途**：交给另一个 agent 做独立、带证据的架构竞争评审。  
**评审对象**：ClawX 的 DCS-first Context Engine、Mem、Working Context、Context IR、ContextBundle 及其后续开发路线。  
**评审方式**：先读指定材料，再追踪源码和真实入口，最后交付独立结论。  
**默认权限**：只读研究，不修改运行时代码、不翻转默认开关、不改变 readiness 结论。

## 一、直接交给其他 agent 的提示词

以下代码块可以原样复制给其他 agent：

```text
你是 ClawX DCS-first Context Engine 的独立架构评审 agent。

你的任务不是复述既有设计，也不是继续堆功能，而是判断这套设计是否值得作为 ClawX 的长期核心，并提出能够真正落地的保留、修改或替代方案。

### 设计背景

ClawX 的拟定核心是 DCS-first Context Engine：

1. DCS 是上下文编译层，不是普通 context provider。
2. Mem 是选择性语义处理器，不是所有信息的必经通道。
3. 简单、短小、结构明确的信息可以走 deterministic fast path。
4. 只有需要抽取、归纳、去重、合并、冲突判断或语义压缩的信息才进入 Mem path。
5. 所有可能进入 provider 的内容都必须先进入统一 Context IR。
6. 每个 agent turn 只生成一个不可变的 provider-bound ContextBundle。
7. Working Context 是 task/session scoped 的最小认知工作集，不等于全局记忆或最近消息拼接。
8. 当前实现已有 ContextCandidate/v1、统一 precedence、去重、共享预算、kill switch 和 lineage；目标是演进为 ContextUnit/v1 + ContextBundle/v1。
9. ContextUnit 预计包含 source、version、epistemic status、scope、priority、freshness、sensitivity、merge policy 和 evidence refs。
10. Run、Session、Effect 是唯一运行时权威；UI、Graph、Ledger、Observability 都只能是投影。
11. 默认路径最小，增强能力必须显式升级。

### 你的硬性工作边界

- 不修改源代码、默认配置、readiness flags 或用户现有 WIP。
- 不把“代码存在”“测试通过”“fixture/synthetic evidence”描述成 live-ready 或 product-approved。
- 不把已有设计当作必然正确；必须主动寻找反例、失效模式和更简单的方案。
- 不用增加更多 provider、flag、memory layer、UI 状态或 graph 节点来掩盖 authority 不统一。
- 如果你认为 DCS-first 不成立，必须给出可实现的替代架构，而不能只列问题。
- 所有关键判断必须绑定源码、文档、测试或运行证据，并注明 E0-E5 证据等级。
- 你的结论必须区分：当前已经实现的事实、设计目标、尚未实现的建议、需要真实 canary 才能证明的假设。

### 必须按顺序阅读的材料

#### A. 项目规则与当前成熟度

1. `AGENTS.md`
2. `docs/dev/Sustained-Development-Playbook.md`
3. `docs/dev/full-chain-maturity-audit-2026-08-02.md`
4. `docs/dev/default-config-matrix.md`

#### B. 设计哲学与当前目标

5. `docs/dev/star-principles-and-development-philosophy-2026-08-02.md`
6. `docs/dev/dcs-first-context-engineering.md`
7. `docs/dev/architecture-philosophy-and-maturity-research-2026-08-02.md`
8. `docs/dev/context-orchestrator.md`

#### C. 必须追踪的实现

9. `openclaw_runtime/src/context-engine/context-orchestrator.ts`
10. `openclaw_runtime/src/context-engine/context-candidate.ts`
11. `openclaw_runtime/src/context-engine/turn-injection-budget.ts`
12. `openclaw_runtime/src/context-engine/chat-turn-memory-injection.ts`
13. `openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts`
14. `openclaw_runtime/src/context-engine/assembler.ts`
15. `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`
16. `openclaw_runtime/src/auto-reply/dispatch.ts`
17. `openclaw_runtime/src/gateway/server-methods/agent.ts`
18. `shared/dcs/prod-flags-catalog.ts`

#### D. 必须阅读的验证证据

19. `openclaw_runtime/src/context-engine/context-candidate.test.ts`
20. `openclaw_runtime/src/context-engine/context-orchestrator.test.ts`
21. `tests/unit/default-config-matrix.test.ts`
22. `docs/dev/first-product-controlled-preview/STATUS.md`
23. `artifacts/agent-dev-audit/report.json`（若存在，必须注意 freshness 和证据边界）
24. `artifacts/uas-06-single-local-exec-canary/real-cohort-report.json`（若存在，确认是否为 no-live-observations）

#### E. 成熟产品对照

25. 本地 Codex：`C:\Users\27933\Desktop\coding\codex-main\docs\sandbox.md`
26. 本地 Codex：`C:\Users\27933\Desktop\coding\codex-main\docs\execpolicy.md`
27. 本地 Codex：`C:\Users\27933\Desktop\coding\codex-main\docs\agents_md.md`
28. 本地 Codex：`C:\Users\27933\Desktop\coding\source_archive\codex`
29. 本地 Aider：`C:\Users\27933\Desktop\coding\aider-main\aider\repomap.py`
30. 本地 Aider：`C:\Users\27933\Desktop\coding\aider-main\aider\coders\base_coder.py`
31. 本地 Aider：`C:\Users\27933\Desktop\coding\source_archive\NOTES\02_能力2_RepoMap上下文选择.md`
32. 本地 Aider：`C:\Users\27933\Desktop\coding\source_archive\NOTES\03_能力3_LintTest反射循环.md`
33. 本地 Aider：`C:\Users\27933\Desktop\coding\source_archive\NOTES\04_能力4_Architect双模型协作.md`

如果某个文件不存在，记录 `missing`，不要自行假设其内容；继续读取其他材料。

### 必须完成的源码追踪

请至少画出或用文字完整追踪以下链路：

#### 链路 1：普通桌面消息

`ChatInput -> Host API/Main -> Gateway chat.send -> auto-reply dispatch -> agent turn -> context collection -> final projection -> provider request`

明确指出：Context 编译在哪一层发生、是否存在第二个 prompt 拼接点、最终 provider 请求是否能得到唯一 ContextBundle。

#### 链路 2：真实外部入口

选择一个已接入的 channel 或 Cron，追踪：

`Ingress -> admission -> session identity -> turn -> context -> delivery`

比较它与桌面消息是否共享同一套 context authority、session authority、effect/approval 语义。

#### 链路 3：失败、compact、fork 或 handoff

选择至少一个场景，说明：

- 哪些事实能够恢复；
- 哪些上下文需要重新编译；
- 哪些外部副作用不能撤销；
- 是否存在重复执行或状态漂移风险。

### 必须回答的架构问题

#### 1. 方向判断

- DCS-first 是否应该保留为核心方向？结论只能是 `keep`、`revise` 或 `replace`。
- 这个方向真正解决了什么问题？没有解决什么问题？
- 它相对于 Codex CLI/Aider 的真实差异化是什么？

#### 2. 语义边界

- DCS、Mem、Working Context、Context IR、ContextCandidate、ContextBundle 的职责是否重叠？
- 哪个对象是事实，哪个对象是中间产物，哪个对象是 provider 投影？
- 哪些内容必须保留原文，哪些可以摘要，哪些可以丢弃？
- confirmed、inferred、proposed、uncertain、stale 如何阻止错误记忆污染？

#### 3. 成本与高密度

- admission 是否发生在昂贵 Mem/provider 调用之前？
- Fast Path / Mem Path / Deferred / Drop 是否可操作、可观测、可回放？
- 缓存的 key、失效条件和隐私边界是什么？
- unit-aware packing 是否优于当前字符预算？如何防止摘要丢失关键约束？
- 需要哪些指标证明“高密度”而不是单纯“更短”？

#### 4. 单次编译语义

- “一次编译、一次 provider 请求”如何处理流式 tool loop、重试、compact、fork、handoff 和 provider fallback？
- 是每个 turn 一次编译，还是每个 model call 一次编译？请明确选择并解释。
- tool result 回来后如何生成下一次 ContextBundle？
- provider adapter 如何被强制禁止隐藏追加 prompt？

#### 5. 权威与恢复

- Run、Session、Effect、DCS 四个 authority 的边界是否清楚？
- UI、Graph、Ledger、Observability 如何确保只是投影？
- transcript rewind、context rebuild、workspace restore、process restart、external effect 是否被清楚区分？

#### 6. 复杂度与替代方案

- 当前方案是否会制造中央巨型编排器、延迟瓶颈或 schema 过度设计？
- 哪些能力应留在 DCS core，哪些应降为 coding profile 或 adapter？
- 至少提出一个比当前方案更简单的替代架构，并比较迁移成本、收益和风险。

#### 7. 真实落地

- 哪个最小任务场景最适合做 E4 canary？
- 需要什么真实 corpus、provider、workspace、人工评价和 soak？
- 哪些工作现在应该明确拒绝，因为会扩大复杂度而不增加证据？

### 你的思考方法

请按以下顺序思考，不能跳到结论：

1. 事实层：当前代码和证据到底证明了什么？
2. 语义层：DCS-first 每个对象的权威边界是什么？
3. 运行层：一轮 turn、tool loop、retry、compact、fork 如何演进？
4. 成本层：每一步增加多少 token、延迟、存储、维护和失败面？
5. 证据层：哪些判断必须经过真实 provider/channel/browser/人审才能成立？
6. 选择层：保留、修改、替代，并给出最小迁移路线。

### 最低交付要求

你必须提交一个独立 Markdown 报告，不能只在对话中给出摘要。报告至少包含：

1. Executive decision：`keep` / `revise` / `replace` + 置信度；
2. 证据表：结论、来源文件/行号、证据等级 E0-E5、是否可外推；
3. 最强的 3 个设计点；
4. 最严重的 5 个风险，按 P0/P1/P2 排序；
5. DCS/Mem/Working Context/IR/Bundle 的职责矩阵；
6. 三条源码链路追踪结果；
7. 至少一个具体失败场景和恢复分析；
8. ContextUnit/v1、ContextBundle/v1、Admission Planner 的修改建议；
9. 至少一个更简单的替代架构；
10. 2-3 阶段最小实施路线，每阶段包含验收指标；
11. 明确的 rejected ideas；
12. 需要产品 owner 决策的开放问题；
13. 真实 E4/E5 证据要求，以及现在不应承诺的能力。

### 交付结论的硬格式

报告结尾必须包含以下机器可读区块：

Decision: keep | revise | replace
Confidence: high | medium | low
Core_thesis: <一句话>
P0_risks: <逗号分隔>
Chosen_IR_changes: <逗号分隔>
Chosen_first_milestone: <一句话>
Simpler_alternative: <一句话>
Rejected_ideas: <逗号分隔>
Evidence_required_before_default_on: <逗号分隔>
Owner_questions: <逗号分隔>

### 质量门槛

- 不允许只写赞成意见；至少有一个反例和一个替代方案。
- 不允许只谈类型设计；必须追踪真实 runtime 入口和 provider boundary。
- 不允许把“更高密度”写成“更少字符”；必须给出事实/约束保留指标。
- 不允许把 Mem 设计成无条件必经管道；必须说明 fast path。
- 不允许把 rollback 说成全世界回滚；必须拆分恢复对象。
- 不允许把多 agent、Browser、Remote、SEKB 自动写回设为默认前提。
- 不允许修改 ClawX 代码来让评审结果变绿。
```

## 二、评审 agent 必须交付的文件

### 1. 主报告（必交）

建议路径：

```text
docs/dev/reviews/dcs-first-architecture-review-<agent-id>-<yyyy-mm-dd>.md
```

主报告是唯一允许写长篇论证的文件，必须包含提示词要求的全部章节和最终机器可读区块。

### 2. 决策卡（必交）

建议路径：

```text
docs/dev/reviews/dcs-first-decision-card-<agent-id>-<yyyy-mm-dd>.yaml
```

建议结构：

```yaml
decision: keep | revise | replace
confidence: high | medium | low
core_thesis: ""
strengths: []
p0_risks: []
p1_risks: []
p2_risks: []
chosen_ir_changes: []
simpler_alternative: ""
first_milestone: ""
rejected_ideas: []
evidence_required_before_default_on: []
owner_questions: []
```

这个文件只放结论，不放长篇解释，便于多个 agent 之间做竞争合并。

### 3. 场景与证据附录（必交）

建议路径：

```text
docs/dev/reviews/dcs-first-evidence-matrix-<agent-id>-<yyyy-mm-dd>.md
```

至少包含以下表格：

| 场景 | 入口 | Context authority | Mem path | 最终 bundle | 副作用 | 恢复边界 | 当前证据等级 |
|---|---|---|---|---|---|---|---|
| 桌面 coding |  |  |  |  |  |  |  |
| channel 或 cron |  |  |  |  |  |  |  |
| compact/fork/handoff |  |  |  |  |  |  |  |

### 4. 可选：非代码变更建议

如果评审 agent 认为需要修改 schema、契约或文档，可以提交：

```text
docs/dev/reviews/dcs-first-proposed-changes-<agent-id>-<yyyy-mm-dd>.md
```

只允许提交设计级修改建议、字段草案、迁移顺序和验收标准，不直接改运行时代码。代码实现必须由后续明确授权的任务承担。

## 三、评审完成判定

一个评审只有同时满足以下条件，才算有效：

- 已阅读 A-D 类必读材料，或明确记录缺失文件；
- 至少完成三条 runtime 链路追踪；
- 至少提供一个反例和一个更简单的替代方案；
- 明确区分当前事实、设计目标和未验证假设；
- 主报告、决策卡、证据矩阵三件套齐全；
- 没有修改 ClawX 运行时代码或现有 readiness/default-on 状态；
- 给出了第一阶段可执行的验收指标，而不是泛泛的长期愿景。

多个 agent 完成后，主负责人应只合并以下内容：

```text
共同结论
不可调和的分歧
最高优先级 P0 风险
最小可行的 IR/Bundle 变更
第一阶段唯一实施目标
明确拒绝的扩张方向
需要 owner 决策的问题
```

