---
id: gateway-backend-communication
title: Gateway Backend Communication
type: runtime-bridge
ownedPaths:
  - src/lib/api-client.ts
  - src/lib/host-api.ts
  - src/stores/gateway.ts
  - src/stores/chat.ts
  - src/stores/chat/**
  - electron/main/ipc/**
  - electron/services/**
  - electron/gateway/**
  - electron/preload/**
  - electron/utils/**
requiredProfiles:
  - fast
  - comms
conditionalProfiles:
  e2e:
    when:
      - user-visible gateway status changes
      - user-visible chat send/receive behavior changes
      - channels/agents/settings UI depends on new backend response shape
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - channel-plugin-migration-guards
  - capability-owner-resolution
  - active-config-guards
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - window.electron.ipcRenderer.invoke in src/pages/**
  - window.electron.ipcRenderer.invoke in src/components/**
  - fetch('http://127.0.0.1:18789 in src/**
  - fetch("http://127.0.0.1:18789 in src/**
  - fetch('http://localhost:18789 in src/**
  - fetch("http://localhost:18789 in src/**
  - fetch('http://[::1]:18789 in src/**
  - fetch("http://[::1]:18789 in src/**
  - new WebSocket('ws://127.0.0.1:18789 in src/**
  - new WebSocket("ws://127.0.0.1:18789 in src/**
  - new WebSocket('ws://localhost:18789 in src/**
  - new WebSocket("ws://localhost:18789 in src/**
  - new WebSocket('ws://[::1]:18789 in src/**
  - new WebSocket("ws://[::1]:18789 in src/**
---

Gateway backend communication covers all Verse Claw paths that move data between the visual desktop UI and OpenClaw runtime/backend services.

Allowed flow:
Renderer page/component -> `src/lib/host-api.ts` or `src/lib/api-client.ts` -> Electron Main typed host service or IPC handler -> Main-owned OpenClaw Gateway WebSocket -> runtime result -> store/UI.

Renderer code must not own transport selection, direct IPC channels, direct Gateway HTTP calls, retry policy, or protocol fallback.

Renderer code must not create direct Gateway WebSocket connections. Gateway frame diagnostics must be emitted by Main-process Gateway logging.

Provider readiness must recognize resolvable environment SecretRefs in Main without persisting their values. Missing variables, incompatible secret provider sources, and allowlist exclusions must remain unavailable; renderer receives only the existing masked key status.

Channel/plugin migration behavior is also part of this scenario when Verse Claw rewrites OpenClaw config before Gateway launch. Upgrades must preserve single-owner channel registration for migrated plugin-backed channels such as Feishu/Lark.

Chat composer intent metadata, including per-message knowledge scope and work mode, must cross this boundary through the typed host API. Main process may annotate runtime messages with untrusted metadata blocks, but renderer UI state must not bypass host-api/api-client or directly alter Gateway/OpenClaw tool policy.

Tool cancellation must survive runtime adaptation, client delegation, policy evaluation, plugin approval registration, and process input waits. Cancelled calls must not return late success or a pending client handoff. Process polling preserves unread output and the execution owner's terminal status; removing a process prevents late exit callbacks from restoring its entry. Repeated delivery of the same tool outcome must not inflate loop evidence.

Pending preparation and policy promises must release their local wait on cancellation without waiting for the plugin to return. Input acknowledgements must report a process that exited during the write with its owner's terminal status and output. Session alias merges must not duplicate a tool call, and changes to process poll wait duration must not reset otherwise unchanged loop evidence.

## Explicit coding diagnostics

An explicitly selected runtime diagnostic consumer may observe destructive-tier classification rates through the existing diagnostic logger. It must not create approvals or alter tool effects; missing/expired windows are unavailable, not healthy. See `coding-approval-rate-diagnostics` and task `harness-gap-approval-rate-alerts`. Main-process copies of process-local counters do not count as runtime observations.
