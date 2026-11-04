---
lifecycleStatus: active
id: semantic-convergence-remediation
title: 三层语义收敛修复与可量化收益
scenario: gateway-backend-communication
task_forest:
  - TF-0725
taskType: runtime-bridge
intent: 修复 Memory、提示词注入、Provider 验证/网络与重试预算中已复核的语义裂缝，并以可复算 baseline/after 证明收益；不改变产品锁、默认值、发布状态或 GA 口径。
touchedAreas:
  - docs/dev/semantic-convergence-program-20261104.md
  - docs/dev/semantic-convergence-benefit-20261104.md
  - docs/dev/network-protocol-reliability/retry-budget.md
  - docs/dev/network-protocol-reliability/provider-health.md
  - harness/specs/tasks/semantic-convergence-remediation.md
  - openclaw_runtime/src/agents/request-attempt-budget.ts
  - openclaw_runtime/src/agents/request-attempt-budget.test.ts
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/src/agents/model-fallback.ts
  - openclaw_runtime/src/agents/model-fallback.loop-termination.test.ts
  - openclaw_runtime/src/agents/retry-budget-invariants.test.ts
  - openclaw_runtime/src/agents/sessions/agent-session.ts
  - openclaw_runtime/src/infra/retry.ts
  - openclaw_runtime/src/infra/retry.test.ts
  - electron/services/providers/provider-validation.ts
  - electron/services/providers-api.ts
  - electron/utils/proxy-fetch.ts
  - electron/services/knowledge-embedding-provider.ts
  - electron/services/knowledge-api.ts
  - shared/host-api/contract.ts
  - src/components/settings/ProvidersSettings.tsx
  - src/pages/Setup/ProviderModelSteps.tsx
  - src/lib/providers.ts
  - src/lib/setup-provider.ts
  - src/stores/providers.ts
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/en/setup.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/zh/setup.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ja/setup.json
  - shared/i18n/locales/ru/settings.json
  - shared/i18n/locales/ru/setup.json
  - tests/unit/provider-validation.test.ts
  - tests/unit/provider-store-validation.test.ts
  - tests/unit/setup-provider-validation.test.ts
  - tests/e2e/setup-first-run-fp-p1-01.spec.ts
  - openclaw_runtime/src/context-engine/context-candidate.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.ts
  - openclaw_runtime/src/context-engine/turn-injection-budget.ts
  - openclaw_runtime/src/context-engine/context-final-snapshot.ts
  - openclaw_runtime/src/context-engine/rc03-seal-hook.ts
  - openclaw_runtime/src/context-engine/seal-registry.ts
  - openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts
  - openclaw_runtime/src/runtime-core/memory-self-edit-adapter.ts
  - openclaw_runtime/src/runtime-core/memory-runtime-integration.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/runtime-core/memory-pre-reply-injection.ts
  - openclaw_runtime/src/runtime-core/memory-query-tool.ts
  - openclaw_runtime/src/context-engine/stage5-memory-facade.ts
  - scripts/semantic-convergence-baseline.mjs
  - tests/unit/semantic-convergence-*
  - tests/e2e/semantic-convergence-*
  - artifacts/runs/semantic-convergence-20261104/**
expectedUserBehavior:
  - 一次用户请求不会因多层重试被重复计费或被提前拒绝；预算内的合法重试可以恢复。
  - 设置页不会把 429、非鉴权 400 或未确认模型误报为“凭据已验证/推理就绪”。
  - 验证与正式推理对同一目标的 SSRF/private-network/deadline 判定一致。
  - 编排器之后追加的系统提示内容可被分账；6000 字符不再被误读为总请求预算。
  - 模型自编辑记忆不会生成 human_confirmation/human_approved 标签；退役状态保持。
  - 每个修复都有 baseline/after 数值与未测边界，不宣称 GA。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - provider-error-retry-boundaries
  - outbound-protocol-payload-consistency
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/request-attempt-budget.test.ts src/agents/model-fallback.loop-termination.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/provider-error-retry-boundaries.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/memory-tf0500-persistence-retirement.test.ts tests/unit/memory-self-edit-adapter.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - 重试 attempt 身份唯一；同一成功记录不会被后续失败覆盖；完成操作幂等。
  - 同一逻辑请求的 charged_attempts 不超过 physical_requests（放大系数 ≤1.0），且预算内可恢复。
  - provider validation 返回结构化状态，false_ready_rate=0/12；429 与非鉴权 400 不再显示 verified。
  - 验证与推理共享策略指纹，SSRF/private-network/deadline 判定一致；知识 embedding 受总 deadline 约束。
  - 提示词 mutation 字段有 authority 声明；orchestrator 后追加内容全部入账或显式标记 unbudgeted；seal-on 下未注册 semantic mutation=0。
  - memory 自编辑 provenance 不含 human_*；更新路径无部分成功窗口；DELETE 已生效时不返回 flag_disabled。
  - Memory persist 仍为 false；默认值、产品锁、发布状态未变；最终报告给出 decision.status 与未测边界。
docs:
  required: true
  files:
    - docs/dev/network-protocol-reliability/retry-budget.md
---

# Non-goals

No product lock/default/release change; no Runtime Memory persist restoration; no second memory/context/retry/telemetry store; no claim of real-human evidence; no GA.
