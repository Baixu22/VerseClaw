---
id: windows-ui-v2
title: Cross-platform FakeCoding UI v2
type: scenario
requiredRules:
  - ui-motion-material-system
  - renderer-loading-experience
  - i18n-locale-coverage
  - docs-sync
pathPatterns:
  - src/App.tsx
  - src/styles/**
  - src/components/layout/**
  - src/components/ui/**
  - src/pages/**
  - shared/i18n/locales/**
---

# Cross-platform FakeCoding UI v2

## Purpose

Give the Electron application a coherent FakeCoding-aligned grayscale shell, compact control system, and route-driven settings surface while preserving all existing product workflows.

## Flow

1. Windows, macOS and Linux use UI v2; the temporary visual rollback is retired after TF-0027. Old query values resolve to the current shell.
2. The application shell remains mounted while pages and settings sections load.
3. Navigating to `/settings/*` uses the shared full-page Settings chrome and remembers the application return route.
4. Returning from Settings restores the remembered application route and focus.
5. Existing page functionality remains unchanged while shared page shells, compact controls, grayscale materials, migrated SVGs, and restrained motion provide the new visual language.
6. Knowledge has Library and Review Queue as its two primary views. Inbox, Draft and Proposal records remain projections of the existing knowledge service. More > Maintenance and Source tools preserve advanced operations. Documents open in Preview; editing is explicit, and a 960px window shows only one editor pane. The Chat knowledge mode preserves local conversation checkpoints and returns to Library or governed review with its source context.
7. Chat keeps process details in a wrapping, keyboard-accessible turn disclosure while the final answer stays visible. Tool rows use compact status-aware call chips, preview their target and duration, and reveal complete arguments on demand. File names and commands lead their headers; long diffs and command output use expandable previews, with complete retained content available to copy. File-change cards stay within the turn disclosure column, and unbroken code wraps in the preview rather than widening the conversation. Verify light, dark and narrow layouts with agent-driven Electron histories; see `tasks/chat-output-visual-hierarchy.md`.
   Replacement previews show both versions with explicit +/- markers on neutral surfaces. Command previews start at the latest output and preserve a reader's earlier scroll position while new output arrives; retention notices stay outside the scrolling region. Web-search tool results appear as a collapsible search pill with a left-to-right progress fill and landed sources as openable cards; the circular ring from the Rare UI reference is deliberately not used.
8. Runtime command approvals replace the owning session's composer in place, with readable, copyable commands and reachable decisions at narrow widths and 150% zoom. The repository status strip and the approval/composer column share the same centered width. No modal or page overlay is opened; the transcript and other conversations remain usable. The input stays mounted but hidden and inert until approvals resolve, restoring its draft and attachments. Only decisions offered by the runtime can be submitted.

## Validation

Composer model, knowledge, permission and agent menus share the add control's
blur-to-clear motion, neutral surface and selection marks. Opening one closes
the previous menu; Escape and outside click dismiss it. Short and narrow windows
constrain the menu to available space with internal scrolling. Verify normal and
reduced motion with `tests/e2e/chat-composer-popovers.spec.ts` and agent-driven
Electron captures.

Empty Chat uses an unboxed project picker below the composer, with worktree
selection inside its menu. Observed file changes reveal a compact entry below
the input; its details retain governed branch search, checkout and worktree
actions. The three starter actions live in a single Quick start disclosure;
drafting hides this entry without shifting the composer.

Chat's assistant output has no avatar gutter. Progress text and the final answer
share one reading column; active process details start folded and show only the
current tool's existing progress animation. Completed passive tool records open
on demand. Errors, approval requests and questions remain visible. The shared
summary owns the live status so a second Thinking row does not compete with it.

Session status and process output share the conversation's neutral surfaces and
compact text states. Successful calls settle quietly, matched call/result rows
share one disclosure, and diagnostics follow the useful work. Process history
folds completed entries without hiding running or failed commands. Open process
output reuses the transcript terminal with copy and reader-controlled scrolling.

Session environment appears only after observed changes or activity. It groups
changes, used MCP/skills and workers into bounded previews with details on demand.
Automatic expansion shares the conversation plane; a manual opening is a compact
overlay that closes with Escape, outside click or its close control. Dismissal
survives incoming events. Workers open their own tab from this card; closing the
workspace preserves its mounted tabs, selected content and expansion state.

The Knowledge corner uses the approved procedural Ginger character. Drag stays
near its corner dock and out-of-range release snaps back; click or keyboard
activation opens a compact nonmodal floating conversation with source context
intact. Actual request boundaries drive its states, and answers
share the main Chat Markdown renderer. Reduced motion settles one pose.
See `tasks/knowledge-bot-avatar.md` and `rules/knowledge-bot-runtime-state.md`.

- `pnpm harness validate --spec harness/specs/tasks/windows-ui-v2-apple-motion.md`
- `pnpm run typecheck`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/windows-ui-v2.spec.ts tests/e2e/settings-drawer.spec.ts`
