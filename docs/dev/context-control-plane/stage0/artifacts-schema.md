# Stage 0 六 Artifact 最小 Schema（D2）

| 字段 | 值 |
|---|---|
| 文档状态 | `draft`（Stage 0 契约冻结稿） |
| 版本 | v1 |
| 日期 | 2026-08-16 |
| 类型文件 | `shared/types/context-control-plane/artifacts.ts`（纯类型 + zod normalize/validate） |
| 测试文件 | `tests/unit/context-control-plane-stage0-contracts.test.ts` |
| 代码基线 | `f55201b22630d5c904f3105b2a9c8876ea5e889b` |

## 0. 全局规则

1. 首版只保留**黄金 coding turn 必需字段**；后续阶段通过 schema 版本演进加字段，不在 Stage 0 预埋。
2. `ContextRef` 不复制 payload；只保存 owner store 地址、版本、digest 与治理元数据。
3. Receipt 类（`CompilationSnapshot` 的 ref 指纹、`PromptPlan` 的 selected/omitted、`EffectReceipt`，以及未来任何 WireReceipt）**不保存原始内容**；只保存 ref、digest、预算、lineage、政策摘要。
4. `CapabilityGrant` 是 approval/effect 链派生的短生命周期执行凭证；不新建权限数据库，不带凭据、函数、闭包或原始 proposal。
5. `RequestEnvelope` 必须结构化覆盖 `system`、`messages`、`tools`、`media`、`transforms` 五类内容；它自身是内存中的最终请求载体，只把 digest 写入 receipt。
6. 每个字段标注六项：`source` / `policy` / `owner` / `lifecycle` / `required-or-optional` / `version`。
7. 所有 digest 使用 `sha256:<64位小写hex>`；所有 id 使用有界规范 id（Stage 0 校验器强制）。
8. 所有 artifact 带 `schema` 字面量版本。类型文件用 strict schema 拒绝未声明字段，防止 payload 或原文被偷偷带入。

## 1. 公共类型

| 类型 | 字段 | 约束 |
|---|---|---|
| `TurnIdentity` | `sessionKey`、`runId`、`attemptIndex`、`modelCallIndex` | 全部 required；非负整数索引；attempt/model-call/wire 语义沿用 RC-02/RC-03 |
| `Digest` | 字符串 | `^sha256:[a-f0-9]{64}$` |
| `IsoTimestamp` | 字符串 | ISO-8601 时间戳 |
| `RegisteredTransform` | `id`、`kind: semantic \| non-semantic`、`mutates: system_prompt \| messages \| tool_schema \| media \| transport`、`version`、`registeredDigest` | 与 RC-03 seal registry 语义对齐 |

## 2. ContextRef

Owner：owner store 的投影适配器（transcript / task-ledger / archive / memory / workspace / observability）。
不变量：无 payload、无正文、无摘要文本；指向同一事实的所有 ref 必须可由 owner store 重新寻址。

| 字段 | 类型 | R/O | source | policy | owner | lifecycle | version |
|---|---|---|---|---|---|---|---|
| `schema` | `"ContextRef/v1"` | R | 契约常量 | schema 版本策略：未知版本 fail-closed | ContextRef 契约 | 随契约冻结，不可变 | v1 |
| `refId` | string | R | `ctxref:<owner>:<itemId>` 规范 id | id 不可重写、不可猜测 | Owner store adapter | 创建即固定 | v1 |
| `kind` | `user_intent \| task_ledger \| tool_result` | R | 黄金路径三类来源 | 只允许声明的 kind；untrusted 文本只能是数据 | ContextRef 契约 | 创建即固定 | v1 |
| `owner` | `transcript \| task_ledger \| archive \| memory \| workspace \| observability` | R | 实际拥有 payload 的 store | 不允许跨 owner 伪造 | 原 owner store | 随 payload owner 存续 | v1 |
| `sourceRef` | string | R | owner store 原生地址（transcript entry、Task Ledger id、ArchiveHandle uri 等） | 必须可解析；不得是自由文本 | Owner store adapter | 与 payload 同生命周期 | v1 |
| `revision` | string | R | owner store 修订号/版本 | revision 变化必须产生新 ref 或显式失效 | Owner store | owner 更新时演进 | v1 |
| `contentDigest` | Digest | R | 对 owner payload 的 SHA-256 | digest 不一致时拒绝入链 | Owner store | 内容变化即失效 | v1 |
| `acl.scope` | `turn \| task \| session \| workspace` | R | owner store 可见性投影 | 不得扩大 owner store 可见性 | Owner store | 随任务/会话边界 | v1 |
| `acl.allowedActors` | string[] | R | identity adapter 输出 | 只允许已派生 actor | Owner store + Identity adapter | 随授权变化 | v1 |
| `retention.policyId` | string | R | owner store retention policy id | 无 policy 不得登记 | Owner store | 与 owner 策略对齐 | v1 |
| `retention.expiresAt` | IsoTimestamp | O | owner store retention | 过期后 ContextRef 只能 evicted，不能读取 payload | Owner store | 过期即 evict | v1 |
| `provenance.producerId` | string | R | 创建 ref 的 adapter id | producer 必须登记 | ContextRef 契约 | 创建即固定 | v1 |
| `provenance.observedAt` | IsoTimestamp | R | adapter 观察时刻 | 单调时间，回拨拒绝 | ContextRef 契约 | 创建即固定 | v1 |
| `provenance.evidenceRefs` | string[] | R | 支撑来源 ref（可空数组） | 只允许可解析 ref | Owner store adapter | append-only | v1 |
| `lifecycle` | `active \| archived \| evicted` | R | owner store 生命周期投影 | 禁止把 projection 当 payload 生命周期 | Owner store | 随 owner 状态演进 | v1 |

## 3. CompilationSnapshot

Owner：DCS。不变量：只冻结输入；不保存候选正文；任何输入变化必须可解释（新 snapshot 或显式失效）。

| 字段 | 类型 | R/O | source | policy | owner | lifecycle | version |
|---|---|---|---|---|---|---|---|
| `schema` | `"CompilationSnapshot/v1"` | R | 契约常量 | 未知版本 fail-closed | DCS | 不可变 | v1 |
| `snapshotId` | string | R | `snap_<uuid>` | 唯一、不可猜测 | DCS | 创建即固定 | v1 |
| `identity` | `TurnIdentity` | R | session/run/attempt 派生 | 必须与 ReceiptStore identity 同源 | DCS / Identity adapter | 一个 model call 一个快照 | v1 |
| `contextRefs` | `{refId,kind,revision,contentDigest}[]` | R | ContextRef 指纹投影 | 每个黄金来源至少一个；缺用户意图 fail-closed | DCS | 快照内冻结 | v1 |
| `taskLedgerRevision` | string | R | Task Ledger owner 当前 revision | 普通 turn 可用 `latest` 或 ledger id；不可伪造 | Task Ledger owner | 任务状态演进 | v1 |
| `catalogEpoch` | string | R | V3 catalog 重建 epoch | epoch 变化必须显式进入新快照 | V3 Capability Catalog | 随 catalog 重建 | v1 |
| `policyEpoch` | string | R | runtime config/policy digest 派生 | 与 catalogEpoch 分离 | Policy adapter | 随 policy 变化 | v1 |
| `policyDigest` | Digest | R | 本次编译 policy 的 digest | 必须是实际生效 policy | Policy adapter | 快照内冻结 | v1 |
| `modelProfile` | `{providerId,modelId,adapterId}` | R | 本次 provider/model 绑定 | fallback 换 provider/model 必须开新 attempt | Provider Guard / Runner | 一个 attempt 内稳定 | v1 |
| `transformGraph` | `RegisteredTransform[]` | R | RC-03 seal registry 投影 | 未登记 semantic mutation = 0 | DCS / RC-03 | 快照内冻结 | v1 |
| `budget` | `{unit,limit,outputReserve}` | R | turn budget policy | 超窗显式失败/降级，不裸截断 | DCS | 每轮编译一次 | v1 |
| `snapshotDigest` | Digest | R | 对以上字段的 canonical digest | 相同输入稳定；不同输入可解释 | DCS | 创建即固定 | v1 |
| `createdAt` | IsoTimestamp | R | 编译时刻 | 单调时间 | DCS | 创建即固定 | v1 |

## 4. PromptPlan

Owner：DCS。不变量：计划只含 ref 与决策，不含正文；selected/omitted 必须可解释。

| 字段 | 类型 | R/O | source | policy | owner | lifecycle | version |
|---|---|---|---|---|---|---|---|
| `schema` | `"PromptPlan/v1"` | R | 契约常量 | 未知版本 fail-closed | DCS | 不可变 | v1 |
| `planId` | string | R | `plan_<uuid>` | 唯一、不可猜测 | DCS | 创建即固定 | v1 |
| `snapshotId` | string | R | 同轮 `CompilationSnapshot.snapshotId` | 必须匹配已存在 snapshot | DCS | 与快照绑定 | v1 |
| `identity` | `TurnIdentity` | R | 同快照 identity | 与快照/ReceiptStore 同源 | DCS | 与快照绑定 | v1 |
| `selected` | `{refId,order,projection,basis,budgetUnits}[]` | R | DCS admission/resolve/pack 输出 | 只有快照内 `contextRefs` 可被选中；projection ∈ verbatim/summary/index_only | DCS | 计划内冻结 | v1 |
| `omitted` | `{refId,reason,policyDigest}[]` | R | DCS 丢弃/截断 lineage | reason 必须可解释；`policyDigest` 必填 | DCS | 计划内冻结 | v1 |
| `order` | string[] | R | `selected[].order` 归一化 | 每个选中 ref 恰好一次 | DCS | 计划内冻结 | v1 |
| `budget` | `{unit,requested,applied,outputReserve}` | R | DCS token/chars packer | `applied<=requested<=limit`；unit-aware，禁裸前缀截断 | DCS | 计划内冻结 | v1 |
| `why.policyDigest` | Digest | R | 快照 policy digest | 与快照一致 | DCS / Policy adapter | 计划内冻结 | v1 |
| `why.policyEpoch` | string | R | 快照 policy epoch | 与快照一致 | DCS / Policy adapter | 计划内冻结 | v1 |
| `why.ruleId` | string | R | 唯一派生规则 id | 每个选择/丢弃必须有规则 | DCS | 计划内冻结 | v1 |
| `planDigest` | Digest | R | canonical 计划摘要 | sealed 后不可变 | DCS | 创建即固定 | v1 |
| `sealed` | boolean | R | DCS seal | `false` 的计划不得进入 Provider Guard | DCS | 编译末尾封口 | v1 |
| `createdAt` | IsoTimestamp | R | 编译时刻 | 单调时间 | DCS | 创建即固定 | v1 |

## 5. RequestEnvelope

Owner：Provider Guard。不变量：最终请求的规范化载体；观测模式不得改变发送字节；持久化只写 digest。

| 字段 | 类型 | R/O | source | policy | owner | lifecycle | version |
|---|---|---|---|---|---|---|---|
| `schema` | `"RequestEnvelope/v1"` | R | 契约常量 | 未知版本 fail-closed | Provider Guard | 不可变 | v1 |
| `envelopeId` | string | R | `env_<uuid>` | 唯一、不可猜测 | Provider Guard | 创建即固定 | v1 |
| `planId` | string | R | sealed PromptPlan id | 未 sealed plan 拒绝 | Provider Guard | 与计划绑定 | v1 |
| `snapshotId` | string | R | CompilationSnapshot id | 关联可解释 | Provider Guard | 与快照绑定 | v1 |
| `identity` | `TurnIdentity` | R | 同快照 identity | 与 ReceiptStore 同源 | Provider Guard | 与计划绑定 | v1 |
| `system` | unknown | R | sealed plan 的 system projection | 必须逐字节可解释；不得事后覆盖 | Provider Guard | 请求存活期 | v1 |
| `messages` | unknown[] | R | sealed plan 的 messages projection | 顺序、字节不得改变 | Provider Guard | 请求存活期 | v1 |
| `tools` | unknown[] | R | V3 descriptor -> provider tool schema 投影 | 未声明工具不得出现 | Provider Guard | 请求存活期 | v1 |
| `media` | unknown[] | R | 媒体/附件 final wire 投影 | 只允许登记媒体块，不做未登记旁路 | Provider Guard | 请求存活期 | v1 |
| `transforms` | `RegisteredTransform[]` | R | seal registry + provider adapter 实际执行的 transform | 每个 transform 必须登记；不登记即违规 | Provider Guard | 请求存活期 | v1 |
| `transport` | `{method,targetOrigin,endpointClass,providerId,adapterId,modelId}` | R | 最终 fetch 目标 | 只允许已配置 provider endpoint；SSRF 沿用现有 guard | Provider Guard | 请求存活期 | v1 |
| `envelopeDigest` | Digest | R | 规范化 envelope 的 SHA-256 | 与最终 wire digest 关联，不替代 wire digest | Provider Guard | 创建即固定 | v1 |
| `createdAt` | IsoTimestamp | R | 发送前时刻 | 单调时间 | Provider Guard | 创建即固定 | v1 |

## 6. CapabilityGrant

Owner：现有 policy/approval/session identity 的派生适配层。不变量：短生命周期、单次 effect 幂等绑定、可撤销；不是权限数据库。

| 字段 | 类型 | R/O | source | policy | owner | lifecycle | version |
|---|---|---|---|---|---|---|---|
| `schema` | `"CapabilityGrant/v1"` | R | 契约常量 | 未知版本 fail-closed | Grant adapter | 不可变 | v1 |
| `grantId` | string | R | `grant_<uuid>` | 唯一、不可猜测、不可重放 | Grant adapter | TTL 内有效 | v1 |
| `derivation.ruleId` | string | R | Stage 1 唯一派生规则 | 每个 grant 必须能解释由哪条规则产生 | Grant adapter | 随规则版本 | v1 |
| `derivation.ruleVersion` | string | R | 派生规则版本 | 规则变化生成新 grant | Grant adapter | 随规则版本 | v1 |
| `derivation.policyDigest` | Digest | R | approval/policy digest | 必须与 approval 链一致 | Policy adapter | 随 policy | v1 |
| `derivation.inputRefs` | string[] | R | approvalId / planId / snapshotId 等输入 ref | 只允许可解析 ref | Grant adapter | 创建即固定 | v1 |
| `actor` | `{sessionKey,runId,attemptIndex,modelCallIndex,actorKind}` | R | Identity adapter | actor 必须等于发起工具调用的 turn identity，并与 approval ledger requested/resolved actor 对齐 | Identity adapter | TTL 内有效 | v1 |
| `scope.taskBranchId` | string | R | Task Ledger / run branch | 不得跨任务分支 | Task Ledger owner | TTL 内有效 | v1 |
| `scope.resource` | string | R | 目标工具/资源 id | 只允许一个资源（临时最小） | Grant adapter | TTL 内有效 | v1 |
| `scope.action` | string | R | 允许动作 | 不允许通配 `*`（Stage 1） | Grant adapter | TTL 内有效 | v1 |
| `scope.purpose` | string | R | 调用目的摘要 | 无 purpose 不签发 | Grant adapter | TTL 内有效 | v1 |
| `approvalRef.approvalId` | string | R | approval ledger row id | 必须处于 `approved` | Approval Ledger | 随 approval 存续 | v1 |
| `approvalRef.decision` | `"approved"` | R | approval ledger decision | `denied` 永不签发 | Approval Ledger | 随 approval 存续 | v1 |
| `approvalRef.resolvedBy` | string | R | approval ledger `resolved_by` | 治理 actor 必须落账 | Approval Ledger | 随 approval 存续 | v1 |
| `approvalRef.policyDigest` | Digest | R | 决策 policy digest | 与 governance 绑定 | Policy adapter | 随 approval 存续 | v1 |
| `ttl.issuedAt` | IsoTimestamp | R | grant 签发时刻 | 不得早于 approval resolved 时刻 | Grant adapter | 创建即固定 | v1 |
| `ttl.expiresAt` | IsoTimestamp | R | 签发时计算 | `expiresAt>issuedAt`；过期即拒绝 | Grant adapter | 过期即失效 | v1 |
| `effectIdempotency.key` | string | R | `grantId + approvalId + toolCallId` 派生 | 同 key 同内容幂等，不同内容冲突 | Grant adapter | TTL 内有效 | v1 |
| `effectIdempotency.namespace` | string | R | effect 领域命名空间 | 防跨领域键碰撞 | Grant adapter | TTL 内有效 | v1 |
| `delegation` | `{parentGrantId,maxDepth}` | O | 父 grant 链（Stage 1 单工具调用通常为空） | 子 agent 权限严格 ≤ 父 agent | Grant adapter | 随父 grant | v1 |
| `revocation` | `{revokedAt,reason,revocationEpoch}` | O | 撤销事件（Stage 1 单工具调用通常为空） | 撤销后 Tool Guard 必须拒绝 | Grant adapter | 撤销即失效 | v1 |
| `status` | `proposed \| active \| expired \| revoked` | R | Tool Guard 当前观察 | 只有 `active` 可通过 | Grant adapter | 状态机单调 | v1 |

## 7. EffectReceipt

Owner：Effect boundary（domain journal 为 truth，receipt 只做关联证据）。不变量：不保存原始内容；不授权重放。

| 字段 | 类型 | R/O | source | policy | owner | lifecycle | version |
|---|---|---|---|---|---|---|---|
| `schema` | `"EffectReceipt/v1"` | R | 契约常量 | 未知版本 fail-closed | Effect boundary | 不可变 | v1 |
| `receiptId` | string | R | `efx_<uuid>` | 唯一、不可猜测 | Effect boundary | append-only | v1 |
| `idempotencyKey` | string | R | grant effect idempotency key | 同 key 同内容幂等，异内容冲突 | Effect boundary | append-only | v1 |
| `approvalRef.approvalId` | string | R | approval ledger | 与执行 approval 一致 | Approval Ledger | 随 approval 存续 | v1 |
| `approvalRef.decision` | `approved \| denied` | R | approval ledger | `denied` 对应 `not_applied`，不可报 `applied` | Approval Ledger | 随 approval 存续 | v1 |
| `approvalRef.policyDigest` | Digest | R | governance policy digest | 可解释拒绝 | Policy adapter | 随 approval 存续 | v1 |
| `actor` | `{sessionKey,runId,attemptIndex,modelCallIndex,actorKind}` | R | Identity adapter | 与 grant actor 一致 | Identity adapter | append-only | v1 |
| `effect.toolCallId` | string | R | 真实工具调用 id | 必须来自 Runtime 工具执行点 | Runtime / Tool Guard | append-only | v1 |
| `effect.toolName` | string | R | 真实工具名 | 只记录名字，不记录参数正文 | Runtime / Tool Guard | append-only | v1 |
| `effect.resource` | string | R | 受影响资源 id | 只允许可解析 ref | Runtime / Tool Guard | append-only | v1 |
| `effect.action` | string | R | 执行动作 | 与 grant scope 对齐 | Tool Guard | append-only | v1 |
| `outcome` | `applied \| not_applied \| unknown \| reconciled` | R | 真实执行器返回 | `unknown` 必须进入 reconciliation，不自动重放 | Effect boundary | 状态可演进到 reconciled | v1 |
| `proposalDigest` | Digest | R | 对 proposal 的 canonical SHA-256 | 原始 proposal 永不持久化 | Effect boundary | append-only | v1 |
| `journalRef` | string | O | 领域 journal 原生引用 | journal 仍是 effect/idempotency truth | 领域 journal owner | append-only | v1 |
| `artifactRef` | string | O | ArchiveHandle / 产物引用 | 只存引用不存内容 | 产物 owner | append-only | v1 |
| `recoverability` | `none-needed \| journal-replay \| reconcile-from-journal` | R | 执行器/journal 判定 | 不得承诺仅凭 receipt 重放 | Effect boundary | append-only | v1 |
| `createdAt` | IsoTimestamp | R | 执行后记录时刻 | 单调时间 | Effect boundary | append-only | v1 |

## 8. 跨 artifact 关联

```text
ContextRef ──(contextRefs 指纹)──▶ CompilationSnapshot
CompilationSnapshot ──(snapshotId)──▶ PromptPlan
PromptPlan ──(sealed planId)──▶ RequestEnvelope
RequestEnvelope ──(envelopeDigest)──▶ WireReceipt（Stage 1 持久化 digest）
Approval Ledger ──(approved row)──▶ CapabilityGrant（派生，不新库）
CapabilityGrant ──(effectIdempotency)──▶ Tool Guard ──▶ EffectReceipt
```

## 9. Stage 0 禁止携带内容清单

| Artifact | 禁止 |
|---|---|
| ContextRef | payload、正文、摘要文本、工具 schema、凭据 |
| CompilationSnapshot | 候选正文、消息全文、raw tool output |
| PromptPlan | 正文、渲染后的 prompt 字符串 |
| RequestEnvelope | 作为 receipt 持久化原文；持久化只能写 digest/ref |
| CapabilityGrant | 权限数据库行、凭据、函数、闭包、raw proposal |
| EffectReceipt | 原始 proposal、工具参数、工具输出、渠道正文、密钥 |
