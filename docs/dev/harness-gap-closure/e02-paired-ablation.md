# E02：首次真实生效的单组件配对消融

日期：2026-10-13（Asia/Shanghai）。包码：E02（TF-0275）。真实 provider 调用：无（本地确定性 fixture）。付费调用：无。

## 组件

Phase-4 type-aware eviction（treatment，`evictionPolicy=importance`）对前 Phase-4 FIFO（baseline / leave-one-out，`evictionPolicy=fifo`），生产消费者为真实 `openclaw_runtime/src/runtime-core/memory-store.ts` 的 `RuntimeMemoryStore`。可逆（只切策略）、非安全。

## 语料与预登记

- 确定性本地 fixture（无真实 provider）：20 case × 3 重复 × 2 条件 = 120 run；逐 case 用固定 seed 打乱 15 条事实（proc/epis/sem 各 5），`maxFacts=10`。
- 主指标 = procedural retention（越高越好）；k=3；minCases=20；退化预算 = 0。见 `shared/agent-dev/paired-ablation-fixture.json`。

## 实测结果（真实 RuntimeMemoryStore，非伪造）

| 条件 | 成功 | pass^k | p50 ms | p95 ms | tokens(代理) | 误拦截 | 安全违规 |
|---|---|---|---|---|---|---|---|
| baseline (FIFO) | 0.1667 | 0 | 0.7999 | 1.3443 | 10 | 0 | 0 |
| treatment (type-aware) | 1.0 | 1.0 | 0.8903 | 1.4368 | 10 | 0 | 0 |

配对效应（primary = procedural retention，60 对）：mean diff **+0.3133**，sd 0.2062，95% CI **[0.2612, 0.3655]**，Cohen d_z 1.5193 → 判决 **component-helps**（区间排除 0）。

组件生效痕迹：FIFO 与 type-aware 的保留/淘汰集合在多种 seed 下不同（成功率的显著差异即其证据）。

## 边界与不做项

- tokens 为 `maxFacts` 槽位代理，**不是**真实模型 token；延迟为 `perf_hooks` 实测（微秒级，仅本地）；无账单、无真实 provider，不宣称泛化。
- 显著正效应**不**用于改产品默认值/锁、不扩大启用、不授予 verifier 权限。
- 不新建指标平台/持久 store；零/负效应同样按区间如实判决。