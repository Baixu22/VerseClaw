---
id: session-ecosystem-production-reachability
title: Session ecosystem production reachability — sessions.stop registry gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make the existing governed sessions.stop runtime handler reachable through the real Gateway registry and observable by the Electron runtime-surface gate.
touchedAreas:
  - harness/specs/tasks/session-ecosystem-production-reachability.md
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.stop.test.ts
  - openclaw_runtime/src/gateway/session-ecosystem-production-reachability.test.ts
  - electron/gateway/manager.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - artifacts/session-ecosystem-production-reachability/report.json
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - An authenticated operator can address the existing sessions.stop RPC through the Gateway method registry.
  - Invalid sessions.stop parameters reach the method validator and return the standard INVALID_REQUEST shape instead of unknown method.
  - Electron handshake monitoring reports sessions.stop as a required runtime capability.
  - A missing required method cannot be masked by a later gateway.ready event or system-presence fallback probe.
  - The change does not add a renderer-facing stop API or enable goal-wake, durable-helper, or default-on lifecycle behavior.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-lifecycle-governance-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/session-ecosystem-production-reachability.md
  - pnpm harness validate --spec harness/specs/tasks/session-ecosystem-production-reachability.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-core.config.ts session-ecosystem-production-reachability.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts server-methods/sessions.stop.test.ts
  - pnpm --dir openclaw_runtime exec vitest --root .. run tests/unit/gateway-ready-fallback.test.ts --config vitest.agent-dev.node.config.ts --maxWorkers=1
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - coreGatewayHandlers contains sessions.stop and the lazy family resolves it without a lazy handler-not-found error.
  - The core descriptor for sessions.stop has operator.admin scope and is advertised in the Gateway method list.
  - A registry-backed sessions.stop request with invalid params returns INVALID_REQUEST, never unknown method.
  - Electron required-method monitoring includes sessions.stop and remains blocked when that method is absent from the handshake.
  - gatewayReady remains false while sessions.stop is missing, even if a ready event or fallback probe arrives.
  - No renderer, Host API, Goal-wake, durable-helper, or product default-on surface is added.
docs:
  required: false
  note: This is an internal Gateway reachability repair; public renderer behavior is intentionally unchanged.
---
