---
id: skill-mcp-capability-publication-layer
title: Skill/MCP capability publication layer
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Unify Skill and MCP exposure into one read model consumed through host-api while keeping activation tied to explicit user configuration.
ownedPaths:
  - harness/specs/tasks/skill-mcp-capability-publication-layer.md
  - shared/host-api/contract.ts
  - shared/types/mcp.ts
  - electron/services/capabilities-api.ts
  - electron/services/mcp-api.ts
  - openclaw_runtime/src/runtime-core/capability-publications.ts
  - openclaw_runtime/src/gateway/server-methods/capabilities.ts
  - src/lib/capability-registry.ts
touchedAreas:
  - shared/**
  - electron/**
  - openclaw_runtime/src/**
  - src/lib/**
  - tests/**
expectedUserBehavior:
  - Consumers read Skill and MCP availability through `hostApi.capabilities.publications`.
  - Saving an agent's default Skill IDs updates the runtime agent skill allowlist.
  - Saving an agent's default MCP server IDs updates runtime MCP exposure for that agent without widening other agents.
  - Role context narrows and diagnoses publications; it does not create a separate Skill/MCP registry.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - gateway-readiness-policy
  - capability-owner-resolution
  - active-config-guards
  - runtime-local-ecosystem-boundary
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - renderer direct Gateway HTTP, Gateway WebSocket, or raw IPC calls
  - model-autonomous Skill enablement or MCP registration
  - a second runtime service, daemon, port, or durable capability store
  - widening agent-scoped MCP servers into global runtime MCP config
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/skill-mcp-capability-publication-layer.md
  - pnpm harness validate --spec harness/specs/tasks/skill-mcp-capability-publication-layer.md
docs:
  required: true
  files:
    - docs/clawx-design-overview.md
    - docs/architecture-overview.md
implementationTestCandidates:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/chat-capability-actions.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/mcp-api.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Shared contract exposes `CapabilityPublication*` types and a `capabilities.publications` host-api method.
  - Gateway exposes read-only `capabilities.publications` with `operator.read` scope.
  - Renderer capability registry uses the publication layer instead of separately composing Skill and MCP sources.
  - MCP runtime config accepts optional `exposure.agents/workspaces/roles` filters, and runtime materialization honors them when context is provided.
  - Explicit agent bootstrap saves sync Skill and MCP selections into runtime-owned config surfaces.
---

# Skill/MCP Capability Publication Layer

Use this spec when changing the unified Skill/MCP publication read model, the
explicit bootstrap sync path, or renderer consumers that depend on capability
availability. The layer is a projection over existing owner-managed config, not
a new lifecycle store.
