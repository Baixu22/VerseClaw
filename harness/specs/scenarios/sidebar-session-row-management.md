---
id: sidebar-session-row-management
title: Managing conversations from sidebar rows and following live activity
type: scenario
requiredRules:
  - sidebar-session-row-controls
  - rareui-interaction-adaptation
  - ui-motion-material-system
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
pathPatterns:
  - src/components/layout/Sidebar.tsx
  - src/components/layout/SessionContextMenu.tsx
  - src/components/layout/SessionFolderTree.tsx
  - src/components/layout/use-title-marquee.ts
  - src/components/rareui/CompletionActivityMenu.tsx
  - src/components/rareui/NotificationBell.tsx
  - src/components/rareui/HookSidebar.tsx
  - src/styles/codex-sidebar.css
  - src/styles/rareui-interactions.css
  - tests/e2e/sidebar-session-row-polish.spec.ts
---

# Managing conversations from sidebar rows

1. Hover a conversation row. Pin and ⋯ appear at its right edge, the title
   stops before them, and a running conversation keeps its status orb.
2. Hover a row whose title is longer than the row. After a short dwell the
   title scrolls as a loop; moving the pointer away returns it to rest. With
   reduced motion enabled it stays still and the tooltip shows the full title.
3. Open ⋯. The menu opens under the button with rename, move to a workgroup,
   unread, pin, fork, hand off, copy, archive and delete; right-click on the row
   opens the same menu at the pointer. Arrow keys move through it and Escape
   closes it.
4. Choose Archive. The row leaves the list and a toast offers Undo, which
   restores it. Delete still asks for confirmation.
5. Start a run in any conversation. The header bell gently swings from side to
   side; waiting for approval or input turns it amber. Open it: the swing pauses,
   and running conversations appear with elapsed time above recent completions,
   errors and approval requests. Escape closes the panel and returns focus.
6. Collapse the sidebar. The sidebar toggle sits above the bell, with both
   controls centered. The activity panel stays inside the window; reduced
   motion keeps the bell still.
7. Open a conversation title. Search is focused; source and derived conversations
   are shown in the same picker. Switching out and back preserves each draft.
8. Open More to use a checkpoint, fork or handoff. Execution migration opens a
   persistent dialog; cancelling it restores focus without starting migration.
9. Check 1280px, 960px and 720px layouts in light and dark themes. The header
   stays 40px high, both menus stay in bounds, and dark sidebar, reading surface,
   menu and composer keep their distinct tones.

Run with agent-driven Electron automation (`tests/e2e/sidebar-session-row-polish.spec.ts`)
and record light, dark and reduced-motion states as `driven_by: agent`; do not
claim human review.
