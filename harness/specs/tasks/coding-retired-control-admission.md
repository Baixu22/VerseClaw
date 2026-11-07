---
lifecycleStatus: active
id: coding-retired-control-admission
title: TF-0774 编码退役入口与有效状态一致性
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: bd7e32292
intent: 阻止已退役 Patch Flow 通过旧请求或恢复元数据执行，并让 Developer 目录与模型建议反映当前可用的编码路径。
touchedAreas:
  - harness/specs/tasks/coding-retired-control-admission.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/active-config-guards.md
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/orchestrator-write-set-plan.test.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/isolation-mode-matrix.ts
  - openclaw_runtime/src/agents/isolation-mode-matrix.test.ts
  - openclaw_runtime/src/agents/patch-flow-graduation.ts
  - openclaw_runtime/src/agents/patch-flow-graduation.test.ts
  - openclaw_runtime/src/agents/coding-control-dispositions.ts
  - openclaw_runtime/src/context-engine/coding-runtime-flags.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - shared/dcs/component-disposition-catalog.ts
  - shared/dcs/prod-flags-catalog.ts
  - src/components/settings/DcsProdFlagsPanel.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/coding-controls-tf0510.test.ts
  - tests/unit/coding-controls-tf0510-patchflow-trigger.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/coding-retired-deferred-completion.test.ts
  - tests/unit/dcs-prod-flags-catalog.test.ts
  - tests/unit/dcs-prod-flags-retirement.test.tsx
  - tests/e2e/coding-retired-controls.spec.ts
  - docs/modules/workspace-and-coding.md
  - harness/specs/fixtures/coding-fixes/TF-0774/**
expectedUserBehavior:
  - 旧 patchFlowExecution 请求与已退役 config/override 不会改变真实 worker 的提示词或工具权限。
  - 恢复中的旧 Patch Flow 元数据不会发起新的串行候选应用，已经记录的历史效果继续保留。
  - Developer 显示 Symbol Lease 与 Patch Flow 为退役、不可写；模型建议使用当前支持的共享或工作树路径。
  - 普通 write/journal/worktree 的现有权限、恢复与冲突检查继续执行。
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - active-config-guards
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/coding-controls-tf0510.test.ts tests/unit/coding-controls-tf0510-patchflow-trigger.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/coding-retired-deferred-completion.test.ts tests/unit/dcs-prod-flags-catalog.test.ts tests/unit/dcs-prod-flags-retirement.test.tsx --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/agents/isolation-mode-matrix.test.ts src/agents/patch-flow-graduation.test.ts src/agents/worktree-service.test.ts src/agents/tools/write-journal.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/coding-retired-control-admission.md
  - pnpm run test:e2e:run tests/e2e/coding-retired-controls.spec.ts
acceptance:
  - A10 原始失败保持冻结；真实 observed executor 与 Gateway API 的三 worker 对照中，旧请求/config/override 均不激活 proposal-only 模式。
  - 真实完成入口拒绝旧元数据发起的新 Patch Flow 应用；已有 applied 状态和效果不被改写。
  - 目录、模型建议、Developer 四语显示与有效状态一致；退役条目无可写入口。
  - 普通共享及工作树执行、write/journal 正向验证和相关负例通过。
  - 同一干净候选的命令/退出码/count/skip、真实效果、源码及产物摘要、审查、凭据扫描与清理完成后自动收口。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
  note: 根 README 保留模块入口，编码能力与退役说明在模块文档同步。
---

TF-0758/P4，A10。沿用已批准的 TF-0510 退役决定和现有 write/journal/worktree owner；冻结默认值维持现有值。验收及 UI 操作由 agent 驱动，标记 driven_by: agent、actor、realHumanEvidence: false。
