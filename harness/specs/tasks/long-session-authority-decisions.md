---
lifecycleStatus: active
id: long-session-authority-decisions
title: 长期会话架构边界与自动收口方式决策
program: long-session-development-20261022
taskKey: DECISION
phase: DECISION
intent: 固定继续复用现有 Workspace、Assistant、Session、Task Ledger、权限和资源 owner，并以 agent 自动验收替代真人门禁。
contractIndex: harness/specs/tasks/long-session-development-plan.md
touchedAreas:
  - harness/specs/tasks/long-session-authority-decisions.md
  - harness/specs/tasks/long-session-development-plan.md
requiredRules:
  - task-forest-autoclose-and-roles
  - identity-scope-boundary
  - runtime-lifecycle-governance-boundary
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 长期会话开发不创建第二 Project、Task、Goal、Context、Memory、Scheduler 或执行环境权威。
  - 功能实现、验收和收口由代理自动完成并如实标记；真实真人证据永不伪造，重大产品/发布/默认/安全决定继续独立授权。
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/long-session-authority-decisions.md
  - git diff --check
acceptance:
  - 产品边界明确：Project 在当前阶段仍是 Workspace compatibility projection；普通 Chat 不自动成为长期经理，进入长期协作必须显式。
  - task 事实只通过 Task Ledger，session/resource 动作复用现有 owner；不得新增并行 Project/Task/Goal/Context/Memory/Scheduler authority 或云执行环境。
  - 所有新验收可由脚本或代理执行；不要求所有者操作、凭据数据、真人 verdict 或真人证据。涉及第三方模型时可请求一次资源后自动执行，资源不足如实标 unmeasured/evidenceInsufficient。
  - 自动决定包括保留基线/NO-GO 与结构收口；不自动改变产品锁、冻结默认、公开发布或不可逆范围。
docs:
  required: true
  files:
    - harness/specs/tasks/long-session-development-plan.md
---

**长期会话架构边界与自动收口方式决策**

1. 当前产品继续以 Workspace 执行根、稳定 Assistant 和 Session 为组合，Project 只作只读兼容投影。普通 Chat 的用户与任务状态保持原语义；长期协调是显式可选能力，不是隐藏默认。
2. 现有 Task Ledger 持有任务事实；现有 session store/runtime、admission/finalizer、Role/permission、context/memory owner、Cron/Workboard 与 resource owner 保持唯一职责。新增 binding/receipt/read model 不能成为平行权威。
3. 阶段可以因证据不充分保留 baseline/NO-GO 正常收口；功能性完成的判断仍要求盘上 source、真实 caller、负向 case 与门禁一致。计划、合同、测试 fixture 存在不等于实现。
4. 真人不是前置条件。任何原真人步骤改由 actual agent 执行，产物标 driven_by: agent 和具体 actor；绝不将自动产物称为 real-human。外部资源只请求一次，随后自动化并保持未达标时的诚实降级。
5. 产品锁、冻结默认、公开发布、不可逆 git/数据操作、新的独立 Project/cloud execution 范围和重大范围变化仍按仓库授权规则另行决定，不能由自动验收自行生效。
6. 本决定是当前开发 lane 的架构约束，不改变历史节点，也不把 TF-0482/context-memory graduation 等已有工作强制并入本目标。