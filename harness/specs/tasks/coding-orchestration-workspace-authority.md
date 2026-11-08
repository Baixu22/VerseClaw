---
lifecycleStatus: active
id: coding-orchestration-workspace-authority
title: TF-0768 编排隔离与父会话工作区身份贯通
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 75393857d
intent: 让显式隔离请求进入真实worker工作区，以父会话持有的目录和代际为准，调度只消费真实工作树记录。
touchedAreas:
  - harness/specs/tasks/coding-orchestration-workspace-authority.md
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/agents/orchestration-protocol.ts
  - openclaw_runtime/src/agents/coding-control-dispositions.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/orchestration-resource-scheduler.ts
  - openclaw_runtime/src/agents/role-spawn.ts
  - openclaw_runtime/src/agents/orchestration-workspace-context.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/subagent-spawn.ts
  - openclaw_runtime/src/agents/subagent-spawn.test.ts
  - openclaw_runtime/src/agents/worktree-service.ts
  - openclaw_runtime/src/agents/worktree-service.test.ts
  - openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/orchestration-resource-scheduler.test.ts
  - tests/unit/role-spawn.test.ts
  - tests/e2e/coding-orchestration-workspace-authority.spec.ts
  - harness/specs/fixtures/coding-fixes/TF-0768/**
  - docs/modules/workspace-and-coding.md
expectedUserBehavior:
  - 顶层worktree被worker继承，显式worker shared覆盖顶层，未知隔离值明确拒绝。
  - 外部路径、旧代际与创建失败在worker执行前拒绝；返回实际backend与根目录，不将目录模拟标成Git隔离。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/agents/subagent-spawn.test.ts src/agents/worktree-service.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-resource-scheduler.test.ts tests/unit/role-spawn.test.ts tests/unit/versegit-runtime-bindings.test.ts tests/unit/orchestration-protocol-v3.test.ts tests/unit/orchestration-task-graph.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node node_modules/@playwright/test/cli.js test tests/e2e/coding-orchestration-workspace-authority.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/coding-orchestration-workspace-authority.md
acceptance:
  - plan和run的顶层隔离、worker覆盖与未知值保持同一语义。
  - 工作根从父会话和配置owner读取；外来根、缺失目录、跨会话准入和旧代际不能生成worker或第二工作目录。
  - 实际worker cwd、workspaceDir、工作树注册归属和generation一致；创建失败与执行前generation变化拒绝。
  - Gateway与team_orchestrate共用父会话owner；原生spawn异步准备期间父会话重置会阻止下发并回滚准备、清理临时子会话。
  - 资源调度以owner登记的独立Git工作树为依据，caller布尔值和inprocess目录不能声称verified checkout。
  - 精选正反证据按候选和SHA256固定；模拟、源运行时及完整端到端证据分别标注，未通过不得收口。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
  note: 修复既有隔离约束，README功能范围和默认值不变。
---

TF-0758/S4，A6。复用现有Session store、Workspace配置、WorktreeService和资源调度owner；不引入第二工作区注册表。默认shared/inprocess不变，只有显式worktree执行创建工作树。计划本身不创建目录；执行前及每次spawn前复核父会话身份。全部验收driven_by=agent，realHumanEvidence=false。
