---
lifecycleStatus: archived
id: agent-browser-browserwindow-playwright-prototype
title: Agent Browser OS workbench and secure automation runtime
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Turn the internal Electron BrowserWindow-backed agent browser into a user-facing workbench with headed and headless sessions, secure credentials, site data, task lifecycle, approvals, and evidence without requiring an external Chrome install.
touchedAreas:
  - harness/specs/tasks/agent-browser-browserwindow-playwright-prototype.md
  - electron/main/ipc-handlers.ts
  - electron/services/agent-browser-api.ts
  - packages/versebrowser/src/engine/service.ts
  - packages/versebrowser/src/engine/vault.ts
  - packages/versebrowser/src/engine/task-service.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - src/lib/host-api.ts
  - src/components/settings/BrowserSettingsPanel.tsx
  - src/components/layout/Sidebar.tsx
  - src/pages/Cron/index.tsx
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.ts
  - openclaw_runtime/src/agents/tools/web-tools.ts
  - packages/versebrowser/tests/agent-browser-service.test.ts
  - packages/versebrowser/tests/agent-browser-vault.test.ts
  - packages/versebrowser/tests/agent-browser-task-service.test.ts
  - tests/unit/agent-browser-tool.test.ts
  - tests/e2e/agent-browser-workbench.spec.ts
expectedUserBehavior:
  - Users can inspect and control persistent headed and headless Electron browser sessions from a dedicated Browser workbench.
  - Users can create immediate browser tasks, monitor their lifecycle, cancel or retry them, and inspect redacted run evidence.
  - Browser profiles expose site-data management while preserving existing Electron partition login state.
  - Passwords are encrypted with Electron safeStorage, never returned to Renderer or Agent tools, and are filled only after scoped authorization.
  - Sensitive final actions are blocked in Electron Main unless a valid session or task authorization is supplied.
  - Bundled Agent Browser CLI remains an explicit advanced compatibility path rather than the default managed engine.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway HTTP directly.
  - Agent browser control is owned by Electron Main/Host API boundaries.
  - Managed headed and headless modes share Electron partition state and browser actions.
  - Headless sessions can be shown for takeover and hidden again without recreation.
  - Vault persistence fails closed when safeStorage encryption is unavailable and contains no plaintext password.
  - Credential results contain metadata only and enforce Profile plus HTTPS origin matching.
  - Sensitive actions without scoped authorization enter a waiting-approval state and do not click the page.
  - Cookie and localStorage changes are performed by Main and are observable in the active profile partition.
  - Browser workbench, Cron, Web Preview, Host API, Gateway bridge, and agent_browser tool use aligned contracts.
  - User-visible strings cover en, zh, ja, and ru, with targeted Electron E2E coverage.
docs:
  required: true
---

Use this task spec for the Agent Browser OS workbench and secure Electron automation runtime.
