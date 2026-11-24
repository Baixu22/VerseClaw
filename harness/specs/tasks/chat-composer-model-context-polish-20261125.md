---
id: chat-composer-model-context-polish-20261125
title: 模型强度卡片与真实上下文来源统一优化
lifecycleStatus: active
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
diffBase: 1f87f31d5d7064e97b53eed03d1f12862ff43fc3
intent: 紧凑排列模型与强度滑块，移除搜索内框，用纯线条呈现上下文用量和真实来源；Codex完成数据和初版后由Carbon直接优化视觉代码。
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
  - src/components/chat/ChatContextIndicator.tsx
  - src/components/chat/ChatModelSettingsCard.tsx
  - src/components/chat/ChatModelPicker.tsx
  - src/styles/chat-model-settings.css
  - src/styles/codex-composer-shell.css
  - electron/services/usage-api.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/usage-live-scope.test.ts
  - tests/unit/chat-context-indicator.test.tsx
  - tests/e2e/chat-context-display.spec.ts
  - tests/e2e/chat-model-settings-card.spec.ts
  - tests/e2e/chat-composer-model-context.spec.ts
  - tests/e2e/fixtures/composer-context-report.ts
  - harness/specs/tasks/chat-context-display-20261124.md
  - harness/specs/tasks/chat-model-effort-picker-20261124.md
  - harness/specs/tasks/chat-composer-model-context-polish-20261125.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/ui-motion-material-system.md
  - harness/specs/fixtures/chat-composer-model-context/**
  - docs/dev/chat-model-selection.md
  - docs/modules/context-and-memory.md
  - README*.md
expectedUserBehavior:
  - 强度Tooltip显示在模型行上层；模型和滑块间距不超过16px，覆盖处模型仍可点击。
  - 模型列表覆盖强度卡片时滑块和Tooltip隐藏且不可交互，搜索输入在聚焦时没有内框。
  - 上下文入口仅有纯线条圆环，详情组成进度为2px细线，标题、用量和关闭入口固定。
  - 展开的文件、工具和技能计量来自当前会话运行报告，字符份额与Token用量明确区分。
  - 模型卡片和上下文详情在明暗主题、375px与桌面窗口中保持边界、字号和间距比例。
acceptance:
  - 真实文件经运行时报告生成器、会话索引、Main接口和Renderer显示；文件修改后计量变化有来源哈希与截图。
  - 生产接口不把缺少测量的计数写成0，缺少用量或报告时显示未知状态。
  - 记忆回执按会话来源和真实时间展示；报告生成前已记录的注入可查阅，未提供报告关联标识时不声称其属于当前报告。
  - 实际Electron操作检查纯线条、搜索无框、Tooltip点击穿透、来源展开和相邻菜单切换。
  - Carbon看图后直接修改CSS或JSX，保存真实修改、守卫记录和usage；Codex复核diff并重新截图验收。
  - 定向单测、完整类型、四语、contract、comms、构建及所选Harness通过。
requiredTests:
  - pnpm exec vitest run tests/unit/session-context.test.ts tests/unit/usage-live-scope.test.ts tests/unit/chat-context-indicator.test.tsx tests/unit/chat-model-settings-card.test.tsx tests/unit/chat-agent-effort-popover.test.tsx tests/unit/chat-input.test.tsx tests/unit/chat-model-selection.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run i18n:lint
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-composer-model-context.spec.ts tests/e2e/chat-model-settings-card.spec.ts tests/e2e/chat-context-display.spec.ts tests/e2e/chat-agent-effort.spec.ts --workers=1 --retries=0
docs:
  required: true
  files:
    - docs/dev/chat-model-selection.md
    - docs/modules/context-and-memory.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

本轮接续模型选择与上下文展示的已落地实现。报告展示沿用现有只读Main接口，保留身份、代次与陈旧读数校验。验收记录明确区分agent生成的文件输入、实际Main投影和生产会话的安全元数据。
