---
id: capability-registry-v3-provider-native
title: Capability Registry V3 provider-native deferred adapter
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 8306466d175016a938703c41125dc3a3dca68390
intent: Implement V3-07 as an explicit provider/model/workflow allowlisted deferred-loading adapter over caller-owned provider transport, with bounded retry, circuit breaking, idempotent fallback, and the existing V3 resolver/lease execution path.
ownedPaths:
  - docs/dev/capability-registry-v3-*-acceptance.md
  - docs/dev/capability-registry-v3-development-plan.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-*.md
  - openclaw_runtime/src/capabilities/v3/**
  - openclaw_runtime/src/infra/circuit-breaker.ts
  - openclaw_runtime/src/infra/circuit-breaker.test.ts
  - openclaw_runtime/src/agents/tool-search.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.test.ts
  - openclaw_runtime/src/agents/tool-search-code-mode-v3.test.ts
residualPaths:
  - .agent-workbench/task-forest/exports/task-forest.graph.json
  - .agent-workbench/task-forest/exports/task-forest.html
  - .agent-workbench/task-forest/graph/forest.json
touchedAreas:
  - harness/src/cli.mjs
  - harness/src/report.mjs
  - harness/src/rules.mjs
  - tests/unit/harness-specs.test.ts
  - docs/dev/capability-registry-v3-provider-native-acceptance.md
  - docs/dev/capability-registry-v3-development-plan.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-provider-native.md
  - openclaw_runtime/src/capabilities/v3/provider-native-capability-v3.ts
  - openclaw_runtime/src/capabilities/v3/provider-native-capability-v3.test.ts
  - openclaw_runtime/src/infra/circuit-breaker.ts
  - openclaw_runtime/src/infra/circuit-breaker.test.ts
  - openclaw_runtime/src/agents/tool-search.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.test.ts
  - openclaw_runtime/src/agents/tool-search-code-mode-v3.test.ts
expectedUserBehavior:
  - With V3 provider-native disabled, unsupported by the provider probe, or outside the provider/model/workflow allowlist, no native request is serialized or sent and the existing V3 proxy caller remains the only optional fallback.
  - Explicit opt-in callers can defer capability discovery/loading to an existing provider owner without V3 taking ownership of provider HTTP/WebSocket/IPC transport.
  - Native events are parsed into either an unstarted request that may safely fall back, a started/completed request that must never be replayed through proxy, or a bounded failure.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - capability-registry-v3-boundary
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
  - direct fetch, WebSocket, IPC, provider SDK, Gateway, Host API, Electron, Renderer, config, prompt, transcript, or persistence integration
  - upgrading diagnostics-only ToolProviderRegistry to execution authority
  - fallback after a native side effect is reported started, completed, or ambiguous
  - bypassing the V3 resolver, trusted lease, Tool Search executor, schema, policy, approval, timeout, or abort owners
  - default-on behavior, wildcard allowlists, raw credentials, raw target results, or a second transport/router
featureFlags:
  - Construction requires enabled=true plus an exact provider/model/workflow allowlist match. No application config or default caller changes.
rollback:
  - Stop constructing the adapter. Existing provider transport and V3 proxy fallback remain unchanged.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/capability-registry-v3-provider-native.md
  - pnpm harness validate --spec harness/specs/tasks/capability-registry-v3-provider-native.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/capabilities/v3/capability-descriptor.test.ts src/capabilities/v3/evaluation-baseline.test.ts src/capabilities/v3/shadow-catalog.test.ts src/capabilities/v3/skill-resolver.test.ts src/capabilities/v3/trusted-catalog.test.ts src/capabilities/v3/unified-resolver.test.ts src/capabilities/v3/dcs-projection.test.ts src/capabilities/v3/result-pointer.test.ts src/capabilities/v3/provider-native-capability-v3.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.infra.config.ts src/infra/circuit-breaker.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run lint:check
  - pnpm run typecheck
  - git diff --check
acceptance:
  - Disabled/probe-miss/allowlist-miss lanes are inert toward the native owner and return a stable proxy fallback or disabled result.
  - Native discovery and schema load serialize current V3 resolver output; every execution request carries a unique request id and correlation metadata but no trusted executor or credentials.
  - Retry occurs only for explicitly retryable pre-start failures, uses bounded delay and abort propagation, and opens a reusable circuit breaker after the configured threshold.
  - Proxy fallback occurs only when native execution is proven not started. Once started, completed, or ambiguous, failures return fail-closed and never repeat a target side effect.
  - Replayed request ids return the same in-run promise/result and invoke at most one native or proxy execution.
  - The adapter introduces no provider transport caller, application config, prompt mutation, storage, UI, or default activation.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - docs/dev/capability-registry-v3-provider-native-acceptance.md
---

# Capability Registry V3-07: Provider-native deferred adapter

V3-07 defines a generic, caller-injected transport contract. Provider owners
retain request delivery and event streaming. V3 owns only gated request/event
normalization and safe fallback decisions over its accepted resolver/lease path.
