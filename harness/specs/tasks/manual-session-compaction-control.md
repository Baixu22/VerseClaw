---
lifecycleStatus: archived
id: manual-session-compaction-control
title: Manual current-session compaction control
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose runtime session compaction as a visible, confirmed Chat control without renderer-direct Gateway access.
touchedAreas:
  - src/lib/host-api.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - openclaw_runtime/packages/gateway-protocol/src/**
  - openclaw_runtime/src/gateway/**
expectedUserBehavior:
  - Chat composer context status shows a manual compression action for the current session.
  - Clicking the action opens a confirmation dialog with token pressure details and optional instructions.
  - Confirmed compression calls Main-owned Host API methods, then refreshes session history and context status.
  - Compression is disabled while a run is active or compaction is already in flight.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm run typecheck
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-services.test.ts -t compaction
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-manual-compaction.spec.ts
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not call Gateway HTTP or WebSocket endpoints directly.
  - Main proxies `sessions.compactionStatus`, `sessions.compactionHistory`, and `sessions.compact` through Gateway.
  - Gateway unavailable status is diagnostic rather than silent failure.
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

Manual session compaction is a control-plane feature for lowering transcript pressure in the active Chat session. It does not mutate Task Ledger, Context Pack, memory, or observability state automatically.
