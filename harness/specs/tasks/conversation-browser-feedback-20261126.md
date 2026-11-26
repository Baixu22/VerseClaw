---
id: conversation-browser-feedback-20261126
title: Improve conversation output, disclosure, bookmarks and workspace controls
lifecycleStatus: active
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
intent: Apply the owner's conversation typography, model and tool behavior, and annotated composer, workspace and settings feedback.
touchedAreas:
  - src/components/assistant-render/AssistantMarkdown.tsx
  - src/components/assistant-render/MarkdownSyntaxHighlight.tsx
  - src/components/assistant-render/model.ts
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Chat/ExecutionGraphCard.tsx
  - src/pages/Chat/execution-projection.ts
  - src/pages/Chat/task-visualization.ts
  - src/pages/Chat/tool-activity-groups.ts
  - src/styles/codex-tokens.css
  - tests/e2e/chat-assistant-markdown-plain.spec.ts
  - tests/unit/assistant-render-model.test.ts
  - tests/unit/chat-message.test.tsx
  - tests/unit/execution-projection.test.ts
  - harness/specs/tasks/chat-tool-activity-stream-20261123.md
  - harness/specs/fixtures/conversation-browser-feedback/20261126/**
  - src/pages/Chat/MessageNavRail.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ComposerGitStrip.tsx
  - src/components/assistant-render/ToolActivityGroup.tsx
  - src/components/assistant-render/TurnSummaryCard.tsx
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/pages/Settings/SettingsSidebar.tsx
  - src/components/ui/tooltip.tsx
  - src/components/settings/primitives/usePopover.ts
  - src/styles/codex-conversation.css
  - src/styles/codex-composer-shell.css
  - src/styles/codex-composer-material.css
  - src/styles/codex-workspace-panel.css
  - src/styles/rareui-interactions.css
  - shared/i18n/locales/*/chat.json
  - tests/unit/chat-message-nav-rail.test.tsx
  - tests/unit/tool-activity-group.test.tsx
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/workspace-browser-body.test.tsx
  - tests/e2e/rareui-interactions.spec.ts
  - tests/e2e/chat-tool-activity-stream.spec.ts
  - tests/e2e/conversation-browser-feedback.spec.ts
  - tests/e2e/chat-agent-effort.spec.ts
  - tests/e2e/chat-work-mode.spec.ts
  - tests/e2e/chat-composer-popovers.spec.ts
  - tests/e2e/visual-tune.spec.ts
  - tests/e2e/effort-intensity-smoke.spec.ts
  - harness/specs/tasks/conversation-browser-feedback-20261126.md
  - harness/specs/scenarios/windows-ui-v2.md
  - docs/dev/chat-tool-activity-stream.md
  - README*.md
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - ui-motion-material-system
  - i18n-locale-coverage
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Conversation prose uses 17px regular text with a 1.6 line height, native letter spacing, clear text and secondary activity ink.
  - Streaming Markdown keeps completed blocks stable, follows the writing endpoint and highlights completed code snippets.
  - Model thinking, tool result processing and writing follow the latest meaningful event. A failed parallel tool retains its own target while other work continues.
  - Tool arguments and results are shown once per field, including an equal-input result and receipts retained across answer-only history refreshes.
  - Tool groups open and close smoothly, support rapid reversal and render immediately with reduced motion.
  - Tool summaries are smaller than prose; elapsed-time labels use secondary text.
  - The composer model control opens the shared model and effort card without a separate flame glyph.
  - Turn previews expose a keyboard-accessible bookmark action. The rail marks saved turns and cycles through them.
  - Bookmarks persist by workspace, session generation and transcript identity across reloads and prepended history.
  - Workspace file headings distinguish file names from paths and expose full paths through the shared tooltip.
  - Workspace and settings navigation controls use the common tooltip. Conversation menus use the composer menu material.
  - The input prompt and file-change entry remain legible at narrow widths.
requiredTests:
  - pnpm exec vitest run tests/unit/chat-message-nav-rail.test.tsx tests/unit/tool-activity-group.test.tsx tests/unit/artifact-panel.test.tsx --maxWorkers=1
  - pnpm run i18n:lint
  - pnpm run typecheck:web
  - pnpm exec playwright test tests/e2e/conversation-browser-feedback.spec.ts --workers=1
acceptance:
  - Agent-driven ego-browser checks cover expanded and collapsed groups, bookmark persistence and jumping, file headings, model controls, menu surfaces and settings tooltips.
  - Electron verifies keyboard navigation, tooltip visibility, reduced motion and narrow layouts.
  - Curated agent-driven results and source hashes are retained under harness/specs/fixtures/conversation-browser-feedback/20261126/RESULT.json.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---
