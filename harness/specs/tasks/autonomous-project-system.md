---
lifecycleStatus: active
id: autonomous-project-system
title: 基于现有架构骨架的系统与项目自治实施规划
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 将用户授权的高度自治项目目标拆成依赖清楚、复用既有owner且可自动验收的Task Forest节点；本轮只交付规划并调整0657至0662的UI合同，不宣称实现或运行验收。
touchedAreas:
  - harness/specs/tasks/autonomous-project-system.md
  - harness/specs/guides/autonomous-project-system-plan.md
  - harness/specs/scenarios/autonomous-project-system.md
  - harness/specs/tasks/session-derivation-ui.md
  - harness/specs/guides/session-derivation-ui-design.md
  - harness/specs/rules/session-derivation-ui-contract.md
  - harness/specs/scenarios/session-derivation-ui.md
residualPaths:
  - .gitignore
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/chat-model-picker-tiers.spec.ts
expectedUserBehavior:
  - 用户从项目名称进入负责人页面，从目标发起任务拆解、执行、验证与结果交付。
  - 每个会话有任务范围，讨论可为空，执行副作用前须由agent自动建立真实任务关联。
  - 系统总控在既有授权内协调项目、工具、资源和生效配置，仅重大决策升级给用户。
  - 任务完成、运行结束、模型回复、静态能力与实际效果不互相冒充。
requiredRules:
  - identity-scope-boundary
  - contract-first-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - context-family-boundary
  - runtime-authority-convergence-boundary
  - session-derivation-ui-contract
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/autonomous-project-system.md
  - pnpm harness validate --spec harness/specs/tasks/autonomous-project-system.md --since HEAD
  - pnpm harness run --spec harness/specs/tasks/autonomous-project-system.md --since HEAD --dry-run
  - pnpm harness validate --spec harness/specs/tasks/session-derivation-ui.md --since HEAD
  - pnpm harness:specs:lifecycle
  - git diff --check
acceptance:
  - 规划逐项引用已完成的身份、本体关系、语义权威、资源及长期协调成果，未把历史或静态通过当新运行效果。
  - 本地Task Forest包含20个新增实施叶子、阶段和目标，以及保留编号与原验收的0657至0662；每叶有写集、前置、正负验收、证据、回退与范围边界。
  - 自动写入口依赖现有接入层收敛；UI任务依赖真实任务绑定；整体依赖无环，保留其他会话状态与已有列表字段。
  - proposal保存与应用遵守当前base_graph_hash；Task Forest validate/export通过；从CLI回读确认实际节点和依赖。
  - 规划状态与实现状态分离，不把页面草图、规范校验或建图当成功运行；无人操作、无人数据与无人verdict不作为验收前置。
  - 本轮变更只涉及声明的规范与本地任务图；不改变产品锁、冻结默认、运行代码或其他会话已有改动。
docs:
  required: true
  files:
    - harness/specs/guides/autonomous-project-system-plan.md
    - harness/specs/scenarios/autonomous-project-system.md
    - harness/specs/guides/session-derivation-ui-design.md
---

# 规划与执行边界

这是umbrella规划合同。后续每个ready叶子必须按guide对应写集建立窄task spec并context/validate，再实现；本合同不能作为一次改遍所有运行时的授权。

现有骨架的“零行为改动”只约束其历史收敛任务，不阻止用户这次明确要求的新产品行为。新增行为在本计划对应叶子内实现，并继续消费原身份、权限、任务、记忆和工具owner；不改旧骨架任务的验收定义。

当前residualPaths是规划开始时已有的并行工作：.gitignore包含本地研究目录规则，tests/e2e/fixtures/electron.ts属于TF-0650/0663的host mock迁移。本轮不编辑或验证这些改动，不将其冒充本任务通过；使用--since HEAD仍保留真实工作区diff检查，不使用--no-diff。

规划期间另一会话继续推进并出现tests/e2e/chat-model-picker-tiers.spec.ts改动；同样按精确residual路径报告，不纳入本轮规范写集或验收声明。

产品README本轮仅复核，未宣称新功能已实现，因此不改能力文案。每个实现叶子按实际行为同步四语README；独立发布批准另行处理。
