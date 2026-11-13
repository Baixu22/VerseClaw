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
- Family counts are visible while collapsed; expanding the family removes the
  count and gives its title that space. Parent and child rows use the same type
  scale, with indentation and a quiet connector carrying the relationship.

## Conversation header

- Keep the normal header at 40px. Project and session names are unboxed at rest.
- The title opens the searchable conversation picker. Source links, ancestry
  and derived sessions live in that picker; no additional native select or
  relation strip occupies the resting header.
- Checkpoints, fork, handoff, refresh, recovery settings, execution migration
  and memory inspection use More. Their existing eligibility guards still apply.
- Closing More must not unmount a dialog opened from it. Escape returns focus
  to the originating trigger, and floating menus stay inside the viewport.
- A recovered prompt cache returns to the quiet state. Session environment
  remains reachable while workspace tabs are open.
- Dark surfaces follow the graphite palette: frame, sidebar, conversation,
  raised menu and composer. The header shares the conversation surface; sidebar,
  canvas and composer must have distinct computed backgrounds.

## Activity bell

- Live activity comes from the same runtime status projection as the row orbs
  and is drawn with the same glyph: while a session runs or waits, the bell
  icon gives way to the row's `OrbStatus` (streaming / waiting). No private
  swing, ring or corner dot. At rest the control is a plain bell.
- The bell and sidebar toggle share a horizontal row when expanded and stack
  vertically when collapsed. The corner holds only the unread count.
- The badge counts unread feed entries and takes the colour of the most severe
  one. Opening the panel reads the listed entries; closing records them read.
- The panel lists running sessions, with an elapsed clock where the runtime
  reports a start, above the recent feed. The feed stays newest-first; only
  consecutive entries of one session share a heading. Feed entries use the row
  status glyphs (success / error / waiting); unread entries carry full ink, not
  a trailing dot. Counts are neutral text, not accent pills.

## Status vocabulary and planes

- Any surface that reports run state (bell, activity panel, session
  environment card, header picker) uses `OrbStatus`. Do not add a bespoke dot,
  pulse or spinner for "running".
- The titlebar and sidebar are one chrome surface; the conversation is a raised
  card with a rounded top-left corner and hairline edge. The sidebar heading
  shares the conversation header's 40px line, and header icon buttons share
  the sidebar `.icon-button` recipe (30px, radius-md, row-hover wash).
- The conversation header gains its hairline only after the transcript scrolls.
- A status query that is merely unavailable is a quiet line with Retry; only a
  failed run or blocked continuation uses the error bar.
- Floating cards opened from the header (session environment, memory
  injection) share one material: raised surface, 20px corner, hairline plus
  shadow, 28px header actions, rows rather than nested boxes.
- All text routes through i18n in `en`, `zh`, `ja` and `ru`. Motion has a
  reduced-motion fallback, and the bell, panel and menus stay usable in the
  collapsed sidebar and by keyboard.

## Validation

- `pnpm exec vitest run tests/unit/sidebar-session-context-menu.test.tsx tests/unit/sidebar-render-containment.test.tsx tests/unit/rareui-interactions.test.tsx`
- `pnpm run test:e2e:run tests/e2e/sidebar-session-row-polish.spec.ts`
