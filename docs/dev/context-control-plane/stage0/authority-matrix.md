# Stage 0 五平面 Authority 矩阵（D1）

| 字段 | 值 |
|---|---|
| 文档状态 | `draft`（Stage 0 契约冻结稿） |
| 版本 | v1 |
| 日期 | 2026-08-16 |
| 代码基线 | `f55201b22630d5c904f3105b2a9c8876ea5e889b` |
| 关联文档 | `docs/dev/context-capability-blueprint.md`（rev3）、`docs/dev/adr/2026-08-16-context-authority-boundaries.md` |
| 产品锁 | `defaultOn=false`、`liveReady=false`、`productApproved=false`，本文不改变任何锁 |

## 1. 核心结论

1. **五平面冻结**：数据 / 能力 / 上下文 / 效果 / 出口与证据，任何 Stage 1+ 实现都必须回答本表列出的唯一问题。
2. **不新增真相源**：本阶段不新增数据库、store、ledger、daemon、provider、flag。Stage 0 只新增：
   - 文档化的逻辑契约；
   - 纯类型与 normalize/validate 测试；
   - 把现有 owner store 与逻辑 authority 连接起来的**适配层设计**（D3）。
3. **逻辑 authority 是派生与适配，不是新所有权**：
   - Identity 派生自 session/run/attempt + ReceiptStore；
   - Policy 派生自 config/policy digest + approval policy；
   - Grant 派生自 approval/effect 链；
   - Effect 关联 approval ledger + EffectReceipt + operator slice；
   - Egress 建立在 `buildGuardedModelFetch` + RC-03 之上。
4. **每个现有资产必须如实标注为“工程资产”**：只有经过黄金路径、真实执行证据与独立验收后，才允许后续阶段把某个闭合能力标为 `done`。

## 2. 五平面 Authority 矩阵

| 平面 | Owner | 唯一问题 | 核心产物 | 现有资产映射 | 缺口（Stage 0 不得假装已闭合） |
|---|---|---|---|---|---|
| 数据平面 | Owner stores：transcript JSONL、workspace、Task Ledger、Mem slot owner、ArchiveHandle owner | 原始事实在哪里？什么版本？谁可读？保留多久？ | `ContextRef` | transcript / SessionManager、workspace 文件、`electron/services/task-ledger-service.ts` + `openclaw_runtime/src/agents/long-task-control/task-ledger.ts`、`tool-result-truncation.ts` 的 ArchiveHandle、Context Family shadow registry | 普通 coding turn 没有统一 `ContextRef` 生产者；当前 `ContextCandidate/v1` 只有 `authority.objectId/version/contentDigest`，缺少 ACL、retention、provenance 的完整语义；工作区 Task Ledger 与 long-task ledger 尚未在普通 turn 内统一寻址 |
| 能力平面 | V3 Capability Catalog（发现元数据）；Runtime / MCP / Skill loader（执行与正文） | 当前有哪些能力可被发现？发现元数据与执行绑定是否一致？ | `CapabilityDescriptor`；`catalogEpoch` 引用 | `openclaw_runtime/src/capabilities/v3/**`、native tool schema、MCP materializer、Skill loader、Tool Search / CVK、`tool_registry` Block | 生产 prompt 路径仍有四套发现投影（native schema、`tool_registry`、Tool Search/CVK、V3 descriptor），版本/缓存语义未统一；`catalogEpoch` 尚未成为普通 coding turn 的编译输入 |
| 上下文平面 | DCS | 本轮模型该看到什么？以什么顺序、预算、解释？ | `CompilationSnapshot`、`PromptPlan` | Context Orchestrator、`ContextCandidate/v1`、turn injection budget、RC-03 seal hook（`CompilePlan/v1`、`ContextBundle/v1`）、`dcs-receipts.ts` | 还没有 `ContextRef -> CompilationSnapshot -> PromptPlan` 的生产编译链；候选缺 kind/epistemic/freshness/sensitivity/merge；RC-03 默认关闭；编译状态多为进程内 Map，非可恢复 artifact |
| 效果平面 | Effect boundary = 现有 policy/approval 链派生 Grant + Tool Guard + 领域 journal | 这次工具调用是否有权执行？最终产生什么效果？ | 临时最小 `CapabilityGrant`、`EffectReceipt` | `approval-ledger.ts`（schema v2）、`effect-receipt.ts`（schema v2）、`operator-slice.ts`（v1）、`runtime_receipts` 的 effect/context rows、CVK `tool-call-gate`（当前 `report_only`） | 普通 coding turn 的工具调用没有从 approval 链派生临时最小 Grant；Tool Guard 未在工具执行点消费 grant；`EffectReceipt` 只覆盖 operator slice 的 bounded file/message effect，不覆盖黄金 coding turn |
| 出口与证据平面 | Provider Guard（最终请求）；transcript / journal / archive（副作用证据） | 最后到底发了什么？发生了什么？谁可以解释与恢复？ | `RequestEnvelope`、`WireReceipt`、Receipt 关联链 | `provider-transport-fetch.ts` 的 `buildGuardedModelFetch`（SSRF/timeout/proxy/SSE 归一化）、RC-02 shadow census（shadow wire receipt）、RC-03 `CompilePlan/v1` + `WireReceipt/v1`、provider payload trace、transcript / Observability / domain journals | `buildGuardedModelFetch` 只对最终序列化 JSON body 计算 digest，没有结构化的 system/messages/tools/media/all-transforms `RequestEnvelope`；RC-03 默认关闭；provider-specific finalizer、流式/媒体/非 JSON wire 的登记不完整；Stage 0 无 fail-closed |

## 3. 平面边界与禁止重叠

| 边界 | 规则 |
|---|---|
| V3 vs DCS | V3 只发布能力发现元数据；DCS 只裁决本轮投影。V3 descriptor 不承载工具输出或任务状态；DCS 不拥有 descriptor 的 canonical metadata。 |
| Owner stores vs ContextRef | Owner store 是原始 payload 唯一真相；`ContextRef` 只保存 address、revision、digest、ACL、retention、provenance，**不复制 payload**。 |
| DCS vs Provider Guard | DCS 输出 sealed `PromptPlan`；Provider Guard 只证明最终 `RequestEnvelope` 是什么、由哪些 transform 生成，不重新筛选内容、不改 policy。 |
| Policy/approval vs Grant | approval ledger 保留 pending/resolved/outcome 的 durable truth；Grant 是从该 truth 派生的短生命周期执行凭证，**不是新权限数据库**。 |
| EffectReceipt vs domain journal | domain journal 是 effect/idempotency truth；`EffectReceipt` 只做 digest/ref 关联与可解释性，不授权重放，不保存原始内容。 |
| 出口 vs 副作用证据 | Provider Guard 覆盖 provider-bound 请求；工具/写入副作用由 Tool Guard + journal/archive + EffectReceipt 覆盖，两者不得互相替代。 |

## 4. “不新增真相源，只新增逻辑契约与适配层”的落地方式

```text
现有真相源（保持不变）
  transcript / workspace / Task Ledger / Mem / archive
  approval_ledger / effect_receipts / runtime_receipts
  V3 catalog / runtime config / domain journals
                 │
                 ▼
Stage 0 逻辑契约（新增，纯文档 + 纯类型）
  ContextRef / CompilationSnapshot / PromptPlan
  RequestEnvelope / CapabilityGrant / EffectReceipt
                 │
                 ▼
Stage 0 适配层设计（新增，仅设计）
  Identity / Policy / Grant / Effect / Egress 的派生规则、版本、拒绝原因
                 │
                 ▼
Stage 1+ 才允许的运行时行为
  Provider Guard 观测、临时最小 grant、Tool Guard、EffectReceipt 写入
```

Stage 0 的硬约束：

- 不在上述右侧新增任何持久化表、目录、daemon、provider、flag 或默认值；
- 契约类型文件不得被任何生产模块 import；
- 所有实现资产映射都以“只读确认现状”为证据级别（E0/E1），不宣称闭合。

## 5. 本阶段验收措辞

本矩阵只允许出现：

```text
draft / proposed / in_progress / blocked / deferred / done
```

禁止出现：

```text
liveReady / productApproved / GA / default-on / 已闭合 / 已具备生产控制能力
```

本文件结论为 `draft`；五平面矩阵被接受为后续实现的约束，不等价于任何运行时能力已上线。
