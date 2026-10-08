---
id: capability-registry-v3-dcs-result-pointer
title: Capability Registry V3 DCS projection and Result Pointer
scenario: capability-registry-v3
taskType: runtime-opt-in
diffBase: 8306466d175016a938703c41125dc3a3dca68390
intent: Implement V3-05 as an explicit opt-in metadata-only DCS projection with bounded namespace/capability reads and an ArchiveHandle-backed, budgeted Result Pointer facade.
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
  - docs/dev/capability-registry-v3-dcs-result-pointer-acceptance.md
  - docs/architecture-overview.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-dcs-result-pointer.md
  - openclaw_runtime/src/capabilities/v3/dcs-projection.ts
  - openclaw_runtime/src/capabilities/v3/dcs-projection.test.ts
  - openclaw_runtime/src/capabilities/v3/result-pointer.ts
  - openclaw_runtime/src/capabilities/v3/result-pointer.test.ts
expectedUserBehavior:
  - With V3 disabled, DCS, prompt text/order, tool_registry, context_read, Tool execution, archives, storage, Host API, UI, and legacy Result payloads remain unchanged.
  - Explicit opt-in callers can obtain a bounded navigation-only projection, then read one namespace or one capability without exposing executors or full Tool schemas in the root projection.
  - Explicit opt-in callers can archive a large result through the existing context archive owner and receive a session/task-scoped pointer whose slice, search, and read operations are bounded and checksum verified.
requiredProfiles:
  - fast
requiredRules:
  - capability-registry-v3-boundary
  - context-family-boundary
  - dcs-stage3-tool-registry-boundary
forbiddenPatterns:
  - adding a second archive store, direct archive-file reads, direct SQLite access, BlockStore construction, or a new capability database
  - replacing or mutating the existing tool_registry producer, block shape, context_read semantics, or Assembler injection
  - placing raw Tool results, full Tool schemas, executors, functions, closures, or credentials in the DCS projection or Result Pointer metadata
  - default-on configuration, prompt mutation, Code Mode wiring, provider transport, Host API, Electron, Renderer, or new persistence
featureFlags:
  - DCS projection and Result Pointer construction require explicit enabled=true input. No application setting or default change is added in V3-05.
rollback:
  - Stop constructing the opt-in projection/pointer facades or remove the unused modules. Existing tool_registry, context_read, Tool Search, archive creation/verification, and result payload behavior remain unchanged.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/capability-registry-v3-dcs-result-pointer.md
  - pnpm harness validate --spec harness/specs/tasks/capability-registry-v3-dcs-result-pointer.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/capabilities/v3/capability-descriptor.test.ts src/capabilities/v3/evaluation-baseline.test.ts src/capabilities/v3/shadow-catalog.test.ts src/capabilities/v3/skill-resolver.test.ts src/capabilities/v3/trusted-catalog.test.ts src/capabilities/v3/unified-resolver.test.ts src/capabilities/v3/dcs-projection.test.ts src/capabilities/v3/result-pointer.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/tool-search-capability-v3.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run lint:check
  - pnpm run typecheck
  - git diff --check
acceptance:
  - Disabled projection/pointer facades do not inspect the catalog, create or verify archives, or call DCS owners.
  - The root projection is deterministic, category/namespace structured, navigation-only, character/entry bounded, and contains metadata only.
  - Namespace and capability reads are deterministic, bounded, and preserve the descriptor's owner identity and hashes without adding execution authority.
  - Result Pointer creation delegates to the existing context archive owner and stores only pointer metadata, summary, checksum-backed ArchiveHandle, scope, expiry, and permissions.
  - Pointer read, slice, and search verify session/task/permission/expiry before archive access, verify the archive checksum, and enforce configured scan/output/match budgets.
  - Cross-session, wrong-task, expired, permission-denied, missing, and checksum-mismatched reads fail closed; hard-deleted archives are reported missing.
  - Existing tool_registry, context_read, Tool Search, archive owner, and flag-off result behavior remain unchanged.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - docs/dev/capability-registry-v3-dcs-result-pointer-acceptance.md
---

# Capability Registry V3-05: DCS Projection and Result Pointer

The DCS adapter is a pure caller-owned projection. It does not create a
ContextBlock, write BlockStore, or replace the existing `tool_registry` path.
The Result Pointer facade delegates archive creation and verification to the
existing Context Family archive owner and never reads archive files itself.
