---
lifecycleStatus: active
id: session-collaboration-b4
title: B4 可查询的消息记录和回复视图
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 68c741a9fccbce8a563837dfb7108f6fdd1f06fe
intent: 展示原消息 owner 的有界记录、来源、投递状态和回复，保留发送意图与草稿。
touchedAreas:
  - src/components/agents/SessionCollaborationMessages.tsx
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/stores/session-collaboration.ts
  - electron/services/sessions-api.ts
  - shared/i18n/locales/**/agents.json
  - tests/unit/session-collaboration-message-view.test.tsx
  - tests/e2e/session-collaboration-message-view.spec.ts
  - harness/specs/tasks/session-collaboration-b4.md
  - docs/modules/sessions.md
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
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
  - pnpm exec vitest run tests/unit/session-collaboration-message-view.test.tsx --maxWorkers=1 --no-file-parallelism
  - pnpm run test:e2e tests/e2e/session-collaboration-message-view.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-collaboration-b4.md
  - pnpm harness run --spec harness/specs/tasks/session-collaboration-b4.md --dry-run
acceptance:
  - 元数据分页显示原发件/收件 scope、用途、任务、状态和回复引用，展开后读取原正文和回复。
  - 来源和目标换代不会套用旧草稿或响应，明确接受才清空草稿，重复点击与 unknown 复用原意图。
  - 四语、键盘、焦点、主题和宽窄 Electron 旅程完整，原失败与未知可查询。
docs:
  required: true
  files:
    - docs/modules/sessions.md
---
# B4 消息阅读与发送

消息区只在展开后查询摘要，选中 ID 后取正文与原回执。发送源从 Main 活动 owner 预览，提交时再次核验 expectedSource。草稿按源目标完整 scope/generation 保存；unknown 保留原 ID 与内容并先查原回执。

开发继续；本轮不启动 UI 或产品验收。
