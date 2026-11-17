---
lifecycleStatus: active
id: autonomy-object-owner-contract
title: TF-0670 自治对象、角色范围与既有 owner 合同
scenario: gateway-backend-communication
taskType: runtime-bridge
previousValidationDiffBase: 397e7b973
diffBase: 177ee7ed214979b82c4615fca6ddfda3b400a6b3
intent: 为自治消费者建立可拒绝错误 owner、跨项目和陈旧会话代的只读边界，复用现有身份、角色、任务和执行权威。
expectedUserBehavior:
  - 现有页面和手工操作保持原行为；新增自治消费者只能显示 owner 回读的身份、来源和状态。
  - 静态合同、角色职责和 run 完成不能被显示为执行授权或任务验收成功。
touchedAreas:
  - shared/types/identity-scope.ts
  - shared/types/project.ts
  - shared/types/task-ledger-reference.ts
  - shared/product-semantics.ts
  - tests/unit/autonomy-object-owner-contract.test.ts
  - tests/unit/task-ledger-reference.test.ts
  - harness/specs/tasks/autonomy-object-owner-contract.md
  - harness/specs/rules/autonomy-object-owner-boundary.md
  - harness/specs/scenarios/autonomy-object-owner-contract.md
  - harness/specs/fixtures/autonomous-project-system/a1/**
requiredRules:
  - identity-scope-boundary
  - contract-first-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - autonomy-object-owner-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
residualPaths:
  - harness/specs/tasks/autonomy-task-completion.md
  - harness/specs/tasks/autonomy-session-task-scope.md
  - harness/specs/tasks/autonomy-host-readiness.md
  - harness/specs/tasks/durable-task-owner-acceptance.md
  - harness/specs/tasks/g5-foundation-current-acceptance.md
  - tests/e2e/u6-interaction-metrics.final.spec.ts
requiredTests:
  - pnpm exec vitest run tests/unit/autonomy-object-owner-contract.test.ts tests/unit/identity-scope.test.ts tests/unit/project-projection.test.ts tests/unit/task-ledger-reference.test.ts tests/unit/component-authority-manifest.test.ts tests/unit/product-semantics.test.ts --maxWorkers=1
  - pnpm typecheck
  - pnpm contract:check
  - node scripts/check-semantic-authority.mjs
  - pnpm repo:evidence:check
  - pnpm harness validate --spec harness/specs/tasks/autonomy-object-owner-contract.md
  - pnpm harness run --spec harness/specs/tasks/autonomy-object-owner-contract.md --dry-run
  - git diff --check
acceptance:
  - Project、Workspace、Session/generation、ScopedRunId、TaskRef、Action、Effect、Evidence、ResourceRef 均有既有 owner、消费者和可核对 source anchor；不新增运行权威或第二注册服务。
  - 新引用必须携带显式 owner 和 owner 回读的 project/workspace/session/generation；缺失 owner、裸 taskId、跨 scope、陈旧 generation、混合或伪 grant 字段均拒绝。
  - Project 复用显式一对一兼容 mapper；角色复用 AgentSummary 和 RoleContract，System/Project/Session 职责不产生权限。
  - Task Forest 引用只指向外部完成权威；Ledger execution anchor 不携带或镜像其完成状态，反向引用和混合完成字段被拒绝。
  - 修改静态 manifest owner/allow 不能改变实际 Main 权限判定；真实 workspace owner 缺失时 fail closed；Run 完成不能升级 Task 验收。
  - 正负测试、uncached node/web/test typecheck、合同、语义权威、本体来源校验通过；磁盘证据绑定干净候选、命令、退出码、计数、source/input/config digest 与 agent actor。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - harness/specs/rules/autonomy-object-owner-boundary.md
    - harness/specs/scenarios/autonomy-object-owner-contract.md
---

本叶只交付纯合同适配器和拒绝能力，不接入自动写任务、授权、调度、资源租约或 UI。
期望 scope 必须从已存在的 workspace/session owner 回读；适配器本身不证明 owner 存在或授予权限。
后续 A2/A4/U1 使用这些边界。Action/Effect/Evidence/Resource 的引用保留其真实 owner，
不复制效果、完成或资源状态。当前四语 README 已复核，用户可见能力和操作路径没有变化。

验证复用 D:/ClawX 已安装依赖；没有运行 fresh install 或打包/发布验收。
pnpm 11 对依赖 junction 的自动同步检查需使用 verify-deps-before-run=false；不得清除共享依赖。
原始跑次写 D:/tmp；最终精选证据放本合同声明的 fixture 目录。
