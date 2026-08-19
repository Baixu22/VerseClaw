# Stage 0 逻辑 Authority 适配层设计（D3）

| 字段 | 值 |
|---|---|
| 文档状态 | `draft`（Stage 0 设计稿；Stage 1 才允许实现） |
| 版本 | v1 |
| 日期 | 2026-08-16 |
| 代码基线 | `f55201b22630d5c904f3105b2a9c8876ea5e889b` |
| 原则 | 不新增真相源；每个逻辑 authority 有唯一派生规则、版本、拒绝原因 |

## 0. 适配层总原则

1. **适配层只读现有资产**：不复制数据、不建立第二索引库；映射结果要么是可丢弃内存凭证，要么追加到已批准的 ReceiptStore / 领域 journal。
2. **每个映射必须三要素齐全**：唯一派生规则（ruleId + ruleVersion）、版本、拒绝原因。三者缺一不可进入 Stage 1。
3. **现有资产统一降级为“工程资产”**：可复用、可接线，但不等价于闭合的可信控制平面；只有黄金路径真实执行证据出现后，才可在对应阶段标 `done`。
4. **拒绝语义必须可查询**：拒绝原因进入 receipt / ledger / 诊断，不静默。
5. **Stage 0 不写适配器代码**：本文只冻结映射关系；实现留在 Stage 1+ 的 task spec 中。

## 1. Identity：session/run/attempt + ReceiptStore → 逻辑 Identity

| 项 | 内容 |
|---|---|
| 逻辑 authority | `TurnIdentity { sessionKey, runId, attemptIndex, modelCallIndex }` + `actorKind` |
| 现有资产 | session key 派生（`openclaw_runtime/src/sessions/session-key-utils.ts`）、run/trace 关联（Observability correlation）、`ReceiptIdentity`（`openclaw_runtime/src/agents/receipt-store.ts`）、`ReceiptCallIndex`（attempt/model-call/wire-attempt） |
| 映射版本 | `identity-adapter/v1`；输入资产版本：`runtime_receipts` schema v1、RC-03 `CompilePlan/v1` callIndex |
| 派生规则 | 一条 rule：`identity-adapter/v1:derive-from-session-run-attempt`；ReceiptStore 的 `ReceiptIdentity` 只作为**证据投影**引用，不反向授权 |
| 拒绝原因 | `missing-session-key`、`missing-run-id`、`non-canonical-id`、`attempt-index-not-monotonic`、`identity-not-bound-to-session`、`receipt-identity-conflict` |
| 缺口 | 普通 coding turn 的所有入口尚未统一产出 `attemptIndex/modelCallIndex`；ReceiptStore identity 是持久化投影，不能替代 session manager 的运行时 truth |
| 工程资产判定 | 已接线、可查询，但**不是已闭合的全局 Identity authority** |

Stage 1 落地要求：黄金路径开头必须从同一条 session/run 上下文派生 `TurnIdentity`，并让 ContextReceipt / WireReceipt / EffectReceipt 使用同一份 identity；任何字段缺失直接拒绝进入 Provider Guard，而不是用 `unknown`。

## 2. Policy：config/policy digest + approval policy → 逻辑 Policy

| 项 | 内容 |
|---|---|
| 逻辑 authority | `policyEpoch` + `policyDigest` + `ruleId/ruleVersion`；approval 决策 policy digest |
| 现有资产 | runtime config 对象与 zod schema（`openclaw_runtime/src/config/**`）、RC-03 policy digest（`rc03-seal-hook.ts` 的 `RC03_SEAL_POLICY_DIGEST`）、RC-05 governance policy（`resolveOperatorGovernancePolicy`）、workspace permission mode / approval risk policy |
| 映射版本 | `policy-adapter/v1`；输入资产版本：RC-03 seal policy v1、operator policy v1、approval ledger schema v2 |
| 派生规则 | 一条 rule：`policy-adapter/v1:digest-effective-config`。黄金路径 policy digest 必须来自实际生效的 config 切片 + 明确的 policy rule；approval policy 继续单独由 approval 链持有 |
| 拒绝原因 | `policy-digest-missing`、`policy-epoch-stale`、`policy-rule-not-found`、`policy-digest-mismatch`、`kill-switch-engaged` |
| 缺口 | 当前只有 RC-03 固定 policy digest 和 approval 单决策 digest，没有覆盖黄金 coding turn 全链路的 `policyEpoch` 派生器；config 变化与 catalog epoch 的关系未定义 |
| 工程资产判定 | config schema、kill switch、RC-03 digest 是工程资产；**不是已闭合的全局 Policy authority** |

Stage 1 落地要求：Provider Guard 与 Grant 派生必须消费同一 `policyDigest`；policy 变化产生新 `policyEpoch`，旧 grant/plan 显式失效，不静默复用。

## 3. Grant：现有 approval/effect 链 → 临时最小 CapabilityGrant

| 项 | 内容 |
|---|---|
| 逻辑 authority | `CapabilityGrant/v1`（Stage 1 只签发临时最小字段） |
| 现有资产 | `ApprovalLedger`（`approval-ledger.ts`：`intent_reserved -> approval_pending -> approved|denied -> execution_started -> applied|not_applied|unknown -> reconciled|needs_reconciliation`）、`EffectReceiptStore`、`operator-slice.ts` 的三步流程、`runtime_receipts` |
| 映射版本 | `grant-adapter/v1`；输入资产版本：approval ledger schema v2、operator slice v1 |
| 派生规则 | 一条 rule：`grant-adapter/v1:derive-minimal-from-approved-ledger`。输入必须同时包含：已批准 approval row、计划 identity、policy digest；输出只含 actor/scope/approvalRef/TTL/effectIdempotency |
| 拒绝原因 | `approval-not-found`、`approval-not-approved`、`approval-denied`、`state-conflict`、`revision-conflict`、`expired`、`governance-mismatch`、`policy-digest-mismatch`、`effect-idempotency-conflict` |
| 缺口 | 现有 approval/effect 链只在 operator slice（Cron 触发的一个 bounded file/message effect）闭环，尚未接到普通 coding turn 的真实工具调用；CVK `tool-call-gate` 仍 `report_only`，未在工具执行点消费 grant |
| 工程资产判定 | approval ledger、effect receipt、operator slice 是**可复用工程资产**；不是已闭合的 Grant authority |

Stage 1 落地要求：**只有** `approvalLedger.markExecutionStarted` 的同一事务成功后，才允许生成 `active` grant；grant TTL 覆盖单次 tool call；执行完成后立即进入 expired/revoked，不缓存为权限库。子 agent 继承必须 `childGrant ⊆ parentGrant`（Stage 4 前不做扩展）。

## 4. Effect：approval ledger + EffectReceipt + operator slice → 逻辑 Effect

| 项 | 内容 |
|---|---|
| 逻辑 authority | `EffectReceipt/v1` 关联记录；domain journal 继续当 effect/idempotency truth |
| 现有资产 | `effect_receipts` 表（schema v2，只存 proposal digest）、`approval_ledger`（schema v2）、`ReceiptStore`（`runtime_receipts` schema v1）、`projectOperatorLineage` |
| 映射版本 | `effect-adapter/v1`；输入资产版本：effect receipt schema v2、approval ledger schema v2、receipt store schema v1 |
| 派生规则 | 一条 rule：`effect-adapter/v1:correlate-approval-journal-effect`。`execution_started` 必须先于真实执行；真实执行结果后写 `applied|not_applied|unknown`，再写 `EffectReceipt` 和 `recordEffectOutcome`；`unknown` 进 `needs_reconciliation` |
| 拒绝原因 | `execution-not-started`、`duplicate-effect`、`content-conflict`、`unknown-outcome`、`journal-ref-missing`、`effect-receipt-write-failed` |
| 缺口 | 普通 coding turn 的 write/edit/exec/browser/MCP 工具尚未经过统一的 Tool Guard 并产出 EffectReceipt；write journal fail-open、拒绝不自动回滚既有写入的问题依旧存在；当前只有 operator slice 是已验证的最小闭环 |
| 工程资产判定 | 已有实现但覆盖窄；**不是已闭合的全工具 Effect authority** |

Stage 1 落地要求：一个真实工具调用必须从“模型提出调用 → grant 校验 → 领域执行 → journal 引用 → EffectReceipt”形成完整关联；失败/拒绝语义不得伪造 `applied`。

## 5. Egress：`buildGuardedModelFetch` + RC-03 → Egress 基础

| 项 | 内容 |
|---|---|
| 逻辑 authority | Provider Guard 的结构化 `RequestEnvelope/v1` + `WireReceipt/v1` 关联 |
| 现有资产 | `buildGuardedModelFetch`（`provider-transport-fetch.ts`：timeout、proxy/TLS、SSRF policy、local-service lease、retry hints、SSE 归一化）、RC-02 shadow census（`shadow-census.ts` 的 shadow wire receipt 与 owner census）、RC-03 seal（`compile-plan.ts`、`context-bundle.ts`、`dcs-receipts.ts`、`rc03-seal-hook.ts`） |
| 映射版本 | `egress-adapter/v1`；输入资产版本：RC-02 shadow wire v0、RC-03 `WireReceipt/v1`、`CompilePlan/v1` |
| 派生规则 | 一条 rule：`egress-adapter/v1:register-final-envelope-before-fetch`。在现有 guarded fetch 之前，从 sealed plan 组装 `RequestEnvelope`，登记 system/messages/tools/media/transforms，计算 `envelopeDigest`；发送字节不变，只额外持久化 digest |
| 拒绝原因 | `final-wire-body-unavailable`、`final-wire-body-invalid`、`wire-owner-incomplete`、`unregistered-semantic-transform`、`receipt-store-write-failed`（Stage 1 观测模式：拒绝仅记录，不改变发送） |
| 缺口 | 当前 guard 只看到 provider adapter 交给 `fetch` 的最终 JSON body 文本，拿不到结构化 `system/messages/tools/media/transforms`；provider SDK 的 finalizer、流式 body、媒体与非 JSON wire 尚未完整登记；RC-03 默认关闭 |
| 工程资产判定 | `buildGuardedModelFetch` 是真实接线且默认运行的网络 guard；RC-02/RC-03 是默认关闭的观测/封口资产；**都不是已闭合的全 `RequestEnvelope` egress authority** |

Stage 1 落地要求：黄金路径内的 provider fetch 必须能还原出结构化 envelope + wire digest；未登记 egress 计数在 Stage 1 测试范围内为 0；观测模式开关关闭时字节完全一致。

## 6. 现有资产成熟度总表（工程资产 vs 已闭合能力）

| 资产 | 可复用工程资产 | 已闭合能力 | 结论 |
|---|---|---|---|
| `buildGuardedModelFetch` 网络 guard | 是（SSRF/timeout/proxy/SSE 归一化） | 否（无结构化 envelope 覆盖） | Egress 基础，不是完整 Provider Guard |
| RC-02 ReceiptStore / shadow census | 是（append-only、digest-only、幂等） | 否（默认关闭、只覆盖局部） | Evidence 基础，不是完整审计平面 |
| RC-03 CompilePlan / ContextBundle / receipts | 是（seal registry + 双 receipt） | 否（默认关闭、进程内 plan 注册表） | Context 封口基础，不是 DCS 全链 |
| ApprovalLedger | 是（durable、CAS、幂等） | 否（仅 operator slice 闭环） | Grant/Effect 输入，不是全工具授权 |
| EffectReceiptStore | 是（digest-only、idempotent） | 否（未覆盖普通 coding turn） | Effect 关联基础 |
| operator-slice | 是（最小 governance 闭环） | 否（只 bounded file/message effect） | Stage 1 参考实现，不能直接宣称全工具可用 |
| Task Ledger（workspace / long-task） | 是（append-only + snapshot） | 否（普通 turn 未作为编译输入） | 数据平面 owner 之一 |
| V3 Capability Catalog | 是（descriptor、catalog epoch 基础） | 否（生产投影未统一） | 能力平面 owner 候选 |
| CVK tool-call gate | 是（typed `report_only/enforce`） | 否（执行点未消费） | Stage 1 Tool Guard 可参考，非已闭合 |

## 7. 本设计的边界

- Stage 0 只冻结上述映射的**名称、版本、输入、规则、拒绝原因、缺口**；
- 不在 Stage 0 实现 adapter、不迁移 prompt、不接入工具执行点；
- 任何实现必须先在 Stage 1+ task spec 中声明，且不得创建第二个 approval ledger、第二个权限数据库、第三 durable memory writer、第四个能力目录。
