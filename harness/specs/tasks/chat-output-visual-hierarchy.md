---
lifecycleStatus: active
id: chat-output-visual-hierarchy
title: Clarify conversation tool and file-change presentation
scenario: windows-ui-v2
intent: Make turn summaries, tool details, file diffs and command output readable at desktop and narrow widths using the existing renderers and disclosure controls.
touchedAreas:
  - src/App.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-page-execution-graph.test.tsx
  - src/components/assistant-render/TurnSummaryCard.tsx
  - src/pages/Chat/ExecutionGraphCard.tsx
  - src/pages/Chat/task-visualization.ts
  - src/pages/Chat/ChatMessage.tsx
  - src/components/tool-ui/RunMutationDiffs.tsx
  - src/components/tool-ui/RunTerminalSurfaces.tsx
  - src/components/tool-ui/code-diff/code-diff.tsx
  - src/components/tool-ui/shared/call-chip.tsx
  - src/components/tool-ui/terminal/terminal.tsx
  - src/components/tool-ui/agent-interactions.tsx
  - src/components/tool-ui/shared/use-copy-to-clipboard.ts
  - src/styles/codex-conversation.css
  - src/components/runtime-approvals/RuntimeApprovalPrompt.tsx
  - tests/unit/runtime-approval-prompt.test.tsx
  - tests/e2e/runtime-approval-bridge.spec.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/tool-ui-execution-surfaces.test.tsx
  - tests/unit/execution-graph-card-badge.test.tsx
  - tests/e2e/chat-turn-summary-collapse.spec.ts
  - tests/e2e/chat-tool-ui-execution-surfaces.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
  - tests/e2e/chat-composer-git-strip.spec.ts
  - tests/e2e/chat-task-visualizer.spec.ts
  - harness/specs/tasks/chat-output-visual-hierarchy.md
  - harness/specs/fixtures/chat-output-visual-hierarchy/**
  - harness/specs/scenarios/windows-ui-v2.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - A completed turn retains a compact, wrapping process summary and an independently visible final answer.
  - File paths and commands lead their headers; counts, copy controls and disclosure buttons stay reachable in narrow layouts.
  - Long diffs and command output have bounded previews with explicit expand and collapse controls; copying retains the complete content. Inline file-change cards never exceed the turn disclosure column, and long code tokens wrap in previews instead of widening the conversation.
  - Tool rows show a useful operation target before disclosure and retain complete arguments and results in a readable detail pane. Tool calls use compact status-aware call chips with a progress wash, a live or measured duration, and a green done / red failure state.
  - Long replacement previews pair the original and modified lines with subdued surfaces and explicit addition/deletion markers; expansion retains the complete requested diff layout.
  - Collapsed terminal output starts at the latest result, follows incoming output only while the reader remains at the end, and keeps retention notices visible outside the scroll area.
  - Runtime command approval replaces the owning conversation's composer in place, with readable command details and offered actions. The original input stays mounted and restores its draft and attachments after resolution.
  - The repository/Git change strip and composer share one centered column; neither may extend past the other at desktop or narrow widths.
requiredRules:
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
requiredProfiles:
  - fast
  - e2e
requiredTests:
  - pnpm exec vitest run tests/unit/tool-ui-execution-surfaces.test.tsx tests/unit/execution-graph-card-badge.test.tsx tests/unit/runtime-approval-prompt.test.tsx tests/unit/chat-input.test.tsx tests/unit/chat-page-execution-graph.test.tsx tests/unit/composer-git-strip.test.tsx
  - pnpm run typecheck:web
  - pnpm run typecheck:test
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/chat-turn-summary-collapse.spec.ts tests/e2e/chat-tool-ui-execution-surfaces.spec.ts tests/e2e/chat-file-changes.spec.ts tests/e2e/runtime-approval-bridge.spec.ts tests/e2e/chat-composer-git-strip.spec.ts
  - pnpm run test:e2e:run tests/e2e/chat-task-visualizer.spec.ts --grep "internal yield"
acceptance:
  - Agent-driven screenshots cover light, dark and narrow layouts with long paths, long command output and long file diffs.
  - Summary badges, file headers, command headers and their actions do not overflow their owning surface. File-change cards stay within the turn disclosure bounds at desktop and narrow widths; only an explicitly expanded diff may scroll inside its own region.
  - Keyboard activation can expand and collapse details and long previews without concealing the final response or losing copy content. Call chips preserve the tool target, status and expansion affordance without widening the transcript.
  - Structured code and output preserve leading indentation and trailing newlines; only native clipboard CRLF conversion is normalized in Windows assertions.
  - Existing approval and error states remain visible and retain their authority; no transport, runtime, product-lock or permission changes are made.
  - Long previews support keyboard scrolling without trapping the page, and final output and both sides of a replacement remain visible in the collapsed viewport.
  - Runtime approval is a nonmodal panel at the input location, with no global overlay. It shares the composer and repository-strip column, sits below the repository strip, and keeps the original draft mounted while pending. Other conversations and transcript controls stay usable; each request retains its own rejection and busy state.
  - Copying the command or pressing Escape does not decide the request. The input stays hidden and inert until every pending request for its session resolves; its original draft and attachments remain intact.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

The owner requested a focused visual improvement on 2026-10-29. This work is
renderer presentation only. Automated histories are labelled agent-driven and
do not establish live-model quality or product acceptance.
