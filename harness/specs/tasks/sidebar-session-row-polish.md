---
lifecycleStatus: active
id: sidebar-session-row-polish
title: Sidebar session rows, title marquee and live activity bell
scenario: sidebar-session-row-management
taskType: implementation
intent: Make conversation management in the sidebar obvious and calm — two hover controls plus one shared menu, titles that stop before the controls and scroll when too long, and a header bell that shows live running state — without changing transport, stores' contracts or product defaults.
touchedAreas:
  - harness/specs/tasks/sidebar-session-row-polish.md
  - harness/specs/scenarios/sidebar-session-row-management.md
  - harness/specs/rules/sidebar-session-row-controls.md
  - src/components/layout/Sidebar.tsx
  - src/components/layout/SessionContextMenu.tsx
  - src/components/layout/SessionFolderTree.tsx
  - src/components/layout/session-buckets.ts
  - src/components/layout/use-title-marquee.ts
  - src/components/rareui/CompletionActivityMenu.tsx
  - src/components/rareui/NotificationBell.tsx
  - src/components/rareui/HookSidebar.tsx
  - src/components/rareui/completion-activity.ts
  - src/lib/mock-host-bridge.ts
  - src/styles/codex-sidebar.css
  - src/styles/rareui-interactions.css
  - src/styles/codex-responsive.css
  - src/styles/codex-tokens.css
  - src/styles/globals.css
  - src/styles/codex-composer-shell.css
  - src/styles/codex-composer-material.css
  - src/styles/codex-workspace-panel.css
  - src/components/layout/TitleBar.tsx
  - src/components/brand/BrandLogo.tsx
  - src/pages/Chat/SessionActivityPanel.tsx
  - src/styles/codex-session-activity.css
  - src/components/chat/MemoryInjectionPanel.tsx
  - tests/unit/memory-injection-panel.test.tsx
  - tests/unit/session-activity-panel.test.tsx
  - tests/unit/session-activity-panel-sections.test.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - src/pages/Chat/ExecutionMigrationControl.tsx
  - src/pages/Settings/sections/RecoverySettingsSection.tsx
  - src/components/chat/SessionFamilyNavigation.tsx
  - src/components/task-ledger/TaskLedgerSummaryPanel.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/sidebar-render-containment.test.tsx
  - tests/unit/session-family-navigation.test.tsx
  - tests/unit/chat-toolbar.test.tsx
  - tests/unit/execution-migration-control.test.tsx
  - tests/unit/fakecoding-design-system.test.ts
  - tests/e2e/fixtures/session-navigation.ts
  - tests/e2e/chat-checkpoints.spec.ts
  - tests/e2e/chat-session-fork.spec.ts
  - tests/e2e/chat-session-handoff.spec.ts
  - tests/e2e/chat-worktree-session-navigation.spec.ts
  - tests/e2e/execution-migration.spec.ts
  - tests/e2e/project-agent-entry.spec.ts
  - tests/e2e/session-chain-scope-faults.spec.ts
  - tests/e2e/session-context-commit-recovery.spec.ts
  - tests/e2e/session-context-recovery.spec.ts
  - tests/e2e/session-derivation-ui.spec.ts
  - tests/e2e/session-family-lifecycle.spec.ts
  - tests/e2e/session-fork-intent.spec.ts
  - tests/e2e/session-lifecycle-recovery.spec.ts
  - tests/e2e/session-task-locales.spec.ts
  - tests/e2e/session-task-reading-navigation.spec.ts
  - tests/e2e/session-worker-task-journey.spec.ts
  - tests/e2e/u6-interaction-metrics.final.spec.ts
  - docs/dev/evidence/ui-hierarchy-20261112/**
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/sidebar-session-context-menu.test.tsx
  - tests/unit/session-folder-tree.test.tsx
  - tests/unit/rareui-interactions.test.tsx
  - tests/e2e/sidebar-session-row-polish.spec.ts
  - tests/e2e/main-navigation.spec.ts
  - tests/e2e/sidebar-session-family-connectors.spec.ts
  - tests/e2e/session-family-counter-layout.spec.ts
  - tests/e2e/sidebar-session-folders-archive.spec.ts
  - tests/e2e/dialog-transitions.spec.ts
  - tests/e2e/runtime-lifecycle-governance.spec.ts
  - docs/dev/rareui-interactions.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
residualPaths:
  - one
  - openclaw_runtime/src/agents/worktree-service.ts
  - src/styles/codex-settings-controls.css
  - tests/e2e/chat-memory-injection-panel.spec.ts
  - tests/e2e/chat-recovery-assist.spec.ts
  - tests/unit/chat-save-to-knowledge.test.tsx
  - tests/unit/vite-config-openclaw-runtime.test.ts
  - vite.config.ts
expectedUserBehavior:
  - Hovering a conversation shows Pin and ⋯ only; the title ends before them and a running conversation keeps its status orb.
  - ⋯ and right-click open the same session menu; it holds rename, move to a workgroup (including back out of one), unread, pin, fork, hand off, copy, archive and delete.
  - Archive is one click with an Undo toast; permanent delete keeps its confirmation dialog.
  - A title longer than its row scrolls as a seamless loop after a short hover and glides back when the pointer leaves; reduced motion keeps it still.
  - Hovering a conversation inside a workgroup no longer reveals the workgroup's own rename/delete.
  - While any conversation runs or waits, the header bell shows the same status orb as that conversation's row; its corner badge counts unread activity in the colour of the most severe entry.
  - Collapsing the sidebar stacks the sidebar toggle above the bell. Parent conversation counts yield to hover controls and stay clear of titles.
  - The 40px header uses unboxed project and conversation identity. The title opens search, source and derived-session navigation; More contains checkpoints, fork, handoff, refresh, execution migration, memory inspection and recovery settings. Empty task scopes load silently.
  - Dark mode follows the owner-supplied Codex reference with a darker sidebar, a lighter conversation canvas and raised menus and composer. The header and transcript share one plane.
  - Child conversations reuse SidebarRow with a shallow indent and one quiet guide; relation details remain in conversation navigation.
  - Session and Recovery separates display from notifications and history. Quiet display applies the existing attention-only expansion and completed-detail collapse preferences; lifecycle explanations expand on demand.
  - The bell panel lists running conversations with elapsed time above the recent activity feed, using row status glyphs and neutral counts, and offers the desktop-notification switch in its footer.
  - The titlebar and sidebar share one chrome tone; the conversation is a raised card with a rounded corner and hairline. The sidebar heading shares the 40px header line, header icon buttons share one recipe, and the header hairline appears only after scrolling.
  - The session environment card and the "what was injected" dialog use the same status glyph and floating-card material; an unavailable status query is a quiet line with Retry.
requiredRules:
  - sidebar-session-row-controls
  - rareui-interaction-adaptation
  - ui-motion-material-system
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
requiredProfiles:
  - fast
  - e2e
requiredTests:
  - pnpm exec vitest run tests/unit/sidebar-session-context-menu.test.tsx tests/unit/sidebar-render-containment.test.tsx tests/unit/session-folder-tree.test.tsx tests/unit/rareui-interactions.test.tsx tests/unit/main-layout.test.tsx tests/unit/fakecoding-design-system.test.ts
  - pnpm run typecheck
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/sidebar-session-row-polish.spec.ts tests/e2e/sidebar-session-folders-archive.spec.ts tests/e2e/rareui-interactions.spec.ts
acceptance:
  - At 1280px, 960px and 720px the header remains 40px and floating menus stay within the viewport; dark sidebar, canvas and composer have distinct backgrounds.
  - Opening execution migration from More retains its dialog after the menu closes; cancelling starts no migration and returns focus to More.
  - Source and derived conversation navigation preserve each conversation's draft and existing lifecycle guards.
  - The session hover strip renders exactly Pin and ⋯; no retired move/rename/delete hover control remains in the DOM.
  - The ⋯ menu is anchored under its button (right edges aligned), keeps the row highlighted while open, and closes on a second press, Escape or an outside click.
  - Archive from the menu calls the existing host archive with the session's workspace and workgroup, and Undo calls the existing host restore; no new host route is added.
  - Bell live state is derived from the sidebar's value-frozen runtime status map; the bell is idle when nothing runs.
  - The renderer adds no direct IPC or Gateway HTTP; all text is in four locales; light, dark, collapsed and reduced-motion states were captured by agent-driven automation and are not claimed as human review.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
    - docs/dev/rareui-interactions.md
---

# Sidebar session rows, title marquee and live activity bell

The exact residual paths record changes already present at the 2026-11-12
hierarchy review's starting revision. They are retained as concurrent work.
The review's source delta and browser evidence are recorded under
`docs/dev/evidence/ui-hierarchy-20261112/`.

The owner asked on 2026-10-30 for an aesthetic and interaction pass over the
conversation area of the sidebar: unclear management, weak hover controls, no
scrolling for long titles on hover, poorly placed titles, and a header bell that
did not convey live activity.

## Verified starting state

| # | Problem | Verified cause |
|---|---------|----------------|
| 1 | Management is unclear | Four equal-weight hover icons (pin, move, rename, delete) per row, a second differently-styled move popover, and the full menu hidden behind right-click only. |
| 2 | Hover controls cover the title | The strip was absolutely positioned over the title; the status orb faded out on hover instead. |
| 3 | Long titles never scrolled | The collapse containers were `display: grid` with an implicit `auto` column, which grew to the longest nowrap title. Every row became as wide as that title, so titles never overflowed their own frame and the marquee measured nothing; the hover controls were laid out beyond the sidebar's clipped edge. |
| 4 | Title position | Ungrouped project sessions were indented 16px past the project name with nothing at the intermediate level. |
| 5 | The bell said nothing live | It only showed a 5px dot for finished entries; running and waiting sessions were invisible there. |

## Boundaries

Renderer presentation only. The archive/restore host calls, the runtime status
projection and the completion-activity store are reused as they are; no host
route, transport behaviour or product default changes. Automated screenshots are
agent-driven evidence (`driven_by: agent`), not human review.
