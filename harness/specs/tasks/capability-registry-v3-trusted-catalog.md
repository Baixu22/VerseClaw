---
lifecycleStatus: archived
id: capability-registry-v3-trusted-catalog
title: Capability Registry V3 trusted catalog and lease
scenario: capability-registry-v3
taskType: runtime-shadow
diffBase: fafa493fabd7e7c0c448f6b0a275c87eb13afb46
intent: Implement V3-03 as an unwired in-memory trusted Tool catalog with cold-start/reload executor registration and fail-closed session leases.
ownedPaths:
  - docs/dev/capability-registry-v3-development-plan.md
  - docs/dev/capability-registry-v3-foundation-acceptance.md
  - docs/dev/capability-registry-v3-skill-resolver-acceptance.md
  - docs/dev/capability-registry-v3-trusted-catalog-acceptance.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-foundation.md
  - harness/specs/tasks/capability-registry-v3-skill-resolver.md
  - harness/specs/tasks/capability-registry-v3-trusted-catalog.md
  - openclaw_runtime/src/capabilities/v3/**
touchedAreas:
  - docs/dev/capability-registry-v3-trusted-catalog-acceptance.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-trusted-catalog.md
  - openclaw_runtime/src/capabilities/v3/**
expectedUserBehavior:
  - Existing Tool registration, Tool Search, tool invocation, approval, retry, errors, transcript, prompt, storage, Host API, and UI behavior remain unchanged.
  - Runtime-only callers can build a sealed in-memory trusted catalog during cold start or controlled reload and issue bounded session leases.
  - Forged, stale, cross-session, revoked, expired, or mismatched leases cannot reach the registered executor.
requiredProfiles:
  - fast
requiredRules:
  - capability-registry-v3-boundary
forbiddenPatterns:
  - active changes to Tool Search, agent tool construction, prompt construction, DCS, MCP, Code Mode, provider transport, Host API, Electron, Renderer, approval, retry, transcript, or persistence
  - executor references in CapabilityDescriptor, catalog snapshots intended for discovery, or public lease handles
  - registration from model text, Skill content, DCS Blocks, Host API, renderer input, or a durable capability database
featureFlags:
  - No active application flag is added because V3-03 remains unwired. Construction and invocation require explicit runtime-owned callers.
rollback:
  - Remove the unused trusted-catalog module. It owns only process memory and creates no configuration, migration, durable state, prompt mutation, or user-visible surface.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/capability-registry-v3-trusted-catalog.md
  - pnpm harness validate --spec harness/specs/tasks/capability-registry-v3-trusted-catalog.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/capabilities/v3/capability-descriptor.test.ts src/capabilities/v3/shadow-catalog.test.ts src/capabilities/v3/evaluation-baseline.test.ts src/capabilities/v3/skill-resolver.test.ts src/capabilities/v3/trusted-catalog.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run lint:check
  - pnpm run typecheck
  - git diff --check
acceptance:
  - Cold start and controlled reload are the only catalog construction operations; registration is sealed between rebuilds.
  - Only validated Tool descriptors with schema hashes and function executors are accepted, and duplicate ids fail the rebuild.
  - Catalog and policy epochs change only at their named lifecycle boundary; stale leases fail closed.
  - Lease handles expose only a cryptographically opaque issuedId and bind session, capability, revision, manifest hash, schema hash, policy epoch, catalog epoch, executor registration id, permissions, expiry, and revocation state.
  - Verification and invocation reject forged, cross-session, expired, revoked, stale-epoch, descriptor-mismatch, registration-mismatch, and permission-mismatch leases before calling an executor.
  - No active runtime path imports or constructs the trusted catalog in V3-03.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - docs/dev/capability-registry-v3-trusted-catalog-acceptance.md
---

# Capability Registry V3-03: Trusted Catalog and Lease

The package is an inactive runtime primitive. It stores runtime-owned executor
functions in private process memory and publishes only metadata snapshots.
Lease verification is mandatory immediately before any explicit invocation.

The API has no incremental registration method. Catalog replacement is atomic
through `reload`, which produces a new catalog epoch and new executor
registration ids. Policy rotation separately produces a new policy epoch.
