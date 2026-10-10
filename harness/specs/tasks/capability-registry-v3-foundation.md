---
lifecycleStatus: archived
id: capability-registry-v3-foundation
title: Capability Registry V3 foundation
scenario: capability-registry-v3
taskType: runtime-shadow
diffBase: fafa493fabd7e7c0c448f6b0a275c87eb13afb46
intent: Establish V3-00/V3-01 metadata contracts, static evaluation baseline, and an in-memory shadow catalog without changing any active runtime behavior.
ownedPaths:
  - docs/dev/capability-registry-v3-development-plan.md
  - docs/dev/capability-registry-v3-foundation-acceptance.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-foundation.md
  - openclaw_runtime/src/capabilities/v3/**
touchedAreas:
  - docs/dev/capability-registry-v3-development-plan.md
  - docs/dev/capability-registry-v3-foundation-acceptance.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-foundation.md
  - openclaw_runtime/src/capabilities/v3/**
expectedUserBehavior:
  - Existing Skill, Tool, Context, MCP, DCS, prompt, approval, retry, storage, Host API, and UI behavior remains unchanged.
  - Runtime developers can build deterministic metadata-only snapshots from caller-supplied Skill, Tool, and Context metadata.
  - Static V3 fixtures provide a reproducible comparison baseline but do not enable retrieval or publish a user-visible catalog.
requiredProfiles:
  - fast
requiredRules:
  - capability-registry-v3-boundary
forbiddenPatterns:
  - changes to openclaw_runtime/src/agents/tool-search.ts, code-mode, DCS handlers, MCP materialization, Host API, Electron, Renderer, prompts, approval, retry, or persistence
  - executor references, functions, credentials, raw tool results, or full schemas in descriptors or snapshots
  - a feature flag, active runtime wiring, durable store, daemon, port, protocol, or user-visible surface
featureFlags:
  - No feature flag is added because V3-00/V3-01 has no active runtime integration.
rollback:
  - Remove the metadata-only V3 module and its unused callers. No runtime data, schema, configuration, or user-visible state requires migration or cleanup.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/capability-registry-v3-foundation.md
  - pnpm harness validate --spec harness/specs/tasks/capability-registry-v3-foundation.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/capabilities/v3/capability-descriptor.test.ts src/capabilities/v3/shadow-catalog.test.ts src/capabilities/v3/evaluation-baseline.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run lint:check
  - pnpm run typecheck
  - git diff --check
acceptance:
  - CapabilityDescriptor canonical serialization and SHA-256 manifest hashing are stable for identical metadata and do not serialize executors, functions, credentials, raw outputs, or full schemas.
  - Skill, Tool, and Context adapters accept only caller-supplied public metadata and map it into one-way descriptors without creating runtime registrations.
  - The shadow catalog returns deterministically ordered snapshots, reports duplicate ids, invalid paths, and conflicting owners, and never silently chooses a conflicting owner.
  - Static fixture corpus reports direct-projection character/token estimates and three-level Recall@k expectations without claiming production measurements.
  - No active path, prompt text, tool set, invocation, approval, error, retry, transcript, storage, Host API, renderer, or feature-lock behavior changes.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - docs/dev/capability-registry-v3-foundation-acceptance.md
---

# Capability Registry V3 Foundation

This task combines the plan's V3-00 contract/baseline work with V3-01's first
production implementation. It intentionally stops before hierarchical
resolution, leases, tool execution, DCS projection, Code Mode, provider-native
loading, UI, or rollout work.

The implementation is a pure metadata module under
`openclaw_runtime/src/capabilities/v3/`. Inputs are supplied explicitly by a
caller. The module does not import runtime tool factories, Skill loading,
Context Engine storage, DCS, MCP, Gateway, Electron, or renderer code.

The corpus is a hand-authored contract fixture. Its direct-projection estimate
uses the existing repository convention of `ceil(characters / 4)` and must be
described as an estimate only. Production token counts, provider cache use,
TTFT, recall, and canary evidence remain future V3-08 work.
