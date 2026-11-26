---
lifecycleStatus: active
id: knowledge-bot-avatar
title: Knowledge assistant procedural character and conversation integration
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
intent: Integrate the approved Ginger solid character into Knowledge and bind its animation to the existing knowledge conversation and governed actions.
touchedAreas:
  - vite.config.ts
  - src/components/knowledge-bot/**
  - src/components/assistant-render/AssistantMarkdown.tsx
  - src/components/assistant-render/UserMessageBubble.tsx
  - src/pages/Knowledge/**
  - src/pages/Chat/KnowledgeChat.tsx
  - src/pages/Chat/ChatMessage.tsx
  - shared/i18n/locales/*/knowledge.json
  - tests/unit/knowledge-chat.test.tsx
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/knowledge-bot.test.tsx
  - tests/unit/chat-message.test.tsx
  - tests/e2e/knowledge-bot.spec.ts
  - tests/e2e/knowledge-ux-cdp.spec.ts
  - harness/specs/tasks/knowledge-bot-avatar.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/knowledge-bot-runtime-state.md
  - docs/dev/knowledge-bot.md
  - docs/dev/evidence/knowledge-bot/**
  - scripts/repository-artifacts.json
  - .gitignore
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - Knowledge shows the approved orange solid character; drag is limited to 112 pixels from its corner dock, with an elastic edge and snapback on out-of-range release.
  - Click or keyboard activation opens a compact nonmodal floating conversation without navigating away or obscuring the whole Knowledge page.
  - Conversation avatars follow actual retrieval, page reading, answer construction, source-set requests, draft creation, review, completion and failure.
  - Knowledge answers reuse the main Chat Markdown renderer and composer materials while keeping knowledge citations and governed actions.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
  - knowledge-bot-runtime-state
requiredTests:
  - pnpm exec vitest run tests/unit/knowledge-chat.test.tsx tests/unit/knowledge-page.test.tsx tests/unit/knowledge-bot.test.tsx
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/knowledge-bot.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The bundled renderer, animation recipes and closed solid come from the approved local showcase and load without a remote service or CDN.
  - A drag has a movement threshold, pointer capture, cancellation, a corner radius, out-of-range snapback and persisted in-range position; keyboard activation still opens the floating window.
  - The floating window is at most 400 by 520 pixels, nonmodal, closes on Escape, keeps the Knowledge page mounted and preserves the conversation and unsent input on close.
  - No visible brand, title or status banner repeats above the floating conversation; only clear/close controls remain, and the character belongs to messages and work/error indicators.
  - The compact conversation hides repeated role/time/checkpoint chrome, keeps suggested questions in a composer menu and candidate actions under Details; sources remain accessible with full paths on demand.
  - The floating surface keeps 40px outer offsets, symmetric composer insets and a 32px round minimize control separated from the edge; it opens in 180ms and closes in 140ms with transform/opacity only.
  - Interrupted transitions cannot hide a reopened panel; closing makes the surface inert, retains pending requests and restores launcher focus after completion. Reduced motion uses an 80ms opacity transition.
  - Animation states come from actual async call boundaries and composer focus; no simulated tokens, keyword sentiment or invented tool activity.
  - The existing source-backed, non-streaming answer is not represented as token streaming.
  - Historical answers settle; only the active answer or pending avatar follows live work.
  - The floating and standalone transcripts use the main Chat user bubble and full-width assistant Markdown. The companion sits below a reply so tables and code retain the full column.
  - Hovering over the idle companion invites its attention. Clicking, tapping or activating it with the keyboard elicits a brief celebration. A minimized launcher shows pending work and its outcome.
  - Reduced motion, hidden/offscreen suspension and unmount cleanup are implemented.
  - A real Electron automated interaction test records bounded drag, snapback, floating open/close, async transitions, retry, shared Markdown and light/dark/narrow screenshots as agent driven evidence.
docs:
  required: true
  files:
    - docs/dev/knowledge-bot.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This is one renderer feature on the existing Knowledge workstream. Existing host
contracts, knowledge write authority and product locks remain authoritative.
