---
id: chat-running-activity-icons-20261124
title: 仅在当前运行的折叠工具摘要中播放动态图标
lifecycleStatus: active
scenario: windows-ui-v2
taskType: implementation
diffBase: c76f588f3e1e56441522a0ce0560ec9515d4098f
intent: 采用 AnimateIcons 的 Lucide 路径动效风格，让正在 shimmer 的折叠摘要图标循环播放；其余行为图标保持静态。
requiredRules:
  - ui-motion-material-system
  - i18n-locale-coverage
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - e2e
residualPaths:
  - docs/dev/chat-model-selection.md
  - harness/specs/tasks/chat-activity-bell-unread-status-20261120.md
  - harness/specs/tasks/chat-effort-preview-slider-20261124.md
  - openclaw_runtime/pnpm-workspace.yaml
  - src/components/chat/ChatAgentEffortPopover.tsx
  - src/components/chat/EffortPreviewSlider.tsx
  - tests/e2e/chat-agent-effort.spec.ts
  - tests/unit/chat-agent-effort-popover.test.tsx
touchedAreas:
  - src/components/assistant-render/ToolActivityGroup.tsx
  - src/styles/codex-conversation.css
  - tests/unit/tool-activity-group.test.tsx
  - tests/e2e/chat-tool-activity-stream.spec.ts
  - harness/specs/tasks/chat-running-activity-icons-20261124.md
  - harness/specs/tasks/chat-tool-activity-stream-20261123.md
  - harness/specs/rules/ui-motion-material-system.md
  - harness/specs/scenarios/windows-ui-v2.md
  - docs/dev/chat-tool-activity-stream.md
  - README*.md
expectedUserBehavior:
  - 仅当前运行组的折叠摘要图标与运行文字一起显示动效，使用现有单色 Lucide 轮廓和固定图标尺寸。
  - 展开摘要、后台组、完成、停止、失败和等待结果时，行为图标静态显示；悬停不会启动图标动画。
  - 同一调用的日志追加保持动画连续，切换最新调用时更新语义图标。
  - 减少动态效果偏好下，图标与文字保持静态可读。
acceptance:
  - 定向组件回归核对折叠运行、展开、完成、停止、失败、后台组和调用切换的图标状态。
  - Agent 驱动的 Electron 旅程核对实际图标动画、折叠切换、完成静态、悬停和减少动态效果。
  - 定向回归、类型检查、构建与所选 Harness 验证通过。
requiredTests:
  - pnpm exec vitest run tests/unit/tool-activity-group.test.tsx tests/unit/tool-activity-groups.test.ts tests/unit/chat-page-execution-graph.test.tsx --maxWorkers=1
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-tool-activity-stream.spec.ts --grep "current white shimmer" --workers=1 --retries=0
docs:
  required: true
  files:
    - docs/dev/chat-tool-activity-stream.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# 运行中的行为图标

图标动画使用与折叠运行文字相同的当前调用条件。展开调用条保留进度填充与计时，图标使用静态 Lucide。动画随调用状态和折叠状态直接切换，并遵循减少动态效果偏好。
