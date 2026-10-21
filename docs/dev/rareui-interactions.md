# Rare UI interaction adaptations

Date: 2026-10-21  
Evidence owner: `codex` (agent-driven Electron automation)

## Scope

Verse Claw adapts six compact interactions from [Rare UI](https://rareui.com) to existing product surfaces. This is a renderer-only change: it adds no host routes, transport behavior, runtime authority, approval behavior, or product-default changes.

| Surface | Production entry point | Behavior |
| --- | --- | --- |
| Hook Sidebar | Project and session menus | A travelling hook follows the selected or hovered row while preserving existing row actions. |
| Proximity Sidebar | Chat transcript left edge | After more than three visible user turns, a 28 px turn rail appears. Its tooltip contains a bounded prompt and assistant-response preview; selecting a mark scrolls only the transcript. |
| Rail TOC | Markdown file preview | A circular reading-progress control expands into a responsive, nested heading rail. Heading selection scrolls only the preview. |
| Duration Picker | Scheduled-task editor | Daily, weekly, and monthly cron expressions expose local hour/minute editing. Non-cron `every` and `at` schedules remain untouched unless the user explicitly edits the schedule. |
| Delete Button | Scheduled-task detail panel | The compact delete affordance opens the existing confirmation flow. Cancelling performs no delete host call, and failure never renders a success state. |
| Notification Bell | Persistent sidebar header | Completed runtime runs and completed visible assistant replies appear newest first. Active, failed, aborted, empty, and tool-only turns are excluded. |

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
