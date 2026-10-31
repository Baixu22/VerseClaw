---
id: conversation-resource-boundary
title: Conversation resource boundary
type: ai-coding-rule
appliesTo:
  - conversation-resource-rendering
pathPatterns:
  - src/pages/Chat/conversation-resources.ts
  - src/pages/Chat/message-render-projection.ts
  - src/components/assistant-render/resources/**
  - src/components/tool-ui/chart/**
  - src/components/file-preview/MediaPreview.tsx
requiredTests:
  - tests/unit/conversation-resources.test.ts
  - tests/unit/conversation-resource-cards.test.tsx
  - tests/e2e/chat-conversation-resources.spec.ts
---

- `MessageRenderProjection` is the only authority for whether a message has resources to show. Do not add a second visibility check.
- A resource must render, or show an explicit unavailable or unsupported state. Silent `return null` for a resource is a defect.
- Local bytes reach the renderer only through `readBinaryFile`. Gateway URLs are resolved by Main through `media.thumbnails`. Never set a `file://` or Gateway URL as a media source, and never fetch one from the renderer.
- Remote images and media are not loaded automatically. CSP `img-src` deliberately omits http(s); do not widen it, and do not embed arbitrary websites in the conversation.
- Revoke every Blob URL on unmount and on source change.
- A turn renders each media resource once.
- An artifact does not have to come from the runtime's own tools; a file an external tool wrote during the turn is that turn's output. A path found in tool output counts only if the file exists and was written during the turn, so listing old files shows nothing. Tool-declared media uses the `tool-media` source and reports its own errors instead.
- Do not invent runtime shapes. A shape with no producer in the repository is labelled a compatibility layer in the task matrix.
- Unknown resources must not expose credentials or raw payloads. Diagnostics may record the block type and field names, not values.
- Charts must draw the declared type. Anything that cannot be drawn degrades to a labelled data table.
