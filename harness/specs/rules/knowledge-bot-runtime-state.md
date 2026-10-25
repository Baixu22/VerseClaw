---
id: knowledge-bot-runtime-state
title: Knowledge character reflects observed work
type: rule
pathPatterns:
  - src/components/knowledge-bot/**
  - src/pages/Chat/KnowledgeChat.tsx
requiredTests:
  - tests/unit/knowledge-bot.test.tsx
  - tests/e2e/knowledge-bot.spec.ts
---

Character state is a renderer projection of actual knowledge requests, input
focus, pointer gestures and their outcomes. Do not infer private reasoning or
sentiment from text, fabricate tool activity or animate fake streamed tokens.
Only explicit knowledge actions may create drafts or submit review; character
gestures confer no write permission. Keep the approved silhouette and solid.
Reduced motion settles a pose; hidden, offscreen and unmounted instances stop
their frame loops. Capture cancellation never opens the conversation.
