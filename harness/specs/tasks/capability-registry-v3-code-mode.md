---
id: capability-registry-v3-code-mode
title: Capability Registry V3 Code Mode bridge
scenario: capability-registry-v3
taskType: runtime-opt-in
diffBase: fafa493fabd7e7c0c448f6b0a275c87eb13afb46
intent: Implement V3-06 as an explicit opt-in adapter over the existing Tool Search Code Mode sandbox, routing search/describe/call through V3 descriptors, trusted leases, and ArchiveHandle-backed Result Pointers.
ownedPaths:
  - docs/dev/capability-registry-v3-*-acceptance.md
  - docs/dev/capability-registry-v3-development-plan.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-*.md
  - openclaw_runtime/src/capabilities/v3/**
  - openclaw_runtime/src/agents/tool-search.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.test.ts
  - openclaw_runtime/src/agents/tool-search-code-mode-v3.test.ts
  - openclaw_runtime/src/infra/circuit-breaker.ts
  - openclaw_runtime/src/infra/circuit-breaker.test.ts
residualPaths:
  - .agent-workbench/task-forest/exports/task-forest.graph.json
  - .agent-workbench/task-forest/exports/task-forest.html
  - .agent-workbench/task-forest/graph/forest.json
touchedAreas:
  - harness/src/cli.mjs
  - harness/src/report.mjs
  - harness/src/rules.mjs
  - tests/unit/harness-specs.test.ts
  - docs/dev/capability-registry-v3-code-mode-acceptance.md
  - docs/dev/capability-registry-v3-development-plan.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-code-mode.md
  - openclaw_runtime/src/agents/tool-search.ts
  - openclaw_runtime/src/agents/tool-search-code-mode-v3.test.ts
  - openclaw_runtime/src/capabilities/v3/code-mode-capability-v3.ts
  - openclaw_runtime/src/infra/circuit-breaker.ts
  - openclaw_runtime/src/infra/circuit-breaker.test.ts
expectedUserBehavior:
  - With V3 disabled, existing Tool Search Code Mode sandbox, Tool Search tools, prompt, approval, abort, timeout, retry, transcript, result payload, and tool_registry behavior remain unchanged.
  - Explicit opt-in callers can run existing Code Mode source against a V3 bridge: tools.search returns V3 navigation, tools.describe loads current L3 schema, and tools.call verifies a per-call lease before using the existing Tool Search executor path.
  - Code Mode tool-call results are returned as bounded Result Pointers, not raw large result bodies; duplicate bridge deliveries for one request id do not repeat a target side effect.
requiredProfiles:
  - fast
requiredRules:
  - capability-registry-v3-boundary
forbiddenPatterns:
  - creating a second code sandbox, child-process protocol, tool executor, approval path, or archive store
  - direct catalog Tool invocation, bypassing ToolSearchRuntime.callExactId, trusted lease validation, existing hook/approval/schema validation, timeout, or abort
  - raw target result bodies in the Code Mode bridge return shape, default-on configuration, prompt mutation, DCS changes, provider transport, Host API, Electron, Renderer, or persistence
featureFlags:
  - V3 Code Mode construction requires explicit enabled=true input. Existing Tool Search Code Mode remains the default implementation and no application setting changes.
rollback:
  - Stop constructing the V3 Code Mode adapter. Existing Tool Search Code Mode keeps its original runtime bridge and behavior.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/capability-registry-v3-code-mode.md
  - pnpm harness validate --spec harness/specs/tasks/capability-registry-v3-code-mode.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/capabilities/v3/capability-descriptor.test.ts src/capabilities/v3/evaluation-baseline.test.ts src/capabilities/v3/shadow-catalog.test.ts src/capabilities/v3/skill-resolver.test.ts src/capabilities/v3/trusted-catalog.test.ts src/capabilities/v3/unified-resolver.test.ts src/capabilities/v3/dcs-projection.test.ts src/capabilities/v3/result-pointer.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/tool-search-capability-v3.test.ts src/agents/tool-search-code-mode-v3.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run lint:check
  - pnpm run typecheck
  - git diff --check
acceptance:
  - Disabled V3 Code Mode construction/run does not invoke the existing sandbox, resolver, trusted catalog, Result Pointer, or Tool Search runtime.
  - V3 reuses the existing Tool Search Code Mode sandbox source and bridge protocol; existing non-V3 Code Mode behavior remains unchanged.
  - Search and describe preserve V3 progressive disclosure; call issues a session-bound lease, routes through the V3 resolver and existing ToolSearchRuntime.callExactId, forwards abort/progress, then revokes the lease.
  - Every successful V3 Code Mode call returns pointer metadata only. Pointer creation/verification failures fail closed and expose no raw target result.
  - Replayed bridge calls with the same request id are idempotent within a Code Mode run and produce at most one target executor invocation.
  - Approval/schema/timeout/abort remain owned by the existing Tool Search Code Mode/Tool Search path, and no default active caller changes.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - docs/dev/capability-registry-v3-code-mode-acceptance.md
---

# Capability Registry V3-06: Code Mode Bridge

V3-06 refactors the existing Tool Search Code Mode runner only enough to accept
a caller-provided bridge. The legacy runner continues passing its own
`ToolSearchRuntime`. The V3 bridge is a separate opt-in caller that uses the
same sandbox/process protocol while routing each operation through V3 ownership.
