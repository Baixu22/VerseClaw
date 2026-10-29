# Rare UI interaction evidence

These files are curated, agent-driven evidence for the Rare UI interaction adaptation on 2026-10-21.

- Actor: `codex`
- `driven_by`: `agent`
- Environment: Windows Electron automation through Playwright
- Product locks and runtime defaults: unchanged

## Interaction results

- `interaction-results.json` records the three-turn/four-turn threshold, the rail's sidebar/main-area boundary position, the bell's sidebar-header location, prompt and response tooltip content, five newest-first completion entries, six Markdown headings, the TOC card's bottom-right anchor plus its container-relative width/height bounds (<80% / <75% of the preview), isolated preview scrolling, Escape dismissal, light/dark/narrow/reduced-motion screenshots, and zero renderer page errors.
- `theme-selector-results.json` records the Settings theme picker: click/keyboard activation, roving tab stop, persistence, per-miniature palettes (the light card stays light in dark mode), the split System preview, and no horizontal overflow at 1695/1000/820 px, captured through ego-browser rather than Electron.
- `schedule-results.json` records `09:15` to `10:30` cron editing, reopening the saved value, preserving an untouched `every` schedule, no delete call after cancellation, and confirmed deletion through the existing dialog.

## Screenshots

- `screenshots/conversation-proximity-light.png`
- `screenshots/completion-bell-light.png`
- `screenshots/session-hook-light.png`
- `screenshots/theme-selector-dark.png`
- `screenshots/theme-selector-light.png`
- `screenshots/theme-selector-en-dark.png`
- `screenshots/theme-selector-keyboard-focus.png`
- `screenshots/theme-selector-narrow-1000.png`
- `screenshots/markdown-toc-light.png`
- `screenshots/markdown-toc-dark.png`
- `screenshots/conversation-narrow-reduced-dark.png`
- `screenshots/cron-duration-edit-light.png`
- `screenshots/delete-hover-light.png`
- `screenshots/delete-confirmation-light.png`

The conversation, Markdown, cron, and delete screenshots are generated from the Electron E2E fixture. The theme-selector screenshots are generated through ego-browser against the built renderer with the browser-only mock host bridge, because the current shell has no interactive desktop session for Electron windows. None of these claim real-human validation or live-provider coverage.
