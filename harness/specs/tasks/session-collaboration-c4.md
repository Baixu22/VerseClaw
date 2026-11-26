---
lifecycleStatus: active
id: session-collaboration-c4
title: C4 回读材料失效、替代和冲突
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: fc6bbcae9ac25b781c73732e84884665ff11e4dd
intent: 原 TaskSystem 保留发布版本，按原证据和后续事件回读有效状态。
touchedAreas:
  - shared/types/session-collaboration-material.ts
  - shared/task-system/store.ts
  - shared/types/session-collaboration-watch.ts
  - shared/session-collaboration-watch.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - openclaw_runtime/src/agents/tools/sessions-watch-tool.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-material.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-watch.ts
  - electron/services/session-activity-api.ts
  - src/components/agents/SessionCollaborationMaterials.tsx
  - src/stores/session-collaboration.ts
  - shared/i18n/locales/**/agents.json
  - tests/unit/session-collaboration-material-lifecycle.test.ts
  - tests/unit/session-collaboration-watch.test.ts
  - tests/unit/task-worktree-retention.test.ts
  - tests/e2e/session-collaboration-material-lifecycle.spec.ts
  - docs/modules/sessions.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/session-collaboration-c4.md
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
  - pnpm exec vitest run tests/unit/session-collaboration-material-lifecycle.test.ts tests/unit/session-collaboration-watch.test.ts tests/unit/task-worktree-retention.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-material-lifecycle.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-c4.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-c4.md --dry-run
acceptance:
  - 原版本保持可回读，任务修订、证据或产物变化、期限、替代、撤销和来源缺失分别投影。
  - 冲突只记录显式锚定的原版本；未确认替代无权覆盖有验证证据的材料。
  - 选中材料的失效通过既有有界监听和游标按来源去重。
  - 来源删除后，相关任务的有权读者可读取适用的原留存证据引用。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---
# C4 材料有效性

替代和冲突引用精确版本，撤销写入独立 TaskSystem 回执。读取时核对任务修订、证据文件、产物与有效期限。材料观察沿用原会话可见性、等待和游标；原证据字节继续通过 TaskSystem 留存入口读取。
