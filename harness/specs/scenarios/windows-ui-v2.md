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

The chat composer includes a Lobe UI TokenTag for current context usage. Hover,
focus or click reveals the runtime report's source composition; source groups
expand to file, skill and tool metadata. Settings > General > Appearance persists
its display switch. Validate unknown readings, generation changes, keyboard,
four locales and narrow light/dark layouts with `tests/e2e/chat-context-display.spec.ts`.

## Purpose

Give the Electron application a coherent FakeCoding-aligned grayscale shell, compact control system, and route-driven settings surface while preserving all existing product workflows.

## Flow

1. Windows, macOS and Linux use UI v2; the temporary visual rollback is retired after TF-0027. Old query values resolve to the current shell.
2. The application shell remains mounted while pages and settings sections load.
3. Navigating to `/settings/*` uses the shared full-page Settings chrome and remembers the application return route.
4. Returning from Settings restores the remembered application route and focus.
5. Existing page functionality remains unchanged while shared page shells, compact controls, grayscale materials, migrated SVGs, and restrained motion provide the new visual language.
6. Knowledge has Library and Review Queue as its two primary views. Inbox, Draft and Proposal records remain projections of the existing knowledge service. More > Maintenance and Source tools preserve advanced operations. Documents open in Preview; editing is explicit, and a 960px window shows only one editor pane. The Chat knowledge mode preserves local conversation checkpoints and returns to Library or governed review with its source context.
7. Chat keeps process details in a wrapping, keyboard-accessible turn disclosure while the final answer stays visible. Pending workspace approvals remain actionable outside that disclosure. Completed assistant replies have a compact action row aligned to their text, with copy, quote-to-composer and eligible fork actions; timestamp and token usage remain adjacent. Tool rows use compact status-aware call chips, preview their target and duration, and reveal complete arguments on demand. File names and commands lead their headers; long diffs and command output use expandable previews, with complete retained content available to copy. File-change cards stay within the turn disclosure column, and unbroken code wraps in the preview rather than widening the conversation. Verify light, dark and narrow layouts with agent-driven Electron histories; see `tasks/chat-output-visual-hierarchy.md`.
   Runtime tool calls and command output share a start-ordered timeline. Tool arguments and the latest result occupy separate labelled sections. Running command rows keep the existing progress wash and reveal live output; completed rows start folded. The composer, review strip, toolbar and session status panel adapt to the conversation column and keep their controls within narrow windows.
   Replacement previews show both versions with explicit +/- markers on neutral surfaces. Command previews start at the latest output and preserve a reader's earlier scroll position while new output arrives; retention notices stay outside the scrolling region. Web-search tool results appear as a collapsible search pill with a left-to-right progress fill and landed sources as openable cards; the circular ring from the Rare UI reference is deliberately not used.
8. Runtime command approvals replace the owning session's composer in place, with readable, copyable commands and reachable decisions at narrow widths and 150% zoom. The repository status strip and the approval/composer column share the same centered width. No modal or page overlay is opened; the transcript and other conversations remain usable. The input stays mounted but hidden and inert until approvals resolve, restoring its draft and attachments. Only decisions offered by the runtime can be submitted.
9. Sidebar settings remain bottom-anchored with the session list visible or collapsed. Running and waiting status keeps its existing animation; completed and failed status uses a shared static semantic icon in session rows, activity entries and the activity bell. With no live run, the bell shows the latest unread event's icon and returns to the bell glyph when read.

## Validation

The reasoning section of the model menu uses the supplied Aceternity Preview
Slider with a floating text tooltip. Seven existing levels remain accessible
through pointer dragging, arrow keys, Home and End. Moving previews the level;
releasing saves it. Agent-driven Electron captures check light, dark, narrow
and reduced-motion layouts; see `tasks/chat-effort-preview-slider-20261124.md`.

Composer model, knowledge, permission and agent menus share the add control's
blur-to-clear motion, neutral surface and selection marks. Opening one closes
the previous menu; Escape and outside click dismiss it. Short and narrow windows
constrain the menu to available space with internal scrolling. Verify normal and
reduced motion with `tests/e2e/chat-composer-popovers.spec.ts` and agent-driven
Electron captures.

Empty Chat uses an unboxed project picker below the composer, with worktree
selection inside its menu. Observed file changes reveal a compact review bar
above the input, with the current branch, unique file count and a direct review
action. Its menu retains governed branch search, checkout and worktree actions.
The three starter actions live in a single Quick start disclosure; drafting
hides this entry without shifting the composer.

Chat output has no avatar gutter and shares the available conversation width
with the input. Adjacent operations form a folded group after their progress
explanation. Folded summaries use an unboxed operation icon and the latest action
text, entering left to right once with a continuous white running shimmer.
Expanded tool and command rows use CallChip progress strips with a background,
timer and completion check. Icons reflect the actual tool and its captured target.
Calls, late results and command output keep their original group. Completed
records remain static and preserve manual disclosure. Final replies, delivered
resources, errors and pending requests remain accessible.

Live planning has one primary entry in the task strip attached to the composer.
The solid task/input frame has a 16px radius. The collapsed row shows the objective, neutral count and necessary actions; current steps open below it. State uses a small muted icon, without a progress ring or border beam. Sent messages use opaque 12px cards with a fine border and contact shadow;
finishing the run steps preserves the task owner's acceptance status. Archived
plans remain in their turn disclosure. Knowledge scope, invocation mode and
retrieval profile share one menu, with non-local profiles labelled on the input.
Normal checkpoint records open on demand, while queues, read failures and
connection errors stay directly visible. An initial task read failure offers
inline refresh, preserves the draft and never replaces another session's task.
Verify these states with
`tests/e2e/chat-planning-composer-ux.spec.ts`.


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
- Pending questions, plan proposals and workspace approvals replace the composer with one shared decision surface while history scrolls. Runtime approvals have priority. Acceptance follows priority interruption and restoration, selection, submission, retry and request-specific acknowledgement, and checks draft preservation, light/dark and narrow layouts.
- `pnpm run test:e2e:run tests/e2e/chat-runtime-ux-acceptance.spec.ts tests/e2e/chat-long-task-control.spec.ts tests/e2e/runtime-approval-bridge.spec.ts`
- `pnpm run typecheck`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/windows-ui-v2.spec.ts tests/e2e/settings-drawer.spec.ts`

The execution context refinement in `tasks/chat-execution-context-20261123.md` moves project, directory and branch actions into one inset tray above the 22px composer. Task progress shares this tray. New worktrees use generated branch names with optional custom settings; current drafts are saved before switching.

The conversation controls in `tasks/chat-continuity-controls-20261123.md` explain the effect of queue, guide, interrupt, branch and summary handoff. Continuation drafts take priority over collapsed sources; compaction shows one usage reading. Menus stay within the conversation column as the sidebar or artifact panel changes its width.
