---
id: chat-model-effort-picker-20261124
title: 用紧凑强度卡片和展开模型列表统一会话模型选择
lifecycleStatus: active
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
diffBase: c76f588f3e1e56441522a0ce0560ec9515d4098f
intent: 点击模型入口先显示当前强度、模型与官方Preview Slider交互，再从模型行展开Rare UI列表并隐藏滑块；头像浮层改为本地化强度文字Tooltip，前置开发由Codex完成，集中交Carbon优化视觉细节。
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
  - src/pages/Chat/ChatInput.tsx
  - src/components/chat/ChatModelSettingsCard.tsx
  - src/components/chat/ChatModelPicker.tsx
  - src/components/chat/ChatAgentEffortPopover.tsx
  - src/components/chat/EffortPreviewSlider.tsx
  - src/styles/chat-model-settings.css
  - shared/i18n/locales/*/chat.json
  - tests/unit/chat-model-settings-card.test.tsx
  - tests/unit/chat-agent-effort-popover.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-model-selection.test.ts
  - tests/e2e/chat-agent-effort.spec.ts
  - tests/e2e/chat-model-settings-card.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - harness/specs/tasks/chat-model-effort-picker-20261124.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/ui-motion-material-system.md
  - harness/specs/fixtures/chat-model-effort-picker/20261124/**
  - docs/dev/chat-model-selection.md
  - README*.md
expectedUserBehavior:
  - 首次点击会话模型入口显示当前强度文字、重置为自动按钮、当前模型和Preview Slider。
  - 模型行使用Rare UI搜索、提供商分组和选中标记，并从当前模型位置展开；模型层期间强度标题、滑块及其Tooltip隐藏且不可交互，布局保留。
  - 模型数据来自当前配置，选择沿用现有会话模型写入、缓存提示、忙态、错误和身份隔离流程。
  - 滑块保留弹簧跟随、倾斜、边缘弹性和松手提交；原头像浮层显示四语强度文字，七种强度与现有存储一致。
  - 搜索、方向键、Enter、Escape、Tab、四语、明暗、375px和减少动态效果可操作；模型层关闭后恢复强度卡片。
  - 卡片保持紧凑比例，模型列表在提供商分组下只显示模型名，搜索框使用中性灰焦点而不出现蓝色框；滑块文字Tooltip与模型行保持分离。
acceptance:
  - 真实模型引用选择、搜索、禁用、状态隔离、滑块提交和重置有自动检查。
  - agent驱动的Electron截图与交互证明两层切换、滑块及Tooltip隐藏、键盘和实际窄窗边界。
  - Carbon实际查看参考及已验证初版，集中返回视觉判断和有限调整，回执与用量可回读。
  - 类型、四语、契约、通信、构建、所选Harness与源码绑定通过，失败记录保留。
requiredTests:
  - pnpm exec vitest run tests/unit/chat-model-settings-card.test.tsx tests/unit/chat-agent-effort-popover.test.tsx tests/unit/chat-input.test.tsx tests/unit/chat-model-selection.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-model-settings-card.spec.ts tests/e2e/chat-agent-effort.spec.ts --workers=1 --retries=0
docs:
  required: true
  files:
    - docs/dev/chat-model-selection.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

模型列表参考Rare UI的公开Model Picker；滑块参考所有者给定的preview-slider-official-runtime.html。显示状态消费现有模型和agent强度数据，持久化继续经原owner完成。模型、能力和评分仅使用实际可用数据。
