# 对“可信 Agent 控制平面”提案的评审意见（Debate Notes）

| 字段 | 值 |
|---|---|
| 状态 | `review`（辩论用，非最终决策） |
| 日期 | 2026-08-16 |
| 对象 | “ClawX 不应只是上下文编译器，而应成为可信 Agent 控制平面”提案 |
| 立场 | 方向上赞成升级；实施上要求先复用现有权威，不新增第二套 Policy/Identity/Effect 系统 |
| 关联文档 | `docs/dev/context-capability-blueprint.md`（rev2）、`docs/dev/adr/2026-08-16-context-authority-boundaries.md` |

---

## 1. 总体结论

提案把北极星从“模型拿到更多信息”升级为“每个可见 token、每次工具调用、每次写入都能回答 provenance / permission / actor / effect”，这是对的。五平面模型比我 rev2 的“上下文收敛蓝图”更完整，也更有产品壁垒。

但我不接受把它作为**替代现有控制面**的蓝图。正确做法是把它作为 rev2 的**目标架构扩展**，并且严格区分：

- 哪些是现有能力的重新命名/接线；
- 哪些是需要新建的 authority；
- 哪些是长期愿景，不应进入前三个 stage。

我的核心反对项：**不要新增 Policy/Identity/Effect 三套 authority**。仓库已经存在 workspace guard、approval ledger、EffectReceipt、V3 lease/trusted catalog、RC-03 wire receipt、sandbox/approval policy。新增三套 authority 会制造第二轮“authority 重叠”，正是我们刚刚从 Mem/DCS 那里修正的问题。

---

## 2. 我同意的部分

1. **五平面拆分正确**：
   - 数据平面回答“事实在哪里”；
   - 能力平面回答“有什么能力”；
   - 上下文平面回答“本轮看什么”；
   - 效果平面回答“凭什么执行”；
   - 出口平面回答“最终发了什么、发生了什么”。
2. **V3 不是权限，DCS 不是数据库，Mem 不是全局事实库，Provider Guard 不是第二个 prompt compiler**——这四句比 rev1 更精确。
3. **黄金垂直链路优先**：选择普通 coding turn 先跑通，而不是全系统迁移。这是防止该项目再次膨胀的最重要约束。
4. **DCS 无状态、可丢弃**：DCS 只做编译，缓存/索引是 materialized view，事实留在 owner store。这避免 DCS 成为第二数据库。
5. **安全不能交给 prompt**：Tool Guard 在执行点验证 grant/scope/TTL/actor chain，而不是只在 system prompt 里写安全规则。
6. **Task Ledger 更新只能是 proposal**：长任务和多 agent 需要可解释、可恢复的状态机，而不是模型直接改任务状态。
7. **六类 artifact 拆分优于单一万能 ContextUnit**：`ContextRef / CompilationSnapshot / PromptPlan / RequestEnvelope / CapabilityGrant / EffectReceipt` 边界清楚。
8. **上下文经济系统放在 shadow/offline**：学习型排序不能先碰安全关键内容。

---

## 3. 我的反对与风险

### 3.1 不要新建 Policy/Identity/Effect authority，应先做 Authority Map

现有事实：

- `effect-receipt.ts` 已有 EffectReceipt；
- `approval-ledger.ts` 已有 durable approval ledger；
- `operator-slice.ts` 已把 cron ingress -> approval -> bounded effect -> EffectReceipt 串起来；
- V3 `trusted-catalog.ts` 已有 lease/revoke/epoch 验证；
- workspace guard、sandbox、MCP policy、channel policy 已经各自承担工具权限。

风险：如果 Stage 0 直接“新增 Policy/Identity/Effect authority”，很可能出现：

- Tool Guard 与现有 approval/workspace 判断不一致；
- EffectReceipt 出现两套定义；
- CapabilityGrant 与 V3 lease 重复。

修正：Stage 0 应产出 **Authority Map**，逐项列出每个现有 authority 的 owner、写入路径、执行路径、缺口；只有缺口才允许新建 authority。

### 3.2 “每个字段都有 source/policy/owner/生命周期”可能变成分析瘫痪

六类 artifact 可以冻结字段，但不能要求所有既有系统每个字段立即具备完整 provenance。否则前三个月都会耗在元数据迁移，黄金路径永远跑不通。

修正：只对六类 artifact 定义最小 schema 和必填治理字段；其余字段按 golden path 逐步补齐。

### 3.3 Provider Guard 必须复用 `buildGuardedModelFetch`，而不是包装出新系统

现有 `provider-transport-fetch.ts` 的 `buildGuardedModelFetch` 已经具备：

- provider URL/SSRF policy；
- provider body 读取；
- shadow wire receipt；
- RC-03 WireReceipt 绑定 sealed plan；
- 发送失败不影响主路径。

风险：另建 Provider Guard 会重复序列化、重复 digest、增加 cache/TTFT 风险。

修正：扩展现有 guarded fetch 为 RequestEnvelope Guard：

- 覆盖 body 中的 system/messages/tools/media；
- 登记所有 pre/post transforms；
- 输出统一 envelope digest；
- 先 observational，后 fail-closed。

### 3.4 “未登记 egress 为 0”需要先定义 egress 全集

当前潜在 egress 至少包括：

- provider HTTP body；
- channel outbound；
- Browser / Web Fetch；
- MCP server 调用；
- Remote Forge mutation；
- `message` 工具；
- media generation；
- exec/文件写入不是 egress，但属于 effect 平面。

风险：若把“未登记 egress 为 0”定义为所有出口，Stage 1 会立刻扩大到渠道、浏览器、MCP，违背黄金路径原则。

修正：Stage 1 只要求 **普通 coding turn 的 provider egress 100% 覆盖**；其他 egress 继续现有 guard，只登记不改动。

### 3.5 DCS 无状态与当前进程内状态需要明确迁移

当前 `context-candidate.ts` 的 collections、`turn-injection-budget.ts` 的 ledgers、`rc03-seal-hook.ts` 的 sealed plans 都是进程内 Map。DCS 无状态不意味着删除这些结构，而是：

- 它们必须是可丢弃缓存；
- owner store 中要有足够的 ref/version 让同一输入重建；
- compact/fork/handoff 时明确哪些状态可丢弃、哪些重建。

风险：过早强制无状态会让当前 memory/VToken/CVK 收集流程退化，golden path 反而跑不通。

### 3.6 Tool Guard 不应成为第二审批系统

Tool Guard 的正确形态是：

- 执行前读取 CapabilityGrant；
- 执行前复用现有 approval/workspace/sandbox/MCP policy 判定；
- 执行后写 EffectReceipt；
- 执行失败不假装成功。

它不是替代 workspace guard / approval manager / MCP policy。若 Stage 4 先于 Stage 2/3，会形成“上下文还没统一，权限又出现第二套”。

### 3.7 安全不能只靠 Tool Guard，必须处理 untrusted data taint

提案说“untrusted 文件/网页/OCR/工具结果/Memory 摘要只能是数据，不能被提升成系统指令”，这是对的。但 Tool Guard 验证 grant 无法阻止模型被注入后，利用**已授权**的 `write` / `message` / `exec` 造成危害。

修正：

- `ContextRef` 增加 trust/taint 字段；
- 敏感 egress（message、remote、browser）需要 output-side guard；
- prompt-injection fencing 保留在 admission，Tool Guard 只解决“能否执行”，不解决“模型是否被诱导”。

### 3.8 Task Ledger event sourcing 与现有 Task Ledger / ClawGraph / Observability 的关系必须裁决

现有：

- Task Ledger 是 workspace 级 append-only JSONL + snapshot projection；
- ClawGraph 运行态主要在 Gateway 进程内；
- Observability 是 trace/投影；
- transcript 是会话历史。

提案的“事件 + 物化视图 + proposal-only update”是对的，但必须指定：

- 哪个是 canonical event log；
- Task Ledger / ClawGraph / Observability 都只能消费事件；
- fork/handoff 是事件分支，不是复制状态。

否则会出现第二个任务真相源。

### 3.9 多 agent 衰减授权要限定第一个拓扑

“子 agent 永不获得父 agent 更大的权限”是正确红线，但实现复杂。第一个 golden path 不应包含多 agent。

修正：Stage 4 先只覆盖 `sessions_spawn` 单层子代理，定义 grant attenuation；ACP/远程/ClawGraph 后置。

### 3.10 上下文经济系统不能进入关键路径

价值/风险/token 成本估算可以做，但必须：

- deterministic critical/constraint/evidence 优先；
- 学习排序 shadow-only；
- 不做模型评分驱动安全裁量；
- telemetry 不落原始 prompt/secret。

---

## 4. 我建议的修正执行顺序

| 阶段 | 提案 | 我的修正 |
|---|---|---|
| 0 | 冻结契约，新增 Policy/Identity/Effect authority | 先做 **Authority Map**；冻结六类 artifact；只补缺口，不新增整套 authority |
| 1 | 封住出口 | 扩展 `buildGuardedModelFetch`；先只覆盖 coding turn provider egress |
| 2 | DCS 真正编译 | 同意；先接用户意图、Task Ledger、工具结果；DCS 状态可丢弃但可重建 |
| 3 | Task Ledger 事件化 | 先裁决 canonical event log，再改造 Task Ledger；ClawGraph 降为投影 |
| 4 | CapabilityGrant + Tool Guard | 先做单层 `sessions_spawn`；Tool Guard 复用现有 approval/workspace/sandbox/MCP |
| 5 | Mem 与预算 | 同意；先单 durable memory owner，再 unit-aware packer |
| 6 | 产品化 | 同意；但 `why-this-was-included` 的 PromptPlan reason 必须在 Stage 2 就存在 |

---

## 5. 我在辩论中会坚持的三个立场

1. **先复用，再新建**：可信控制平面的多数零件已经存在；新 proposal 的价值是接线和统一投影，不是增加 authority。
2. **黄金路径必须包含 effect，而不只是 prompt**：如果第一条路径只验证“请求被 digest”，没有一次工具调用的 grant 检查与 EffectReceipt，那它只是 Provider Guard demo，不是控制平面验证。
3. **ContextRef 是数据平面产物，PromptPlan 是上下文平面产物，CapabilityGrant 是效果平面产物**：三者不互相替代；任何 producer 都不得替 DCS/Tool Guard 做决定。

---

*本文件用于多 agent 辩论，不构成实施授权。辩论结果应回写 `context-capability-blueprint.md` 与 ADR。*
