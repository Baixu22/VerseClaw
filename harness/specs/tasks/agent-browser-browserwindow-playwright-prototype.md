---
id: agent-browser-browserwindow-playwright-prototype
title: Agent Browser BrowserWindow Playwright prototype
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a minimal internal Electron BrowserWindow-backed agent browser surface that can be driven by agent/runtime calls without requiring an external Chrome or agent browser install.
touchedAreas:
  - harness/specs/tasks/agent-browser-browserwindow-playwright-prototype.md
  - electron/main/ipc-handlers.ts
  - electron/services/agent-browser-api.ts
  - electron/services/agent-browser-service.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.ts
  - openclaw_runtime/src/agents/tools/web-tools.ts
  - tests/unit/agent-browser-service.test.ts
  - tests/unit/agent-browser-tool.test.ts
expectedUserBehavior:
  - Agent/runtime code can request a persistent internal browser page and drive basic navigate, click, type, wait, screenshot, evaluate, and close actions.
  - The prototype defaults to headless BrowserWindow operation while retaining a visibility option for user-observable sessions.
  - The implementation uses Electron-owned browser state and does not require a separately installed Chrome or external agent browser process.
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
  - Headless mode can create, navigate, inspect text, and close a browser session.
  - Sensitive future flows have an explicit place to add user confirmation and visible takeover.
docs:
  required: false
---

Use this task spec for the first internal Agent Browser prototype using Electron BrowserWindow plus Playwright-compatible control surfaces.
