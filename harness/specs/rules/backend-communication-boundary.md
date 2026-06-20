---
id: backend-communication-boundary
title: Backend Communication Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - comms
---

Renderer backend calls must go through `src/lib/host-api.ts` and `src/lib/api-client.ts`.

Pages and components must not add direct `window.electron.ipcRenderer.invoke(...)` calls.

Renderer code must not call Gateway HTTP endpoints directly, including `127.0.0.1:18789` and `localhost:18789`.

Gateway transport policy remains owned by Electron Main. Renderer code must not implement `WS -> HTTP -> IPC` protocol switching.

New backend interfaces must be exposed through Electron Main or the host API layer before renderer code consumes them.

Renderer-provided chat intent metadata, such as knowledge scope or work mode, must be treated as untrusted preference data in Main-process services. It must not grant tools, bypass approval gates, or rewrite OpenClaw runtime policy directly.

Any communication path change must run the `comms` profile. If the communication result changes visible UI state, the task must run or add the relevant Electron E2E coverage.
