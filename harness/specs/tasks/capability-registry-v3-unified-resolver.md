---
id: capability-registry-v3-unified-resolver
title: Capability Registry V3 unified resolver and Tool Search fallback
scenario: capability-registry-v3
taskType: runtime-opt-in
diffBase: 8306466d175016a938703c41125dc3a3dca68390
intent: Implement V3-04 as an explicit opt-in categories/discover/describe/load/execute/reflect resolver that delegates Tool L3 and execution to the existing Tool Search runtime through V3 leases.
ownedPaths:
  - docs/dev/capability-registry-v3-*-acceptance.md
  - docs/architecture-overview.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-*.md
  - openclaw_runtime/src/capabilities/v3/**
  - openclaw_runtime/src/agents/tool-search-capability-v3.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.test.ts
touchedAreas:
  - docs/dev/capability-registry-v3-unified-resolver-acceptance.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-unified-resolver.md
  - openclaw_runtime/src/capabilities/v3/unified-resolver.ts
  - openclaw_runtime/src/capabilities/v3/unified-resolver.test.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.test.ts
expectedUserBehavior:
  - Flag-off Tool Search, prompt, tool set, invocation, hooks, approval, errors, retry, transcript, storage, Host API, and UI remain byte/behavior compatible.
  - Explicit opt-in callers can traverse categories, discover descriptors, describe metadata, load an owner contract, execute a Tool through a valid V3 lease, and reflect a bounded summary.
  - Tool Search continues to own ranking, full schema materialization, target Tool execution, and its existing runtime executor path.
requiredProfiles:
  - fast
requiredRules:
  - capability-registry-v3-boundary
forbiddenPatterns:
  - direct invocation of ToolSearch catalog entry.tool.execute from V3 code
  - bypassing ToolSearchRuntime.callExactId, existing before-tool hooks, approval, schema validation, abort, or existing error behavior
  - default-on configuration, prompt mutation, DCS projection, Code Mode changes, provider transport changes, Host API, Electron, Renderer, or persistence
featureFlags:
  - Unified resolver and Tool Search adapter require explicit enabled=true input. No application setting or default change is added in V3-04.
rollback:
  - Stop constructing the opt-in resolver/adapter or remove the unused modules. Existing Tool Search remains unchanged and owns all active execution.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/capability-registry-v3-unified-resolver.md
  - pnpm harness validate --spec harness/specs/tasks/capability-registry-v3-unified-resolver.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/capabilities/v3/capability-descriptor.test.ts src/capabilities/v3/evaluation-baseline.test.ts src/capabilities/v3/shadow-catalog.test.ts src/capabilities/v3/skill-resolver.test.ts src/capabilities/v3/trusted-catalog.test.ts src/capabilities/v3/unified-resolver.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/tool-search-capability-v3.test.ts
  - pnpm --dir openclaw_runtime exec oxlint --type-aware --type-check --tsconfig=config/tsconfig/oxlint.core.json --deny-warnings src/capabilities/v3/capability-descriptor.ts src/capabilities/v3/capability-descriptor.test.ts src/capabilities/v3/adapters.ts src/capabilities/v3/evaluation-baseline.ts src/capabilities/v3/evaluation-baseline.test.ts src/capabilities/v3/shadow-catalog.ts src/capabilities/v3/shadow-catalog.test.ts src/capabilities/v3/skill-resolver.ts src/capabilities/v3/skill-resolver-evaluation.ts src/capabilities/v3/skill-resolver.test.ts src/capabilities/v3/trusted-catalog.ts src/capabilities/v3/trusted-catalog.test.ts src/capabilities/v3/unified-resolver.ts src/capabilities/v3/unified-resolver.test.ts src/agents/tool-search-capability-v3.ts src/agents/tool-search-capability-v3.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run lint:check
  - pnpm run typecheck
  - git diff --check
acceptance:
  - The resolver exposes explicit categories, discover, describe, load, execute, and reflect operations with closed success/failure results.
  - Disabled construction and methods do not inspect the catalog or call Skill, Context, Tool Search, or trusted-catalog delegates.
  - Tool Search compatibility uses ToolSearchRuntime.search for fallback ranking, ToolSearchRuntime.describe for full schema loading, and ToolSearchRuntime.callExactId for execution.
  - Tool descriptors store only a schema hash; load recomputes and verifies the Tool Search schema hash before returning L3.
  - Execute requires a valid V3 lease and delegates through the trusted catalog to Tool Search; lease failure produces zero target executor calls.
  - Existing Tool Search behavior remains the flag-off path and no current production caller is changed in V3-04.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - docs/dev/capability-registry-v3-unified-resolver-acceptance.md
---

# Capability Registry V3-04: Unified Resolver and Tool Search Fallback

The compatibility adapter reads the already-built Tool Search catalog through
its public runtime methods. It does not reach into catalog storage or invoke a
target Tool directly. A Tool Search entry becomes a V3 descriptor plus a
runtime-only trusted registration; the descriptor retains a schema hash, while
`load` asks Tool Search for the current full schema and verifies that hash.

No production caller is switched in this package. V3-08 owns any controlled
rollout decision after DCS, Code Mode, native adapter, and observability work.
