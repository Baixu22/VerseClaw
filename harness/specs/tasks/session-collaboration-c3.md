---
lifecycleStatus: active
id: session-collaboration-c3
title: C3 按任务、文件和主题读取共享材料
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: dae64780ca683c3f88a03361c822c2ac7428fffb
intent: 同一工作区内按可见会话查询原 TaskSystem 材料，按材料版本展开详情。
touchedAreas:
  - shared/types/session-collaboration-material.ts
  - shared/task-system/store.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-material.ts
  - openclaw_runtime/src/agents/tools/session-collaboration-query.ts
  - openclaw_runtime/src/agents/tools/sessions-list-tool.ts
  - openclaw_runtime/src/agents/tool-description-presets.ts
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/components/agents/SessionCollaborationMaterials.tsx
  - shared/i18n/locales/**/agents.json
  - tests/unit/session-collaboration-material-query.test.ts
  - tests/e2e/session-collaboration-material-search.spec.ts
  - docs/modules/sessions.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/session-collaboration-c3.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/session-collaboration-material-query.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-material-search.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-c3.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-c3.md --dry-run
acceptance:
  - 会话工具和 typed Host 在原会话可见范围内按任务、文件、主题和证据查询材料。
  - 分页摘要记录截断和扫描进度，展开固定版本后读取来源、适用条件和原证据引用。
  - 排除不可见来源和跨工作区读取，区分无结果、未扫完与材料过期。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---
# C3 材料查询

沿用会话发现的可见性和 generation，读取原 TaskSystem 中按来源限定的材料事件。工具在调用者工作区搜索，面板可指定来源会话。列表返回短摘要与稳定材料引用，选中后按任务和内容哈希展开版本详情。
