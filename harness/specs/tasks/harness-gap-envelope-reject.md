---
lifecycleStatus: completed
id: harness-gap-envelope-reject
title: Provider 内容守卫接到可拒绝的窄执行边界（S01）
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: S01 把一个 provider 适配器的请求信封守卫从 shadow-only 观察升级为 opt-in 可拒绝边界：开启后非法/未知信封在 wire 之前被拒绝且不发送任何字节，关闭时保持原观察语义与字节不变；不改默认值、产品锁或网络 SSRF 规则。
touchedAreas:
  - openclaw_runtime/src/agents/shadow-census.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/src/agents/rc02-envelope-reject.test.ts
  - harness/specs/tasks/harness-gap-envelope-reject.md
  - harness/specs/rules/provider-envelope-reject-boundary.md
  - docs/dev/harness-gap-closure/s01-envelope-reject.md
  - docs/dev/harness-gap-closure/s01-acceptance.json
  - docs/dev/harness-gap-closure/S01-SHA256SUMS
ownedPaths:
  - openclaw_runtime/src/agents/shadow-census.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/src/agents/rc02-envelope-reject.test.ts
  - harness/specs/tasks/harness-gap-envelope-reject.md
  - harness/specs/rules/provider-envelope-reject-boundary.md
  - docs/dev/harness-gap-closure/s01-envelope-reject.md
  - docs/dev/harness-gap-closure/s01-acceptance.json
  - docs/dev/harness-gap-closure/S01-SHA256SUMS
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - provider-envelope-reject-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - openclaw_runtime/src/agents/rc02-envelope-reject.test.ts
acceptance:
  - 复用既有 RC-02 shadow 边界与 digest-only wire receipt，不新建 store/registry/router；拒绝发生在 fetchWithSsrFGuard 之前。
  - opt-in：默认与 flag-off 时保持 shadow-only 观察语义、请求仍然发出、字节不变；只有显式开启才拒绝。
  - 拒绝时不发送任何 provider 字节（0 fetch 调用），并以 typed ProviderEnvelopeRejectedError 暴露原因；digest-only receipt 已在边界先写出，receipt 不含原始 prompt/正文。
  - 网络 SSRF、超时、代理、出站预算等既有规则不变；本包不接管它们。
  - 干净候选定向单测、runtime core 类型、scoped lint、harness validate/dry-run、comms replay/compare 通过，凭据扫描 0 命中，SHA256SUMS 可回读。
  - 不改产品默认值/锁/approval；已复核 README 四语：本包为内部守卫接线，无用户可见接口变化，故不改。
expectedUserBehavior:
  - 默认不改变任何 provider 请求；显式开启后，非法/未知请求信封会在发送前被拒绝，用户看到可归因的失败而不是静默发出。
  - 关闭开关即恢复原观察行为，不需要数据迁移。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/s01-envelope-reject.md
---

# S01 冻结实施边界

S01 只把已有的 Stage-1 请求信封守卫接到一个可拒绝的窄边界，复用 RC-02 shadow 边界与既有 digest-only wire receipt，不新建任何 store/registry/router，也不改变网络 SSRF、超时、代理或出站预算规则。

开关：`ShadowReceiptOptions.rejectInvalidEnvelope`（默认 false），或环境变量 `OPENCLAW_RC02_REJECT_INVALID_ENVELOPE`。只有 RC-02 shadow 边界处于活动状态、且开关为真、且信封 `!ok` 时，才在 `fetchWithSsrFGuard` 之前抛出 `ProviderEnvelopeRejectedError`。

顺序保证：拒绝判定放在既有 `emitShadowWireReceipt` 之后、真实发送之前，因此“digest-only receipt 先写、wire 从未发生”。receipt 只含 digest/ref/相关性摘要，不含原始 prompt 或正文。

默认/关闭路径：`resolveEnvelopeRejectEnabled` 返回 false，代码路径与之前完全一致——仍是观察，不改变字节。
