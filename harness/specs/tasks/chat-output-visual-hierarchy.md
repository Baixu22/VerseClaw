---
lifecycleStatus: active
id: chat-output-visual-hierarchy
title: Clarify conversation tool and file-change presentation
scenario: windows-ui-v2
intent: Make turn summaries, tool details, file diffs and command output readable at desktop and narrow widths using the existing renderers and disclosure controls.
touchedAreas:
  - src/components/chat/WelcomeProjectPicker.tsx
  - src/components/chat/WelcomeBranchPicker.tsx
  - src/styles/codex-welcome-hero.css
  - tests/unit/welcome-project-picker.test.tsx
  - tests/unit/welcome-branch-picker.test.tsx
  - tests/e2e/chat-welcome-hero-fakecoding.spec.ts
  - tests/e2e/chat-welcome-hero-verse-shot.spec.ts
  - src/pages/Chat/session-environment.ts
  - src/pages/Chat/ChatToolbar.tsx
  - src/stores/artifact-panel.ts
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/panel-tab-meta.tsx
  - src/styles/codex-workspace-panel.css
  - tests/unit/session-environment.test.ts
  - tests/unit/artifact-panel-store.test.ts
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/artifact-panel-subject-tabs.test.ts
  - tests/unit/chat-artifact-panel-layout.test.tsx
  - tests/e2e/chat-artifact-panel.spec.ts
  - tests/e2e/fixtures/electron.ts
  - docs/modules/workspace-and-coding.md
  - src/pages/Chat/SessionActivityPanel.tsx
  - src/components/file-preview/WorkspaceProcessPanel.tsx
  - src/components/assistant-render/CodingRunEvidence.tsx
  - src/styles/codex-session-activity.css
  - tests/unit/session-activity-panel-sections.test.tsx
  - tests/unit/session-activity-panel.test.tsx
  - tests/unit/chat-session-status-rail.test.tsx
  - tests/e2e/session-activity-background-read.spec.ts
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
  - tests/unit/chat-message.test.tsx
  - tests/unit/chat-render-reachability.test.tsx
  - tests/unit/chat-tool-card-suppression.test.tsx
  - harness/specs/rules/ui-motion-material-system.md
  - tests/e2e/chat-turn-summary-collapse.spec.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/e2e/chat-workspace-header.spec.ts
  - tests/e2e/product-acceptance-space-bunny.spec.ts
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
  - Empty Chat shows a plain project / branch row beneath the composer, without a duplicate Git strip. Project and branch selection remain local controls independent of Gateway connectivity. The three starter actions are kept behind one keyboard-accessible Quick start disclosure, hidden while drafting without moving the composer.
  - Branch selection reuses hostApi.git.branches and checkoutBranch under gateway-backend-communication. Search and keyboard focus work; failed reads offer retry, blocked checkouts preserve the current label, detached HEAD still exposes selection, and switching projects resets branch options. Project selection uses the owning conversation state-preservation handler.
  - Session environment stays absent for a clean repository, a policy snapshot or a running reply alone. Observed changes, MCP calls, skill reads or worker/process activity reveal its entry. Automatic disclosure follows the existing preference beside the conversation; manual disclosure is a dismissible overlay.
  - Environment sources show only observed call identities and skill names, with tool names behind disclosure. Groups preview at most three rows and retain overflow on demand. Active workers precede completed history; clicking a worker opens its own workspace tab.
  - Workspace expand/collapse changes its width; closing hides it while preserving mounted tabs and selected content. Reopening restores the current tab. Workers are entered through the environment rather than the workspace launcher.
  - Turn headers show at most two useful counts. Diagnostics sit at the end of the disclosure; history tool calls and their results share one expandable row, with unmatched results retained.
  - Session status uses one continuous surface. Running and failed processes remain visible regardless of history length; completed processes are available in a keyboard-accessible history disclosure.
  - An opened process uses the shared terminal surface with a live status, full-output copying and bounded scrolling. Incoming output follows only while the reader remains at the end.
  - Assistant messages use one text column without avatars. User-facing progress remains visible without duplicating the live reply when history catches up.
  - Active runs default to a compact disclosure with only the current tool animated. Reasoning, execution graphs and passive Tool UI records open on demand; pending approvals and errors remain visible. Explicit expansion and the completed-run preference still apply.
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
  - pnpm exec vitest run tests/unit/welcome-project-picker.test.tsx tests/unit/welcome-branch-picker.test.tsx
  - pnpm run test:e2e:run tests/e2e/chat-welcome-hero-fakecoding.spec.ts tests/e2e/chat-welcome-hero-verse-shot.spec.ts tests/e2e/chat-composer-git-strip.spec.ts
  - pnpm exec vitest run tests/unit/session-environment.test.ts tests/unit/artifact-panel-store.test.ts tests/unit/artifact-panel.test.tsx tests/unit/artifact-panel-subject-tabs.test.ts tests/unit/chat-artifact-panel-layout.test.tsx
  - pnpm run test:e2e:run tests/e2e/chat-artifact-panel.spec.ts --grep "conversation column"
  - pnpm run test:e2e:run tests/e2e/chat-artifact-panel.spec.ts --grep "owned Windows child"
  - pnpm exec vitest run tests/unit/session-activity-panel-sections.test.tsx tests/unit/session-activity-panel.test.tsx tests/unit/chat-session-status-rail.test.tsx
  - pnpm run test:e2e:run tests/e2e/session-activity-background-read.spec.ts
  - pnpm exec vitest run tests/unit/chat-message.test.tsx tests/unit/chat-render-reachability.test.tsx tests/unit/chat-tool-card-suppression.test.tsx
  - pnpm exec vitest run tests/unit/tool-ui-execution-surfaces.test.tsx tests/unit/execution-graph-card-badge.test.tsx tests/unit/runtime-approval-prompt.test.tsx tests/unit/chat-input.test.tsx tests/unit/chat-page-execution-graph.test.tsx tests/unit/composer-git-strip.test.tsx
  - pnpm run typecheck:web
  - pnpm run typecheck:test
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/chat-turn-summary-collapse.spec.ts tests/e2e/chat-tool-ui-execution-surfaces.spec.ts tests/e2e/chat-file-changes.spec.ts tests/e2e/runtime-approval-bridge.spec.ts tests/e2e/chat-composer-git-strip.spec.ts
  - pnpm run test:e2e:run tests/e2e/chat-task-visualizer.spec.ts --grep "internal yield"
acceptance:
  - Agent-driven Electron evidence covers the welcome project and branch row, successful branch switching, the three actions behind disclosure, light/dark/narrow layouts, and stable composer placement when drafting. Existing conversation Git worktree actions remain available after a turn starts.
  - A successful empty status read shows no environment entry; an actual failed status read keeps its warning and retry. Sources do not leak across session keys, do not list configured-but-unused integrations, and never render raw tool arguments or environment values.
  - Dismissing the environment persists through later events in that session. Manual reopening uses an overlay without transcript inset; Escape, outside click and the close button dismiss it. Narrow windows keep the card within the conversation bounds.
  - Source and worker overflow remains keyboard-accessible. Agent-driven light/dark/narrow Electron captures show the two layers and source/worker hierarchy. A worker never opens a workspace tab automatically.
  - The workspace close control and toolbar toggle preserve the selected tab, its mounted content and expanded state. Opening/closing uses short transform/opacity motion, disabled by reduced motion.
  - An active tool keeps the existing call-chip progress wash in the collapsed view. Opening the full process renders that tool once. Reduced motion disables its transition; completing the tool removes the live chip without expanding the log.
  - While waiting for the next tool or reply, the existing particle status animation stays inline at 20px; it does not reserve an avatar gutter or compete with the active tool animation.
  - Native keyboard disclosure exposes passive command, diff, plan and test records; questions, approvals, failed commands and failed test reports stay directly accessible.
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
