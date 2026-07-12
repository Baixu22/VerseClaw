# DCS Round 4 — Stage 3 Tool Registry Block Producer and Assembler Injection

**Status**: COMPLETE
**Date**: 2026-07-12
**Baseline**: `3e715f08233e045d6fc813c769dcd7c101e9b9f6`
**R3 HEAD**: `e00ee941e`
**Task spec**: `harness/specs/tasks/dcs-stage3-tool-registry.md`
**Boundary rule**: `harness/specs/rules/dcs-stage3-tool-registry-boundary.md`

---

## Scope Delivered

R4 delivers DCS v1.6 Stage 3: the `tool_registry` Block producer (cvkHandler)
and Assembler pre-LLM injection. A `before_agent_start` hook produces one
system-managed `tool_registry` Block through `ContextBlockSink` when the
feature flag is on. The Block carries `always_on=true`, `token_budget=200`,
`priority=7`, `on_demand={ expand_tool: "context_read", auto_register: true }`.
The Assembler's `#appendToolRegistry` injects the `## Tools (N available)`
summary into the pre-LLM output following the same flag-guard + exactly-once
pattern as `#appendWorkingMemory`. The existing CVK
`ContextRuntimeKitContextEngine.assemble` path runs unchanged; the Stage 3
Block path is a parallel, flag-gated producer.

---

## Readiness Gate

| Prerequisite | Evidence |
|-------------|----------|
| DCS Stage 1 final COMPLETE | `team/dcs/DCS-ROUND1-COMPLETE.md` — all gates exit 0, review Critical 0 / Important 0 |
| Coding Runtime P0 final COMPLETE | `team/dcs/DCS-ROUND2-COMPLETE.md` — producer envelope 3/3, all gates exit 0 |
| DCS Stage 2 final COMPLETE | `team/dcs/DCS-ROUND3-COMPLETE.md` — task_state + handoff + SEKB, all gates exit 0 |
| Runtime build baseline green | `pnpm --dir openclaw_runtime build` exit 0 (335.5s) |

### Preflight: Canonical Paths

| Path | Canonical location |
|------|-------------------|
| tool_registry producer | `before_agent_start` plugin hook → `handleBeforeAgentStartToolRegistry` → `ContextBlockSink` |
| Assembler injection | `Assembler.assemble` → `#appendToolRegistry` (flag-guard + exactly-once + BlockStore query) |
| Factory wiring | `buildEmbeddedExtensionFactories` → `buildToolRegistryFactory` (returns undefined when no sink/toolEntries) |
| Feature flag | `runtime.contextBlock.tool-registry.enabled` (defaults to false) |
| Source system mapping | `contextBlockFlagNameForSourceSystem("cvk")` → `runtime.contextBlock.tool_registry.enabled` |

---

## RED Phase Evidence

**Test files**:
- `openclaw_runtime/src/context-engine/handlers/tool-registry-handler.test.ts`
- `openclaw_runtime/src/context-engine/assembler.test.ts` (new test cases)
- `openclaw_runtime/src/agents/embedded-agent-runner/extensions.tool-registry.test.ts`
- `openclaw_runtime/src/config/runtime-context-block-tool-registry.test.ts`

RED tests written before implementation. Before GREEN, results were:
- `buildToolRegistryBlock` / `handleBeforeAgentStartToolRegistry` /
  `formatToolRegistryInjection` did not exist (module not found)
- `#appendToolRegistry` did not exist in Assembler
- `buildToolRegistryFactory` did not exist in extensions
- `runtime.contextBlock.tool-registry.enabled` feature flag did not exist
- `cvk` source system was not mapped in `CONTEXT_BLOCK_FLAG_NAME_BY_SOURCE_SYSTEM`

---

## GREEN Phase Evidence

### Implementation Changes

1. **`tool-registry-handler.ts`** (NEW): Core implementation —
   `buildToolRegistryBlock` constructs a system-managed `tool_registry` Block
   with `source_system="cvk"`, `always_on=true`, `token_budget=200`,
   `priority=7`, `on_demand={ expand_tool: "context_read", auto_register: true }`,
   `mutability="system_managed"`. Entries capped at 40. Summary format:
   `## Tools (N available)\n→ context_read('tool_registry') for full schema`.
   `handleBeforeAgentStartToolRegistry` writes through `ContextBlockSink`,
   returns `{ accepted: boolean } | undefined`. `formatToolRegistryInjection`
   parses `full_content` JSON and returns the summary string, or undefined for
   missing/invalid/empty blocks.

2. **`assembler.ts`** (MODIFIED): Added `#appendToolRegistry` method following
   the same flag-guard + exactly-once + BlockStore-query pattern as
   `#appendWorkingMemory`. Queries `block_types=["tool_registry"]`,
   `source_systems=["cvk"]`, `limit=1`. Added `"runtime.contextBlock.tool_registry.enabled": false`
   to `DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS`. Added `cvk` to
   `FlaggedContextBlockSourceSystem` and `CONTEXT_BLOCK_FLAG_NAME_BY_SOURCE_SYSTEM`.
   Added `TOOLS_HEADING_PATTERN` and `hasToolsHeading` helper for exactly-once guard.

3. **`extensions.ts`** (MODIFIED): Added `buildToolRegistryFactory` — registers
   `before_agent_start` handler that calls `handleBeforeAgentStartToolRegistry`
   through `ContextBlockSink`. Returns `undefined` when no sink, no session key,
   or no tool entries. Best-effort: sink failure does not block agent start.
   Added `isToolRegistryEnabled` helper. Added `toolEntries` param to
   `buildEmbeddedExtensionFactories`.

4. **Config files** (MODIFIED): Added `"tool-registry"` to
   `types.openclaw.ts` (optional `{ enabled?: boolean }`), `zod-schema.ts`
   (strict object schema), `schema.labels.ts` (2 labels), `schema.help.ts`
   (2 help texts).

5. **`runtime-context-block-working-memory.test.ts`** (MODIFIED): Updated
   `expectTypeOf` assertion to include `tool-registry` field in the
   `contextBlock` type (required because R4 adds a sibling field to the same
   type).

6. **Test files** (NEW): 3 new test files with 19 tests total:
   - `tool-registry-handler.test.ts` — 12 tests (buildToolRegistryBlock,
     handleBeforeAgentStartToolRegistry, formatToolRegistryInjection)
   - `extensions.tool-registry.test.ts` — 5 tests (factory omission conditions,
     handler registration, best-effort failure)
   - `runtime-context-block-tool-registry.test.ts` — 2 tests (default-off typed
     config surface, strict schema keys)
   - `assembler.test.ts` — 5 new tests + 2 updated tests (flag off no-op,
     flag on injects, exactly-once, empty store, cvk mapping)

7. **`package.json`** (MODIFIED): Updated `test:dcs` and `lint:dcs` scripts to
   include R4 files.

### After GREEN:
- All 12 tests in `tool-registry-handler.test.ts` PASS
- All 22 tests in `assembler.test.ts` PASS (17 existing + 5 new)
- All 5 tests in `extensions.tool-registry.test.ts` PASS
- All 2 tests in `runtime-context-block-tool-registry.test.ts` PASS
- All 104 tests in `test:dcs` PASS (73 unit + 4 runtime-config + 27 agents)

---

## Gate Evidence

| Gate | Command | Exit Code | Notes |
|------|---------|-----------|-------|
| Harness context | `pnpm harness context --spec ...` | 0 | Reading list generated |
| Harness validate | `pnpm harness validate --spec ... --since e00ee941e` | 0 | Spec valid |
| Typecheck | `pnpm run typecheck` | 0 | node + web projects pass |
| Lint (DCS) | `pnpm run lint:dcs` | 0 | 0 warnings, 0 errors on 35 files |
| Test (DCS) | `pnpm run test:dcs` | 0 | 104/104 tests pass (73 unit + 4 rc + 27 agents) |
| Harness CI | `pnpm run harness:ci` | 0 | 14/14 tests pass |
| Harness run (dry) | `pnpm harness run --spec ... --since e00ee941e --dry-run` | 0 | Report generated |
| Contract check | `pnpm contract:check` | 0 | Contract check passed |
| Comms replay | `pnpm run comms:replay` | 0 | Pass |
| Comms compare | `pnpm run comms:compare` | 0 | Pass |
| Runtime build | `pnpm --dir openclaw_runtime build` | 0 | Build successful (335.5s) |
| Git diff check | `git diff --check` | 0 | No whitespace errors |

---

## Ownership / Prohibition Scan

### Touched Files (R4 changes only)

| File | Change Type |
|------|-------------|
| `openclaw_runtime/src/context-engine/handlers/tool-registry-handler.ts` | New — core implementation |
| `openclaw_runtime/src/context-engine/handlers/tool-registry-handler.test.ts` | New — 12 tests |
| `openclaw_runtime/src/context-engine/assembler.ts` | Modified — #appendToolRegistry + flag + cvk mapping |
| `openclaw_runtime/src/context-engine/assembler.test.ts` | Modified — 5 new tests + 2 updated |
| `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts` | Modified — buildToolRegistryFactory + isToolRegistryEnabled |
| `openclaw_runtime/src/agents/embedded-agent-runner/extensions.tool-registry.test.ts` | New — 5 wiring tests |
| `openclaw_runtime/src/config/types.openclaw.ts` | Modified — tool-registry config type |
| `openclaw_runtime/src/config/zod-schema.ts` | Modified — tool-registry zod schema |
| `openclaw_runtime/src/config/schema.labels.ts` | Modified — 2 labels |
| `openclaw_runtime/src/config/schema.help.ts` | Modified — 2 help texts |
| `openclaw_runtime/src/config/runtime-context-block-tool-registry.test.ts` | New — 2 config tests |
| `openclaw_runtime/src/config/runtime-context-block-working-memory.test.ts` | Modified — type assertion update |
| `package.json` | Modified — test:dcs + lint:dcs scripts |
| `harness/specs/tasks/dcs-stage3-tool-registry.md` | New — task spec |
| `harness/specs/rules/dcs-stage3-tool-registry-boundary.md` | New — boundary rule |

### Prohibition Compliance

- No direct SQLite DDL outside BlockStore: **PASS**
- No direct Renderer IPC or Gateway HTTP/WebSocket: **PASS**
- No modifications to existing CVK `ContextRuntimeKitContextEngine.assemble` path: **PASS**
- No COMPASS/knowledge/experience/environment Block production: **PASS**
- No AgentMap/AST/CodeGraph/LSP activation: **PASS**
- No new host-api contract: **PASS**
- No Renderer/Main/Gateway transport change: **PASS**
- No new database/table: **PASS**
- No Stage 1/2 behavioral edit: **PASS**
- No transcript write: **PASS**
- No working-memory or task-state handler modification: **PASS**

### Untracked Files

No untracked files remain after R4 work (all new files are staged for commit).

---

## Independent Adversarial Review

**Reviewer**: Lead agent (adversarial scanning)
**Scope**: All R4 implementation files, boundary compliance, flag-guard + exactly-once correctness, ownership chain
**Findings**:
- Handler: Clean — no forbidden imports, no direct SQLite, no prompt formatting, correct Block fields
- Assembler: `#appendToolRegistry` follows identical pattern to `#appendWorkingMemory` (flag-guard → store check → exactly-once → query → format → inject)
- Extensions: `buildToolRegistryFactory` returns undefined for all omission conditions, best-effort sink failure handling
- Config: Default-off verified in `DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS`, zod schema, and type assertion
- No boundary violations: No COMPASS, knowledge, experience, environment, AgentMap, AST, CodeGraph, transport, host API, database, Stage 1/2, or transcript changes
- Diff is minimal: +235 insertions, -6 deletions across 9 modified files + 6 new files

**Result**: **Critical 0 / Important 0 — Verdict: PASS**

---

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| Readiness report proves Stage 1 + Coding Runtime P0 + Stage 2 + Runtime build accepted | PASS |
| Preflight identifies canonical cvkHandler producer path and Assembler injection path | PASS |
| RED tests first demonstrate missing behavior | PASS |
| cvkHandler produces tool_registry through ContextBlockSink/BlockStore, no direct SQLite | PASS |
| Assembler #appendToolRegistry follows flag-guard + exactly-once + BlockStore-query pattern | PASS |
| tool_registry Block has correct presence fields (always_on, token_budget, priority, on_demand, mutability) | PASS |
| Feature flag defaults to false; when off, no Block produced, no injection, existing behavior unchanged | PASS |
| No forbidden changes (COMPASS/knowledge/experience/environment/AgentMap/AST/CodeGraph/transport/host-api/db/Stage 1-2/transcript) | PASS |

---

## R5 Handoff Interface Facts

For R5 (knowledge unification), the following R4 interface facts are stable:

1. **tool_registry Block**: `block_type = "tool_registry"`, `source_system = "cvk"`, `mutability = "system_managed"`, `always_on = true`, `token_budget = 200`, `priority = 7`
2. **Producer path**: `before_agent_start` → `handleBeforeAgentStartToolRegistry` → `ContextBlockSink`
3. **Assembler injection**: `#appendToolRegistry` queries `block_types=["tool_registry"]`, `source_systems=["cvk"]`, `limit=1`
4. **Feature flag**: `runtime.contextBlock.tool-registry.enabled` (defaults to false)
5. **Source system mapping**: `cvk` → `runtime.contextBlock.tool_registry.enabled` via `contextBlockFlagNameForSourceSystem`
6. **Exactly-once guard**: `TOOLS_HEADING_PATTERN = /^## Tools \(\d+ available\)$/m`
7. **Factory wiring**: `buildToolRegistryFactory` in `buildEmbeddedExtensionFactories`, returns undefined when no sink/toolEntries
8. **Summary format**: `## Tools (N available)\n→ context_read('tool_registry') for full schema`

---

## Honest Statement

R4 delivers the **tool_registry Block producer and Assembler injection**: A
`before_agent_start` hook produces one system-managed `tool_registry` Block
through `ContextBlockSink` when the feature flag is on. The Assembler injects
the `## Tools (N available)` summary into the pre-LLM output following the
same flag-guard + exactly-once pattern as working_memory. The existing CVK
path runs unchanged.

**Not yet delivered in R4** (per task spec scope, deferred to R5+):
- Knowledge unification (M5b)
- SEKB closure (M6 + T1)
- End-to-end integration test with real agent spawn (current tests use mock
  sinks/stores at the factory boundary)
- toolEntries provision from the agent's real tool list (current factory
  accepts `toolEntries` param but no caller passes real entries yet)
