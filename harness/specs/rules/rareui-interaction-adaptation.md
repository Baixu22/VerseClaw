---
id: rareui-interaction-adaptation
title: Rare UI adaptation boundaries
type: rule
appliesTo:
  - rareui-conversation-interactions
pathPatterns:
  - src/components/rareui/**
  - src/styles/rareui-interactions.css
  - src/pages/Chat/MessageNavRail.tsx
  - src/pages/Settings/index.tsx
requiredTests:
  - tests/e2e/rareui-interactions.spec.ts
  - tests/e2e/settings-drawer.spec.ts
  - tests/unit/rareui-interactions.test.tsx
---

- Adapt source locally to React/Vite and existing compact grayscale surface tokens. Do not import Next.js or install dependencies solely for icon morphing.
- Preserve Rare UI copyright and license alongside adapted components and credit the project in the README.
- Motion belongs to the indicator or icon; conversation text and existing sidebar hit areas keep their layout.
- Rail appears only after more than three real user prompts; navigation is scoped to mounted anchors in the conversation scroller.
- Tooltips include a bounded plain-text response excerpt, never raw hidden reasoning, internal tool output, or HTML.
- Markdown headings derive from the rendered AST and IDs are scoped to each preview instance; scrolling affects only that preview.
- Schedule controls preserve existing cron/every/at semantics and validation; never coerce an unedited schedule on save.
- Delete controls require confirmation and await successful host effects before reporting success.
- Completion notifications use actual completed run/response state and sort newest first; empty states remain truthful.
- Theme previews declare their own palette per miniature, so the light option stays light while the app is dark; System shows a genuine light/dark split.
- Accessible names use four-locale i18n; keyboard focus, Escape, reduced-motion, dark mode, and narrow layout retain all actions.

## Progress surfaces

When a Rare UI progress affordance is adapted into chat, prefer the existing ReactBits CallChip left-to-right wash over arc/ring progress unless the owning task spec explicitly requires otherwise. Keep the original attribution header, reduced-motion fallback, and content-width bounds.
