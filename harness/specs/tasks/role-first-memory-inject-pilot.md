---
lifecycleStatus: archived
id: role-first-memory-inject-pilot
title: Role-first chat-turn memory injection pilot (Area 4 §3.4)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Punch through the chat-turn memory injection channel for the Role Memory system only, default-off and byte-identical when off, without expanding the boundary until the candidate Runtime Memory system finishes development.
touchedAreas:
  - openclaw_runtime/src/context-engine/chat-turn-memory-injection.ts
  - openclaw_runtime/src/context-engine/role-memory-context-provider.ts
  - openclaw_runtime/src/context-engine/register-memory-providers.ts
  - openclaw_runtime/src/gateway/server-methods/agent.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - tests/unit/chat-turn-memory-injection.test.ts
expectedUserBehavior:
  - When `runtime.memory.injectPilot.enabled` is false (default), chat-turn prompts are byte-identical to today; `computeMemoryExtraSystemPrompt` returns the original `extraSystemPrompt` unchanged and `providerFactory` is never called.
  - When the flag is on and the session key matches `main-only` scope (`agent:<id>:main` or `cron:<id>:main`), the Role Memory provider is queried, its `ContextPack` buckets are adapted to `ContextItem`s, and a single `## Memory Context` block is appended to `extraSystemPrompt`.
  - When the flag is on but the session is a subagent session (`agent:<id>:<role>`), injection is skipped — subagents already receive role memory via `role-spawn.ts`, so double-injection is prevented.
  - When the Role Memory store is unconfigured, empty, or throws, the provider returns a fallback result with zero items; the turn proceeds with the original prompt. No mem structure is mutated.
  - The `runtime-memory` provider id is reserved in the type union but is NOT registered by `createMemoryContextProviders` unless explicitly opted in; the default `providers: ['role-memory']` configuration does not query it.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/chat-turn-memory-injection.test.ts
  - tests/unit/role-memory-context-provider.test.ts
acceptance:
  - `resolveMemoryInjectPilotConfig` returns `enabled: false` for any missing, malformed, or non-strictly-true `enabled` field; malformed sub-fields fall back to safe defaults, never to enabled.
  - `shouldInjectChatTurnMemory` returns false when the flag is off, the session key is missing under `main-only` scope, or the session key does not match `^(agent|cron):[^:]+:main$`.
  - `assembleChatTurnMemoryInjection` returns null when the pilot is off, no providers match the configured id list, every provider falls back with zero items, or every provider throws. Provider failures are isolated: a throwing provider contributes zero items and a diagnostic, never aborting the turn or the other providers' injection.
  - `computeMemoryExtraSystemPrompt` is the single gateway wiring seam; it lazy-constructs providers via `providerFactory` only when the flag is on, suppresses all errors to a warn log, and falls back to the original prompt on any failure.
  - The gateway call site (`agent.ts:2538-2590`) passes the computed `memoryExtraSystemPrompt` as `extraSystemPrompt` to `dispatchAgentRunFromGateway`; when the pilot is off, the value is byte-identical to `request.extraSystemPrompt`.
  - `createMemoryContextProviders` returns only the `role-memory` provider when only `opts.roleMemory` is supplied; the `runtime-memory` provider is constructed only when `opts.runtimeMemory` is explicitly passed.
  - The Role Memory provider reuses `buildContextPack` / `getMemoryCards` / `listMemoryConflicts` exactly as `role-spawn.ts` does today — no new retrieval path, no new memory structure, no mutation of `MemoryCard` / `ContextPack` types.
  - `comms:replay` and `comms:compare` pass with the pilot flag off (byte-identical prompt parity, Area 4 §8).
  - The `runtime.memory.injectPilot` config schema (`types.openclaw.ts`) ships with `enabled` (default false), `providers` (default `['role-memory']`), `totalTokenBudget` (default 768), and `sessions` (default `main-only`); labels and help text are present in `schema.labels.ts` and `schema.help.ts`.
docs:
  required: true
---

## Pilot scope (§3.4)

This pilot punches through the chat-turn memory injection channel for the **Role Memory system only**. The channel is the single `computeMemoryExtraSystemPrompt` seam at `agent.ts:2538-2590`; the provider is `role-memory` only by default.

**In scope (current PR):**
- Wire `computeMemoryExtraSystemPrompt` into the gateway chat-turn path.
- Register `createRoleMemoryContextProvider` via `createMemoryContextProviders({ roleMemory: { resolveRoleName: defaultMainSessionRoleResolver } })`.
- Ship the `runtime.memory.injectPilot` config schema, default-off.
- 28 unit tests covering config resolution, scope gating, provider isolation, and byte-identical-off parity.
- Comms replay parity with the flag off.

**Out of scope (deferred until candidate mem finishes development):**
- Registering the `runtime-memory` provider — its quality gates (maturity ≥ 0.7, extraction density ≥ 1.0, multi_hop Recall@5 ≥ 40%) are not yet met.
- Expanding `sessions` beyond `main-only` — subagent sessions already receive role memory via `role-spawn.ts`; wider session scopes risk double-injection until the candidate system's deduplication story lands.
- Promoting `enabled` default to true — promotion is gated by the pilot evidence criteria below.
- Any modification to `MemoryCard`, `ContextPack`, `buildContextPack`, or `memory-policy.ts` — the mem structure is frozen during the pilot.

## Design constraints (preserved)

1. **Federate, don't unify** (§3.2): the Role Memory provider reuses the existing `buildContextPack` retrieval path; it does not re-implement retrieval or merge memory stores.
2. **Purely additive** (§6): the provider registration, the seam module, and the config field are all additive; no existing agent/spawn/prompt flow is modified when the flag is off.
3. **Default-off / zero-harm degradation** (§8): any missing registry, broken store, or throwing provider falls back to the original prompt; comms replay is byte-identical.
4. **Error isolation**: a provider failure contributes zero items and a diagnostic, never aborts the turn or the other providers' injection.
5. **No boundary expansion during pilot**: the `runtime-memory` provider id is reserved in the type union but not registered by default; `sessions` stays `main-only`; the mem structure types are frozen.

## Pilot phases (§3.4 migration path)

1. **Operator gate / default-off** (current): flag ships off; channel is wired; unit tests and comms parity prove no behavior change.
2. **Shadow phase** (next): flag flipped on for a single operator session; both passes run but only role-memory contributes; telemetry: provider invocation count, item count per bucket, fallback rate, prompt byte-delta.
3. **Gate to active**: ≥ 30 shadow turns; provider fallback rate < 20%; no comms replay regression; no user-visible prompt corruption.
4. **Boundary expansion** (deferred): once the candidate Runtime Memory system meets its quality gates, register the `runtime-memory` provider and expand `sessions` — tracked separately, not in this spec.

## Execution path

- **Channel**: `agent.ts` gateway chat-turn handler calls `computeMemoryExtraSystemPrompt(request.extraSystemPrompt, cfg, resolvedSessionKey, providerFactory, log)`.
- **Provider factory**: `() => createMemoryContextProviders({ roleMemory: { resolveRoleName: defaultMainSessionRoleResolver } })` — lazy, only invoked when the flag is on.
- **Provider**: `createRoleMemoryContextProvider` calls `ensureMemoryCardsLoaded` → `getMemoryCards({ roleName, status: 'all' })` → filter injectable → `buildContextPack` → `adaptPackToContextItems`.
- **Output**: a single `## Memory Context` block grouped by provider id, appended to `extraSystemPrompt` via `${original}\n\n${memoryText}`.

## Rollback

Disable-only: flip `runtime.memory.injectPilot.enabled` back to false. No schema change (all fields optional), no persisted state to migrate, no mem structure to revert. Byte-identical prompts are restored immediately.
