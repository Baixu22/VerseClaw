---
id: live-tool-runtime-reliability
title: 真实语料后续工具执行、终止与恢复可靠性
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: HEAD
intent: 接力 TF-0156/0157，修复工具取消、前台进度和循环终止在实际调用链中的剩余缺口，以独立回归证据逐项收口。
ownedPaths:
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/native-hook-relay.loop-detection.test.ts
  - openclaw_runtime/src/agents/harness/native-hook-relay.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.abort.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.types.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.ts
  - openclaw_runtime/src/agents/bash-tools.exec.foreground-heartbeat.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec.lifecycle.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.loop-termination.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.cancellation.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.shadow-failure.test.ts
  - openclaw_runtime/src/agents/model-fallback.ts
  - openclaw_runtime/src/agents/model-fallback.loop-termination.test.ts
  - openclaw_runtime/src/agents/tool-loop-detection.ts
  - openclaw_runtime/src/agents/tool-loop-detection.progress.test.ts
  - openclaw_runtime/src/config/types.tools.ts
  - openclaw_runtime/src/config/schema.help.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - harness/specs/tasks/live-tool-runtime-reliability.md
  - harness/specs/rules/tool-runtime-lifecycle.md
  - docs/dev/context-moat/reviews/tool-runtime-reliability-20260912.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .agent-workbench/task-forest/**
touchedAreas:
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.types.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.abort.test.ts
  - openclaw_runtime/src/agents/harness/native-hook-relay.ts
  - openclaw_runtime/src/agents/native-hook-relay.loop-detection.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec.foreground-heartbeat.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec.lifecycle.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.loop-termination.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.cancellation.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.shadow-failure.test.ts
  - openclaw_runtime/src/agents/model-fallback.ts
  - openclaw_runtime/src/agents/model-fallback.loop-termination.test.ts
  - openclaw_runtime/src/agents/tool-loop-detection.ts
  - openclaw_runtime/src/agents/tool-loop-detection.progress.test.ts
  - openclaw_runtime/src/config/types.tools.ts
  - openclaw_runtime/src/config/schema.help.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - harness/specs/tasks/live-tool-runtime-reliability.md
  - harness/specs/rules/tool-runtime-lifecycle.md
  - docs/dev/context-moat/reviews/tool-runtime-reliability-20260912.md
  - docs/dev/handoffs/LATEST.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - 取消工具执行后不再收到前台心跳，也不启动尚未启动的命令。
  - 前台进度只提示当前可用的操作，正常输出和最终结果保留。
  - 工具循环终止不能被模型回退重新启动，按会话标识隔离检测状态。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - tool-runtime-lifecycle
humanEvidence: not-required
featureFlags:
  - 不新增或翻转产品默认开关。
forbiddenPatterns:
  - 为满足节点数量把已有 done 节点或仅登记、格式化工作计作新完成
  - 将模拟模型和自动化执行计作具名真人验收
  - 通过改变历史证据、产品锁或审批策略使检查通过
rollback:
  - 回退对应工具生命周期修复及其回归测试，无持久化格式迁移。
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts bash-tools.exec.foreground-heartbeat.test.ts bash-tools.exec.lifecycle.test.ts agent-tools.before-tool-call.loop-termination.test.ts agent-tools.before-tool-call.cancellation.test.ts agent-tools.before-tool-call.shadow-failure.test.ts model-fallback.loop-termination.test.ts tool-loop-detection.progress.test.ts bash-tools.exec-host-node.abort.test.ts native-hook-relay.loop-detection.test.ts --passWithNoTests=false
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts --grep foreground
acceptance:
  - 每项完成节点包含修复前失败、修复后通过的独立行为证据。
  - 取消、自然退出、后台交接和循环终止均遵守现有生命周期所有权。
  - 所有新增行为以相邻测试验证；涉及界面呈现的行为包含 Electron E2E。
  - 通过 Task Forest CLI 更新图和交接，并区分工程证据、真人证据及仍未完成的父节点。
docs:
  required: true
  files:
    - docs/dev/context-moat/reviews/tool-runtime-reliability-20260912.md
    - docs/dev/handoffs/LATEST.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

本批按用户“至少完成十个节点”的授权顺序推进。后续子节点只从实际代码、真实语料或
可执行反例发现的独立缺口建立，不重做 TF-0156/0157，不将本地工程结果升级为产品放行。
