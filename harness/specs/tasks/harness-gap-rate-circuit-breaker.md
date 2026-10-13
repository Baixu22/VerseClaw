---
id: harness-gap-rate-circuit-breaker
title: 异常调用速率的有限状态断路器（L05）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: L05 为异常调用速率提供有限状态断路器：closed 累积窗口内失败，达阈值转 open 并在 cooldown 内拒绝（不再产生效果），cooldown 后转 half-open 只放行单个探测，探测成功回 closed、失败重新 open；纯合法速率永不误断。不与既有 budget/loop guard 重复，不放松 SSRF/loop guard/approval。
touchedAreas:
  - openclaw_runtime/src/agents/rate-circuit-breaker.ts
  - openclaw_runtime/src/agents/rate-circuit-breaker.test.ts
  - harness/specs/tasks/harness-gap-rate-circuit-breaker.md
  - docs/dev/harness-gap-closure/l05-rate-circuit-breaker.md
  - docs/dev/harness-gap-closure/l05-acceptance.json
  - docs/dev/harness-gap-closure/L05-SHA256SUMS
ownedPaths:
  - openclaw_runtime/src/agents/rate-circuit-breaker.ts
  - openclaw_runtime/src/agents/rate-circuit-breaker.test.ts
  - harness/specs/tasks/harness-gap-rate-circuit-breaker.md
  - docs/dev/harness-gap-closure/l05-rate-circuit-breaker.md
  - docs/dev/harness-gap-closure/l05-acceptance.json
  - docs/dev/harness-gap-closure/L05-SHA256SUMS
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - sensitive-sink-ledger-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - openclaw_runtime/src/agents/rate-circuit-breaker.test.ts
  - openclaw_runtime/src/agents/tool-loop-detection.progress.test.ts
acceptance:
  - 状态机有限且确定：closed -> open -> half-open -> (closed | open)；由注入时钟驱动，可重放。
  - open 在 cooldown 内拒绝请求（不再产生效果）；cooldown 结束转 half-open。
  - half-open 只放行 **单个** 探测；探测进行中不再放行第二个；探测成功回 closed，失败重新 open 并重置 cooldown。
  - 纯合法速率（无失败）永不 trip；窗口滑动使旧失败过期，合法后续窗口不 false-trip。
  - 断路器是速率边界而非生产默认；不替代/放松 SSRF、loop guard、approval 与既有 budget/loop guard（沿用 tool-loop-detection 正反回归）。
  - 干净候选定向测试、runtime core 类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
expectedUserBehavior:
  - 错误风暴被明确熔断，cooldown 后仅一次探测，成功后恢复；合法速率不受影响。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/l05-rate-circuit-breaker.md
---

# L05 冻结实施边界

L05 只新增一个确定性的有限状态速率断路器（closed/open/half-open），由注入时钟驱动。它是边界/限流，不是生产默认配置；不替代也不放松 SSRF、loop guard、approval 或既有 budget（`provider-outbound-budget`）与 loop guard（`tool-loop-detection`）。fixture 参数：windowMs、maxFailuresPerWindow、cooldownMs（示例 10 次/1s、cooldown 2s），与既有 guardian-circuit-breaker（blocking 信号计数）互补而非重复。
