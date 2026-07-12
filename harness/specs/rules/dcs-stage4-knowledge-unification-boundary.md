---
id: dcs-stage4-knowledge-unification-boundary
title: DCS Stage 4 knowledge Block unification boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

# DCS Stage 4 knowledge Block unification boundary

## Authority

This rule governs the DCS v1.6 Stage 4 knowledge Block unification. The
authoritative specs are `team/dcs/dcs-v1.6-spec.md` §Stage 4 and
`team/dcs/dcs-v1.6.1-addendum.md` addenda 2, 4, 5, 6.

## Required Ownership

1. **compass-handler** (`context-engine/handlers/compass-handler.ts`) is the
   ONLY function that converts a `PreReplyInjection` into a `knowledge` Block
   with `source_system="compass"`. It wraps — does NOT rewrite —
   `buildPreReplyInjection`.

2. **role-memory-handler** (`context-engine/handlers/role-memory-handler.ts`)
   is the ONLY function that converts a `ContextPack` into a `knowledge` Block
   with `source_system="role-memory"`. It wraps — does NOT rewrite —
   `buildContextPack`.

3. **Assembler #appendKnowledge** is the ONLY pre-LLM injection path for
   `knowledge` Blocks. It queries `BlockStore` with session-type-aware
   `source_systems` (compass for main, role-memory for subagent).

4. **selectHandlers** (Assembler layer) is the ONLY session-type gate. Handlers
   do not inspect session type. ANTI-3 is enforced here.

5. The existing CVK `ContextRuntimeKitContextEngine.assemble` path is unchanged;
   Stage 4 Block paths are parallel, flag-gated producers.

## knowledge Block Contract

### compass path (main session)

- `block_type = "knowledge"`
- `source_system = "compass"`
- `presence.always_on = false`
- `presence.on_demand = { expand_tool: "context_search", auto_register: false }`
- `presence.background = true`
- `mutability = "system_managed"`
- `compression_depth = 0`
- `entity_extraction_status = "empty"`
- `full_content` = concatenation of `PreReplyInjection.sspString` and
  `PreReplyInjection.top5FactsString` (both optional; if both absent,
  `full_content` is `undefined`)

### role-memory path (subagent session)

- `block_type = "knowledge"`
- `source_system = "role-memory"`
- `presence.always_on = false`
- `presence.on_demand = { expand_tool: "context_search", auto_register: false }`
- `presence.background = true`
- `mutability = "system_managed"`
- `compression_depth = 0`
- `entity_extraction_status = "empty"`
- `full_content` = JSON-serialized `ContextPack.buckets`

## Prohibitions

1. **No subagent compass**: subagent sessions MUST NOT query or inject
   `source_system="compass"` knowledge Blocks (ANTI-3).
2. **No main role-memory**: main sessions MUST NOT query or inject
   `source_system="role-memory"` knowledge Blocks (ANTI-3).
3. **No double injection**: a session MUST NOT have both compass and role-memory
   `always_on` knowledge Blocks (v1.0 L408). Enforced by `selectHandlers`
   returning exactly one handler per session.
4. **No third channel**: DCS Stage 4 MUST NOT create a third role-memory
   injection channel (addendum 5). `#appendKnowledge` is the only injection
   path.
5. **No chain compression**: `compression_depth` MUST be `0` for freshly
   produced knowledge Blocks. No chained compression.
6. **No legacy builder rewrite**: `buildPreReplyInjection` and
   `buildContextPack` MUST NOT be modified. The handlers wrap their outputs.
7. **No COMPASS write path**: Stage 4 does NOT activate the working-memory
   handler's COMPASS write path (significance='high' → TemporalFact). That is
   deferred to R6+.
8. **No transport/host-api/db changes**: no new IPC channels, no new Gateway
   endpoints, no new database tables.
9. **No BlockMutability widening**: `BlockMutability` stays
   `"system_managed" | "agent_writable"`. The v1.0 spec's `"readonly"` for
   compass is reconciled to `"system_managed"` per v1.6 convergence.

## Required Evidence

1. RED tests demonstrate missing behavior before implementation.
2. GREEN tests pass after implementation.
3. `#appendKnowledge` follows flag-guard + exactly-once + session-type-aware
   query pattern.
4. `## Knowledge` heading appears at most once per LLM call (addendum 2).
5. `isMainSessionKey` accepts optional `mainKey` param (addendum 4).
6. Combined character budget constant is declared (addendum 6).
7. Feature flags `runtime.contextBlock.compass.enabled` and
   `runtime.contextBlock.role-memory.enabled` default false.
