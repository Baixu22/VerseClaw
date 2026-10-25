---
lifecycleStatus: active
id: rareui-conversation-interactions
title: Compact Rare UI interactions in conversations and workspace previews
scenario: rareui-conversation-interactions
taskType: implementation
intent: Adapt six Rare UI interactions to existing session selection, turn navigation, Markdown preview, schedule editing, deletion confirmation, and completion activity without introducing runtime authority.
touchedAreas:
  - harness/specs/tasks/rareui-conversation-interactions.md
  - harness/specs/scenarios/rareui-conversation-interactions.md
  - harness/specs/rules/rareui-interaction-adaptation.md
  - src/components/rareui/**
  - src/components/chat/WorkspacePickerMenu.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/SidebarRow.tsx
  - src/components/file-preview/MarkdownPreview.tsx
  - src/components/file-preview/FilePreviewBody.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Chat/MessageNavRail.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - src/pages/Cron/index.tsx
  - src/styles/rareui-interactions.css
  - src/styles/codex-sidebar.css
  - src/styles/globals.css
  - .gitignore
  - scripts/repository-artifacts.json
  - shared/i18n/locales/**
  - tests/e2e/rareui-interactions.spec.ts
  - tests/unit/rareui-interactions.test.tsx
  - tests/unit/chat-message-nav-rail.test.tsx
  - docs/dev/rareui-interactions.md
  - docs/dev/evidence/rareui-interactions/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - Project and session selection retain existing actions and gain a travelling hook indicator.
  - After more than three visible user turns, a narrow proximity rail appears at the boundary between the persistent sidebar and the main conversation area; hovering previews the prompt and response and clicking scrolls to that turn.
  - Markdown previews show a circular scroll indicator at the preview's bottom-right; clicking it expands a hierarchical rail TOC sized relative to the preview (never blanketing the text), and heading selection scrolls only the preview.
  - Schedule editing provides hours and minutes for daily, weekly, and monthly cron times and preserves untouched cron/every/at schedule fields through the existing host contract.
  - The animated delete affordance opens confirmation and cannot delete on its first click.
  - A bell in the persistent sidebar header, above the projects/conversations section, records completed activity, opens newest-first items, and navigates to the corresponding run or session.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - rareui-interaction-adaptation
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm run i18n:lint
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm exec vitest run tests/unit/rareui-interactions.test.tsx tests/unit/chat-message-nav-rail.test.tsx
  - pnpm run test:e2e:run tests/e2e/rareui-interactions.spec.ts
acceptance:
  - All six interactions are reachable in production UI using existing stores and host calls.
  - Three turns do not show the proximity rail; four turns do, including prompt and assistant output previews.
  - The proximity rail sits at the sidebar/main-area boundary, targets only mounted message anchors, and preserves transcript scrolling, composer access, and readable content width.
  - Markdown heading IDs remain unique with duplicate labels, fenced code is absent from the TOC, and nested headings use a stepped rail.
  - Editing a schedule preserves its type and existing fields until the user explicitly changes them.
  - Failed deletion never displays a successful deletion state; opening or cancelling makes no delete host call.
  - Completion entries are sourced from completed runtime runs or existing assistant responses, not timers or fabricated progress.
  - Light, dark, narrow, keyboard, and reduced-motion states are verified in real Electron screenshots marked driven_by agent.
  - Copied Rare UI source retains its copyright, full license, and visible project attribution.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
    - docs/dev/rareui-interactions.md
---

Renderer-only adaptation. `gateway-backend-communication` remains the contract for the existing host API; this task does not add routes or change delivery, transport, runtime policies, or product locks.
