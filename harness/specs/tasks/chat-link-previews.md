---
id: chat-link-previews
title: GitHub 仓库引用与网页悬停预览
lifecycleStatus: active
scenario: gateway-backend-communication
scenarios:
  - conversation-resource-rendering
  - windows-ui-v2
taskType: runtime-bridge
diffBase: c932dfb554ae318cb50c20a9d4f8d9b78d56fca5
intent: 在草稿和会话正文中用胶囊展示仓库，用普通链接和站点图标展示网址，停留后显示预览图。
touchedAreas:
  - harness/specs/tasks/chat-link-previews.md
  - harness/specs/scenarios/conversation-resource-rendering.md
  - harness/specs/rules/conversation-resource-boundary.md
  - electron/services/link-preview.ts
  - electron/services/media-api.ts
  - shared/host-api/contract.ts
  - shared/security/link-preview.ts
  - package.json
  - pnpm-lock.yaml
  - shared/i18n/locales/*/chat.json
  - src/components/assistant-render/WebsiteLink.tsx
  - src/components/assistant-render/AssistantMarkdown.tsx
  - src/components/assistant-render/GitHubCard.tsx
  - src/components/assistant-render/MessageReferences.tsx
  - src/components/assistant-render/UserMessageBubble.tsx
  - src/components/assistant-render/resources/ResourceCards.tsx
  - src/components/chat/ComposerDraftPreview.tsx
  - src/components/chat/DraftReferenceRow.tsx
  - src/lib/chat-display-text.ts
  - src/lib/composer-references.ts
  - src/lib/github-link.ts
  - src/lib/host-api.ts
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Chat/conversation-resources.ts
  - src/styles/codex-conversation.css
  - src/styles/codex-composer-shell.css
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-message.test.tsx
  - tests/unit/composer-references.test.ts
  - tests/unit/conversation-resource-cards.test.tsx
  - tests/unit/github-card.test.tsx
  - tests/unit/link-preview-api.test.ts
  - tests/e2e/chat-link-previews.spec.ts
  - tests/e2e/chat-assistant-markdown-plain.spec.ts
  - tests/e2e/chat-conversation-resources.spec.ts
  - README*.md
requiredRules:
  - conversation-resource-boundary
  - backend-communication-boundary
  - comms-regression
  - renderer-main-boundary
  - i18n-locale-coverage
  - ui-motion-material-system
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - 单独粘贴仓库名或网址时，在编辑区显示对应引用。编辑按钮或 Esc 恢复原文和焦点，手动输入可主动切换。句中链接保持行内，引用列表使用相同样式。
  - 仓库胶囊显示 GitHub 图标和 owner/repo。普通网址显示站点图标与链接，悬停或聚焦 500 ms 后呈现可用的 16:9 预览图。
  - 单独粘贴已识别的会话 ID 或会话键会显示单行会话名。点击名称可跳转，编辑入口恢复原文。消息和引用列表中的会话引用保留紧凑的单行入口。
  - 预览结果归属当时的链接。慢请求、请求失败和无图时保留静态信息及原有打开动作。
requiredTests:
  - pnpm exec vitest run tests/unit/link-preview-api.test.ts tests/unit/github-card.test.tsx tests/unit/chat-input.test.tsx tests/unit/chat-message.test.tsx tests/unit/composer-references.test.ts tests/unit/conversation-resources.test.ts tests/unit/conversation-resource-cards.test.tsx
  - pnpm run i18n:lint
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run typecheck
  - pnpm run test:e2e:run tests/e2e/chat-link-previews.spec.ts tests/e2e/chat-assistant-markdown-plain.spec.ts tests/e2e/chat-conversation-resources.spec.ts
  - pnpm run test:e2e:run tests/e2e/appearance-personalization.spec.ts
acceptance:
  - 草稿只显示引用或原文其中一种。切换回原文可继续输入，直接发送引用使用原始文本。
  - 编辑按钮的铅笔图标为 12 px，按钮的点击区域为 24 × 24 px。
  - 可见网址的图标请求只传入站点 origin，完整网页地址在达到停留时间后读取。GitHub 仓库胶囊仅使用本地数据。主进程对请求与重定向执行相同的网络检查。
  - 明暗及 375 px 窄窗中预览浮层保持 16:9，宽度至多 208 px。浮层出现或关闭时，链接和编辑区尺寸保持稳定。
  - Electron 和浏览器使用 agent 驱动的公开 URL 或模拟数据。
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---
