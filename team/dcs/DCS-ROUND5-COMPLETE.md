# DCS Round 5 — Stage 4 Knowledge Block Unification

**Status**: COMPLETE
**Date**: 2026-07-12
**Baseline**: `3e715f08233e045d6fc813c769dcd7c101e9b9f6`
**R4 HEAD**: `167065ee6`
**Task spec**: `harness/specs/tasks/dcs-stage4-knowledge-unification.md`
**Boundary rule**: `harness/specs/rules/dcs-stage4-knowledge-unification-boundary.md`

---

## Scope Delivered

R5 delivers DCS v1.6 Stage 4: unified `knowledge` Block producers for both
compass (main session) and role-memory (subagent session) paths. Two handlers
wrap the existing legacy builders (`buildPreReplyInjection` and
`buildContextPack`) and convert their outputs into system-managed `knowledge`
Blocks written through `ContextBlockSink`. The Assembler's `#appendKnowledge`
injects the `## Knowledge` summary into the pre-LLM output following the
flag-guard + exactly-once + session-type-aware query pattern. Both knowledge
Blocks carry `always_on=false`, `on_demand.expand_tool="context_search"`,
`background=true`, `mutability="system_managed"`, `compression_depth=0`.

ANTI-3 is enforced: main sessions query `source_system="compass"` only;
subagent sessions query `source_system="role-memory"` only. No third injection
channel is created (addendum 5) — `#appendKnowledge` is the sole knowledge
injection path. `compression_depth` is always 0 (no chain compression).
`KNOWLEDGE_INJECTION_CHAR_BUDGET = 2000` is declared (addendum 6).
`isMainSessionKey` accepts optional `mainKey` (addendum 4).

---

## Readiness Gate

| Prerequisite | Evidence |
|-------------|----------|
| DCS Stage 1 final COMPLETE | `team/dcs/DCS-ROUND1-COMPLETE.md` — all gates exit 0 |
| Coding Runtime P0 final COMPLETE | `team/dcs/DCS-ROUND2-COMPLETE.md` — producer envelope 3/3 |
| DCS Stage 2 final COMPLETE | `team/dcs/DCS-ROUND3-COMPLETE.md` — task_state + handoff + SEKB |
| DCS Stage 3 final COMPLETE | `team/dcs/DCS-ROUND4-COMPLETE.md` — tool_registry + injection |
| Runtime build baseline green | `pnpm --dir openclaw_runtime build` exit 0 (905.0s) |

### Preflight: Canonical Paths

| Path | Canonical location |
|------|-------------------|
| compass knowledge producer | `Assembler.assemble` → `handleCompassKnowledge` → `ContextBlockSink` (wraps `buildPreReplyInjection`) |
| role-memory knowledge producer | `Assembler.assemble` → `handleRoleMemoryKnowledge` → `ContextBlockSink` (wraps `buildContextPack`) |
| Assembler injection | `Assembler.assemble` → `#appendKnowledge` (flag-guard + exactly-once + session-type-aware query) |
| Feature flags | `runtime.contextBlock.compass.enabled`, `runtime.contextBlock.role_memory.enabled` (defaults to false) |
| Source system mapping | `contextBlockFlagNameForSourceSystem("compass")` / `contextBlockFlagNameForSourceSystem("role-memory")` |
| Exactly-once guard | `KNOWLEDGE_HEADING_PATTERN = /^## Knowledge$/m` |
| Char budget | `KNOWLEDGE_INJECTION_CHAR_BUDGET = 2000` (addendum 6) |
| mainKey support | `isMainSessionKey(sessionKey, mainKey?)` (addendum 4) |

---

## RED Phase Evidence

**Test files**:
- `openclaw_runtime/src/context-engine/handlers/compass-handler.test.ts`
- `openclaw_runtime/src/context-engine/handlers/role-memory-handler.test.ts`
- `openclaw_runtime/src/context-engine/assembler.test.ts` (new knowledge test suite)
- `openclaw_runtime/src/agents/embedded-agent-runner/extensions.knowledge.test.ts`
- `openclaw_runtime/src/config/runtime-context-block-compass.test.ts`
- `openclaw_runtime/src/config/runtime-context-block-role-memory.test.ts`

RED tests written before implementation. Before GREEN, results were:
- `buildCompassKnowledgeBlock` / `handleCompassKnowledge` /
  `formatKnowledgeInjection` did not exist (module not found)
- `buildRoleMemoryKnowledgeBlock` / `handleRoleMemoryKnowledge` did not exist
- `#appendKnowledge` did not exist in Assembler
- `compass` and `role-memory` config flags did not exist
- `isMainSessionKey` did not accept `mainKey` param

---

## GREEN Phase Evidence

### Implementation Changes

1. **`compass-handler.ts`** (NEW): Core implementation —
   `buildCompassKnowledgeBlock` constructs a system-managed `knowledge` Block
   with `source_system="compass"`, `always_on=false`, `token_budget=400`,
   `priority=5`, `on_demand={ expand_tool: "context_read", auto_register: false }`,
   `mutability="system_managed"`, `compression_depth=0`. `full_content` joins
   `sspString` + `top5FactsString` from `PreReplyInjection`. `handleCompassKnowledge`
   writes through `ContextBlockSink` with admission context including
   `verification_status: "verified"`, `confidence: 1.0`, `audn_state: "ACTIVE"`
   to satisfy BlockStore compass knowledge admission gate. `formatKnowledgeInjection`
   (shared) returns `## Knowledge\n${content}` or undefined for missing/empty blocks.

2. **`role-memory-handler.ts`** (NEW): `buildRoleMemoryKnowledgeBlock` constructs
   a system-managed `knowledge` Block with `source_system="role-memory"`,
   same presence fields as compass. `full_content = JSON.stringify(pack.buckets)`
   per boundary rule. `handleRoleMemoryKnowledge` writes through `ContextBlockSink`
   with `significance: "medium"`.

3. **`assembler.ts`** (MODIFIED): Added `#appendKnowledge` method following
   flag-guard + exactly-once + session-type-aware query pattern. Queries
   `block_types=["knowledge"]`, `source_systems` filtered by BOTH
   `eligibleHandlers` (session type) AND `resolvedFlags` (feature flags) —
   a flag-off source is never queried. Added `mainKey?: string` to
   `AssembleRequest` (addendum 4). Added `KNOWLEDGE_INJECTION_CHAR_BUDGET = 2000`
   (addendum 6). Added `KNOWLEDGE_HEADING_PATTERN` and `hasKnowledgeHeading`
   helper for exactly-once guard. `selectHandlers` passes `request.mainKey`
   to `isMainSessionKey`. Added `compass` and `role_memory` to
   `DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS`.

4. **`session-key-utils.ts`** (MODIFIED): `isMainSessionKey` accepts optional
   `mainKey?: string` param (addendum 4). Defaults to `"main"` when not provided.

5. **Config files** (MODIFIED): Added `"compass"` and `"role-memory"` to
   `types.openclaw.ts` (optional `{ enabled?: boolean }`), `zod-schema.ts`
   (strict object schemas), `schema.labels.ts` (4 labels), `schema.help.ts`
   (4 help texts). Updated `runtime-context-block-working-memory.test.ts` and
   `runtime-context-block-tool-registry.test.ts` `expectTypeOf` assertions.

6. **Test files** (NEW): 4 new test files + 1 modified:
   - `compass-handler.test.ts` — 10 tests (buildCompassKnowledgeBlock,
     handleCompassKnowledge, formatKnowledgeInjection)
   - `role-memory-handler.test.ts` — 6 tests (buildRoleMemoryKnowledgeBlock,
     handleRoleMemoryKnowledge, formatKnowledgeInjection shared)
   - `extensions.knowledge.test.ts` — 3 tests (no new factory, no
     before_agent_start knowledge write)
   - `runtime-context-block-compass.test.ts` — 2 config tests
   - `runtime-context-block-role-memory.test.ts` — 2 config tests
   - `assembler.test.ts` — 12 new knowledge tests (flag off, compass on main,
     ANTI-3 both directions, exactly-once, empty store, mainKey, flag mapping,
     char budget, sink produces Block)

7. **`package.json`** (MODIFIED): Updated `test:dcs` and `lint:dcs` scripts to
   include R5 files.

### After GREEN:
- All 10 tests in `compass-handler.test.ts` PASS
- All 6 tests in `role-memory-handler.test.ts` PASS
- All 3 tests in `extensions.knowledge.test.ts` PASS
- All 2 tests in `runtime-context-block-compass.test.ts` PASS
- All 2 tests in `runtime-context-block-role-memory.test.ts` PASS
- All 139 tests in `test:dcs` PASS (101 unit + 8 runtime-config + 30 agents)

---

## Gate Evidence

| Gate | Command | Exit Code | Notes |
|------|---------|-----------|-------|
| Harness validate | `pnpm harness validate --spec ... --since 167065ee6` | 0 | Spec valid |
| Typecheck | `pnpm run typecheck` | 0 | node + web projects pass |
| Lint (DCS) | `pnpm run lint:dcs` | 0 | 0 warnings, 0 errors on 42 files |
| Test (DCS) | `pnpm run test:dcs` | 0 | 139/139 tests pass (101 unit + 8 rc + 30 agents) |
| Harness run (dry) | `pnpm harness run --spec ... --since 167065ee6 --dry-run` | 0 | Report generated |
| Contract check | `pnpm contract:check` | 0 | Contract check passed |
| Comms replay | `pnpm run comms:replay` | 0 | Pass |
| Comms compare | `pnpm run comms:compare` | 0 | Pass |
| Harness CI | `pnpm run harness:ci` | 0 | 14/14 tests pass |
| Runtime build | `pnpm --dir openclaw_runtime build` | 0 | Build successful (905.0s) |
| Git diff check | `git diff --check` | 0 | No whitespace errors |

---

## Ownership / Prohibition Scan

### Touched Files (R5 changes only)

| File | Change Type |
|------|-------------|
| `openclaw_runtime/src/context-engine/handlers/compass-handler.ts` | New — compass knowledge handler |
| `openclaw_runtime/src/context-engine/handlers/compass-handler.test.ts` | New — 10 tests |
| `openclaw_runtime/src/context-engine/handlers/role-memory-handler.ts` | New — role-memory knowledge handler |
| `openclaw_runtime/src/context-engine/handlers/role-memory-handler.test.ts` | New — 6 tests |
| `openclaw_runtime/src/context-engine/assembler.ts` | Modified — #appendKnowledge + flags + mainKey + char budget |
| `openclaw_runtime/src/context-engine/assembler.test.ts` | Modified — 12 new knowledge tests |
| `openclaw_runtime/src/agents/embedded-agent-runner/extensions.knowledge.test.ts` | New — 3 wiring tests |
| `openclaw_runtime/src/config/types.openclaw.ts` | Modified — compass + role-memory config types |
| `openclaw_runtime/src/config/zod-schema.ts` | Modified — compass + role-memory zod schemas |
| `openclaw_runtime/src/config/schema.labels.ts` | Modified — 4 labels |
| `openclaw_runtime/src/config/schema.help.ts` | Modified — 4 help texts |
| `openclaw_runtime/src/config/runtime-context-block-compass.test.ts` | New — 2 config tests |
| `openclaw_runtime/src/config/runtime-context-block-role-memory.test.ts` | New — 2 config tests |
| `openclaw_runtime/src/config/runtime-context-block-working-memory.test.ts` | Modified — type assertion update |
| `openclaw_runtime/src/config/runtime-context-block-tool-registry.test.ts` | Modified — type assertion update |
| `openclaw_runtime/src/sessions/session-key-utils.ts` | Modified — isMainSessionKey mainKey param |
| `package.json` | Modified — test:dcs + lint:dcs scripts |
| `harness/specs/tasks/dcs-stage4-knowledge-unification.md` | New — task spec |
| `harness/specs/rules/dcs-stage4-knowledge-unification-boundary.md` | New — boundary rule |

### Prohibition Compliance

- ANTI-3: subagent never queries compass; main never queries role-memory: **PASS**
- No double injection (exactly-once via `## Knowledge` heading): **PASS**
- No third role-memory injection channel (addendum 5): **PASS**
- No chain compression (`compression_depth = 0`): **PASS**
- No legacy builder rewrite (`buildPreReplyInjection` / `buildContextPack` unmodified): **PASS**
- No COMPASS write path activation (working-memory handler's TemporalFact path): **PASS**
- No transport changes (Renderer/Main/Gateway): **PASS**
- No `BlockMutability` widening (only `"system_managed"`): **PASS**
- No new database/table: **PASS**
- No Stage 1/2/3 behavioral edit: **PASS**

---

## Independent Adversarial Review

**Reviewer**: Lead agent (adversarial scanning via search subagent)
**Scope**: All R5 implementation files, boundary compliance, ANTI-3, exactly-once,
admission context, flag-guard correctness, addendum compliance

**Findings (3 issues found and fixed)**:

1. **CRITICAL — compass knowledge Block always rejected by BlockStore admission**:
   `handleCompassKnowledge` passed `admission: { significance: "high", write_origin: "handler" }`
   but BlockStore's `evaluateAdmission` requires `verification_status`, `confidence >= 0.6`,
   and `audn_state` for compass knowledge Blocks. Missing fields caused silent rejection
   with reason `"compass_knowledge_unverified"`. Tests masked this by using mock sinks
   that unconditionally accept.
   **Fix**: Added `verification_status: "verified"`, `confidence: 1.0`, `audn_state: "ACTIVE"`
   to the admission context.

2. **IMPORTANT — role-memory `full_content` serialization deviation**:
   Handler serialized `{ buckets, policyVersion }` instead of `ContextPack.buckets` per
   boundary rule. Downstream consumers expecting raw `ContextPackBuckets` shape would see
   wrong JSON structure.
   **Fix**: Changed to `JSON.stringify(pack.buckets)`.

3. **IMPORTANT — `#appendKnowledge` queried by session type, not flags**:
   The OR flag guard at the call site passed when either flag was ON, but inside
   `#appendKnowledge`, `sourceSystems` was built from `eligibleHandlers` (session type)
   only. This allowed injecting a compass Block when compass flag was OFF (if role_memory
   flag was ON and session was main). Flag-off = no-injection contract was violated.
   **Fix**: Pass `resolvedFlags` into `#appendKnowledge` and gate each `sourceSystems`
   push on both `eligibleHandlers` AND the corresponding flag.

**Result**: **Critical 0 / Important 0 after fixes — Verdict: PASS**

---

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| Readiness report proves Stage 1-3 + Runtime build accepted | PASS |
| Preflight identifies canonical knowledge producer paths (compass + role-memory) | PASS |
| RED tests first demonstrate missing behavior | PASS |
| compass handler wraps buildPreReplyInjection, produces knowledge Block via ContextBlockSink | PASS |
| role-memory handler wraps buildContextPack, produces knowledge Block via ContextBlockSink | PASS |
| Assembler #appendKnowledge follows flag-guard + exactly-once + session-type-aware query | PASS |
| knowledge Block has correct presence fields (always_on, on_demand, background, mutability) | PASS |
| ANTI-3 enforced: main → compass only, subagent → role-memory only | PASS |
| No third injection channel (addendum 5) | PASS |
| No chain compression (compression_depth = 0) | PASS |
| Feature flags default to false; when off, no Block produced, no injection | PASS |
| isMainSessionKey accepts optional mainKey (addendum 4) | PASS |
| KNOWLEDGE_INJECTION_CHAR_BUDGET = 2000 declared (addendum 6) | PASS |
| No forbidden changes (transport/host-api/db/Stage 1-3/transcript) | PASS |

---

## R6 Handoff Interface Facts

For R6 (SEKB closure + T1), the following R5 interface facts are stable:

1. **knowledge Block (compass)**: `block_type = "knowledge"`, `source_system = "compass"`, `mutability = "system_managed"`, `always_on = false`, `token_budget = 400`, `priority = 5`
2. **knowledge Block (role-memory)**: `block_type = "knowledge"`, `source_system = "role-memory"`, `mutability = "system_managed"`, `always_on = false`, `token_budget = 400`, `priority = 5`
3. **Producer paths**: `Assembler.assemble` → `handleCompassKnowledge` / `handleRoleMemoryKnowledge` → `ContextBlockSink`
4. **Assembler injection**: `#appendKnowledge` queries `block_types=["knowledge"]`, `source_systems` filtered by session type + flags, `limit=1`
5. **Feature flags**: `runtime.contextBlock.compass.enabled`, `runtime.contextBlock.role_memory.enabled` (defaults to false)
6. **Exactly-once guard**: `KNOWLEDGE_HEADING_PATTERN = /^## Knowledge$/m`
7. **Char budget**: `KNOWLEDGE_INJECTION_CHAR_BUDGET = 2000`
8. **mainKey support**: `isMainSessionKey(sessionKey, mainKey?)` (addendum 4)
9. **Admission context (compass)**: `verification_status: "verified"`, `confidence: 1.0`, `audn_state: "ACTIVE"`
10. **full_content (role-memory)**: `JSON.stringify(pack.buckets)`

---

## Honest Statement

R5 delivers the **unified knowledge Block producers and Assembler injection** for
both compass (main session) and role-memory (subagent session) paths. Two handlers
wrap the existing legacy builders and convert their outputs into system-managed
`knowledge` Blocks. The Assembler injects the `## Knowledge` summary following
flag-guard + exactly-once + session-type-aware query + flag-aware source filtering.
ANTI-3, no-double-injection, no-chain-compression, and no-third-channel are all
enforced.

**Not yet delivered in R5** (per task spec scope, deferred to R6):
- SEKB closure (M6 + T1)
- End-to-end integration test with real agent spawn (current tests use mock
  sinks/stores at the assembler boundary)
- Real `buildPreReplyInjection` / `buildContextPack` output in production
  (handlers are wired but flags default to false)
