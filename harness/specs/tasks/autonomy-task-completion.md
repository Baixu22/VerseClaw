---
lifecycleStatus: active
id: autonomy-task-completion
title: TF-0672 自动业务任务完成声明与既有owner验收
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 3259f57bd86740f2a743a0bf349b3933a8da08cb
intent: 把自动完成声明交回既有Task Ledger事实owner，回读TaskLoop及验证/效果owner的同候选证据，拒绝文本终态或陈旧证据直接升级done。
expectedUserBehavior:
  - 自动任务的run complete、evidence gate、reviewer核验及Ledger接纳分别可回读，未获接纳显示review或unknown。
  - 手工编辑和turn check保留原语义；自动业务任务完成必须引用既有owner的记录，不能提交自报passed。
  - candidate/input/config/dirty-diff、任务引用、session generation或artifact变化后，旧验收不能接纳新候选。
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - openclaw_runtime/src/agents/exec-defaults.ts
  - openclaw_runtime/src/agents/orchestration-verifier-report.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - electron/utils/sandbox-high-risk-gate.ts
  - electron/services/gateway-api.ts
  - tests/unit/gateway-permissions-api.test.ts
  - electron/services/workspace-permissions.ts
  - tests/unit/sandbox-high-risk-gate-p2-004.test.ts
  - tests/unit/workspace-permissions.test.ts
  - electron/services/chat-api.ts
  - electron/services/sessions-api.ts
  - electron/services/session-activity-api.ts
  - openclaw_runtime/src/config/runtime-snapshot.ts
  - openclaw_runtime/src/agents/task-loop-completion-fence.ts
  - electron/services/task-ledger-api.ts
  - electron/services/task-ledger-service.ts
  - electron/services/task-ledger-actions.ts
  - electron/services/task-ledger-completion.ts
  - electron/services/versegit-receipt-bridge.ts
  - electron/services/versegit-receipt-evidence.ts
  - electron/main/index.ts
  - shared/types/task-ledger.ts
  - shared/types/identity-scope.ts
  - shared/task-ledger-completion.ts
  - shared/task-ledger-candidate.ts
  - shared/task-ledger-artifact.ts
  - shared/task-ledger-journal-lock.ts
  - shared/task-ledger-process.ts
  - tests/unit/task-ledger-process.test.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-completion.ts
  - openclaw_runtime/src/agents/task-loop-verification.ts
  - openclaw_runtime/src/agents/simple-completion-transport.ts
  - openclaw_runtime/src/agents/tools/task-loop-tool.ts
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/bash-tools.exec-runtime.ts
  - openclaw_runtime/src/process/spawn-utils.ts
  - openclaw_runtime/src/process/supervisor/types.ts
  - openclaw_runtime/src/process/supervisor/supervisor.ts
  - openclaw_runtime/src/process/supervisor/adapters/child.ts
  - openclaw_runtime/src/process/supervisor/adapters/pty.ts
  - openclaw_runtime/src/agents/verseshell-runtime.ts
  - openclaw_runtime/src/agents/verseshell/aci-client.ts
  - openclaw_runtime/src/agents/verseshell/process-manager.ts
  - openclaw_runtime/src/agents/verseshell/process-manager.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.run-control.ts
  - tests/unit/autonomy-executor-launch.test.ts
  - tests/unit/autonomy-candidate-input.test.ts
  - openclaw_runtime/src/gateway/session-reset-service.stop.test.ts
  - openclaw_runtime/src/gateway/session-reset-service.ts
  - openclaw_runtime/src/config/sessions/types.ts
  - openclaw_runtime/src/config/sessions/metadata.ts
  - openclaw_runtime/src/agents/goal-wake-helper-host.ts
  - openclaw_runtime/src/agents/goal-wake-helper-host.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec-types.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/context-engine/registry/context-item-registry.ts
  - openclaw_runtime/src/agents/long-task-control/task-ledger.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/agents/long-task-control/store.ts
  - tests/unit/autonomy-task-completion.test.ts
  - tests/unit/autonomy-task-actions.test.ts
  - tests/unit/task-ledger-service.test.ts
  - tests/unit/identity-scope.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/versegit-candidate-receipts.test.ts
  - tests/unit/task-loop-controller.test.ts
  - tests/unit/autonomy-task-completion-owner.test.ts
  - tests/unit/autonomy-task-completion-admission.test.ts
  - tests/unit/task-loop-verification.test.ts
  - tests/unit/autonomy-simple-completion.test.ts
  - tests/e2e/autonomy-task-completion.spec.ts
  - harness/specs/tasks/autonomy-task-completion.md
  - harness/specs/rules/autonomy-task-completion-boundary.md
  - harness/specs/scenarios/autonomy-task-completion.md
  - harness/specs/fixtures/autonomous-project-system/a3/**
  - docs/modules/multi-agent-and-tasks.md
requiredRules:
  - identity-scope-boundary
  - autonomy-object-owner-boundary
  - autonomy-task-completion-boundary
  - autonomy-task-action-boundary
  - backend-communication-boundary
  - contract-first-boundary
  - api-client-transport-policy
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/session-activity-background-read.test.ts tests/unit/autonomy-host-readiness.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-task-completion-admission.test.ts tests/unit/autonomy-task-completion-owner.test.ts tests/unit/task-loop-verification.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/autonomy-task-completion.test.ts tests/unit/identity-scope.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts --maxWorkers=1
  - pnpm typecheck
  - pnpm contract:check
  - pnpm comms:replay
  - pnpm comms:compare
  - pnpm build:runtime
  - pnpm build:vite
  - pnpm test:e2e:run tests/e2e/autonomy-task-completion.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/autonomy-task-completion.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-task-completion.md --dry-run
  - git diff --check
acceptance:
  - complete和repair/blocked/unavailable组合、accepted/exit0/model text都不能直接产生自动业务任务验收done。
  - 完成请求只携taskRef及既有owner记录引用；提交侧回读可信来源、scope/generation、candidate/checks/reviewer/revision与artifact，不接受payload自报verifier或passed。
  - 证据缺失/篡改/过期、错误任务、旧generation和旧分支候选均拒绝；成功决定可以从既有checkpoint、Ledger事件与真实artifact重算。
  - 不新增完成裁判服务或独立decision store，不改变Workboard/TaskLoop调度owner、不重写手工或turn状态，不改变产品锁/冻结默认。
  - 同干净候选包含原始owner事件、自动标记、命令exit/count、正负例、source/input/config/dirty-diff、哈希、凭据扫描与未测限制；不把A3完成外推整个TF0664。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/multi-agent-and-tasks.md
    - harness/specs/rules/autonomy-task-completion-boundary.md
    - harness/specs/scenarios/autonomy-task-completion.md
---

本叶原始6项要求和5项验收以canonical TF-0672为准，不能删减。
完成事实仅追加到现有Task Ledger；runtime来源保留在已有long_task_checkpoints。
既有TaskLoop evidenceGate与shadow verifier各保留原职权，不把shadow报告升级为通过。
一般CRUD的done不是自动验收；新增完成接纳必须明确来源、候选及可失效的检查回执。
README三语复核保持既有任务能力口径，实施中不提前宣传完整项目自治。
