# L02：上下文压力恢复（目标/未完成/依赖/证据）

日期：2026-10-13（Asia/Shanghai）。包码：L02（TF-0284）。真实 provider 调用：无。

## 两半

1. **交接链深度（已由 #179 落地）**：`sessions.createHandoff` 在激活前重读 Task Ledger `handoff_from` 链并持久化 lineage；环路/冲突父/截断遍历/损坏 JSONL/非法 config 全部 fail-closed；深度限制 opt-in（`runtime.handoff.enabled`，默认关，`maxDepth` 1–64 隐含 3）；subagent `maxSpawnDepth` 不变。
2. **上下文压力恢复（本包）**：`runtime-core/context-pressure-recovery.ts` 从 Working Context 快照投影恢复摘要。

## 恢复投影语义

- 四段：objective（Objective）、unfinished（NextAction/OpenRisks/Decisions）、dependencies（Constraints/ActiveFiles）、recentEvidence（Evidence/ConfirmedFacts，含最近 history）。
- 预算：按字符预算逐项放入；超预算项进 `dropped[section]` 并置 `truncated=true`（**kept+dropped=总数**，无静默丢弃）。
- 深度：`depth > maxDepth` → `status='depth-exceeded'`，不产出 section（**无静默递归**）。
- 完成：`complete` 恒为 `false`；空/缺失快照 → `status='unknown'`（**无伪装完成**）。
- 确定性：同一输入 → 同一 `digest`。

## 实测

| 断言 | 结果 |
|---|---|
| 四段可从快照恢复，digest 确定 | ✅ |
| 极小预算 → truncated + dropped 计数守恒 + usedChars≤budget | ✅ |
| complete 恒 false；空快照 unknown | ✅ |
| depth>maxDepth → depth-exceeded | ✅ |

## 残余（residual）

- 本包提供恢复投影；把它接到具体 compaction 注入点由集成层完成。
- 不新建 ledger/store；不改 Stage 3 契约、默认值、产品锁或 approval。
- 非真人证据；无真实 provider 调用。
