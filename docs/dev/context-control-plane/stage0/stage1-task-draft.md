# Stage 1 任务书草案（D5）

| 字段 | 值 |
|---|---|
| 文档状态 | `draft`（待 owner 批准后转为 Stage 1 task spec） |
| 版本 | v1 |
| 日期 | 2026-08-16 |
| 前置 | Stage 0 五份交付物经独立复核为 `accept` 且剩余问题为空 |
| 产品锁 | `defaultOn=false`、`liveReady=false`、`productApproved=false`，Stage 1 不得变更 |

## 1. Stage 1 目标

只做三件事：

1. **Provider Guard**：在黄金 coding turn 中，基于 `buildGuardedModelFetch` + RC-02/RC-03 扩展出结构化 `RequestEnvelope` 观测，覆盖 `system`、`messages`、`tools`、`media`、所有 transforms；
2. **一个真实工具调用**：黄金路径中选一个白名单 coding 工具，走“approval → 临时最小 Grant → Tool Guard → 真实执行”；
3. **EffectReceipt**：该真实调用产出 `EffectReceipt/v1`，并推进 approval ledger outcome。

明确不做：

- 不迁移全部 prompt 路径；
- 不做 Stage 2 的 `ContextRef -> CompilationSnapshot -> DCS PromptPlan` 全链编译器；
- 不做 Stage 3 Task Ledger proposal/accept/reject；
- 不做 Stage 4 完整 `CapabilityGrant`（衰减、跨重启恢复、完整撤销）；
- 不扩展 channel、cron、browser、多 agent、Memory 收敛。

## 2. 验收标准

### 2.1 Provider Guard

- 黄金路径内的最终请求能生成结构化 `RequestEnvelope/v1`，字段覆盖 system/messages/tools/media/transforms，且计算 `envelopeDigest`。
- 观测模式 flag off：发送字节、顺序、tools、retries、审批、delivery 与 legacy 完全一致（byte-identical parity）。
- 观测模式 flag on：发送行为不变，仅追加 receipt/diagnostics。
- 黄金路径测试范围内未登记 egress = 0；必须同时提供 provider 出口 allowlist、静态约束、运行时 census、负向测试、break-glass 审计路径五种证明。
- `WireReceipt/v1` 与 `RequestEnvelope` 可关联（`planId`、`envelopeDigest`、`correlationDigest`、`wireAttemptIndex`）。
- 未登记 transform 被记录为拒绝/诊断，不静默。

### 2.2 一个真实工具调用

- 工具调用必须来自真实 provider/模型响应，不允许 fixture 冒充真实执行（D4 边界）。
- 工具执行点前必须有 Tool Guard，校验临时最小 grant 的 actor、scope、TTL、approval ref、effect idempotency。
- `denied` / 过期 / governance mismatch / 跨 resource：工具不执行，效果计数为 0。
- 真实执行结果写入现有 domain journal；journal 仍是 effect/idempotency truth。

### 2.3 EffectReceipt

- 真实执行后写入 `EffectReceipt/v1`；只存 digest/ref，不存原始 proposal/参数/输出。
- 同一 `effectIdempotency.key` 相同内容幂等，不同内容 `content-conflict`。
- `unknown` outcome 进入 `needs_reconciliation`，禁止自动重放。
- approval ledger 状态序列：`approved -> execution_started -> applied|not_applied|unknown -> reconciled|needs_reconciliation` 全链可查。
- 产品锁保持 false；任何 fixture/synthetic 结果不得宣称 Stage 1 已可执行。

## 3. 测试矩阵（Stage 1 必须全部落盘）

| 编号 | 测试 | 期望 |
|---|---|---|
| T1 | 六 artifact normalize/validate 契约测试 | 合法样本通过；未知字段/payload/raw proposal 拒绝 |
| T2 | flag-off byte parity | flag off 与 legacy 请求字节、顺序、工具集合一致 |
| T3 | RequestEnvelope 覆盖 | 黄金 fixture 中 system/messages/tools/media/transforms 均有 coverage 记录 |
| T4 | envelope digest 稳定性 | 同输入稳定；任一字段变化 digest 变化 |
| T5 | seal producer 登记 | 所有 pre-seal semantic producer 已登记；未登记 mutation 拒绝 |
| T6 | 最终 wire 捕获 | final body 不可得/invalid/owner census 不完整时产生诊断，不改变发送 |
| T7 | egress 负向测试 | 注入未登记 transform/旁路时观测计数增加，黄金路径正常计数为 0 |
| T8 | break-glass 审计 | break-glass 路径产生审计记录，不混入普通 coverage |
| T9 | grant 派生正/负向 | approved 签发；denied/expired/conflict/governance mismatch 不签发 |
| T10 | Tool Guard allow/deny | 合法最小 grant 通过；任一字段不匹配拒绝且零副作用 |
| T11 | 真实工具调用 | 一个白名单 coding 工具真实执行并落 domain journal |
| T12 | EffectReceipt 幂等 | 重放同 key 同内容幂等；异内容冲突；无重复 effect |
| T13 | unknown/reconciliation | `unknown` 不自动重放，进 `needs_reconciliation` |
| T14 | 重启恢复 | approval pending/completed 与 effect receipt 重启后仍可查 |
| T15 | Stage 1 必查字段 | D4 §5 汇总字段全部可通过公开查询路径读取 |
| T16 | 门禁 | 聚焦 Vitest、`pnpm contract:check`、`pnpm run typecheck`、`pnpm run lint:check`、`git diff --check`、harness validate 全过 |

## 4. 不允许提前做的内容

- 不允许改 `attempt.ts`、`get-reply-run.ts`、`role-spawn.ts`、provider 路径，除非 Stage 1 spec 显式列出最小接线点并经 owner 批准；
- 不允许迁移任何现有 prompt 路径或新增 provider/flags/store/daemon；
- 不允许新增权限数据库、第二个 approval ledger、第三个 durable memory writer、第四个能力目录；
- 不允许在黄金路径未闭合时扩展 channel、cron、browser、多 agent；
- 不允许实现学习型排序、Context diff、policy simulation、replay debugger；
- 不允许用 synthetic fixture 或 agent-surrogate 证据宣称真实执行；
- 不允许改变产品锁或默认值以“证明可用”。

## 5. 待 owner 决策的开放问题

1. Stage 1 黄金路径选定哪个真实 coding 工具？（建议：write 或 apply_patch，必须已有 workspace guard + approval + journal）
2. Provider Guard 观测达到什么条件才可 fail-closed？阈值与批准人？
3. `RequestEnvelope` 的 canonical serialization 以哪一层为准：provider SDK 输入前、`buildGuardedModelFetch` 读到的 body、还是最终 wire bytes？
4. provider SDK finalizer / 流式 / 媒体 / 非 JSON wire 如何登记，哪些允许先记录为已知缺口？
5. 临时最小 grant 的 TTL 默认值由谁定义？（建议单次 tool call，最长不超过 approval TTL）
6. Tool Guard 的放置点：gateway exec approval 层、runtime tool dispatch 层、还是两者之间的单一 adapter？
7. EffectReceipt 的 retention / 查询权限与现有 `runtime_receipts` 删除 policy 如何对齐？
8. break-glass 的触发人和审批链路是否复用现有 Inbox approval，还是要独立 owner 裁决？
9. Stage 1 的 egress 静态约束用 harness rule 还是 lint rule，或两者都要？
10. 真实 provider 测试的密钥与测试环境如何脱敏、由谁运行？
