# TF-0127 / TF-0129 真实语料与损失追踪字段包

不新造会话。只把已经存在的真实测量接到 blocked 节点的 AC 上。

## 已有真实语料（T-CORPUS 指针）

| 项 | 值 |
|---|---|
| 语料记录 | `docs/dev/context-moat/corpus/tf-0143-57c00668.md` |
| Session ID | `57c00668-baf0-44d4-8cb3-531fda2a6667` |
| 源 transcript | `~/.openclaw/agents/main/sessions/57c00668-baf0-44d4-8cb3-531fda2a6667.jsonl` |
| SHA-256 | `CDF6843E2E0BDAF159FFC6DD792E81E57C1BED8E03BF586EFA8B5857FF81E4E2` |
| user turns | 42 |
| compaction entries | **2** |
| 是否过 TF-0143 阈值（≥40 轮且 ≥2 次压缩） | **yes** |

注意：TF-0129 AC0 写「TF-0143 实测 174 会话压缩上限恒为 1」。那是 2026-08-27 的测量。`tf-0143-57c00668` 是 2026-08-28 之后补进的第二条压缩，**不能用来假装 174 会话统计被推翻**，但可以作为「≥1 类真实会话证据」的候选，前提是该 jsonl 仍在本机且未被改。

第二条真实会话（spike 用，仅 1 次压缩）：

| 项 | 值 |
|---|---|
| spike | `docs/dev/context-moat/loss-trace-spike.md`（TF-0138） |
| session | `ref:session:6f47f667c12b` |
| messages / user turns / compaction | 246 / 41 / **1** |
| 被丢 message | 234（93%） |
| `runtime_receipts` 行数 | **0**（`rc03.seal` 默认关） |

## Q1/Q2/Q3（T-C0 三问，已有答案，禁止重写）

来源：`docs/dev/context-moat/loss-trace-spike.md` §1。

| 问 | 答 |
|---|---|
| Q1 现有数据是否足以定位被丢弃单元 | 部分足够。compaction 可定位到单元，但无 per-unit reason |
| Q2 五类丢弃能否被区分 | 不能。5 类里只有 compaction 可观测 |
| Q3 需要额外持久化哪些字段 | 6 组（见下） |

## 六组字段清单（T-C2 开工前置，不是新设计）

| 字段 | 取值 | 现状 |
|---|---|---|
| `discardClass` | budget-drop / compaction / limitHistoryTurns / archived / skipChannels | 无载体 |
| `unitRef` | `ref:entry:*` / `ref:block:*` / `ref:memory:*` | receipt.omitted 只覆盖进预算的候选 |
| `droppedAtTurn` / `droppedAtCall` | turnId / attemptIndex / modelCallIndex | JSONL 无轮次身份，无法 join receipts |
| `reason` | 九值枚举已在 `context-candidate.ts:31-40` | 仅内存，attempt 结束即删 |
| `charsRequested` / `charsApplied` | int | 已在 lineage / ReceiptBudget |
| `compactionBoundary` | firstKeptEntryId / positionalIndex / interpretation | 约定未落盘 |

## 五类丢弃可观测性（TF-0129 不得合成）

| 类 | 可观测 | 原因 |
|---|---|---|
| compaction | YES | 会话 JSONL 有 entry；57c00668 还有 2 次 |
| budget-drop | NO | lineage 仅内存；receipts 0 行 |
| skipChannels | NO | 同上 |
| limitHistoryTurns | NO | 纯 slice，无记录点 |
| archived | NO | 16 行 block 无 `lifecycle_state`；生产 archive writer = 0 |

## ContextHealthMonitor（TF-0127 AC0）

代码存在：`openclaw_runtime/src/context-engine/context-health-monitor.ts`。四维：injectionPressure / structuralFidelity / goalAlignment / informationNovelty。模块注释写明 **never auto-called**。因此「四维全部有生产输入源」**未满足**——有 scorer，无生产调用把掏空摘要喂进去。检出率 0% 的陈述仍然成立。

## TF-0127 / TF-0129 解锁条件（本包做不到的部分）

1. 给 ContextHealthMonitor 接上生产调用（或证明已有调用点）。这是代码改动，需独立 task，本包只指出缺口。
2. 打开 `rc03.seal` 或等价路径，让 `runtime_receipts` 出现非 0 行——这是默认值/旗标，本轮禁止偷偷打开。
3. 为 `limitHistoryTurns` 增加记录点之后才会有该类真实数据。
4. `archived` 在生产 writer=0 之前结构上不可能有实例。

本包把「已经测过什么」钉死，避免下一轮再做一次 spike。
