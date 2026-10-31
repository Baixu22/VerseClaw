---
lifecycleStatus: active
id: chat-conversation-resource-rendering
title: Complete and reliable conversation resource rendering
scenario: conversation-resource-rendering
intent: Make every conversation resource visible with an explicit loading, failure and fallback behaviour by extending the existing MessageRenderProjection and ChatMessage, without changing transport, adding dependencies, or inventing runtime protocol.
touchedAreas:
  - harness/specs/tasks/chat-conversation-resource-rendering.md
  - harness/specs/scenarios/conversation-resource-rendering.md
  - harness/specs/rules/conversation-resource-boundary.md
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - electron/services/media-api.ts
  - src/lib/generated-files.ts
  - src/stores/chat.ts
  - src/stores/chat/helpers.ts
  - src/stores/chat/runtime-graph.ts
  - src/pages/Chat/conversation-resources.ts
  - src/pages/Chat/message-utils.ts
  - src/pages/Chat/message-render-projection.ts
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Chat/index.tsx
  - src/components/assistant-render/AssistantMarkdown.tsx
  - src/components/assistant-render/resources/**
  - src/components/tool-ui/agent-interactions.tsx
  - src/components/tool-ui/chart/**
  - src/components/file-preview/FilePreviewBody.tsx
  - src/components/file-preview/MediaPreview.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/components/file-preview/WorkspaceLiveBrowserPanel.tsx
  - src/styles/codex-conversation.css
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/conversation-resources.test.ts
  - tests/unit/conversation-resource-cards.test.tsx
  - tests/unit/conversation-resource-history.test.ts
  - tests/unit/tool-ui-chart.test.tsx
  - tests/unit/chat-message.test.tsx
  - tests/unit/chat-assistant-media-display.test.ts
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/workspace-browser-body.test.tsx
  - tests/unit/media-api.test.ts
  - tests/unit/chat-render-reachability.test.tsx
  - tests/e2e/chat-conversation-resources.spec.ts
  - tests/e2e/fixtures/conversation-resource-fixtures.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - Every resource a turn produces is visible in that turn, or is shown as an explicit unsupported or unavailable state; nothing disappears silently.
  - Audio and video play in the conversation through native controls, with name, type, size and duration; bytes come only through the Main-owned file boundary and are released when the card unmounts.
  - An artifact produced during the session by any tool, including an external system the agent drives, gets the same display as one from the runtime's own generators.
  - Images from base64, local paths, Gateway media, Markdown and galleries share one resolver, one failure state and one lightbox. Remote images are never fetched automatically and always offer an open path.
  - Charts render the declared type; a type or payload that cannot be drawn degrades to a data table or a labelled card rather than a different chart.
  - Standalone website links become safe link cards and are distinct from web-search sources and from the side-panel web preview.
  - Unknown structured resources keep their type, title, description and safe location, with copy and safe-open actions, and never expose credentials or the raw payload.
  - A message that carries only resources stays visible, including when its turn is folded into the execution summary; a message whose resources all fail validation leaves no orphan avatar.
requiredRules:
  - conversation-resource-boundary
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
requiredProfiles:
  - fast
  - e2e
requiredTests:
  - pnpm exec vitest run tests/unit/conversation-resources.test.ts tests/unit/conversation-resource-cards.test.tsx tests/unit/conversation-resource-history.test.ts tests/unit/tool-ui-chart.test.tsx tests/unit/chat-message.test.tsx tests/unit/chat-assistant-media-display.test.ts tests/unit/file-preview-body.test.tsx tests/unit/workspace-browser-body.test.tsx tests/unit/media-api.test.ts
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/chat-conversation-resources.spec.ts
acceptance:
  - The matrix below states an integrity level for every resource type and names the evidence for its runtime shape; any shape without a producer in the repository is labelled as a compatibility layer.
  - Renderer code adds no direct IPC, Gateway HTTP access, `file://` source or network image load. Local bytes use `readBinaryFile`; Gateway URLs are resolved by Main through `media.thumbnails`.
  - Each Blob URL created for media is revoked on unmount and on source change.
  - One message owns each media resource and a turn renders each media resource once, across attachment cards, content blocks and the execution summary.
  - Automated histories and screenshots are labelled agent-driven; they do not establish live-model quality, human review or product acceptance.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

# Conversation resource rendering

The owner requested this on 2026-10-30. It is renderer presentation plus one
additive Main result field; transport, Gateway, runtime and product locks are
unchanged. Automated evidence is agent-driven (`driven_by: agent`) and is not
real-human evidence.

## Verified starting state

Each row was re-verified against production code, not a previous audit.
`src/stores/chat.ts` is the store Electron runs. Its comment in
`chat/history-actions.ts` confirms the split store's history path is not active,
so a fix made only in `chat/helpers.ts` does not reach the app.

| # | Risk | Verified result | Evidence |
|---|------|-----------------|----------|
| 1 | Audio/video exist only as MIME, icon and file card | Confirmed | `attachment.tsx` `FileIcon`, `generated-files.ts` classification, `ChatMessage.tsx` `FileCard` |
| 2 | No native player in the conversation | Confirmed; no `<audio>` or `<video>` anywhere under `src/` | `grep` over `src/**/*.tsx` |
| 3 | `FilePreviewBody` renders a player | Refuted; audio/video fall through to "No preview available" | `FilePreviewBody.tsx` preview tab final branch |
| 4 | `WorkspaceBrowserBody` misroutes media to Monaco | Confirmed; marked ready, then an empty Monaco | `WorkspaceBrowserBody.tsx` final return |
| 5 | Audio/video blocks are dropped | Confirmed; `{type:'attachment'}` is produced by the Gateway and read by nothing here | `chat-webchat-media.ts:118`, `ContentBlock`, `extractImages`, `extractText` |
| 6 | Remote Markdown images return null | Confirmed, and worse: inline syntax is removed by `stripAssistantMediaTags` before the renderer sees it | `message-utils.ts`, `AssistantMarkdown.tsx` |
| 7 | `image-gallery` bypasses resolution | Confirmed; a bare `<img>`, and CSP `img-src` blocks remote sources, so it shows a broken image with no feedback | `agent-interactions.tsx`, `index.html`, `url-policy.ts` |
| 8 | Chart types not honoured | Confirmed; only pie branches, line and area draw bars; `normalizeType(a) ?? normalizeType(b)` never reaches `chart_type` because `normalizeType` always returns a string | `agent-interactions.tsx` `parseChart`, `ChartCard` |
| 9 | Links only open externally; web preview is separate | Confirmed; GitHub is the only card, web preview is a side panel | `AssistantMarkdown.tsx`, `WorkspaceBrowserPanel.tsx` |
| 10 | Resource-only messages can vanish | Confirmed in three places: `hasRenderableContent` ignores media blocks, folding filters audio/video tool attachments, and thinking+media is classed internal | `message-render-projection.ts`, `ChatMessage.tsx`, `helpers.ts` |

Found while verifying, not in the prior audit:

- `chat.ts` lacks two fixes present only in `chat/helpers.ts`: Markdown Gateway
  image extraction, and the guard stopping `NO_REPLY` turns consuming pending
  attachments. In production both lose resources.
- `sanitizeChatHistoryContentBlock` replaces flat image `data` and audio
  `source.data` with `{omitted:true, bytes}`. Those blocks vanished on reload.
- `{type:'input_image'}` is a real Gateway shape that `extractImages` ignored.
- Opening a file outside the workspace tree in the side panel reported "File not
  found", which covers the generated media under `~/.openclaw/media`.
- `.opus` and `.oga` are Gateway audio extensions but were not recognised.

## Resource matrix

Integrity levels: `inline` plays or displays in the conversation. `preview` is a
card that opens a safe side panel. `external` can only be opened safely outside.
`unsupported` shows an explicit state and never disappears.

| Resource | Real runtime/Gateway shape | Transport and parse entry | Normalized type | In conversation | Side panel / external | Failure fallback | History reload | Test evidence | Level |
|---|---|---|---|---|---|---|---|---|---|
| text | `content: string`, `{type:'text',text}` | `chat.history`, chat events; `extractText` | `displayText` | Markdown body | n/a | Empty text with no resource hides the row | Same path | `chat-message.test.tsx` | inline |
| markdown | Text with GFM and math | `AssistantMarkdown` | `displayText` | Rendered prose | Links open externally | Unparsed fence stays as code | Same path | `chat-message.test.tsx` | inline |
| image, base64 | `{type:'image',source:{type:'base64',media_type,data}}`, `{type:'image',data,mimeType}`, `{type:'input_image',image_url:'data:...'}` (`chat-webchat-media.ts`) | `extractImages` | `contentImages` | Card with lightbox | Lightbox | Decode error shows the placeholder | Flat `data` becomes `{omitted:true}`: labelled placeholder | `conversation-resources.test.ts`, E2E | inline |
| image, Gateway | `{type:'image',url:'/api/chat/media/outgoing/<s>/<id>/full',openUrl,alt,mimeType,width,height}` (`managed-image-attachments.ts`) | `enrichWithCachedImages`, then Main `media.thumbnails` | `_attachedFiles.gatewayUrl` | Card with lightbox | Lightbox | Expired record shows the unavailable state | Same path | `media-api.test.ts`, E2E | inline |
| image, local | `MEDIA:/x.png`, `![a](/x.png)`, `[media attached: ...]` | `extractRawFilePaths`, `extractMarkdownImageRefs`, `media.thumbnails` | `_attachedFiles.filePath` | Card with lightbox | Reveal in folder | Missing file shows unavailable | Same path | `chat-message.test.tsx`, E2E | inline |
| image, remote | `![a](https://...)`, `source.type:'url'`, flat `url` | `extractImages` skips; projection and `ConversationImage` | `ConversationResource{image}` | Placeholder with alt, host and URL; never loaded (CSP) | Open in browser | Placeholder is the fallback | Same path | `conversation-resource-cards.test.tsx`, E2E asserts no request | external |
| image gallery | Tool UI `{type:'image-gallery',images:[{url,alt,caption}]}` (model-authored; no runtime producer) | `parseToolUiContent`, `ConversationImage` | `ToolUiInteraction` | Tile grid with lightbox | Lightbox | Per-tile placeholder | Same path | `conversation-resource-cards.test.tsx`, E2E | inline |
| audio | `{type:'attachment',attachment:{url,kind:'audio',label,mimeType,isVoiceNote}}` (`chat-webchat-media.ts:118`); `{type:'audio',source:{...}}` (Control UI reader); tool `details.attachments`, `details.media`, `details.audioPath` (`music-generate-tool.ts`, `tts-tool.ts`); `MEDIA:/x.mp3`; a path in any tool's output or a path in the reply | Projection, `extractToolResultMedia`, `extractRelativeArtifactPaths`, `readBinaryFile` | `AttachedFileMeta` | Card with `<audio controls>`, name, MIME, size, duration | Side panel `MediaPreview`; system app; reveal | Missing, sandbox, too large, unsupported, decode error each with retry or open; base64 omitted from history is labelled | Same path; omitted base64 is labelled | `conversation-resources.test.ts`, `conversation-resource-cards.test.tsx`, E2E | inline |
| video | Tool `details.attachments[{type:'video',path\|url,mimeType,name}]`, `details.media.mediaUrls` (`video-generate-tool.ts`); `MEDIA:/x.mp4`; a path in any tool's output or a path in the reply. **Gap:** the Gateway has no video block producer; `attachment.kind:'video'` has a Control UI reader only and is a compatibility layer | `extractToolResultMedia`, projection, `readBinaryFile` | `AttachedFileMeta` | Card with `<video controls>` | Side panel `MediaPreview`; system app; reveal | As audio; 50 MiB cap, manual load above 16 MiB | Same path | as audio | inline |
| media, remote | `urlOnlyVideos`: `{type:'video',url,...}`; `source.type:'url'` | `classifyResourceUrl` | `AttachedFileMeta.remoteUrl` | Card with host, no player | Open in browser, copy | Card is the fallback | Same path | `conversation-resource-cards.test.tsx` | external |
| document | `_attachedFiles` from `MEDIA:` and tool results; `attachment.kind:'document'` | Existing store path, projection | `AttachedFileMeta` | `FileCard` | PDF, sheet, Office and text viewers; outside the workspace via `FilePreviewBody` | Hidden if a regex-derived path does not exist; viewer states otherwise | Same path | `workspace-browser-body.test.tsx`, E2E | preview |
| table | Tool UI `table`; GFM table | `parseToolUiContent`, `AssistantMarkdown` | `ToolUiInteraction` | `TableCard`, scrollable table | n/a | Invalid fence shows the unknown card | Same path | `tool-ui-execution-surfaces` existing | inline |
| chart | Tool UI `{type:'chart',chartType\|chart_type,labels,series:[{name,data}]}` (model-authored; no runtime producer) | `parseChart`, `ChartCard` | `ToolUiInteraction` | SVG of the declared type, legend, tooltip, data table | n/a | Unsupported type, too many series or negative pie: labelled table. Empty data: unknown card | Same path | `tool-ui-chart.test.tsx`, E2E | inline |
| weather | Tool UI `weather`/`weather-widget` | `parseWeather`, `WeatherWidget` | `ToolUiInteraction` | Animated widget | n/a | No location: unknown card | Same path | `tool-ui-weather.test.tsx`, E2E | inline |
| web-search | `web_search` tool result on `_toolResults`; Tool UI `web-search` | `projectWebSearchInteractions` | `ToolUiInteraction` | Search pill and source cards | Sources open externally | Empty result renders nothing fabricated; execution chip remains | Same path | `rareui-web-search.test.tsx`, E2E | inline |
| website URL | Standalone Markdown link; Tool UI `link-preview`; `attachment.kind:'document'` with an http URL | `AssistantMarkdown`, `parseToolUiContent` | `WebsiteLinkCard` | Card with title, host, URL; inline links stay inline | Open externally; optional side-panel live browser, which loads only on its own action | Disallowed scheme stays plain text | Same path | `conversation-resource-cards.test.tsx`, E2E | external |
| artifact / generated file | Write and edit tool calls; `_attachedFiles` | `extractGeneratedFiles`, `GeneratedFilesPanel` | `GeneratedFile` | Chips and diff surfaces | Review panel | Unavailable diff is labelled | Same path | `generated-files.test.ts` existing | preview |
| code / diff | Fences; Tool UI `code-block`, `code-diff`, `terminal`; `RunMutationDiffs` | `AssistantMarkdown`, `parseToolUiContent` | `ToolUiInteraction` | Bounded previews with copy | Review panel | Unprovable diff is labelled | Same path | `tool-ui-execution-surfaces` existing | inline |
| unknown structured | Explicit `tool-ui` fence with an unknown type or invalid payload; unrecognised assistant content block such as `{type:'canvas',preview}` | `parseToolUiContent`, projection | `ConversationResource{unknown}` | Card with type, title, description, sanitized location | Copy; open only for http(s) or a local path | Card is the fallback; diagnostics log type and field names only | Same path | `conversation-resources.test.ts`, E2E | unsupported |

Distinctions the matrix depends on:

- A recognised file type is not a complete resource; the row must reach a surface
  that renders it. A component that exists is not reachable until a message path
  leads to it. Unit tests do not show a resource is visible in an Electron session,
  which is why the E2E drives real `chat.history` and the real Main file boundary.
- A web-search source and an arbitrary website preview are different capabilities.
  Conversation cards never embed a website. The side-panel browser is a separate,
  explicit action.

## Model

`ConversationResource` covers only what existing carriers cannot: `image`
(self-resolving), `website-link` and `unknown`. Audio, video and documents stay on
`AttachedFileMeta`, so validation and folding have one input. Charts, weather,
tables and web search stay `ToolUiInteraction`. `MessageRenderProjection` remains
the one visibility authority and gains `resources`.

## Artifacts from any tool

An artifact does not have to come from the runtime's own generators. The owner's
example: while developing a system with its own audio generation, the session's
agent runs it and produces an audio file; that file needs a display in the
conversation. This was relayed by a parallel session on the same task. So:

- `tool-media` marks a file a tool explicitly declared. It always shows and reports
  its own errors.
- `tool-result` marks an absolute path found in any tool's output or arguments,
  including a command line. It carries `producedAfter`, the start of its turn. Audio
  and video show only if the file exists and its mtime is at or after that time, so
  `ls *.mp3` over old files stays hidden while a file the system just wrote appears.
- A turn's tool media all goes to that turn's last visible assistant message, the
  reply the user reads, so a multi-step run shows one card. A run ending on a tool
  result or on `NO_REPLY` keeps its media on the last message history retains.
- A reply naming a workspace-relative binary artifact, such as `out/speech.wav`,
  gets a card once the path resolves against the workspace root. A path that does
  not exist stays as text.
- A message shows at most six inline players; further media use file cards, so a
  batch run stays bounded.

## Known gaps

- Remote audio, video and images are `external`. No Main-owned remote fetch exists
  and adding one needs its own SSRF and size review.
- Video has no Gateway content block; it depends on tool-result details surviving
  in the transcript.
- Relative paths are resolved against the workspace root only, not a tool's own
  working directory, and only when a reply names them. Relative paths that appear
  solely in tool output are not detected.
- Images found only in tool output stay hidden, as the store's comments require:
  a turn's intermediate screenshots and conversions are fresh too, so freshness
  cannot separate them. An image shows once a reply or a Gateway block names it.
- `chat.ts` and `chat/helpers.ts` still duplicate their enrichment; new logic lives
  in the shared module, but removing the duplication is separate work.
