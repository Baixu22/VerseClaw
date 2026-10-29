---
id: rareui-conversation-interactions
title: Conversation navigation and workspace reading interactions
type: scenario
requiredRules:
  - rareui-interaction-adaptation
  - renderer-main-boundary
  - i18n-locale-coverage
  - docs-sync
pathPatterns:
  - src/components/rareui/**
  - src/pages/Settings/**
  - src/pages/Chat/**
  - src/pages/Cron/**
  - src/components/file-preview/**
  - src/components/layout/**
---

1. Select a project or session through its existing menu and observe the hook following the selection.
2. Send at least four user prompts. Confirm the proximity rail sits at the sidebar/main-area boundary, hover a mark to preview the prompt and assistant response, then select it to navigate the transcript.
3. Open a Markdown file in the workspace. Expand the circular progress control and select a nested heading in the rail TOC.
4. Edit a daily, weekly, or monthly cron time. Save through the existing cron host API and reopen to verify the schedule. Saving an untouched every/at task keeps the original schedule.
5. Open the animated delete affordance. Cancel safely or confirm through the existing confirmation flow.
6. Complete a run. Open the bell in the persistent sidebar header, above Projects, to see the latest completed activity first and return to that activity's session or turn.
7. Completed web-search tool results render a search pill whose progress fill advances left to right, with landed sources shown as openable cards. The Rare UI reference's circular globe ring is intentionally replaced.

Run these interactions with agent-driven Electron automation; record light/dark/narrow/reduced-motion screenshots without claiming real-human evidence.
