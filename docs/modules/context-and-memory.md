# 上下文、Working Context 与记忆

> 面向问题：模型这一轮到底看到了什么？新 context 候选由谁选择？工作上下文、长期记忆、知识库有什么区别？哪些内容会被注入，哪些只会显示在诊断里？

## 1. 四个概念先分开

| 概念 | 目的 | 当前 owner / entry |
|---|---|---|
| 模型上下文 | 本次 provider 请求的 prompt/messages/tool schemas | Context Orchestrator → PromptPlan → provider request |
| Workspace Context | 最近动作、工具/资源注册表等有界工作现场 | DCS/working-memory/tool-registry sources |
| Memory | 可审核、可失效的 accepted facts/cards | Role Memory + Runtime Memory，经单一 `/memory` 投影 |
| Knowledge | 项目 Wiki、规则、经验与可引用来源 | Knowledge review/retrieval authority |

Knowledge 不是 Memory。Task Ledger Working Context 也不是长期 Memory。Session transcript 也不是上下文本身；每次 turn 只选择其中相关且有界的部分。

## 2. Context 控制平面

### 2.1 组成

```mermaid
flowchart LR
  SRC["Transcript / Task Ledger / Memory / Knowledge / Tools"] --> ORCH["Context Orchestrator<br/>candidate collection"]
  ORCH --> CAND["ContextCandidate/v1<br/>identity + dedup + target"]
  CAND --> PLAN["ordered selection + budget + kill switch"]
  PLAN --> PROMPT["system prompt / message additions"]
  PROMPT --> GUARD["Provider request guard"]
  GUARD --> MODEL["Model request"]
  PLAN --> LINEAGE["lineage + health + receipts"]
```

关键实现：

- `openclaw_runtime/src/context-engine/context-orchestrator.ts`
- `openclaw_runtime/src/context-engine/context-candidate.ts`
- `openclaw_runtime/src/context-engine/assembler.ts`
- `openclaw_runtime/src/context-engine/turn-injection-budget.ts`
- `openclaw_runtime/src/context-engine/context-health-monitor.ts`
- `openclaw_runtime/src/agents/provider-transport-fetch.ts`
- `shared/types/context-item.ts`

### 2.2 Context Runtime Kit

Context Runtime Kit（CRK）拥有：

- immutable owner references；
- selectors；
- checksums；
- prompt bundle lifecycle；
- resource revisions。

它不负责：

- 接纳/排序 context candidates；
- 编译 PromptPlan；
- 生成 provider request；
- 授予工具权限。

CRK 是上下文资源生命周期库，不是第二个上下文投影权威。

### 2.3 Context Orchestrator

每轮生产路径只应有一个最终选择 authority。候选先收集，再按稳定顺序排序、去重，最后统一记账。

当前 channel precedence：

1. `knowledge`
2. `working_memory`
3. `tool_registry`
4. `cvk_addition`
5. `vtoken`
6. `memory_pilot`

VToken 虽然保留兼容 channel 和源码，但当前生产装配被 `VTOKEN_RETIRED` 永久关闭；它不会因配置重新启用。

候选包含：

- 稳定 candidate id；
- authority object id + version + deterministic content digest 形成的 dedup key；
- target：`system_prompt` 或 `message`；
- channel；
- requested/applied chars；
- disposition/reason；
- source/turn/session/run/request/workspace identity。

先 dedup 后 charge，避免同一 authority object 被重复计费。

## 3. 6,000 字符 turn budget

默认 `TURN_INJECTION_CHAR_BUDGET = 6000`，可按配置覆盖：

```json
{
  "runtime": {
    "contextBlock": {
      "injectionBudget": {
        "totalChars": 6000,
        "dropAlertRatio": 0.1,
        "channelDecay": {
          "memory_pilot": 1,
          "vtoken": 2
        }
      }
    }
  }
}
```

预算行为：

- overflow 会 truncate 或 drop；
- 每次实际请求都有 requested/applied/drop/fallback counters；
- source flag 或 kill switch 关闭时，不查询 source、不产生 candidate、不 charge、不注入；
- context enhancement kill switch 是 fail-closed：剩余增强路径直接 no-op，但 agent turn 继续以基线 prompt 运行。

关键配置：

- `runtime.contextEnhancement.killSwitch`
- `VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH`
- `runtime.contextBlock.injectionBudget.*`

## 4. Context sources 与默认状态

| Source | 作用 | 当前状态/边界 |
|---|---|---|
| Knowledge | 项目 Wiki、规则、经验、显式引用 | 读取可受 scope 控制；不授予持久写权限 |
| Working memory | 最近行动、任务状态、有界工作现场 | Workspace Context 默认 on，可单一开关关闭 |
| Tool registry | 当前工具/资源摘要 | 与 working memory 合并到 Workspace Context |
| CVK addition | embedded context assembly 的 bounded message replacement | 受 kill switch 和预算 |
| VToken | 旧 token packing | **retired**，生产装配和 bridge inert |
| Memory pilot | accepted Runtime Memory 的受限注入 | 默认 `injectPilot=false` |
| COMPASS | DCS 内部 candidate source | internal，直接 pre-reply prompt injection 已退役 |
| C6 context ladder | 内部显式 assembler 请求 API | internal，不是普通用户 toggle |
| DCS fact tools | context read/search/understand 工具 | disposition default；自动发现需 workspace/FactService/permission 健康，env 可回滚关闭 |
| Native file memory | 原生文件记忆检索 | read-only 内部来源，不归 `/memory` 面板管理 |

Workspace Context 是一个用户概念，覆盖两个内部 implementation flags：

- `runtime.contextBlock.working_memory.enabled`
- `runtime.contextBlock.tool-registry.enabled`

用户入口在 `Settings → General`。Developer DCS 面板是诊断面，不是正常用户开关。

## 5. Context health

`ContextHealthMonitor v1` 是确定性、无 LLM 的四维评分：

| 维度 | 权重 | 说明 |
|---|---:|---|
| injection pressure | 20% | 预算截断/丢弃是否过多 |
| structural fidelity | 30% | compaction 摘要是否保留必要结构 |
| goal alignment | 30% | SessionGoal objective 的语言覆盖 |
| information novelty | 20% | 与近期注入文本的 8-gram Jaccard novelty |

规则：

- 分数 0–100；
- 低于阈值会附 reason；
- `noDataDimensions` 明确哪些维度没有数据；
- “没有数据”不能用 100 分伪装成“完美”；
- 评分可投影到 observability scorecard，但不自动改变模型行为；
- v1 不调用 LLM，也不新增持久行为。

告警阈值：

- injectionPressure、structuralFidelity、goalAlignment `< 70`；
- informationNovelty `< 50`。

## 6. 长期连续性与长会话 context pack

显式 coordinator session 在发送前排一个 `ContinuityContextPack/v1`，来源包括：

- Task Ledger Working Context；
- CompressionArtifact metadata；
- current model-visible accepted Memory refs；
- typed Knowledge refs；
- binding revision / session generation；
- active Task Ledger node。

只有 accepted、未过期、未被撤销/替代、scope 匹配、fresh 的 refs 才可能进入 pack。Pending/candidate/derived cache/unverified model claims 被排除。

pack 是现有 owner 的 projection，不创建：

- 第二 task list；
- 第二 memory store；
- 第二 injection authority。

原始历史保存在 owner refs 后，按需展开，而不是把全部长会话塞入每次 prompt。

## 7. Memory 的单一产品概念

用户入口：`/memory`。

`shared/memory/control-plane.ts` 是机器可读 `MemoryControlPlaneManifest/v1`。产品界面把多个内部域投影成一个 review surface，但它们仍各有存储和写入路径：

| 数据域 | Owner | 检索/注入 | 删除/失效 |
|---|---|---|---|
| Role memory card | role-memory governance | accepted-only | tombstone/review |
| Runtime fact | Runtime Memory store | accepted-only | TTL/eviction/invalidation |
| Runtime timeline/episode | Runtime Memory store | accepted-only | session/run lifecycle / invalidation |
| Candidate | candidate queue | never / not injectable | reject/tombstone/stale |
| Embedding index | embedding provider | derived internal | source delete/model change rebuild |
| Native file query | native retrieval | transient internal | request-bounded |
| Dreaming cache | derived cache | internal derived | repair/reset/input change |

### 7.1 Accepted

Accepted 视图显示：

- Role cards；
- accepted Runtime facts；
- scope；
- source；
- timestamps；
- sensitivity；
- evidence count；
- 当前是否 model-visible。

### 7.2 Candidates

Candidates 包括：

- persisted Role proposals；
- Runtime fact candidates。

每个 candidate 都必须是：

- `retrievable=false`
- `injectable=false`
- `modelVisible=false`

Candidate 持久化不等于接受。

### 7.3 操作

- **Approve**：交给 Role Memory review 或 `memory.proposeFacts.confirm`，不直接写 card/fact。
- **Delete**：交给对应 owner；Role card tombstone，Runtime fact invalidated with `retracted`。
- **Export**：从同一 surface projection 生成 owner-neutral JSON，写到 Electron `userData/exports/memory`，脱敏 secret/secret-adjacent 内容，并返回精确字节的 SHA-256。
- **Remember this**：调用既有 gatekeeper/policy/evidence/conflict path；可以被接受，也可以成为 persisted candidate；UI 不绕过审核。

### 7.4 关闭语义

- 关闭 Role Memory 会关闭 Role 读写 gate 和 Role prompt retrieval，但不删除已有 card。
- Runtime capture/persist/provider/injection pilot 是独立 flags。
- 关闭 `/memory` 的 Role/Runtime gate 不代表关闭所有 native OpenClaw memory source。
- Runtime Memory 默认 injection pilot 为 false；candidate 列表不是模型可见列表。

## 8. Memory policy 与证据

Memory proposal 的治理包括：

- scope（global/workspace/project/session/run）；
- sensitivity（public/workspace/secret-adjacent/secret）；
- evidence refs；
- confidence；
- conflict detection；
- duplicate detection；
- merge/reject/supersede/needs-review；
- TTL；
- owner-specific invalidation。

Memory policy 会拒绝或要求 review 的典型场景：

- 角色写 workspace/user scope；
- 角色写 project scope；
- trace/session summary 覆盖已有记忆；
- system 写 global；
- 无 evidence 的高重要内容；
- secret/secret-adjacent 内容不当暴露。

## 9. Task Ledger Working Context

Task-scoped working context 是任务运行的工作集，不是长期 Memory。

八个字段：

- Objective
- Constraints
- ConfirmedFacts
- Decisions
- OpenRisks
- ActiveFiles
- Evidence
- NextAction

每次变更是 versioned proposal：

- proposalId；
- field；
- value；
- version；
- evidence refs；
- issuedAt/expiresAt；
- sensitivity；
- trust；
- actor；
- policy digest。

只有 accepted proposal 进入当前 projection。Evidence 只存 refs，不允许 raw payload 常驻。接受后的字段可以生成 `MemPromotionCandidate/v1`，但是否晋升长期 Memory 仍走 Memory owner，而不是 Task Ledger 直接写入。

## 10. 产品默认与退役状态

来自 `docs/dev/default-config-matrix.md` 的当前锁定事实：

| 能力 | 默认 |
|---|---|
| Workspace Context | on，可由单一 Settings toggle 关闭 |
| working-memory / tool-registry 内部 flags | on |
| DCS Fact tools | auto（prerequisites 健康），env override off |
| Context enhancement kill switch | off |
| Runtime Memory injection pilot | false |
| Runtime Memory shadow/provider/persist | false |
| SEKB master | false |
| SEKB auto writeback | off |
| VToken assembly/bridge | retired / always off |
| Browser private network | deny |

这些默认值由测试锁定，不能通过改 README 翻转。

## 11. 可观测与诊断

Context 相关诊断：

- candidate source/id/channel/target；
- dedup key；
- selected/omitted；
- requested/applied chars；
- budget reason；
- kill switch hits；
- source query count；
- ContextOrchestrator chars added；
- RequestEnvelope/lineage/receipt；
- ContextHealth scorecard；
- injection receipts（Memory）；
- problem aggregation。

看到“context candidate 被产生”不代表它被注入；看到“已注入”也不代表 provider 实际使用或据此产出正确结果。

## 12. 当前缺口

- Workspace Context 的默认开启只覆盖声明过的受控路径，不是所有插件/backend。
- DCS Fact tools 依赖 workspace、FactService 与 permission 健康。
- Runtime Memory 注入仍是 diagnostics/opt-in 边界。
- SEKB 自动写回未开放。
- VToken 退役后不能通过旧环境变量恢复。
- Long-session 连续压缩/剪枝/摘要树策略未默认启用；需要新的 live-provider fidelity/safety/cost/latency 证据。
- Context health 是启发式确定性评分，不是语义真值。
- 不同 backend 的 context budget/compaction 消费能力不同；configured 与 effective 必须分开读。

## 13. 源码索引

- `openclaw_runtime/src/context-engine/`
- `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`
- `openclaw_runtime/src/runtime-core/memory-*.ts`
- `openclaw_runtime/src/memory/`
- `electron/services/memory-api.ts`
- `shared/memory/control-plane.ts`
- `shared/task-ledger-working-context.ts`
- `shared/types/context-item.ts`
- `shared/types/context-runtime-kit.ts`
- `shared/types/memory.ts`
- `src/pages/Memory/index.tsx`
- `docs/dev/context-orchestrator.md`
- `docs/dev/memory-control-plane.md`
- `docs/dev/default-config-matrix.md`
- `docs/dev/vtoken-retirement-decision.md`

延伸阅读：[Context Runtime Kit](../context-runtime-kit/README.md)、[产品语义](../clawx-product-semantics.md)、[上下文权威边界 ADR](../dev/adr/2026-08-16-context-authority-boundaries.md)。