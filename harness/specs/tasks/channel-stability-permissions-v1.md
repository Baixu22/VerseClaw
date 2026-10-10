---
lifecycleStatus: archived
id: channel-stability-permissions-v1
title: Harden channel stability and permission visibility
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Align the Channels settings surface with OpenClaw/Hermes-style channel runtime signals by keeping connection state stable across Gateway turbulence and making channel/account access policy visible and auditable.
touchedAreas:
  - src/pages/Channels/index.tsx
  - src/lib/host-api.ts
  - electron/services/channels-api.ts
  - electron/utils/channel-status.ts
  - shared/types/channel.ts
  - shared/host-api/contract.ts
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-health-diagnostics.spec.ts
expectedUserBehavior:
  - Channels does not clear previously known accounts or bindings during transient Gateway status failures.
  - Users can see whether each channel/account is open, allowlist-based, pairing-gated, disabled, or unknown before relying on the connection.
  - Permission policy information is read-only in Channels and does not bypass OpenClaw runtime approval or workspace permission modes.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-health-diagnostics.spec.ts
acceptance:
  - Renderer continues to call channel data only through hostApi.
  - Channel account refreshes preserve stable data on timeout/error and expose degraded/last-refresh context to the UI.
  - Channel permission policy fields are typed, optional, safe for older Gateway responses, and rendered without leaking secrets.
  - E2E covers degraded channel status and permission policy visibility.
docs:
  required: false
---

Use this task spec when improving ClawX channel connection stability, Channel settings diagnostics, or channel/account permission policy visibility.
