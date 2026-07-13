---
id: dcs-stage5-sekb-closure-boundary
title: "DCS Stage 5 SEKB Closure — Boundary Rule"
scenario: gateway-backend-communication
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

# DCS Stage 5 SEKB Closure — Boundary Rule

## Required Ownership

| Component | Owner |
|-----------|-------|
| experience Block bridge | `experience-block-bridge.ts` |
| context_search tool | `context-search-tool.ts` |
| context_write tool | `context-write-tool.ts` |
| distillation-tool extension | `distillation-tool.ts` (modified — optional sink param only) |
| provider-registry pilot deletion | `provider-registry.ts` (T1) |
| coding-tool text decoding and writeback | `sessions/tools/text-file-codec.ts` (T2) |
| tracked Git-blob UTF-8 and U+FFFD gate | `scripts/runtime-utf8-inventory.mjs` (T2) |
| base coding-tool assembly | `agent-tools.ts` per-tool table (T2) |

## experience Block Contract

| Field | Value |
|-------|-------|
| block_type | `"experience"` |
| source_system | `"sekb"` |
| presence.always_on | `false` |
| presence.on_demand.expand_tool | `"context_search"` |
| presence.on_demand.auto_register | `false` |
| presence.background | `true` |
| mutability | `"system_managed"` |
| compression_depth | `0` |
| entity_extraction_status | `"empty"` |
| full_content | principle's `full_content` string |
| entities | `task_types + context_tags` |
| summary | `## Experience\n{principle.title}` |

## Admission Context (experience)

| Field | Value |
|-------|-------|
| confirmed | `true` |
| confidence | `suggestion.confidence` (0–1) |
| write_origin | `"handler"` |

BlockStore admission gate (already implemented):
- `confirmed !== true` → reject `"experience_requires_confirmation"`
- `confidence` not in [0,1] → reject `"experience_confidence_invalid"`
- Per-session limit 3, eviction by `retention_confidence ASC, valid_at ASC, block_id ASC`

## context_search Contract

- Input: `query: string`, `session_id: string`, `limit?: number` (≤ 5)
- Entity extraction: rule-based (split, filter stop words, lowercase)
- Non-empty entities → `queryByEntity` (SAG mode)
- Empty entities → `query` (fallback mode)
- Results marked `fallback_mode='vector_only'` when no entities used
- `query='principles'` → `block_types=["experience"]` filter
- Returns top-K (K ≤ 5)

## context_write Contract

- Input: `operation: "append" | "replace" | "clear"`, `content: string`, `role: string`, `session_id: string`
- block_type fixed to `"notes"` (NOT a parameter)
- `source_system="agent-notes"`, `mutability="agent_writable"`
- Role whitelist: `planner` / `architect` / `implementer`
- `append`: concatenate with existing notes Block content
- `replace`: overwrite notes Block content
- `clear`: set content to empty string
- ANTI-7: role not in whitelist → reject

## Prohibitions

1. **ANTI-8**: `suggest_principles_from_trajectories` results MUST NOT write
   any Block to BlockStore. Only `confirm_and_save` can write `experience` Blocks.
2. **No Stage 1-4 behavioral change**: working-memory, task-loop, tool-registry,
   compass/role-memory handlers and Assembler injection paths must not be modified.
3. **No new vector index**: `context_search` must reuse existing BlockStore
   `query`/`queryByEntity` infrastructure. No new embedding/vector system.
4. **No compression**: `compression_depth = 0` for all experience Blocks.
5. **No advisory write path**: advisory results must never touch `ContextBlockSink`.
6. **No BlockMutability widening**: experience = `"system_managed"`,
   notes = `"agent_writable"`. No `"readonly"`.
7. **No transport changes**: Renderer/Main/Gateway paths unchanged.
8. **T1 boundary**: delete the pilot functions and their exclusive orchestration,
   migrate valid tests to formal registry construction, and preserve provider
   factories used by direct tests. Other live/CVK paths must NOT be touched.
9. **No `chat-turn-memory-injection.ts` changes** (R5 already handled per 增补5).
10. **No `assembler.ts` / `block-store.ts` / existing handler changes** for T1.
11. **T2 encoding preservation**: edit and apply_patch must preserve BOM/UTF-16
    encoding, existing physical line separators, and terminal-newline state.
    Unsupported legacy encodings and binary data must fail before mutation.
12. **T2 DCS stability**: write/edit/apply_patch result shapes and
    `details.working_memory` envelopes must not change.
13. **T2 tool-policy stability**: read/edit/write ordering, sandbox read-only
    filtering, workspace guards, approval behavior, and container workdir
    handling must not change.
14. **T2 SDK stability**: no direct narrowing of
    `plugin-sdk/agent-sessions.ts`; any future public export removal requires a
    separate compatibility and deprecation migration.
15. **T2 encoding gate**: binary blobs are classified before decoding, all
    tracked text Git blobs must be valid UTF-8, and every U+FFFD occurrence
    must match exactly one reasoned, tested, count-guarded allowlist entry.

## Required Evidence

1. `confirm_and_save` with sink → experience Block written to BlockStore
2. `confirm_and_save` without sink → original behavior unchanged (no Block write)
3. `suggest_principles_from_trajectories` → NO Block write (ANTI-8 negative test)
4. `context_search(query='principles')` → returns experience Blocks
5. `context_search` with entities → uses `queryByEntity`
6. `context_search` without entities → `fallback_mode='vector_only'`
7. `context_write` with non-whitelisted role → rejected (ANTI-7)
8. T1: zero production callers proven before deletion and zero production/test
   imports after migration
9. T2: real filesystem round trips cover UTF-8 BOM, UTF-16LE/BE, LF, CRLF,
   CR-only, mixed endings, no terminal newline, GBK rejection, and binary
   rejection without mutation
10. T2: coding-tool registration, bash characterization, and DCS producer
    envelope tests retain names, order, policy, and response contracts
11. T2: all-repo Git-blob scan reports invalidFiles=0, invalidUnits=0,
    worktreeMismatches=0, unallowedReplacementUnits=0, and
    replacementAllowlistErrors=0
