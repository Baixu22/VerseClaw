---
id: sidebar-session-row-controls
title: Sidebar session row controls and activity bell
type: rule
appliesTo:
  - sidebar-session-row-management
pathPatterns:
  - src/components/layout/Sidebar.tsx
  - src/components/layout/SidebarRow.tsx
  - src/components/layout/SessionContextMenu.tsx
  - src/components/layout/SessionFolderTree.tsx
  - src/components/layout/use-title-marquee.ts
  - src/components/rareui/CompletionActivityMenu.tsx
  - src/components/rareui/NotificationBell.tsx
  - src/components/rareui/HookSidebar.tsx
  - src/styles/codex-sidebar.css
  - src/styles/rareui-interactions.css
requiredTests:
  - tests/unit/sidebar-session-context-menu.test.tsx
  - tests/unit/sidebar-render-containment.test.tsx
  - tests/unit/rareui-interactions.test.tsx
  - tests/e2e/sidebar-session-row-polish.spec.ts
---

# Sidebar session row controls and activity bell

## Session rows

- A session row reveals exactly two controls: Pin and a ⋯ menu trigger. Every
  other action (rename, move to a workgroup, unread, fork, hand off, copy,
  archive, delete) lives in the one session menu, which right-click also opens.
  Do not add a third permanent hover button; add a menu item instead.
- Pointer hover and keyboard `:focus-visible` reveal the controls. A mouse click
  must not leave them pinned on the clicked row. A row whose menu is open keeps
  its controls and a highlight until the menu closes.
- Only the hovered row reveals controls. A workgroup header shows its own
  rename/delete only when its own row is hovered, never when a member is.
- The title ends where the controls begin; it never runs underneath them, and
  the runtime status orb stays visible while the row is hovered.
- A title that does not fit scrolls on hover intent as a seamless loop at a
  constant speed and glides back to rest when the pointer leaves. Titles that
  fit never move, reduced motion never scrolls, and the row tooltip still
  carries the full title. The looping copy is generated content, not DOM text.
- Archive from the menu is one click and offers Undo, and it records the
  session's workspace and workgroup. Permanent deletion keeps its confirmation.
- Row callbacks threaded through `renderSessionRow` keep stable identities, and
  per-row UI state (menu open, marquee) stays in the row, so opening a menu or
  streaming a run does not re-render every row (`sidebar-render-containment`).
- A project containing session-family connectors uses those connectors and row
  selection backgrounds. Travelling selection/hover rails must not cross family
  disclosure buttons or duplicate the child connectors.

## Activity bell

- The live ring appears only while a session has a run in flight, derived from
  the same runtime status projection as the row orbs: a blue comet while
  running, a breathing amber ring while a run waits on the user. No timers,
  guesses or fabricated progress.
- The badge counts unread feed entries and takes the colour of the most severe
  one. Opening the panel reads the listed entries; closing records them read.
- The panel lists running sessions, with an elapsed clock where the runtime
  reports a start, above the recent feed. The feed stays newest-first; only
  consecutive entries of one session share a heading.
- All text routes through i18n in `en`, `zh`, `ja` and `ru`. Motion has a
  reduced-motion fallback, and the bell, panel and menus stay usable in the
  collapsed sidebar and by keyboard.

## Validation

- `pnpm exec vitest run tests/unit/sidebar-session-context-menu.test.tsx tests/unit/sidebar-render-containment.test.tsx tests/unit/rareui-interactions.test.tsx`
- `pnpm run test:e2e:run tests/e2e/sidebar-session-row-polish.spec.ts`
