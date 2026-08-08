# STAR 原则：DCS-first 的设计哲学与后续开发理念

**日期**：2026-08-02  
**适用范围**：ClawX / OpenClaw runtime、DCS、Mem、Working Context、ContextBundle 及其所有上层能力  
**定位**：架构决策的长期约束，不是某个功能的实现方案

## 1. STAR 是什么

ClawX 的核心产品不是“拥有最多能力的 Agent”，而是：

> 让每一次 agent turn 都基于高密度、可控、可解释、可恢复的上下文运行。

STAR 是这套设计哲学的四个不可分割的原则：

```text
S — Semantic Density       语义密度
T — Truth Authority        真实权威
A — Adaptive Cognition     自适应认知
R — Reversible Delivery    可恢复交付
```

它们的关系是：

```text
高密度信息
  + 单一真实权威
  + 按价值选择认知成本
  + 对副作用和上下文都诚实可恢复
  = 可依赖的 Agent Runtime
```

任何新能力如果不能说明自己如何满足 STAR，就不能进入默认核心路径。

## 2. S：Semantic Density，语义密度

### 2.1 原则

上下文优化的目标不是“塞入更多内容”，也不是单纯压缩字符，而是在有限预算内最大化任务有效信息：

```text
信息价值 / token / 延迟 / 风险
```

必须优先保留：

- 当前目标和硬约束；
- 已确认事实和证据；
- 已作出的决定及其原因；
- 未解决风险、阻塞点和下一步。

通常可以压缩或丢弃：

- 重复叙述；
- 已被新版本事实覆盖的观察；
- 与当前任务无关的日志；
- 已完成且不再影响下一步的过程细节。

### 2.2 工程要求

- 所有进入模型的内容先转换为统一 Context IR；
- 结构简单的信息走 deterministic fast path；
- 只有需要抽取、合并、冲突判断或语义压缩的信息才进入 Mem；
- 不允许用裸字符串前缀截断替代语义 packing；
- `critical` 事实、硬约束和关键证据不可静默丢弃；
- 每次摘要、合并、压缩和丢弃都必须保留 lineage。

### 2.3 禁止事项

- 不以 prompt 长度越大为能力指标；
- 不以压缩率越高为优化成功指标；
- 不让 Mem 无条件处理所有输入；
- 不把最近消息简单等同于 Working Context；
- 不允许 provider adapter 私自拼接未登记上下文。

## 3. T：Truth Authority，真实权威

### 3.1 原则

系统必须能回答：

1. 这一段上下文来自哪里？
2. 它是什么版本？
3. 它是确认事实、推断、提案还是不确定信息？
4. 为什么本轮选中它？
5. 哪些内容被排除，为什么排除？
6. 最终发送给 provider 的完整 bundle 是什么？

因此必须建立三个唯一权威：

```text
Run Authority      决定运行生命周期、排队、重试、暂停和完成
Session Authority  保存 transcript、working context、checkpoint 和 fork 关系
Effect Authority   批准、执行、记录和确认所有外部副作用
```

DCS 是上下文编译权威。UI、Graph、Ledger、Observability、ClawGraph 都只能是这些权威的投影，不能形成第二套事实。

### 3.2 工程要求

- 所有 ContextUnit 必须有 source、version、scope、epistemic status 和 digest；
- 每轮只生成一个不可变 `ContextBundle`；
- 编译结果、选择结果、压缩结果和成本必须可重放；
- 所有状态投影从统一事件流生成；
- 默认值、kill switch、审批和能力声明必须有单一来源；
- 文档中的能力等级必须与真实证据等级一致。

### 3.3 禁止事项

- 不允许多个模块各自维护“当前上下文”；
- 不允许 UI 状态覆盖 runtime 事实；
- 不允许代码存在、fixture 通过或 synthetic evidence 被描述为 live-ready；
- 不允许隐藏 prompt、隐藏 memory 注入或未经登记的 provider 侧上下文；
- 不允许用新的 flag 掩盖 authority 未统一的问题。

## 4. A：Adaptive Cognition，自适应认知

### 4.1 原则

Agent 不应对所有信息使用同一种处理强度。系统应根据任务价值、信息复杂度、重复度、冲突度和成本预算，选择不同认知路径：

```text
Fast Path       结构化规范化，不调用 Mem
Mem Path        抽取、归纳、去重、冲突处理、工作记忆构建
Deferred        当前不需要，保留可引用来源
Drop            无关、过期、低价值或超出策略边界
```

`effort`、`mode`、`capability profile` 和 `approval policy` 必须是四个独立维度：

```text
effort              质量、延迟和 token 成本预算
mode                ask / plan / code / review 等工作流
capability profile  允许的工具和副作用集合
approval policy     何时必须暂停并请求用户决定
```

任何一个维度都不能隐式升级另一个维度。

### 4.2 工程要求

- Mem 调用之前必须先经过 admission planner；
- 相同 source/version/content digest 的处理结果应缓存复用；
- 长历史应优先生成可引用摘要，而不是每轮重算；
- 多 Agent 只在有明确任务收益时启用；
- 上下文预算应按语义单元和优先级分配，而不是只按来源预留；
- 每次自适应选择都要记录原因、成本和结果。

### 4.3 禁止事项

- 不因“高强度”而自动获得写入、网络、浏览器或远程权限；
- 不因平台能力存在就默认启用 Memory、Browser、Cron 或 Multi-agent；
- 不为了上下文统一而让短小结构化信息经过昂贵 Mem；
- 不用增加 token 预算掩盖选择算法低效；
- 不把复杂度转嫁给普通用户的每次交互。

## 5. R：Reversible Delivery，可恢复交付

### 5.1 原则

Agent 的交付必须可检查、可暂停、可接力、可恢复，并且诚实表达不可恢复的部分。

恢复对象必须分开：

```text
Transcript rewind       对话历史分叉或截断
Context rebuild         重新编译上下文
Workspace restore       恢复文件或 worktree
Process restart         终止并重新启动进程
External effect         已发送消息、远程 mutation，通常不可自动撤销
```

不能把这些对象包装成一个含义过强的“全局 rollback”。

### 5.2 工程要求

- 每个副作用都有 ProposedEffect 和 EffectReceipt；
- checkpoint 保存可重建事实、证据、决定、风险和下一步，不伪装成世界快照；
- 恢复结果明确列出 restored、not-restored、external-effects 和 manual-actions；
- 成功但实际没有恢复任何目标对象必须报告为失败或显式 no-op；
- queue、retry、fork、handoff 必须绑定稳定 idempotency key；
- 长任务必须能够从 checkpoint 重新生成 ContextBundle。

### 5.3 禁止事项

- 不承诺无法保证的全链路回滚；
- 不让重试重复发送消息或重复执行远程 mutation；
- 不让 checkpoint 只保存 UI 文案而缺少可执行恢复材料；
- 不把失败后仍存在的外部副作用隐藏在“任务已回滚”之后；
- 不因恢复复杂而删除必要审计证据。

## 6. STAR 对技术架构的直接约束

### 6.1 唯一上下文管线

```text
Observation
  -> Admission
  -> Fast Path / Mem Path
  -> ContextUnit/v1
  -> Working Context
  -> DCS Resolve
  -> Unit-aware Pack
  -> ContextBundle/v1
  -> Provider Adapter
```

任何直接追加 `extraSystemPrompt`、直接拼接历史、绕过 DCS 的 Memory 注入，都视为架构违规。

### 6.2 能力分层

```text
Core Context Engine
  DCS / Mem routing / Working Context / ContextBundle / lineage / budget

Core Coding Profile
  repo map / plan / edit / approval / verify / diff / workspace restore

Capability Adapters
  channels / web / browser / cron / media / Office / MCP / remote / multi-agent
```

第三层能力必须通过统一 ingress、context、effect、receipt 和 evidence 契约接入，不能直接成为新的运行时真相源。

## 7. 后续开发理念

### 理念一：Context-first，而不是 Feature-first

每个需求首先回答：

- 它需要产生什么 ContextUnit？
- 它改变哪个 working context？
- 它是否增加 provider-bound ContextBundle 的信息价值？
- 它是否引入新的外部副作用？

如果只能回答“增加一个按钮/工具/渠道”，还没有达到架构需求的粒度。

### 理念二：先定义语言，再实现模块

先稳定 `ContextUnit/v1`、`ContextBundle/v1`、`ProposedEffect/v1`、`EffectReceipt/v1` 和 `RunCheckpoint/v1`，再让 DCS、Mem、VToken、SEKB、Browser、渠道等模块适配它们。

不要让每个模块先发明自己的对象，再通过大量 glue code 互相转换。

### 理念三：每个优化都必须证明净收益

任何新的摘要、记忆、压缩或多 Agent 策略，都必须同时测量：

```text
任务成功率
关键事实保留率
约束保留率
重复率下降
输入/输出 token
编译延迟
模型重复提问率
人工审查质量
```

只降低 token 但降低事实保真度，不算优化；只提高完成率但增加不可审计副作用，也不算优化。

### 理念四：先做单 Agent 的可信闭环

开发顺序固定为：

```text
单轮上下文正确
-> 单 Agent coding 正确
-> 长任务可恢复
-> 多入口一致
-> bounded multi-agent
-> 更高自治
```

不能从 Multi-agent、Heartbeat 或 Remote Task 倒推核心 runtime 已经成熟。

### 理念五：默认路径必须最小

默认路径只包含完成任务所必需的内容。所有增强能力都必须：

- 有明确 profile；
- 有显式开启方式；
- 有 kill switch；
- 有成本和延迟上限；
- 有失败和恢复语义；
- 有真实 canary 毕业条件。

### 理念六：文档、提示词和代码共享同一哲学

提示词不能要求模型“记住一切”，而应要求模型围绕 ContextBundle 工作：

- 区分 confirmed / inferred / proposed；
- 不重复请求已有证据；
- 发现冲突时上报，不自行覆盖；
- 结束时更新 working context 和 checkpoint；
- 对工具副作用等待明确 effect policy。

## 8. 新功能评审门

任何新功能进入实现前必须通过以下问题：

| 问题 | 必须回答 |
|---|---|
| S | 它增加的是信息密度还是信息数量？会保留什么关键语义？ |
| T | 哪个 authority 负责它？如何产生 lineage 和 receipt？ |
| A | 什么情况下走 Fast Path、Mem Path、Deferred 或 Drop？成本上限是什么？ |
| R | 失败、重试、fork、handoff 和 rollback 分别意味着什么？ |
| Evidence | 如何用真实 corpus/provider/channel 证明，而不是只用 fixture？ |
| Scope | 它属于 Core、Coding Profile 还是 Capability Adapter？ |

答不清楚时，功能应停留在设计阶段，不应直接进入 runtime。

## 9. STAR 的成功定义

STAR 成功不是“所有模块都接入”，而是用户可以稳定感知：

1. Agent 没有忘掉关键目标和约束；
2. Agent 没有被冗余历史拖慢或污染；
3. 用户能知道模型看到了什么以及为什么；
4. 成本、延迟和自主性随任务价值自适应；
5. 失败后可以准确知道能恢复什么、不能恢复什么；
6. 新渠道或新工具不会破坏核心上下文语义。

最终目标：

```text
One Language
One Context Compiler
One Provider-bound Bundle
One Effect Ledger
Honest Recovery
```

