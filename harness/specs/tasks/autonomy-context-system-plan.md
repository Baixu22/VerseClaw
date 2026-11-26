---
lifecycleStatus: active
id: autonomy-context-system-plan
title: 设计面向自治任务的新上下文系统并登记实施节点
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 对照当前owner、源码、TF与研究经验完成系统设计和可独立验收的节点；本轮交付规划，后续实现按就绪叶推进。
touchedAreas:
  - harness/specs/guides/autonomy-context-system-design.md
  - harness/specs/tasks/autonomy-context-system-plan.md
  - harness/specs/tasks/autonomy-context-baseline.md
  - harness/specs/rules/autonomy-context-system-contract.md
  - harness/specs/scenarios/autonomy-context-system.md
  - harness/specs/fixtures/autonomy-context-system/planning/**
residualPaths:
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - harness/specs/fixtures/agent-resource-queue/20261125/REPORT.json
  - harness/specs/fixtures/settings-capability-discovery/20261125/REPORT.md
  - harness/specs/fixtures/settings-capability-discovery/20261125/RESULT.json
  - harness/specs/fixtures/settings-capability-discovery/20261125/SHA256SUMS
  - harness/specs/fixtures/settings-capability-discovery/20261125/capabilities-zh-dark-1280.png
  - harness/specs/fixtures/settings-capability-discovery/20261125/capabilities-zh-dark-375.png
  - harness/specs/fixtures/settings-capability-discovery/20261125/capabilities-zh-light-1280.png
  - harness/specs/fixtures/settings-capability-discovery/20261125/source-manifest.json
  - harness/specs/rules/agent-resource-queue-authority.md
  - harness/specs/rules/settings-capability-discovery.md
  - harness/specs/scenarios/settings-capability-discovery.md
  - harness/specs/tasks/agent-resource-queue.md
  - harness/specs/tasks/chat-activity-bell-unread-status-20261120.md
  - harness/specs/tasks/chat-effort-preview-slider-20261124.md
  - harness/specs/tasks/settings-capability-discovery-20261125.md
  - openclaw_runtime/pnpm-workspace.yaml
  - scripts/resource-queue/README.md
  - scripts/resource-queue/resource_queue.py
  - scripts/resource-queue/test_resource_queue.py
  - scripts/resource-queue/windows_processes.py
  - shared/dcs/component-disposition-catalog.ts
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - shared/i18n/locales/zh/settings.json
  - src/App.tsx
  - src/components/settings/DcsProdFlagsPanel.tsx
  - src/components/settings/EfficiencySamplingPanel.tsx
  - src/lib/settings-search.ts
  - src/pages/ImageGeneration/index.tsx
  - src/pages/Settings/SettingsRoute.tsx
  - src/pages/Settings/SettingsSidebar.tsx
  - src/pages/Settings/index.tsx
  - src/pages/Settings/route-config.ts
  - src/pages/Settings/sections/CapabilitiesSection.tsx
  - src/pages/Settings/sections/KnowledgeSettingsSection.tsx
  - src/styles/codex-settings.css
  - tests/e2e/image-generation-settings.spec.ts
  - tests/e2e/settings-capabilities.spec.ts
  - tests/unit/component-disposition-catalog.test.ts
  - tests/unit/settings-capabilities.test.tsx
  - tests/unit/settings-search.test.ts
requiredRules:
  - autonomy-context-system-contract
  - identity-scope-boundary
  - autonomy-object-owner-boundary
  - durable-task-system-boundary
  - context-family-boundary
  - context-runtime-kit-boundary
  - runtime-authority-convergence-boundary
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
expectedUserBehavior:
  - 新上下文设计兼顾System/Project/Session职责、持久任务、工具效果、资源、经验和backend能力。
  - 新TF节点有明确前置、写集、正反验收、证据和回退；只有首个基线叶ready。
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/autonomy-context-system-plan.md
  - pnpm harness validate --spec harness/specs/tasks/autonomy-context-system-plan.md --since HEAD
  - pnpm harness run --spec harness/specs/tasks/autonomy-context-system-plan.md --since HEAD --dry-run
  - pnpm harness validate --spec harness/specs/tasks/autonomy-context-baseline.md --since HEAD
  - git diff --check -- harness/specs/guides/autonomy-context-system-design.md harness/specs/tasks/autonomy-context-system-plan.md harness/specs/tasks/autonomy-context-baseline.md harness/specs/rules/autonomy-context-system-contract.md harness/specs/scenarios/autonomy-context-system.md harness/specs/fixtures/autonomy-context-system/planning
acceptance:
  - 当前源码映射覆盖任务合同、语义转换、上下文装配、归档、自治循环、经验、资源、backend与实际请求；文档/TF编号漂移已显式记录。
  - 设计逐项定义受保护合同、模型可编辑工作投影、条件化经验、缺口恢复、成本/缓存预算与关闭回退。
  - 本地TF新增一个子目标、四阶段、P0设计记录及C01至C14实施叶；主挂TF-0664，保留原任务状态/历史，C01唯一ready。
  - P0以本次设计与结构检查证据完成；产品实现叶不以建图、静态规范或历史通过记录完成。
  - proposal基于当前base_graph_hash，保存/应用/validate/完整历史export与CLI/文件回读一致；并发变更时重新读取并重建提案。
  - 只修改本计划规范和精选规划证据；不改变冻结默认、运行代码、权限、旧RSI判决和其他会话改动。
docs:
  required: true
  files:
    - harness/specs/guides/autonomy-context-system-design.md
    - harness/specs/rules/autonomy-context-system-contract.md
    - harness/specs/scenarios/autonomy-context-system.md
---

本合同交付规划。后续每个实现叶使用设计中的真实owner与受控写集建立窄task spec，再运行context/validate；有产品效果的叶子补齐相关类型、contract、comms与Electron验证。

residualPaths是本轮开始及写规范时已存在的并发路径快照，不属于本次验收。检查使用真实diff，不使用--no-diff。README en/zh/ja已按上下文与自治相关段落复核，本轮设计未改变已实现能力文案。

Task Forest与本地交接留在私有路径；规范、场景、规则及精选规划验证可随变更提交。完整历史导出采用现有流式CLI；在当前资源队列登记并读取真实执行回执，不删除锁或其他历史产物。
