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
  - src/components/assistant-render/WebsiteLink.tsx
  - electron/services/link-preview.ts
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
- Remote image and media attachments load through explicit actions. Keep CSP `img-src` restricted to local image sources, data and blobs. Website links use the Main service for favicons and raster previews. Website HTML opens externally.
- Revoke every Blob URL on unmount and on source change.
- A turn renders each media resource once.
- Resolve chat references against an unambiguous ID or key from the loaded session list. Show the conversation name in a single line, with the full name and source identifier available on hover. Preserve existing links and literal code blocks.
- Mask recognized credentials before producing message previews, links, code blocks and clipboard text. Editing and sending use the original message.
- Compute a draft selection's mask against the complete draft. Partial selections can start inside a key, beyond its recognizable prefix. Preview rendering must preserve the original editor value, caret and send payload.
- Draft reference cards derive their labels locally, resolve files relative to the current workspace, leave fenced examples literal and use the external navigation policy for explicit opens.
- A standalone composer reference takes the place of the visible editor. Return focus to the original draft when editing resumes.
- Visible website links may request a bounded raster favicon through the typed host API using the site's origin. Thumbnails require 500 ms of hover or keyboard focus and are rendered in a floating preview. Main checks public destinations across redirects and responds with bounded image data. GitHub repository pills derive their icon and owner/repo locally.
- An artifact does not have to come from the runtime's own tools; a file an external tool wrote during the turn is that turn's output. A path found in tool output counts only if the file exists and was written during the turn, so listing old files shows nothing. Tool-declared media uses the `tool-media` source and reports its own errors instead.
- Do not invent runtime shapes. A shape with no producer in the repository is labelled a compatibility layer in the task matrix.
- Unknown resources must not expose credentials or raw payloads. Diagnostics may record the block type and field names, not values.
- Charts must draw the declared type. Anything that cannot be drawn degrades to a labelled data table.
