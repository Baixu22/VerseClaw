---
id: chat-work-mode-v2
title: Chat work mode v2 office artifacts
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Extend Chat Work Modes from simple tool-bundle intent labels into artifact-focused Work Kits without changing permissions or runtime tool policy.
touchedAreas:
  - shared/types/work-mode.ts
  - shared/host-api/contract.ts
  - electron/services/chat-api.ts
  - electron/services/skills-api.ts
  - electron/gateway/skill-installer.ts
  - src/pages/Settings/**
  - src/pages/Chat/**
  - src/components/chat/WorkModeSummaryPanel.tsx
  - src/components/file-preview/**
  - shared/i18n/locales/**/chat.json
  - shared/i18n/locales/**/settings.json
  - tests/unit/work-mode.test.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/work-mode-summary-panel.test.tsx
  - tests/e2e/chat-work-mode.spec.ts
expectedUserBehavior:
  - Users can configure Work Kits for each work mode from Settings.
  - Docs/Data defaults to reports, sheets, slides, and PDF kits.
  - Kit status reflects local skill availability, disabled skills, runtime availability, and optional external capability hints.
  - Missing built-in Office skills can be installed only through explicit user action.
  - Chat sends carry untrusted work mode kit metadata and capability summaries.
  - Work Kits do not change workspace permission mode, approval gates, sandbox policy, or OpenClaw tool allow/deny policy.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - tests/unit/work-mode.test.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/work-mode-summary-panel.test.tsx
  - tests/e2e/chat-work-mode.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Work Kit registry defines ids, artifact types, required skill slugs, optional external markers, quality checks, and library notes.
  - Existing workModeToolBundles settings remain backward compatible and can seed kit resolution.
  - workModeKits settings persist independently for v2 UI.
  - Main-process chat metadata includes kits, expected artifact types, quality checks, and capability status summaries as untrusted hints only.
  - Built-in skill install is restricted to an explicit allowlist and workspace-safe target paths.
  - All new user-facing strings are covered in en, zh, ja, and ru locale files.
docs:
  required: true
---

Work Mode v2 keeps Verse Claw-owned behavior presets separate from real runtime authority. Renderer UI may recommend and display Work Kits, while Main injects only untrusted intent metadata into chat sends.
