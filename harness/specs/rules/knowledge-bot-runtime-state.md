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

Petting is local presentation state. Only the empty conversation and the latest
idle reply offer it. A request replaces that interaction with its actual state,
including on the minimized launcher. Earlier replies retain static avatars.

Knowledge records retain the source set and workspace that initiated each question.
Returning a reply to Chat requires explicit selection of a turn. Store its delivery
receipt with that turn after the target accepts it. An unconfirmed retry uses the
same destination and idempotency key.

Inline mentions and the Knowledge conversation share the request owner and result.
Only Main-reported phases add search, read, synthesis or verification activity.
Correlate progress by request ID and unsubscribe after completion. A restored
pending record without its live request displays interrupted status.
