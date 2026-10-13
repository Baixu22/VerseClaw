# L05：异常调用速率的有限状态断路器

日期：2026-10-13（Asia/Shanghai）。包码：L05（TF-0287）。真实 provider 调用：无。

## 状态机

`agents/rate-circuit-breaker.ts`：

- **closed**：放行；窗口内累积失败；成功不清零（窗口滑动过期），达到 `maxFailuresPerWindow` → **open**。
- **open**：`allowsRequest()` 在 `cooldownMs` 内为 false（不再产生效果）；到期 → **half-open**。
- **half-open**：**只放行单个探测**；探测进行中不再放行第二个；探测成功 → closed（恢复）；探测失败 → open 并重置 cooldown。
- 注入时钟驱动，`digest()` 确定可重放。

## 实测（虚拟时钟）

| 断言 | 结果 |
|---|---|
| 100 次合法请求（10 req/s）→ closed，trips 0 | ✅ |
| 10 次失败 → open，trips 1；cooldown 内拒绝 | ✅ |
| cooldown 后 → half-open，只放行 1 个探测 | ✅ |
| 探测成功 → closed；探测失败 → open + 新 cooldown | ✅ |
| 旧失败过期 → 后续合法窗口不 false-trip | ✅ |
| 相同输入 → 相同 digest | ✅ |

与既有 **guardian-circuit-breaker**（blocking 信号计数，连续 ≥3 或窗口 ≥10/50 熔断）互补：本包补时间维度的 cooldown + half-open。

## 残余（residual）

- 本包提供断路器内核；把它接到具体 provider/run 调用点属集成层。
- 是边界/限流，不是生产默认；不改默认值/产品锁/approval；不放松 SSRF/loop guard/approval；非真人证据。
