---
lifecycleStatus: active
id: session-collaboration-center-plan
title: 将会话信息共享落实为完整模块规划和任务节点
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: b3b7109448744e82145a57572d7caf88a77ec79b
intent: 完成用户授权的会话协作中心全阶段规划，建立 owner/接口/交互/资源与验收合同，并通过 Task Forest 提案应用五阶段二十五叶；本次不启动产品实现。
touchedAreas:
  - harness/specs/guides/session-collaboration-center-plan.md
  - harness/specs/tasks/session-collaboration-center-plan.md
  - harness/specs/tasks/session-collaboration-identity-read-model.md
  - harness/specs/scenarios/session-collaboration-center.md
  - harness/specs/rules/session-collaboration-center-contract.md
residualPaths:
  - openclaw_runtime/pnpm-workspace.yaml
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/zh/chat.json
  - src/components/assistant-render/TurnSummaryCard.tsx
  - src/components/tool-ui/RunTerminalSurfaces.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ExecutionGraphCard.tsx
  - src/pages/Chat/index.tsx
  - src/styles/codex-conversation.css
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/chat-render-reachability.test.tsx
  - harness/specs/tasks/chat-activity-bell-unread-status-20261120.md
  - harness/specs/tasks/chat-tool-activity-stream-20261123.md
  - src/components/assistant-render/ToolActivityGroup.tsx
  - src/pages/Chat/tool-activity-groups.ts
  - tests/unit/tool-activity-group.test.tsx
  - tests/unit/tool-activity-groups.test.ts
  - src/pages/Chat/task-visualization.ts
  - tests/e2e/chat-tool-activity-stream.spec.ts
expectedUserBehavior:
  - 会话与 agent 能共用有来源的工作总览、消息状态、成果引用和资源视图。
  - 规划逐叶给出前置、受控写集、正反验收、检查入口、证据与回退，开发可按一个 ready 叶续接。
  - 任务图保留当前其他节点，复用已完成底座与原 TF-0688 追溯任务。
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - autonomy-object-owner-boundary
  - durable-task-system-boundary
  - contract-first-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/session-collaboration-center-plan.md
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-center-plan.md --since b3b7109448744e82145a57572d7caf88a77ec79b
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-center-plan.md --since b3b7109448744e82145a57572d7caf88a77ec79b --dry-run
  - pnpm harness:specs:lifecycle
  - git diff --check
acceptance:
  - 完整规划覆盖 A 总览查询订阅、B 消息与控制、C 材料复用、D 资源收益、E 恢复与整链，叶子合同与本地提案一致。
  - 本地 Task Forest 新增一个模块父节点、五阶段、二十五执行/决策叶；主挂 TF-0664，首叶 ready，后续按依赖 proposed，未实施叶不记 done。
  - 每叶有目的、前置、真实 source owner/写集、正反验收、检查入口、证据字段和具体回退；TF-0688 仅作为 D1 消费前置。
  - proposal-save/apply 采用匹配 base_graph_hash，validate 与完整历史 export 成功；CLI、实际文件和节点依赖回读一致。
  - 所有规划文件可解析并通过声明范围/可移植性/lifecycle 校验；规划元数据和精选证据不包含凭据。
  - 本次 source 变更仅五份合同文件，其他会话工作与原 Task Forest 状态保留；产品功能未由规划验收声称完成。
docs:
  required: true
  files:
    - harness/specs/guides/session-collaboration-center-plan.md
    - harness/specs/scenarios/session-collaboration-center.md
    - harness/specs/rules/session-collaboration-center-contract.md
---
# 规划交付合同

本规格只覆盖规划和节点落实。进入产品实现前，每个就绪叶按 guide 的受控写集建立窄 task spec，运行 context 后实施；首叶已有 session-collaboration-identity-read-model 规格。新叶共享 session-collaboration-center-contract。

residualPaths 列举规划期间其他会话的明确工作路径，用于真实 diff 校验；这些文件不属于本次写集或验收。规划不更改 README 的已实现能力文案；实现叶按实际行为同步 README.md、README.zh-CN.md、README.ja-JP.md 及模块文档。

五阶段二十五叶以本地 Task Forest 为状态源。guide 保存稳定合同，运行日志、提案、映射和原始研究快照保留本地；构建/CI 不依赖私有任务图。节点完成按原 acceptance 与磁盘证据执行，自动化场景如实标 agent 驱动。

