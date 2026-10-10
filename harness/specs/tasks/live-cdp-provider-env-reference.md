---
lifecycleStatus: archived
id: live-cdp-provider-env-reference
title: 识别环境变量密钥并完成真实模型 CDP 采集
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: HEAD
intent: 修复已配置环境变量 SecretRef 的 Provider 被首次发送检查误判为无密钥的问题，并通过真实 Electron CDP 会话沉淀脱敏数据。
touchedAreas:
  - electron/utils/openclaw-auth.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - harness/specs/tasks/live-cdp-provider-env-reference.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/backend-communication-boundary.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - artifacts/live-model-cdp/**
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
residualPaths:
  - artifacts/unblock-pack/tf0127-tf0129-tcorpus.md
  - docs/dev/context-moat/reviews/m2m4-closeout-20260911.md
  - docs/dev/context-moat/reviews/revalidation-sec002-gov003-20260910.json
  - harness/specs/tasks/task-forest-review-outcomes.md
  - plans/system-maturity/phase0-foundation/tasks/P0-004.delivery.md
  - plans/system-maturity/phase1-direct-boundaries/tasks/P1-001.delivery.md
expectedUserBehavior:
  - 使用可解析的环境变量 SecretRef 的 Provider 可以正常发送消息，无需把密钥另存为明文。
  - 缺失环境变量、非法引用或被 allowlist 排除的引用仍然不能声明已配置密钥。
  - 采集保留真实回复、用量、会话标识、失败和数据来源，不将自动化数据算作具名真人验收。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - active-config-guards
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - Main 仅解析已配置的 env SecretRef，尊重 provider source 与 allowlist，不执行 file 或 exec secret provider。
  - 现有 auth-profile 优先级保持不变，环境变量密钥不被写回配置或采集产物。
  - 单元测试覆盖存在、缺失、受限和非法引用，Electron E2E 覆盖 Provider 界面的可用状态。
  - 真实 CDP 采集具备实际会话与用量证据，并保留问题及修复记录。
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

## 采集边界

本轮使用用户明确授权的第三方模型和新编的非敏感练习数据；会话由 Agent 经 CDP 驱动。密钥只通过进程环境传入，产物不包含鉴权头或明文密钥。TF-0009 的具名真人计数和产品锁不随这批数据改变。
