---
lifecycleStatus: archived
id: runtime-contract-layer-spike
title: Runtime contract layer spike
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Establish the phase-two runtime contract layer plan and validation boundary before implementation starts, keeping the runtime core inside openclaw_runtime and preserving legacy behavior through feature-flagged shadow adapters.
ownedPaths:
  - harness/specs/tasks/runtime-contract-layer-spike.md
  - harness/specs/tasks/lane-c-tool-protocol-shadow.md
  - openclaw_runtime/packages/agent-core/**
  - openclaw_runtime/packages/gateway-protocol/**
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/agents/runtime/**
  - openclaw_runtime/src/agents/runtime-plan/**
  - openclaw_runtime/src/agents/sessions/**
  - openclaw_runtime/src/gateway/**
  - electron/gateway/**
  - electron/services/**
  - shared/host-api/contract.ts
  - shared/types/**
  - tests/unit/mcp-api.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-contract-layer-spike.md
  - openclaw_runtime/packages/agent-core/**
  - openclaw_runtime/packages/gateway-protocol/**
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/agents/runtime/**
  - openclaw_runtime/src/agents/runtime-plan/**
  - openclaw_runtime/src/agents/sessions/**
  - openclaw_runtime/src/gateway/**
  - electron/gateway/**
  - electron/services/**
  - shared/host-api/contract.ts
  - shared/types/**
  - tests/unit/mcp-api.test.ts
expectedUserBehavior:
  - With phase-two feature flags disabled, existing chat, tool, MCP, Gateway, and runtime behavior is byte/shape compatible with the legacy path.
  - Enabling shadow adapters records or compares normalized runtime contract data without changing legacy responses, approvals, errors, retries, or delivery semantics.
  - Developers can run harness context and validation commands to see the required rules, profiles, owned paths, tests, rollback boundary, and index update rules before implementation.
requiredProfiles:
  - fast
  - comms
requiredRules:
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
  - workspace-harness-single-source
forbiddenPatterns:
  - any second runtime service, daemon, process, port, local HTTP server, WebSocket server, or Gateway instance for the contract layer
  - runtime core implementation outside openclaw_runtime/src/runtime-core/** or existing openclaw_runtime-owned runtime packages
  - shared/** or electron/** owning runtime core implementation, lifecycle, state, adapters, or contract normalization
  - renderer direct Gateway HTTP, Gateway WebSocket, or window.electron.ipcRenderer.invoke calls
  - shadow adapters mutating legacy response bytes, enumerable shapes, approval states, errors, retries, or delivery ordering
  - default-on feature flags or active-path promotion before flag-off and shadow-only parity tests pass
  - deleting or replacing legacy adapters before rollback and parity acceptance criteria are satisfied
featureFlags:
  - runtime.contractLayer.enabled defaults off until flag-off parity, shadow-only parity, comms, and typecheck proof is recorded.
  - runtime.contractLayer.shadowAdapters defaults off or shadow-only and must never become the active path without a follow-up task spec.
  - Adapter-specific flags, such as runtime.toolProtocol.mcpShadow, stay additive and reversible.
rollback:
  - Disable runtime.contractLayer.* and adapter-specific shadow flags to return to the legacy path without data migration.
  - Remove or bypass shadow adapter registration while keeping legacy adapter exports and Gateway method descriptors intact.
  - Roll back index/barrel additions only after all internal imports have returned to legacy paths.
indexUpdateRules:
  - Runtime export barrels, descriptor registries, and method indexes may be updated only under openclaw_runtime-owned paths for concrete contract-layer exports.
  - Electron/shared indexes may expose bridge types only; they must not become the runtime core owner.
  - Adding or changing a phase-two implementation task must update this task spec or add a follow-up task spec under harness/specs/tasks instead of relying on chat-only constraints.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-contract-layer-spike.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-contract-layer-spike.md --no-diff
pnpmHarnessAliases:
  - pnpm harness context --spec harness/specs/tasks/runtime-contract-layer-spike.md, or node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-contract-layer-spike.md when the pnpm shim fails
  - pnpm harness validate --spec harness/specs/tasks/runtime-contract-layer-spike.md --no-diff, or node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-contract-layer-spike.md --no-diff when the pnpm shim fails
implementationTestCandidates:
  - pnpm run typecheck, or corepack pnpm run typecheck when the pnpm shim fails
  - pnpm exec vitest run openclaw_runtime/src/runtime-core/runtime-core.test.ts tests/unit/mcp-api.test.ts, or corepack pnpm exec vitest run openclaw_runtime/src/runtime-core/runtime-core.test.ts tests/unit/mcp-api.test.ts when the pnpm shim fails and dependencies are installed
  - pnpm run comms:replay, or corepack pnpm run comms:replay when the pnpm shim fails
  - pnpm run comms:compare, or corepack pnpm run comms:compare when the pnpm shim fails
acceptance:
  - This task spec references gateway-backend-communication because phase-two runtime contracts can touch Main, Gateway, Gateway protocol, host-api bridge, and OpenClaw runtime paths.
  - No second runtime service, daemon, port, or Gateway instance is introduced; the existing Main-owned Gateway/OpenClaw runtime lifecycle remains the only runtime bridge.
  - Runtime core code, contract normalization, and adapter ownership live inside openclaw_runtime/src/runtime-core/** or existing openclaw_runtime-owned runtime packages; Electron and shared code may only bridge typed contract surfaces to existing UI/Main boundaries.
  - Shared and Electron code do not become runtime core owners and do not own contract normalization, runtime state, runtime lifecycle, or shadow adapter behavior.
  - Shadow adapters are feature-flagged, default-off or shadow-only, and prove flag-off parity plus shadow-only parity: legacy payload bytes, enumerable shapes, approval waiting, errors, retries, and delivery ordering remain unchanged.
  - Feature flags can disable the contract layer and every shadow adapter without migrations, data cleanup, or user-visible behavior changes.
  - Required tests for this spike are runnable harness context/validation commands; follow-up implementation specs must promote the implementation test candidates that match their touched paths.
  - Rollback is documented as flag disablement plus adapter/index removal, with no dependency on a second service or persistent dual-write state.
  - Index/barrel/descriptor updates are additive, located in the owned runtime bridge paths, and updated in the same PR as any new public contract surface.
docs:
  required: false
  note: This task creates the phase-two harness contract only. Future implementation tasks must revisit README.md, README.zh-CN.md, README.ja-JP.md, and design docs if behavior, flows, or public interfaces change.
---

# Runtime Contract Layer Spike

## Boundary

Use this task spec before implementing the phase-two runtime contract layer. It references `gateway-backend-communication` because the eventual implementation may cross OpenClaw runtime, Gateway protocol, Electron Main, host-api, and renderer-visible behavior boundaries.

The validation boundary is still narrow for this spike: this file creates the durable harness contract and does not implement renderer, Main, Gateway, or runtime behavior. If a follow-up change truly avoids renderer/Main/Gateway paths, it must say so in its own task spec and keep runtime-core work under `openclaw_runtime/src/runtime-core/**`.

## Runtime Ownership

Runtime core belongs inside `openclaw_runtime/src/runtime-core/**` or existing `openclaw_runtime` runtime packages. Shared and Electron files can describe bridge types, Main-owned transport, or host-api exposure, but they must not own runtime core implementation, lifecycle, state, adapters, or contract normalization.

The existing Gateway/OpenClaw runtime lifecycle remains the one runtime service. Do not add another daemon, port, background process, local HTTP server, WebSocket server, or parallel Gateway to host the contract layer.

## Shadow Adapter Rules

Shadow adapters compare or record normalized contract data beside the legacy path. They must not change legacy return bytes, enumerable response shapes, approval waiting semantics, error mapping, retry behavior, event ordering, or delivery status.

The existing `lane-c-tool-protocol-shadow` task remains the MCP-focused precedent. This spike extends that idea to the broader runtime contract layer without promoting the shadow path to active behavior. Required proof must cover both flag-off parity and shadow-only parity.

## Feature Flags

All phase-two contract-layer behavior starts behind default-off feature flags. A shadow flag may collect or compare normalized records, but it must be reversible at runtime or startup without data migration.

Promoting any shadow adapter to active behavior requires a follow-up task spec with updated acceptance criteria, tests, and rollback proof.

## Required Tests

```text
node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-contract-layer-spike.md
node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-contract-layer-spike.md --no-diff
pnpm harness context --spec harness/specs/tasks/runtime-contract-layer-spike.md
pnpm harness validate --spec harness/specs/tasks/runtime-contract-layer-spike.md --no-diff
```

If the `pnpm harness` shim fails or is unavailable, use the equivalent `node harness/src/cli.mjs ...` command shown above.

Follow-up implementation specs should promote the relevant commands below into their own `requiredTests` after the implementation paths exist and dependencies are installed:

```text
pnpm run typecheck
pnpm exec vitest run openclaw_runtime/src/runtime-core/runtime-core.test.ts tests/unit/mcp-api.test.ts
pnpm run comms:replay
pnpm run comms:compare
```

If the Windows `pnpm` shim cannot find Node, use `corepack pnpm ...` for typecheck, Vitest, and comms commands. The Vitest candidate references checked-in test files only.

If the implementation changes visible renderer behavior, add or update the relevant Electron E2E spec in the same PR and include the `e2e` profile in the follow-up task spec.

## Rollback

Rollback must be boring: disable `runtime.contractLayer.*` and adapter-specific shadow flags, keep legacy adapters registered, and remove additive index/barrel/descriptor exports only after internal imports are back on legacy paths.

No rollback plan may depend on deleting user data, migrating persistent state back and forth, or running a second runtime service.

## Index Update Rules

Update runtime export barrels, method descriptors, registries, and indexes only when a concrete contract surface needs them. Runtime-facing index updates belong under `openclaw_runtime/src/runtime-core/**` or existing `openclaw_runtime` runtime package paths; Electron/shared indexes may expose bridge types but must not become a substitute runtime core owner.

Any new phase-two implementation lane must update this task spec or add a follow-up spec under `harness/specs/tasks/**`. Do not rely on oral constraints, private notes, or a parallel task index outside the harness source of truth.
