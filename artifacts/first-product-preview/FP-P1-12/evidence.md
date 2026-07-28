# FP-P1-12 evidence — 预览开关 E2E Phase C 抖动治理（重启冷却竞态）

| item | value |
|---|---|
| 收口日期 | 2026-07-27 |
| 单测 | `gateway-restart-cooldown-fp-p1-12.test.ts` **2 passed**；既有 governor/recovery **8 passed** 零修改 |
| E2E 稳定性 | 修复前 **5 跑 3 败**；修复后 **3 跑 3 绿**（49.2s / 47.6s / 45.7s） |
| typecheck:node | exit 0 |

## 根因（实证，非推测）

`electron/gateway/manager.ts` 的冷却抑制分支原本是：

```ts
trackMetric('gateway.restart.suppressed', props);
captureTelemetryEvent('gateway_restart_suppressed', props);
return;                     // ← 与「重启成功」在调用方看来完全一样
```

`restart()` 返回 `Promise<void>`，抑制与成功**同形**。于是：

1. Phase B 开启预览 → 重启 → 冷却计时开始（`restart-governor.ts:15`，2500ms）
2. Phase C 关闭预览 → 写新配置 → `restart()` 撞在冷却窗口内 → **被静默丢弃**
3. child 仍跑旧配置 → 随后的 flag-ack 轮询拿到不匹配的 flags → 判 `failed`
4. UI 显示一个无从解释的 `failed`

**这不是纯测试问题**：真人快速开关（开→关）走的是同一条路径，看到的也是裸 `failed`。
故按产品缺陷治理，而不是给 E2E 加 sleep。

有意思的是 `restart-governor.ts:26-31` 自己的注释就记着：旧的 10 分钟熔断器被移除，
理由正是「legitimate config changes were silently dropped」。2500ms 冷却是同一个失败模式的小号版本。

## 修复

冷却是**限速**，不是**拒绝**。改为等冷却结束后重启：

```ts
const waitMs = Math.max(0, decision.retryAfterMs);
if (waitMs > 0 && waitMs <= RESTART_COOLDOWN_MAX_WAIT_MS) {
  await new Promise((resolve) => setTimeout(resolve, waitMs + 50));
  await this.restart();
}
return;
```

`RESTART_COOLDOWN_MAX_WAIT_MS = 5000`：略高于 2500ms 冷却。需要等更久说明出问题的
不是冷却，此时宁可放弃也不阻塞数分钟。

**未缩短冷却时长**（它防的是重启风暴，Hard lock）。

## 反向注入证明用例非空转

把新分支条件改成 `if (false && ...)`（即还原旧行为）：

```
× waits out the cooldown and still restarts          1041ms
Test Files  1 failed (1)
Tests  1 failed | 1 passed (2)
```

已复原，复原后 3 文件 10 用例全绿。

## E2E 稳定性对照

| | 结果 |
|---|---|
| 修复前（FP-P1-10 收口期实测） | 5 跑 **3 败**，均停在 Phase C `data-ack-state="failed"` |
| 修复后（本轮连跑 3 次） | **3 passed**：49.2s / 47.6s / 45.7s |

耗时同时下降约 25%（65s → 47s）：等 2.5 秒冷却，比失败后走完整套 ack 超时重试更快。

## 门禁判定

- G1 dev：未改冷却时长；等待有上界不会挂死；typecheck:node 过。
- G2 test：2 新单测（等待成功 / 超界放弃）+ 既有 8 用例零修改全绿；反向注入证非空转。
- G3 runtime：真 Electron + 真 child 下连开关达成 applied，连跑 3 次稳定。
- G4 human：n/a。
- G5 accept：self-accept；AC 逐条有指针。
