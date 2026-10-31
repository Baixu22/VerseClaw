---
id: conversation-resource-rendering
title: Conversation resource rendering
type: scenario
requiredRules:
  - conversation-resource-boundary
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
pathPatterns:
  - src/pages/Chat/conversation-resources.ts
  - src/pages/Chat/message-render-projection.ts
  - src/components/assistant-render/resources/**
  - src/components/tool-ui/chart/**
  - src/components/file-preview/MediaPreview.tsx
---

# Conversation resource rendering

1. Open a conversation whose history holds text, audio, video, images, a gallery, a
   chart, weather, web-search sources, a document, a website link and an unknown
   structured resource.
2. Every resource appears in its turn, including one whose only content is a
   resource and one whose turn is folded into the execution summary.
3. Play audio and video with native controls. Open a video in the side panel.
4. Remove or corrupt a media file and reload: the card reports not found or
   unsupported, and offers a recovery action.
5. Remote images and media make no request until the user opens them externally.
6. Reload the history. The same resources appear once each.

Run with agent-driven Electron automation against local fixtures and the real Main
file boundary. Record light and dark screenshots labelled agent-driven, without
claiming real-human evidence.
