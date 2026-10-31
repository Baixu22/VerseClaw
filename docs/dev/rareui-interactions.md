# Rare UI interaction adaptations

Date: 2026-10-21  
Evidence owner: `codex` (agent-driven Electron automation)

## Scope

Verse Claw adapts seven compact interactions from [Rare UI](https://rareui.com) to existing product surfaces. This is a renderer-only change: it adds no host routes, transport behavior, runtime authority, approval behavior, or product-default changes.

| Surface | Production entry point | Behavior |
| --- | --- | --- |
| Hook Sidebar | Project and session menus; sidebar session list | A travelling hook follows the selected or hovered row while preserving existing row actions. In the sidebar the hook branches out of the project's folder icon into its current session, drawn quieter than a menu's selection rail so it reads as structure. |
| Proximity Sidebar | Chat transcript left edge | After more than three visible user turns, a 28 px turn rail appears. Its tooltip contains a bounded prompt and assistant-response preview; selecting a mark scrolls only the transcript. |
| Rail TOC | Markdown file preview | A circular reading-progress control sits at the preview's bottom-right and expands into a nested heading rail sized against the preview, so it never blankets the text. Heading selection scrolls only the preview. |
| Duration Picker | Scheduled-task editor | Daily, weekly, and monthly cron expressions expose local hour/minute editing. Non-cron `every` and `at` schedules remain untouched unless the user explicitly edits the schedule. |
| Delete Button | Scheduled-task detail panel | The compact delete affordance opens the existing confirmation flow. Cancelling performs no delete host call, and failure never renders a success state. |
| Notification Bell | Persistent sidebar header | Completed runtime runs and completed visible assistant replies appear newest first. Active, failed, aborted, empty, and tool-only turns are excluded from the feed. Sessions with a run in flight are listed above it with an elapsed-time clock, and the bell carries a live ring (a blue comet while running, a breathing amber ring while a session waits on the user). Unread entries show as a count badge coloured by the most severe entry; consecutive entries of one conversation share a heading. The live state comes from the same runtime status that drives the sidebar's row orbs. |
| Theme Selector | Settings > General > Theme | A row of miniature app previews for Light, Dark, and System replaces the segmented control. Each miniature is drawn in the palette it depicts, so the light card stays light while the app is dark; System splices the two diagonally. Selection applies immediately, persists through the existing settings store, and keeps a single roving tab stop with arrow/Home/End keys. |
| Web Search | Chat tool results | Provider search query, answer summary, and landed sources render as a collapsible pill plus a source-card grid. The reference's circular globe ring is replaced by the same left-to-right progress wash ReactBits CallChip uses, so an in-flight search fills as a bar instead of an arc. |

## Runtime and data boundaries

- The turn rail is derived from real, mounted user messages. It appears at four user prompts, not three.
- Tooltips strip Markdown/code and use visible assistant text. They do not expose hidden reasoning or internal tool output.
- Markdown heading IDs are scoped per preview. Duplicate headings retain distinct anchors, and fenced-code headings are excluded.
- Completion notifications use the existing run projection and visible reply timestamps. They do not use timers or fabricated progress.
- The cron editor preserves untouched `every` and `at` jobs by omitting the existing schedule from the update payload. Edited cron expressions continue through the existing host API.
- The bell and menus use the existing renderer/host boundary; no renderer-to-Gateway or direct IPC path was added.

## Accessibility and presentation

The adapted controls use existing compact grayscale tokens, keyboard focus, Escape dismissal, reduced-motion fallbacks, and responsive bounds. New user-facing labels are present in English, Chinese, Japanese, and Russian locale files.

Agent-driven Electron evidence is recorded under [`docs/dev/evidence/rareui-interactions`](evidence/rareui-interactions/README.md). The screenshots cover light surfaces, dark Markdown, a narrow reduced-motion window, menu selection, completion activity, duration editing, and both delete-confirmation states. The evidence explicitly records `driven_by: agent`; it does not claim human review.

## Source attribution

The adapted components live in `src/components/rareui`. Rare UI copyright, license text, and required attribution are retained there. Rare UI is created by Swami Malode and published at <https://rareui.com>.
