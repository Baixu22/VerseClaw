---
id: chat-tool-activity-stream-20261123
title: 按会话顺序折叠工具操作并显示实时摘要
lifecycleStatus: active
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
diffBase: 082cd50b8474bca55c0e36b7e36db31d906a586b
intent: 参照用户提供的 Codex 截图，让正文与输入框共享会话宽度，相邻工具操作默认折叠，折叠行显示当前真实动作与对应图标，运行时使用白色 shimmer。
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - i18n-locale-coverage
  - ui-motion-material-system
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
  - e2e
touchedAreas:
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ExecutionGraphCard.tsx
  - src/pages/Chat/tool-activity-groups.ts
  - src/pages/Chat/task-visualization.ts
  - src/components/assistant-render/ToolActivityGroup.tsx
  - src/components/assistant-render/TurnSummaryCard.tsx
  - src/components/chat/ComposerDecisionSurface.tsx
  - src/styles/codex-conversation.css
  - src/components/tool-ui/RunTerminalSurfaces.tsx
  - src/components/tool-ui/run-surfaces.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/tool-activity-groups.test.ts
  - tests/unit/tool-activity-group.test.tsx
  - tests/unit/task-visualization.test.ts
  - tests/unit/tool-ui-run-surfaces.test.ts
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/chat-render-reachability.test.tsx
  - tests/e2e/chat-tool-activity-stream.spec.ts
  - tests/e2e/chat-turn-summary-collapse.spec.ts
  - tests/e2e/chat-tool-ui-execution-surfaces.spec.ts
  - tests/e2e/chat-composer-git-strip.spec.ts
  - harness/specs/tasks/chat-tool-activity-stream-20261123.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/ui-motion-material-system.md
  - harness/specs/fixtures/chat-tool-activity-stream/20261123/**
  - docs/dev/chat-tool-activity-stream.md
  - README*.md
  - scripts/repository-artifacts.json
  - .gitignore
expectedUserBehavior:
  - 正文、工具组与输入框共享可用会话宽度，宽屏和窄窗保持相同左右边界；打开工作区面板后按剩余会话宽度响应。
  - 可读的助手说明保留在会话中，每段相邻工具操作在对应说明后形成独立折叠组；新的说明开始下一组。
  - 组默认折叠。运行期间显示最新正在执行的动作与目标；完成后显示实际执行过的操作类别，静态保留。
  - 文件读取、写入/编辑、网页访问、搜索、命令和其他工具有明确的单色图标；新运行图标只播放一次白色扫光，运行摘要持续 shimmer。
  - 展开后按原顺序查看保留的工具调用、参数和结果；命令输出、文件修改复用已有查看器。同一操作的结果和命令输出只有一个所属组。
  - 审批与交互请求继续通过现有入口处理；失败摘要直接可见，最终答复和交付资源在会话中可访问。
  - 手动折叠状态按会话、运行与稳定工具身份隔离；后续事件不会自行展开，切换会话不继承别的组状态。
  - 展开时仅详情中的当前操作显示运行动画；关闭动画偏好后保留可读静态文本。
acceptance:
  - 分组、配对、实时状态、迟到结果和会话隔离通过定向单测。
  - Agent 驱动的 Electron 旅程覆盖历史与运行中两组操作、展开结果、完成静态、长路径和命令、四语、明暗主题、375px 窄窗、键盘与减少动态效果。
  - 正文和输入框的边界通过实际窗口几何断言，展开日志不扩大页面宽度。
  - Carbon 实际查看用户参考与首版截图，负责主要视觉收敛，意见、用量和最终落实可从产物读回；调用使用现有模型守卫。
  - 当前干净候选的回归、类型、四语、通信、Harness 与构建通过，最终截图、失败回执和哈希绑定保留。
requiredTests:
  - pnpm exec vitest run tests/unit/tool-activity-groups.test.ts tests/unit/tool-activity-group.test.tsx tests/unit/chat-page-execution-graph.test.tsx tests/unit/chat-render-reachability.test.tsx --maxWorkers=1
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-tool-activity-stream.spec.ts tests/e2e/chat-turn-summary-collapse.spec.ts tests/e2e/chat-tool-ui-execution-surfaces.spec.ts tests/e2e/chat-composer-git-strip.spec.ts --workers=1 --retries=0
docs:
  required: true
  files:
    - docs/dev/chat-tool-activity-stream.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

分组消费现有消息、工具步骤与运行回执；权限决策、调用、重试和任务状态继续由现有 owner 处理。视觉和交互验证均由 agent 驱动。
