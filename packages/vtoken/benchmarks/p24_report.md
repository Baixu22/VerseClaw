# T4 — P2.4 并发稳定性压测报告

> **方法学声明**：线程 A 以 50ms 间隔 `write()` 持续指定时长（durability=fsync）；
> 线程 B/C 并发 `resolve()` 同一 MemStore 实例。所有操作串行化在同一把 RLock 上。
> 延迟测量用 `time.perf_counter()`（含锁等待 + fsync 阻塞 + 实际计算）。
> 完整性校验：`len(store.graph.nodes) == 1 (seed) + writes_succeeded`。

## 1. 硬件环境

| 项 | 值 |
|---|---|
| Platform | Windows-10-10.0.26200-SP0 |
| Processor | AMD64 Family 25 Model 97 Stepping 2, AuthenticAMD |
| Python | 3.10.3 |
| Machine | AMD64 |

## 2. 场景结果

| 场景 | durability | 时长 | 写入成功/尝试 | 节点数 | 完整性 | write P50 | write P95 | write P99 | write max | resolve P50 | resolve P95 | resolve P99 | resolve max | 错误数 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fsync | fsync | 60s | 1033/1033 | 1034 | ✓ | 1.889 | 3.230 | 11.047 | 94.519 | 0.083 | 1.476 | 2.062 | 94.499 | 0 |
| flush | flush | 60s | 1040/1040 | 1041 | ✓ | 0.152 | 0.342 | 0.662 | 4.489 | 0.089 | 0.222 | 0.327 | 6.034 | 0 |

## 3. 场景 fsync 详情

- durability: `fsync`
- 持续时长: 60s
- write 间隔: 50ms
- reader 线程数: 2
- 写入尝试: 1033
- 写入成功: 1033
- 最终节点数: 1034（期望 1034）
- 完整性校验: ✓ 通过
- write 样本数: 1033
- resolve 样本数: 13410
- 错误数: 0

## 3. 场景 flush 详情

- durability: `flush`
- 持续时长: 60s
- write 间隔: 50ms
- reader 线程数: 2
- 写入尝试: 1040
- 写入成功: 1040
- 最终节点数: 1041（期望 1041）
- 完整性校验: ✓ 通过
- write 样本数: 1040
- resolve 样本数: 12381
- 错误数: 0

## 4. 红线判定

红线分两组（HANDOFF §3 T4）：
- **并发红线**（验证目标）：零异常零竞态 + resolve P99 < 15ms
- **延迟红线**（硬件依赖）：write P99 < 5ms（fsync）/ < 2ms（flush）

### 4.1 并发红线（T4 核心验证）

| 场景 | 零异常零竞态 | resolve P99 | 判定 |
|---|---|---|---|
| fsync | ✓ integrity+0err | 2.062ms | ✓ 达标 |
| flush | ✓ integrity+0err | 0.327ms | ✓ 达标 |

**并发红线全部达标**：RLock 串行化设计在真实争用下无竞态、无异常，resolve P99 远低于 15ms。

### 4.2 延迟红线（硬件依赖，按 S2 记录）

| 场景 | write P99 | 阈值 | 判定 |
|---|---|---|---|
| fsync | 11.047ms | < 5ms | ✗ 未达标 |
| flush | 0.662ms | < 2ms | ✓ 达标 |

### 4.3 S2 发现：fsync write P99 超标

fsync 场景 write P99 = 11.047ms > 5ms 红线。
根因：**OS 级 fsync 尾延迟**，非并发争用。证据：
- fsync P50 = 1.889ms（正常，接近 HANDOFF §1.3 的 2.8ms 基线）
- fsync P95 = 3.230ms（已超标）
- fsync max = 94.519ms（OS journal commit 偶发长尾）
- 并发 fsync P99 与单线程基线相近（并发不显著恶化 fsync 延迟）

**Durability 建议（按 S2）**：降级为 `flush` 场景全部达标 — flush P99 = 0.662ms < 2ms，P50 = 0.152ms。
- `flush` 牺牲规格 §5.4 强保证（崩溃可能丢最近若干条 WAL）
- 对延迟敏感的工作流（如交互式 agent），`flush` 是可接受的折衷
- 对持久性关键写入（如 checkpoint），保持 `fsync` 并接受 P99 尾延迟
- D3/D22 的 durability 参数化设计在此场景下证明了价值

## 5. 最终判定

**并发红线达标**（T4 核心验证通过）：零异常零竞态 + resolve P99 < 15ms。

**延迟红线部分未达标**：fsync write P99 > 5ms（OS fsync 尾延迟，S2 已记录）。
按 HANDOFF S2 要求：不静默放宽目标，durability 建议见 §4.3。
T4 验收完成 — 并发设计在真实争用下验证可靠，fsync 延迟问题已按 S2 流程记录。

## 6. 方法学附录

- MemStore 实例：`MemStore(tmpdir, 'stress', durability=..., checkpoint_every=0)`
- checkpoint_every=0 关闭自动 checkpoint，隔离测 write+resolve 锁争用
- 预埋 seed 节点 (#001)，reader 全程 `resolve(seed, depth=2, max_nodes=10, max_facets=2)`
- writer 每 10 次 write 通过 `edges=[seed]` 连入 seed 邻域，让 resolve 有真实遍历
- 延迟测量含锁等待 + fsync 阻塞 + 实际计算（time.perf_counter 包裹整个调用）
- 百分位用线性插值（`sorted[k]` + `frac`），非 nearest-rank
- RLock 串行化所有操作，'并发'本质是锁争用 + fsync 阻塞，不是真并行读
- fsync + flush 双跑：fsync 验证 HANDOFF 规格 + 暴露 OS 尾延迟；flush 验证 durability 退路
