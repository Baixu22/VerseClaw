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
7. Paste Markdown with a task list, a standalone GitHub repository URL and an inline issue reference. The prompt keeps its bubble and each element renders in place.
8. Follow a recognized session ID to a long message. Expand the preview with the keyboard, read the last line and collapse it again.
9. Use a synthetic API key. The message and its copies mask the key, and the composer sends the original value.
10. Paste a known session ID or key by itself. Open the conversation from the one-line title, or edit the reference to recover the original value. Put the ID into a sentence and follow the compact entry in References. Switch the editing area to preview for Markdown, JSON and diff drafts and return to the original text.
11. Paste a synthetic key into the editor and copy just a few characters inside its value. The editor and clipboard show a mask. Confirm that composing text with an IME consumes the confirmation Enter.
12. Type one sentence about a repository, file, package, hex color and canvas size. Expand the References row, open the file and copy the color. Collapse the row and replace the repository in the editor. The summary follows the new repository and the unsent draft retains the original syntax.
13. Paste a GitHub repository or website by itself. The repository shows a compact GitHub pill and the site shows a text link with its favicon. Verify that icon reads use the origin alone and page preview reads begin after 500 ms of hover or focus. Edit the reference to recover the draft, hover the same link in References, and verify that sending a reference uses the original draft text.
14. Resize the composer to 375px and hover a site with a portrait cover. The preview stays at 16:9 within the viewport and the editor retains its height. Confirm that the site remains actionable when a preview is unavailable.

Run with agent-driven Electron automation against local fixtures and the real Main
file boundary. Record light and dark screenshots labelled agent-driven, without
claiming real-human evidence.
