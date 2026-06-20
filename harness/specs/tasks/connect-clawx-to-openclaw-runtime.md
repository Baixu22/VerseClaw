---
id: connect-clawx-to-openclaw-runtime
title: Connect ClawX gateway startup to editable openclaw_runtime
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make ClawX prefer the editable openclaw_runtime tree for Gateway startup and runtime CLI helpers, while preserving an explicit npm fallback.
touchedAreas:
  - harness/specs/tasks/connect-clawx-to-openclaw-runtime.md
  - electron/gateway/config-sync.ts
  - electron/gateway/process-launcher.ts
  - electron/gateway/supervisor.ts
  - electron/services/openclaw-api.ts
  - electron/utils/control-ui-device-pairing.ts
  - electron/utils/openclaw-cli.ts
  - electron/utils/openclaw-doctor.ts
  - electron/utils/paths.ts
  - openclaw_runtime/src/gateway/server-startup-plugins.ts
  - package.json
  - resources/cli/**
  - scripts/build-openclaw-runtime.mjs
  - tests/unit/control-ui-device-pairing.test.ts
  - tests/unit/mock-provider.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/openclaw-doctor.test.ts
expectedUserBehavior:
  - Running ClawX in development starts Gateway from openclaw_runtime/dist/entry.js by default.
  - Gateway WebSocket connect.challenge handshake completes without requiring CLAWX_OPENCLAW_RUNTIME=source.
  - Provider auth pre-warm can resolve its runtime worker file from openclaw_runtime/dist.
  - Doctor, doctor repair, device approval, and packaged CLI wrappers use the same selected OpenClaw runtime as Gateway.
  - Setting CLAWX_OPENCLAW_RUNTIME=npm still forces the legacy npm package path.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
requiredTests:
  - pnpm run build:runtime
  - pnpm run typecheck:node
  - pnpm exec vitest run tests/unit/openclaw-cli.test.ts tests/unit/openclaw-doctor.test.ts tests/unit/control-ui-device-pairing.test.ts tests/unit/mock-provider.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - default pnpm dev smoke with Gateway handshake
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway HTTP directly.
  - Gateway launch logs show runtime=source and entry=openclaw_runtime\dist\entry.js when openclaw_runtime is present and no override is set.
  - Gateway reaches running state after the connect.challenge handshake.
  - openclaw_runtime/dist contains entry.js plus agents/model-provider-auth.worker.js, agents/code-mode.worker.js, and agents/compaction-planning.worker.js.
  - Runtime helper commands do not silently fall back to node_modules/openclaw while Gateway uses openclaw_runtime.
docs:
  required: false
---
