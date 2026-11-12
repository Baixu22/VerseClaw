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
| Notification Bell | Persistent sidebar header | Sessions with a run in flight appear above recent completions, errors and approval events. The bell gently swings while running, pauses while its panel is open, and stays still with reduced motion. Waiting uses amber ink and a corner dot when no unread badge is present. The badge sits clear of the icon and counts unread entries, coloured by severity. Consecutive entries of one conversation share a heading. Live state uses the same runtime projection as the row orbs. In a collapsed sidebar the toggle sits above the bell. |
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

The adapted controls use shared grayscale tokens, keyboard focus, Escape dismissal, reduced-motion fallbacks, and responsive bounds. The 40px Chat header keeps unboxed workspace and session names. Its title opens search, source navigation and derived conversations; More holds checkpoints, fork, handoff, refresh, recovery, execution migration and memory inspection. Menu dismissal retains active dialogs, and environment controls remain reachable beside workspace tabs. Family counts appear only while collapsed. Dark mode uses separate graphite surfaces for the frame, sidebar, conversation, menu and composer, with the header on the conversation plane. Empty task scopes and recovered cache warnings stay silent. Session & Recovery separates display settings from notifications and history. Labels use English, Chinese, Japanese, and Russian locale files.

Agent-driven Electron evidence is recorded under [`docs/dev/evidence/rareui-interactions`](evidence/rareui-interactions/README.md). The screenshots cover light surfaces, dark Markdown, a narrow reduced-motion window, menu selection, completion activity, duration editing, and both delete-confirmation states. The evidence explicitly records `driven_by: agent`; it does not claim human review.

## Source attribution

The adapted components live in `src/components/rareui`. Rare UI copyright, license text, and required attribution are retained there. Rare UI is created by Swami Malode and published at <https://rareui.com>.
