---
lifecycleStatus: active
id: agent-first-product-effect
title: Agent First 真实 Electron 产品效果与自动交互代理
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 完成 TF-0591，复用现有 Electron/Host API/Gateway fixture，在三个隔离 profile 中验证 UI 输入、配置持久化、审批拒绝/允许/取消、非法输入、重启恢复和资源清理。
diffBase: b6b50ceaf4578134eea81f9790a85adac25b7b18
touchedAreas:
  - harness/specs/tasks/agent-first-product-effect.md
  - tests/e2e/agent-first-product-effect.spec.ts
  - harness/specs/fixtures/agent-first-system/product-effect/**
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm exec playwright test tests/e2e/agent-first-product-effect.spec.ts --workers=1 --retries=0
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/agent-first-product-effect.md
acceptance:
  - 三个独立 home/user-data profile 使用真实 Electron main/renderer 和真实 local Gateway；不替换 host owner、Gateway RPC 或 final-state getter。
  - UI 输入和主题选择、审批拒绝/允许/取消、非法设置/URL、等待审批时的 run bypass、关闭重开及恢复均有实际终态断言。
  - 文字声称成功不能覆盖主进程任务状态、renderer 持久状态或缺失凭据；预期拒绝的调用成功时测试失败。
  - 每个 profile 保存 source/build identity、截图、步骤、原始 trace、重启后终态和 app/Gateway 退出及端口关闭凭据。
  - 0 unexpected skips、0 retry，运行输出放 D:；所有操作和观察标为 agent 驱动，产品默认/锁/发布不变。
  - 类型、scoped lint、Harness、comms、凭据扫描与哈希回读通过；绿后提交并尝试合并，冲突保留记录。
docs:
  required: true
  files:
    - harness/specs/tasks/agent-first-product-effect.md
readmeUpdates: not-required
expectedUserBehavior:
  - 自动代理能在真实控件中输入、选择并读取持久状态。
  - 审批拒绝保留变更，批准仅恢复临时测试文件；未审批操作不能改动终态。
  - 重启后的首个交互与资源退出检查仍成功，不能以文字回复代替终态。
---

# TF-0591

只构建和验证自动交互代理，不新增产品 UI 或业务接口。复用 `tests/e2e/fixtures/electron.ts` 与 `fp-p1-harness.ts` 的真实启动及 host 调用。代理通过现有控件和公开 Host API 驱动，观察 Electron 里的持久数据及真实任务 owner 状态；不得用 fixture 的预设 host/RPC 结果代替这些 owner。

隔离 profile 的变更只作用于其临时设置、浏览任务和本地 Gateway。网络任务只检查许可状态，取消后不执行外部导航。真实模型质量和分发布局是后续独立门禁；本节点不据此批准发布或改默认值。
