# S06：记忆写入与 EffectReceipt 恢复闭环

日期：2026-10-13（Asia/Shanghai）。包码：S06（TF-0281）。真实 provider 调用：无。

## 链路（intent → decision → effect receipt）

- `memory-self-edit-tools.ts`（`memory_update` / `memory_forget` / `memory_strengthen`）在写入决策点调用 `recordMemoryEffect`。
- `memory-effect-receipt.ts` 构建 digest-only 视图并交给注入的 RC-04 `EffectReceiptStore`（structural sink，runtime-core 不在运行时 import agents/）。
- RC-04 `effect_receipts`：append-only、idempotency key 唯一、identical-content→duplicate、content-conflict→拒绝。

## 语义

| 情形 | outcome |
|---|---|
| 写入成功 | `applied` |
| 写入前被拒（如 persistFact 失败，未产生副作用） | `not_applied` |
| 已产生部分副作用后失败（fact 已 append 但 invalidation / supersedes relation 失败） | `unknown`（可据 `recoverability` 对账） |

- idempotency key = `memory-effect:v1:<sha256(action ⋮ factId ⋮ sessionKey ⋮ runId ⋮ toolCallId)>`，**与 outcome 无关** → 重放同意图命中同一 key。
- proposal 只含 `domain/action/factId(/newFactId)`，**绝不含记忆正文**；actor/effect 走 `stage1Context`。
- fail-open：无 sink 或 sink 抛错都不阻断 memory 写入。

## 实测（真实数据）

- 真实 `EffectReceiptStore` + 真实 `RuntimeMemoryStore`：一次 `memory_update` → 恰好 1 行 receipt（`domain_executor='clawx-runtime-memory'`, `outcome='applied'`）；重放同意图 → `duplicate:true` 且返回同一 `effectReceiptId`（0 个重复 effect）。
- builder 单测：key 与 outcome 无关；proposal digest-only（不含 objectSummary/subject/predicate）；unknown 原样保留不伪装 applied；fail-open。

## 残余（residual）

- sink 需由调用方注入（本次测试注入真实 store）；真正的生产装配点（把 RC-04 store 接到 memory 工具上下文）留给集成层，本包不接线到 agent 注册。
- `memory_recall` / `memory_find_related` 是只读，不产生 effect receipt。
- 不改默认自动写回、产品默认值/锁/approval；非真人证据。
