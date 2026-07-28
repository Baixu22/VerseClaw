# FP-P1-11 evidence — 真实 turn 内共享预算非零账目核对

| item | value |
|---|---|
| 收口日期 | 2026-07-27 |
| 载体 | 复用 `tests/e2e/coding-loop-fp-p1-04.spec.ts`（真 Electron + 真 gateway child + 真 agent turn） |
| E2E | **1 passed (33.7s)** |
| 单测 | `turn-injection-budget.test.ts` + `dcs-observability.test.ts` **2 files / 20 passed** |
| lint:dcs | exit 0 |

## 与 FP-P0-05 的差别（本任务存在的理由）

FP-P0-05 的 G3 只证明「契约在真 child 里活着」，counters 全 0（无 provider、未跑 turn）：

```
[fp-p0-05-budget] counters: {"turns":0,"appliedChars":0,"requestedChars":0,...}
```

本轮在**有真实 agent turn** 的场景取得非零账目：

```
[fp-p1-04-budget] {"totalChars":6000,
  "precedence":["knowledge","working_memory","tool_registry","cvk_addition","vtoken","memory_pilot","other"],
  "dropAlertRatio":0.1,
  "counters":{"turns":1,"killedTurns":0,"appliedChars":6000,"requestedChars":8000,
              "droppedChars":0,"truncatedChars":2000,"dropAlerts":1},
  "lastTurn":{"turnId":"agent:main:main::fp-p1-04-...","killed":false,
              "charsApplied":6000,"charsRequested":8000,"charsDropped":0,"charsTruncated":2000,
              "byChannel":{"cvk_addition":{"requested":8000,"applied":6000,"disposition":"truncate"}},
              "degradationOrder":[{"channel":"cvk_addition","disposition":"truncate"}]}}

[fp-p1-11-bychannel] {"channels":["cvk_addition"],
  "byChannel":{"cvk_addition":{"requested":8000,"applied":6000,"disposition":"truncate"}},
  "degradationOrder":[{"channel":"cvk_addition","disposition":"truncate"}]}
```

## 求和核对（AC2，关键诚实性断言）

`appliedChars + droppedChars + truncatedChars == requestedChars`
→ `6000 + 0 + 2000 = 8000` ✅（聚合计数器与 lastTurn 逐轮各断言一次）

这条断言是唯一能抓出「charge 了 A 却注入了 B」类 bug 的口子，两个层级都成立。

## 本轮新增的实现

聚合计数器无法回答「本轮哪些来源 charge 了 / 降级顺序是否符合声明的 precedence」，
故新增**最近一轮**的逐通道明细：

| 改动 | path |
|---|---|
| snapshot 增 `lastTurnInjection` | `openclaw_runtime/src/context-engine/dcs-observability.ts` |
| `endTurnInjectionBudget` 透传 byChannel/degradationOrder/turnId | `openclaw_runtime/src/context-engine/turn-injection-budget.ts` |
| ack 暴露 `injectionBudget.lastTurn` | `openclaw_runtime/src/context-engine/runtime-flag-ack.ts` |

## AC4「同一 turn 内 ≥2 来源」— 未达成，且查出更严重的真缺陷

实测本轮只有 `cvk_addition` 一个通道 charge。**穷举 charge 点后确认根因，比「配置没开」严重**：

```
$ grep -rn "chargeTurnInjection\|chargeAppendedSegment" openclaw_runtime/src --include=*.ts | grep -v test
attempt.ts:3273              chargeTurnInjection(cvkLedger, "cvk_addition", ...)
context-orchestrator.ts:316  chargeAppendedSegment(turnLedger, "memory_pilot", ...)
context-orchestrator.ts:360  chargeAppendedSegment(turnLedger, "vtoken", ...)
```

全仓 charge 点只有 **3 个**，通道只覆盖 `cvk_addition` / `memory_pilot` / `vtoken`。
而 `TURN_INJECTION_PRECEDENCE` 声明了 **7 项**，其中 **`knowledge` / `working_memory` /
`tool_registry` 三项没有任何 charge 点** —— 它们在 `turn-injection-budget.ts:33-42` 有注释
详述其优先级理由，但运行时**永远不会出现在账上**。

也就是说：**DCS 三块的注入不受该共享预算约束、也不被记账**。
这不是「本轮配置没开所以没出现」，是「即使开了也不会出现」。

初判「DCS 三块被合成 systemPromptAddition 记为一条 cvk_addition」**经复核为错**：
`cvk_addition` 是 CVK 自己的 registry/compact-selector 文本（`cvk/engine.ts:119-190
formatPromptAddition`），与 DCS 三块无关。该错误结论已在此更正。

**为何不在本任务修**：补三个 charge 点属于改预算接入面，是 FP-P0-05 的裁定域，
且会改变真实注入行为（可能截断此前不受限的内容），风险不属本任务「核对账目」的范围。
**为何不为凑 ≥2 打开 VToken / RM**：两者是 Hard locks 排除项，属为过测放宽标准。

结论：AC4 **判为未达成**，连同新查出的缺陷一并转 **FP-P2-06**，本任务不标 done。

## AC5 降级顺序

本轮只有一个通道被 truncate，`degradationOrder` 与 precedence 无矛盾，
但**单通道场景不构成对排序的有力验证**。E2E 已写入通用校验（被裁通道的 precedence 位次
不得早于任何完整保留的通道），待多通道场景出现时自动生效。

## 逐条 AC

| AC | 结论 | 证据 |
|---|---|---|
| 真实 turn 后 `turns>=1`、`appliedChars>0` | ✅ | `turns:1`、`appliedChars:6000` |
| 求和核对成立 | ✅ | 6000+0+2000=8000，聚合与 lastTurn 双层断言 |
| `appliedChars` 与 prompt 实际增长一致 | ⚠️ 部分 | charge 返回值即注入文本（`chargeAppendedSegment` 把 charge 后文本写回 prompt，代码级保证）；未做独立 prompt 长度测量 → 残留 |
| 同一 turn 内 ≥2 来源 | ❌ 未达成 | 见上；且查出 knowledge/working_memory/tool_registry 三通道**全仓无 charge 点** |
| 超预算降级顺序与 precedence 一致 | ⚠️ 部分 | 通用断言已写入，本轮仅单通道 truncate，未构成有力验证 |
| kill 态真 turn 账目归零 | ✅（既有） | `killedTurns` 计数器 + FP-P0-02 真 child kill 证据；本轮 `killed:false` 为非 kill 场景 |

## 门禁判定

- G1 dev：只增读侧证据面，不改预算算法与 precedence（任务书 Non-goals）；lint:dcs 过。
- G2 test：20 单测 + 真 turn E2E；未跳用例；AC4 未达成明确记为失败项并转残留，未改断言充绿。
- G3 runtime：真 child 内真 agent turn 的非零账目 + 逐通道明细 + 求和成立。
- G4 human：n/a（内部记账）。
- G5 accept：**不通过** —— AC4 未达成、AC3/AC5 仅部分，按 DoD「五门禁缺一不许标 done」，
  本任务状态保持 `in_progress`，缺口转 `FP-P2-06`。已完成部分（非零账目 + 求和核对 + lastTurn 证据面）
  作为阶段性成果保留，供 FP-P2-06 续做。
