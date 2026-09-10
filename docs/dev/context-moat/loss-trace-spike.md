# T-C0 spike：上下文损失追踪可行性（TF-0138）

- 执行者：**lane-1**
- 日期：2026-08-27
- 脚本：[`scripts/context-loss-trace-spike.mjs`](../../../scripts/context-loss-trace-spike.mjs)（离线、只读、零 `src/` 改动）
- 输入：真实 OpenClaw 会话 `ref:session:6f47f667c12b`（251 条 entry / 246 条 message / 41 user 轮 / 1 次真实 compaction）＋ 真实生产状态库 `ref:db:*`
- 结论：**T-C2（TF-0129）技术可行，但当前 AC 不可验证，必须重定范围**（详见第 7 节）

## 1. 结论先行

三个问题的答案是「一、否、六」：

| 问题 | 答案 |
|---|---|
| Q1 现有数据是否足以定位被丢弃的单元 | **部分足够**。compaction 一类可以精确定位到单元级（本次实测定位 234 个被丢单元），但**没有任何单元携带丢弃原因**；其余四类在真实生产数据里完全无痕 |
| Q2 五类丢弃决策能否被区分 | **不能。5 类中只有 1 类（compaction）可观测**，且它也没有 per-unit reason 字段。四类不可区分 |
| Q3 需要额外持久化哪些字段 | **6 组字段**，其中 `reason` 的枚举已经存在于代码里，只是活不过一次 attempt |

一句话概括这次 spike 的核心发现：**追踪所需的语义几乎都已经被实现出来了，缺的不是设计而是持久化 —— `ContextCandidateLineage` 已经带着一个九值 `reason` 枚举精确记录了每个候选的去向，但 `endContextCandidateCollection` 在 attempt 结束时把整张表从内存 Map 里删掉；而唯一有正确形状的落盘载体 `runtime_receipts`（`selected_json` / `omitted_json` / `budget_json`，按 attempt + model call 键控）在真实生产库里是 0 行，因为它的开关 `rc03.seal` 默认关闭且本机未开。**

## 2. 方法与输入

脚本做四件事：读会话 JSONL 重建 compaction 边界与被丢单元集；探测生产状态库里两个落盘载体的真实行数；按「载体在哪」逐类判定可观测性；输出字段缺口清单。全程只产出 digest / ref / 枚举标签 / 数值，并在退出前对**数据派生子树**跑一次脱敏自检（4 类模式 + 长字符串），发现即非零退出。

会话重放语义取自 `openclaw_runtime/src/agents/cli-runner/session-history.ts:400-424`：最近一次 compaction 把它自己**及之前**的全部 entry 换成一条 `compactionSummary`，只有其后的 entry 作为 tail 留存。所以某次 compaction 的被丢集合 = 其索引之前的全部 message entry。

## 3. Q1：现有数据能否定位被丢弃的单元

**能，但只对 compaction 一类，且定位到的单元不带原因。**

本次实测的唯一一次 compaction：

| 项 | 实测值 |
|---|---:|
| 被丢 message entry | **234** |
| 被丢字符数 | **276,795** |
| 按角色分解 | user 35 / assistant 114 / toolResult 85 |
| 保留 tail | 12 |
| `tokensBefore` | 129,959 |
| 压缩档 / 策略 | `tier4` / `emergency-collapse` |
| pressure | **3.249** |
| `staleExcludedCount` / `causalAnchorCount` | 0 / 27 |
| 定位到原因的单元数 | **0 / 234** |
| `runtime_receipts` 行数 | **0** |

三点值得单独记：

1. **一次 compaction 就吃掉了整段会话的 93%**（234 / 246 条 message）。压缩不是渐进修剪，而是在 pressure 3.249 触发的 `emergency-collapse` 一次性坍缩。这意味着损失追踪的价值高度集中在 compaction 这一类上 —— 其余四类合起来的量级远不及它。
2. **`firstKeptEntryId` 指向 compaction entry 自己，不是它后面那条。** 这个约定在代码里没有任何一处写下来。第一版脚本按「指向下一条」解读，直接读出 `markersAgree=false` 的假阳性；查证后才确认两个边界标记语义一致（因为 compaction entry 本身作为 summary 留存）。这条约定必须被 T-C2 显式落盘，否则每个后来者都要重猜一次。
3. **会话 JSONL 里没有任何轮次身份**（无 `turnId` / `attemptIndex` / `modelCallIndex`），而 `runtime_receipts` 恰恰是按这三者键控的。**两个数据源今天无法 join** —— 这是比「字段缺失」更硬的障碍。

## 4. Q2：五类丢弃决策能否被区分

**不能。5 类里 4 类在真实数据中无痕，且可观测的那 1 类也没有 per-unit reason。**

| 丢弃类 | 生产触发点 | 载体 | 可观测 | 判定依据 |
|---|---|---|:--:|---|
| `compaction` | `compaction-planning.ts` `droppedMessagesList` | 会话 JSONL compaction entry（**已落盘**） | **YES** | 边界可解析，被丢集合可精确重建；但无 per-unit reason |
| `budget-drop` | `turn-injection-budget.ts` `chargeTurnInjection` → disposition `drop` | `ContextCandidateLineage.reason`（**仅内存**） | NO | attempt 结束即清除；`runtime_receipts` 0 行，什么都没留下 |
| `skipChannels` | `context-candidate.ts` `recordContextCandidateSkip` → `skip-channel` | 同上（**仅内存**） | NO | 同上 |
| `limitHistoryTurns` | `history.ts` `limitHistoryTurns` 硬截断 | **无任何载体** | NO | 纯 slice，不记录切掉了什么；与「这条消息从未存在」不可区分 |
| `archived` | `block-lifecycle.ts` `archiveLowHeatBlocks` → `lifecycle_state` | `context_blocks.presence_json` | NO | 16 行 block **全部不含** `lifecycle_state`；生产 archive writer 数 = 0，该类当前无任何实例 |

`archived` 一栏与 TF-0121 审核期间 lane-2 的独立测量互相印证（`archiveLowHeatBlocks` / `applyContextLadder` 均无生产调用点）。**它不是「暂时没测到」，而是结构上不可能有实例** —— 生产库里 16 个 block 的 `presence_json` 只有 `always_on` / `on_demand` / `background` 三个键，block 类型只有 `task_state`(15) 与 `notes`(1)。

## 5. Q3：T-C2 需要新增持久化的字段清单

六组。**注意其中三组是「搬运已有值」，不是新设计** —— 这是本 spike 对 T-C2 估价最有价值的一条修正。

| 字段 | 取值 | 为什么缺 | 载体建议 |
|---|---|---|---|
| `discardClass` | `budget-drop` / `compaction` / `limitHistoryTurns` / `archived` / `skipChannels` | 没有任何载体记录「是哪条路径丢的」；compaction 能被推断出来只是因为它恰好是唯一有落盘 entry 的路径 | 追踪行新列，**不要**塞进 receipt 列 |
| `unitRef` | `ref:entry:*` / `ref:block:*` / `ref:memory:*` | `ContextReceipt.omitted` 已经有 ref，但只覆盖「进到预算这一步」的候选；compaction 丢掉的 transcript entry 从不进入该路径 | 复用现有 ref 形状，保证 digest 跨载体可比 |
| `droppedAtTurn` / `droppedAtCall` | `turnId` / `attemptIndex` / `modelCallIndex` | **最硬的一条**：`runtime_receipts` 按这三者键控，而会话 JSONL 完全没有轮次身份，两源今天无法 join | 追踪行同时落这三个值 |
| `reason` | 九值枚举（`collected` / `applied` / `duplicate` / `empty` / `budget-truncate` / `budget-drop` / `flag-off` / `kill-switch` / `skip-channel`） | **枚举已经存在且正好够用**（`context-candidate.ts:31-40`），只是随内存 Map 一起死掉 | 原样持久化。requirement-5 禁自由文本，而这个枚举本身就无自由文本 |
| `charsRequested` / `charsApplied` | int / int | 已在 lineage 与 `ContextReceipt.budget` 里，用来量化损失规模，搬运成本近零 | 复用 `ReceiptBudget` 的 chars 形状 |
| `compactionBoundary` | `firstKeptEntryId` / `positionalIndex` / `interpretation` | 两个边界标记只在一条**没写下来**的约定下才自洽（见 §3.2） | 两个标记 + 解析结果都落盘，别让后来者重猜 |

## 6. 当前不可区分的丢弃决策（AC 明确要求的一节）

按「为什么不可区分」分成三种性质，处置方式完全不同：

1. **有语义、无持久化** —— `budget-drop`、`skipChannels`。`reason` 枚举已经精确区分了它们，`endContextCandidateCollection`（`context-candidate.ts:404-410`）把内存 Map 删掉，语义随之消失。**这是纯工程搬运，风险最低。**
2. **无语义、无载体** —— `limitHistoryTurns`。它是一次 `slice`，没有任何地方记录切掉了什么。要区分它必须**新增记录点**，不是搬运。这是 T-C2 里唯一需要动截断路径本身的部分。
3. **有载体、无实例** —— `archived`。字段位置是清楚的（`presence_json`），但生产 archive writer 数 = 0，所以该类永远取不到真实样本。**T-C2 无法为它提供「真实会话上的归类证据」**，只能给编译期/单测覆盖。

第 3 点直接影响 T-C2 的 AC 可验证性，见下节。

## 7. 对 T-C2（TF-0129）的重定范围建议

spike 结论不是「不可行」，因此**不触发 AC-3 的 `blocked` + deviation 分支**；但 T-C2 现有 AC 有两条在当前事实下不可验证，必须改：

**(a) AC-1「列出至少三类不同丢弃决策」当前不可达。** 真实数据里只有 1 类有实例，`archived` 类结构上零实例，`limitHistoryTurns` 需要新增记录点才会产生数据。即使 T-C2 实现完毕，也要**先有一次同时触发三类的真实会话**才能验收。建议改为：「≥3 类各有单测归类证据 ＋ ≥1 类有真实会话证据」，把「真实」和「三类」两个要求解耦。

**(b) requirement-3「分类必须覆盖全部五条路径」保留，但 `archived` 一条须显式标注为「无生产实例，仅编译期/单测覆盖」**，并绑定一条前向义务：一旦出现生产 archive writer，必须补真实证据。这与 XL-004 报的「assembler lifecycle filter 后续约束需迁挂活节点」是同一个前向依赖，应挂在同一个节点上。

**(c) requirement-1「优先复用既有 SQLite 与 ContextReceipt」经本 spike 验证为可行，但有一个必须写进 requirements 的约束**：`runtime_receipts` 的写入受 `rc03.seal` 控制，该旗标默认关闭（`rc03-seal-hook.ts:110-133`，`enabled = false` 除非 env `OPENCLAW_RC03_SEAL` 或 `runtime.rc03.seal === true`），本机生产配置里 `runtime.rc03` 不存在，故该表真实行数为 0。**T-C2 不得把自己的可观测性建立在一个默认关闭的旗标上** —— 否则实现完成后在默认配置下依然什么都追踪不到，正是 §D1.0 点名的「建成未通电」。要么 T-C2 自带写入路径，要么显式声明依赖并把开关问题上交（本轮 §R5 技术-4 禁止改默认值）。

**(d) 估价修正**：六组字段里三组是搬运已有值（`reason` / `charsRequested` / `charsApplied`），一组是复用已有 ref 形状（`unitRef`），只有 `discardClass`、轮次身份、`compactionBoundary` 是真新增。T-C2 的 `difficulty=very_high` / `confidence=0.62` 有下调空间，但**下调幅度不由 lane-1 定** —— T-C2 是 M6/round-2 的节点，重估价须由接手车道在开工时做。

## 8. 实际输出片段（AC-2）

在真实会话上的完整 stdout，未删改：

```text
# loss-trace-spike-v1 on ref:session:6f47f667c12b
entries=251 messages=246 userTurns=41 compactions=1

## Q1 can the discarded units be located
  units located = 234  units carrying a reason = 0  persisted receipt rows = 0
  ref:entry:c96f540ecbe9 idx=238 dropped=234 chars=276795 keptTail=12 tokensBefore=129959 boundary=self/agree=true
    byRole={"user":35,"assistant":114,"toolResult":85}
    compression={"tier":"tier4","strategy":"emergency-collapse","pressure":3.249,"tokensBefore":129959,"warningCount":2,"staleExcludedCount":0,"causalAnchorCount":27,"rehydratedFileCount":5}

## Q2 can the five discard classes be told apart
  NO  budget-drop        lineage is in-memory and cleared at attempt end; runtime_receipts has no rows, so nothing survives
  YES compaction         dropped set reconstructible from the compaction entry boundary; no per-unit reason field
  NO  limitHistoryTurns  hard slice with no record of what it cut; indistinguishable from a message never having existed
  NO  archived           no block carries lifecycle_state; zero production archive writers, so the class has no instances
  NO  skipChannels       lineage is in-memory and cleared at attempt end; runtime_receipts has no rows, so nothing survives

## Q3 fields T-C2 would have to persist
  discardClass
  unitRef
  droppedAtTurn / droppedAtCall
  reason
  charsRequested / charsApplied
  compactionBoundary
  unobservable classes: budget-drop, limitHistoryTurns, archived, skipChannels

## desensitisation self-check
  patterns=4 findings=0 (clean)
  report written: loss-trace-report.json
```

边界用例两条也已跑过：**零 compaction 的真实会话**（36 entry / 8 user 轮）输出 `units located = 0`，不崩、不误报；**不存在的会话路径**报 `session not found` 并以退出码 2 结束。

复跑方式（审核者自查用；两个路径参数刻意留占位，绝对路径按 §requirement-5 不写入本文档，候选会话的完整路径记在 TF-0143 node 里）：

```bash
node scripts/context-loss-trace-spike.mjs --session <候选会话>.jsonl --state-db <生产状态库>.sqlite
```

脚本以退出码 0 表示脱敏自检通过，非 0 表示发现疑似泄漏；`--out <path>` 可另存完整 JSON 报告（含 234 条被丢单元的逐条 ref / role / chars）。该报告是生成物，**刻意不入库** —— 一条命令即可重现，入库只会给本 task 的半径再加一个路径。

## 9. 受语料限制的结论（须与 TF-0143 一起读）

本 spike 的输入只有 **1 次**真实 compaction，而 node summary 原本要求 `≥2 次`。TF-0143 已实测证明 `≥2 次压缩` 的语料在本机 174 个会话里**不存在**（全语料压缩上限恒为 1），继续等只会无限期阻塞本 spike，故按 requirement-2 的硬约束（必须真实、不得合成）在单次压缩语料上执行。**以下结论受此限制，不得当作已验证：**

1. **跨轮摘要合并行为未观测。** 第二次 compaction 发生时，第一次的 summary 本身已在窗口内，它会被如何对待（整体保留 / 再次压缩 / 与新 summary 合并）无真实样本。这正是 TF-0111 的领域，本 spike 不能替它作证。
2. **`compactionBoundary` 的多次压缩链未观测。** 单次压缩下 `firstKeptEntryId` 指向自身；两次压缩时第二条 compaction entry 的边界是否仍指向自身、以及第一条 entry 是否留在被丢集合里，未验证。
3. **损失叠加不可测。** 「同一单元被两次压缩连续降级」这种叠加损失是 T-C2 最有价值的输出之一，单次压缩语料无法产生。

其余结论（五类可观测性、字段清单、`runtime_receipts` 0 行、`archived` 零实例、两源不可 join）**不依赖压缩次数**，在单次语料上已充分成立。

## 10. 脱敏检查（AC-4）

脚本内置自检对数据派生子树跑 4 类模式（凭据、Windows 绝对路径、POSIX 绝对路径、会话 UUID）＋ 长字符串检测，**findings = 0**，退出码 0。本文档本身同样只含 digest / ref / 枚举 / 数值：会话以 `ref:session:6f47f667c12b` 指代，entry 以 `ref:entry:*` 指代，无任何上下文原文片段、无 summary 正文、无 `lineage.reason` 自由文本、无绝对路径。

第一版脚本的自检曾对全量报告扫描并命中 1 条长字符串 —— 命中的是脚本自己写的字段缺口解释文本，不是泄漏。已把扫描范围收窄到数据派生子树，并在代码里写明原因：把静态说明文字纳入扫描会让检查对自己的解释报警，从而训练读者忽略结果。



