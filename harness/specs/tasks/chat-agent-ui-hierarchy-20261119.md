---
lifecycleStatus: active
id: chat-agent-ui-hierarchy-20261119
title: Unify conversation process, approval and change summaries
scenario: gateway-backend-communication
taskType: runtime-bridge
scenarios:
  - windows-ui-v2
diffBase: 47303b18996f94ec7fd9afbc89ba1dac0910e66d
intent: Reduce competing detail and controls in the conversation by reusing local disclosure, approval, diff and sidebar components, while retaining the current tool progress animation and host-owned actions.
touchedAreas:
  - src/components/file-preview/WorkspaceGitPanel.tsx
  - src/components/file-preview/WorkspaceAuditPanel.tsx
  - src/components/file-preview/MonacoDiffViewer.tsx
  - src/components/ai-elements/commit.tsx
  - src/components/assistant-render/GitHubCard.tsx
  - src/components/chat/SessionWorkspacePicker.tsx
  - src/pages/Settings/sections/StorageSection.tsx
  - src/styles/globals.css
  - src/styles/codex-git-surfaces.css
  - shared/i18n/locales/*/settings.json
  - tests/unit/workspace-git-panel.test.tsx
  - tests/unit/github-card.test.tsx
  - tests/unit/workspace-audit-panel.test.tsx
  - tests/e2e/workspace-git-panel.spec.ts
  - tests/e2e/session-worktree-storage.spec.ts
  - tests/e2e/workspace-git-panel.spec.ts-snapshots/**
  - tests/e2e/git-ui-consistency.spec.ts
  - harness/specs/tasks/git-ui-consistency-20261121.md
  - harness/specs/fixtures/git-ui-consistency-20261121/**
  - src/components/chat/ComposerDecisionSurface.tsx
  - src/components/tool-ui/approval-card/schema.ts
  - tests/unit/runtime-approval-prompt.test.tsx
  - tests/e2e/runtime-approval-bridge.spec.ts
  - src/pages/Chat/ComposerRequestDock.tsx
  - src/pages/Chat/composer-interactions.ts
  - src/pages/Chat/SessionTaskDock.tsx
  - src/pages/Chat/use-run-approvals.ts
  - src/hooks/use-message-viewport.ts
  - src/components/assistant-render/ThinkingReasoning.tsx
  - src/components/runtime-approvals/RuntimeApprovalPrompt.tsx
  - src/components/tool-ui/PendingRunApprovals.tsx
  - src/components/tool-ui/approval-card/approval-card.tsx
  - src/lib/mock-run-script.ts
  - tests/unit/composer-interactions.test.ts
  - tests/unit/chat-pending-message-queue.test.ts
  - tests/unit/chat-viewport.test.tsx
  - tests/unit/session-task-dock.test.tsx
  - tests/e2e/chat-runtime-ux-acceptance.spec.ts
  - tests/e2e/chat-long-task-control.spec.ts
  - src/stores/settings.ts
  - shared/chat/types.ts
  - src/stores/chat/helpers.ts
  - src/stores/chat.ts
  - src/pages/Chat/message-render-projection.ts
  - src/components/ui/collapsible.tsx
  - src/components/assistant-render/TurnSummaryCard.tsx
  - src/components/tool-ui/run-surfaces.ts
  - src/components/tool-ui/RunTerminalSurfaces.tsx
  - src/components/tool-ui/terminal/terminal.tsx
  - src/components/tool-ui/shared/file-line-stats.tsx
  - src/components/file-preview/GeneratedFilesPanel.tsx
  - src/pages/Chat/ComposerGitStrip.tsx
  - src/pages/Chat/ExecutionGraphCard.tsx
  - src/pages/Chat/task-visualization.ts
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Chat/index.tsx
  - src/components/tool-ui/RunMutationDiffs.tsx
  - src/components/tool-ui/code-diff/code-diff.tsx
  - src/components/tool-ui/plan-view.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/assistant-ui/orb-status.tsx
  - src/components/rareui/NotificationBell.tsx
  - src/components/rareui/CompletionActivityMenu.tsx
  - src/styles/codex-sidebar.css
  - src/styles/codex-composer-shell.css
  - src/styles/codex-composer-menu.css
  - src/styles/codex-composer-material.css
  - src/styles/codex-responsive.css
  - src/styles/codex-session-activity.css
  - src/styles/rareui-interactions.css
  - shared/i18n/locales/*/chat.json
  - tests/unit/orb-status.test.tsx
  - tests/unit/rareui-interactions.test.tsx
  - tests/e2e/rareui-interactions.spec.ts
  - tests/e2e/sidebar-settings-fakecoding.spec.ts
  - tests/e2e/orb-visual-verify.spec.ts
  - tests/unit/tool-ui-execution-surfaces.test.tsx
  - tests/unit/execution-graph-card-badge.test.tsx
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/composer-git-strip.test.tsx
  - tests/unit/sidebar-session-context-menu.test.tsx
  - tests/unit/chat-render-reachability.test.tsx
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/chat-message.test.tsx
  - tests/unit/task-visualization.test.ts
  - tests/unit/run-surface-promotion.test.ts
  - tests/e2e/sidebar-session-row-polish.spec.ts
  - tests/e2e/sidebar-session-family-connectors.spec.ts
  - tests/e2e/chat-turn-summary-collapse.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
  - tests/e2e/chat-composer-git-strip.spec.ts
  - tests/e2e/chat-user-message-actions.spec.ts
  - tests/e2e/chat-user-message-actions.spec.ts-snapshots/**
  - tests/e2e/session-activity-background-read.spec.ts
  - harness/specs/tasks/chat-output-visual-hierarchy.md
  - harness/specs/tasks/chat-agent-ui-hierarchy-20261119.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/sidebar-session-row-controls.md
  - harness/specs/fixtures/chat-agent-ui-hierarchy-20261119/**
  - docs/modules/workspace-and-coding.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - src/components/tool-ui/agent-interactions.tsx
  - src/components/ui/plus-menu-morph.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/execution-projection.ts
  - src/pages/Chat/run-surface-promotion.ts
  - tests/e2e/chat-composer-popovers.spec.ts
  - tests/e2e/chat-tool-ui-interaction-flow.spec.ts
expectedUserBehavior:
  - Runtime approval is the highest-priority composer decision, followed by host permissions and remaining requests. The ordinary composer stays mounted but hidden/inert; higher-priority requests preserve the interrupted question's selection.
  - Runtime, workspace permission, question, option, preference and plan requests share the composer material, 25px outline, title row and action footer. Only one active request is visible. Escape never submits a composer approval decision.
  - Composer choices use fine outlines and check marks with 140ms hover/selection feedback. Permission prompts use restrained orange accents; host-classified irreversible requests use red. Danger text maintains 4.5:1 contrast in both themes and hover states. Reduced motion removes these transitions.
  - Questions, choices, approval-required plan proposals and host permission requests remain at the composer while history scrolls. Submission preserves the draft, is guarded against duplicate clicks and keeps failed requests retryable.
  - A plan proposal explicitly opts into approval; progress-only runtime plans leave the composer with their owning run. Ordinary question responses use normal chat.send without long-task-only inputMode.
  - Activity-panel sessions use the sidebar row's actual pin, rename, context-menu and navigation handlers. Terminal success and failure icons occupy equal bounds.
  - The current tool retains its existing CallChip progress wash; opening its process renders the active tool once.
  - Process summaries and change groups use the local Collapsible presentation. Completed reasoning, plans and diffs start behind their own disclosure rather than forming a flat stack of previews.
  - Pending workspace approvals stay visible independently of process expansion, retaining the existing ApprovalCard and host decision identity.
  - A changed repository reveals a compact review bar above the composer with the branch, unique changed-file count and a direct review action. The branch/worktree menu retains its existing governed operations.
  - Sidebar rows retain their title and shared hover surface and show a bounded last-message summary or actionable run status when available.
  - The sidebar Settings control remains anchored at the bottom while expanded and collapsed. Runtime activity remains animated; terminal status uses the same static semantic icon in the sidebar row, activity feed and top activity bell. An idle bell shows the latest unread event and returns to its bell glyph when the event is read.
  - Completed assistant messages expose a compact action row aligned to the response: copy, quote into the composer and fork when a valid prior assistant boundary exists. Timestamp and token usage stay in that row rather than pushing actions to the conversation edge.
  - Tool calls and command output share one event-ordered timeline. Tool arguments remain distinct from progressive output and final results; long terminal lines wrap inside the conversation column.
  - Running command output starts expanded with the current CallChip animation shown once. Completed command output starts folded and keeps full output available with copy.
  - The composer, repository review strip, toolbar and session status rail use restrained Codex-style materials. Their controls adapt to the available chat-column width and remain reachable without horizontal overflow.
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - i18n-locale-coverage
  - ui-motion-material-system
  - sidebar-session-row-controls
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - e2e
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/composer-interactions.test.ts tests/unit/chat-pending-message-queue.test.ts tests/unit/chat-viewport.test.tsx tests/unit/session-task-dock.test.tsx
  - pnpm run test:e2e:run tests/e2e/chat-runtime-ux-acceptance.spec.ts tests/e2e/chat-long-task-control.spec.ts tests/e2e/runtime-approval-bridge.spec.ts
  - pnpm exec vitest run tests/unit/chat-render-reachability.test.tsx tests/unit/chat-store-history-retry.test.ts
  - pnpm run test:e2e:run tests/e2e/chat-tool-ui-interaction-flow.spec.ts
  - pnpm exec vitest run tests/unit/orb-status.test.tsx tests/unit/rareui-interactions.test.tsx
  - pnpm run test:e2e:run tests/e2e/sidebar-settings-fakecoding.spec.ts tests/e2e/sidebar-session-row-polish.spec.ts tests/e2e/rareui-interactions.spec.ts
  - pnpm exec vitest run tests/unit/tool-ui-execution-surfaces.test.tsx tests/unit/execution-graph-card-badge.test.tsx tests/unit/chat-page-execution-graph.test.tsx tests/unit/composer-git-strip.test.tsx tests/unit/sidebar-session-context-menu.test.tsx tests/unit/chat-render-reachability.test.tsx tests/unit/chat-message.test.tsx tests/unit/tool-ui-run-surfaces.test.ts tests/unit/task-visualization.test.ts
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/sidebar-session-row-polish.spec.ts tests/e2e/sidebar-session-family-connectors.spec.ts tests/e2e/chat-turn-summary-collapse.spec.ts tests/e2e/chat-file-changes.spec.ts tests/e2e/chat-composer-git-strip.spec.ts tests/e2e/chat-user-message-actions.spec.ts tests/e2e/runtime-approval-bridge.spec.ts tests/e2e/session-activity-background-read.spec.ts
acceptance:
  - A question published through both streaming and the current turn transcript has one card, regardless of which terminal publication arrives first. The persisted entry retains ownership after the turn settles.
  - A rejected plan update is not promoted from live events or reloaded history. The owning failed tool stays in the process details.
  - At a 375 px touch viewport the five primary composer controls fit without horizontal scrolling; keyboard focus skips closed menu items and returns to Add on Escape.
  - Agent-driven Electron captures show light, dark and narrow conversation layouts, an active tool, a pending approval, file changes and sidebar summaries.
  - Only the current tool uses the retained progress animation in the collapsed view; opening and closing process details preserves one active copy and reduced-motion behavior.
  - Folding process details leaves pending approvals and final answers reachable. Existing request-specific busy, rejection and retry behavior remains covered by the approval bridge checks.
  - File-change disclosure uses the existing CodeDiff renderer, preserves complete code/copy content, and remains inside its owning conversation column at narrow widths.
  - The review bar precedes the composer, hides after a clean status read, retains conflict status and opens the existing changes review. Scope changes cannot display another workspace's cached Git status.
  - Sidebar summaries stay bounded and do not replace explicit conversation titles, unread/pinned markers, row actions or session ownership. Hover/focus controls and family navigation remain usable.
  - Collapsing and expanding the sidebar keeps Settings in the bottom footer; active status remains animated and settled activity uses static icons consistently across row, feed and bell.
  - Assistant copy, quote and eligible fork actions remain keyboard-accessible, use existing handlers and stay aligned with the response at desktop and narrow widths.
  - Interleaved command and tool rows render in their start order; expanding a tool reveals its original arguments and latest result as separate sections, and a long command output does not widen the chat column.
  - A running command's transcript row shows one progress animation while its output updates. Folding its turn leaves one current activity chip; completed output is initially folded with copy access retained.
  - Composer controls, Git review bar and session status rail fit 390px and 640px chat viewports, preserve the branch/count/review actions and expose no horizontal overflow.
  - Sidebar status glyphs and footer anchoring pass unit and Electron interaction checks in expanded, collapsed and minimum-width layouts.
  - Relevant tests, type checks, lint, locales and Harness checks pass; evidence files bind the candidate sources and are read back before closure.
docs:
  required: true
  paths:
    - docs/modules/workspace-and-coding.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

The owner requested approval and execution-process improvements, a useful
repository-change entry and concise sidebar summaries on 2026-11-19. The T3
reference is `pingdotgg/t3code@470ca63499293f7f680f8ad2e77381a6752f1348`.
Local Collapsible, Button, ApprovalCard, CodeDiff, CallChip and SidebarRow remain
the implementation primitives.
