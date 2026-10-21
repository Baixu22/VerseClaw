# Rare UI interaction evidence

These files are curated, agent-driven evidence for the Rare UI interaction adaptation on 2026-10-21.

- Actor: `codex`
- `driven_by`: `agent`
- Environment: Windows Electron automation through Playwright
- Product locks and runtime defaults: unchanged

## Interaction results

- `interaction-results.json` records the three-turn/four-turn threshold, the rail's sidebar/main-area boundary position, the bell's sidebar-header location, prompt and response tooltip content, five newest-first completion entries, six Markdown headings, isolated preview scrolling, Escape dismissal, light/dark/narrow/reduced-motion screenshots, and zero renderer page errors.
- `schedule-results.json` records `09:15` to `10:30` cron editing, reopening the saved value, preserving an untouched `every` schedule, no delete call after cancellation, and confirmed deletion through the existing dialog.

## Screenshots

- `screenshots/conversation-proximity-light.png`
- `screenshots/completion-bell-light.png`
- `screenshots/session-hook-light.png`
- `screenshots/markdown-toc-light.png`
- `screenshots/markdown-toc-dark.png`
- `screenshots/conversation-narrow-reduced-dark.png`
- `screenshots/cron-duration-edit-light.png`
- `screenshots/delete-hover-light.png`
- `screenshots/delete-confirmation-light.png`

The screenshots are generated from the E2E fixture and do not claim real-human validation or live-provider coverage.
