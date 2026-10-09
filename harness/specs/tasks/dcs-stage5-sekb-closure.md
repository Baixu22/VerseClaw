---
id: dcs-stage5-sekb-closure
title: "DCS Stage 5: SEKB Distillation Write-Back Closure"
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 3f8cd6bcdc91cdaf1feab5c2bb5ce7a4ab78bec6
intent: |
  Bridge `confirm_and_save` to write `experience` Blocks to BlockStore via
  ContextBlockSink. Implement `context_search` and `context_write` tools per
  spec Chapter 6. ANTI-8: advisory results must not write Blocks. T1: delete
  provider-registry pilot dead code. T2: converge coding-tool encoding,
  line-ending, registration, and Runtime structure contracts without changing
  DCS producer envelopes or public sessions SDK exports.
touchedAreas:
  - electron/services/agents-api.ts
  - electron/services/mcp-api.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.test.ts
  - openclaw_runtime/src/knowledge/sekb/distillation-tool.ts
  - openclaw_runtime/src/context-engine/tools/context-search-tool.ts
  - openclaw_runtime/src/context-engine/tools/context-search-tool.test.ts
  - openclaw_runtime/src/context-engine/tools/context-write-tool.ts
  - openclaw_runtime/src/context-engine/tools/context-write-tool.test.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - openclaw_runtime/src/context-engine/block.ts
  - openclaw_runtime/scripts/runtime-utf8-inventory.mjs
  - openclaw_runtime/scripts/runtime-utf8-inventory.test.mjs
  - openclaw_runtime/scripts/runtime-utf8-replacement-allowlist.json
  - openclaw_runtime/src/agents/agent-tools.read.characterization.test.ts
  - openclaw_runtime/src/agents/agent-tools.read.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/apply-patch-update.ts
  - openclaw_runtime/src/agents/apply-patch.test.ts
  - openclaw_runtime/src/agents/apply-patch.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.ts
  - openclaw_runtime/src/agents/failover-error.ts
  - openclaw_runtime/src/agents/sandbox/runtime-status.ts
  - openclaw_runtime/src/agents/sessions/tools/edit-diff.test.ts
  - openclaw_runtime/src/agents/sessions/tools/edit-diff.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.test.ts
  - openclaw_runtime/src/agents/sessions/tools/edit.ts
  - openclaw_runtime/src/agents/sessions/tools/output-accumulator.test.ts
  - openclaw_runtime/src/agents/sessions/tools/read.test.ts
  - openclaw_runtime/src/agents/sessions/tools/read.ts
  - openclaw_runtime/src/agents/sessions/tools/text-file-codec.ts
  - openclaw_runtime/src/agents/sessions/tools/write.test.ts
  - openclaw_runtime/src/agents/sessions/tools/write.ts
  - openclaw_runtime/src/auto-reply/reply/commands-session.ts
  - openclaw_runtime/src/config/sessions/store-maintenance.ts
  - openclaw_runtime/src/cron/session-reaper.ts
  - openclaw_runtime/src/infra/restart-sentinel.ts
  - openclaw_runtime/src/infra/tailscale.ts
  - openclaw_runtime/src/security/audit-extra.async.ts
  - openclaw_runtime/src/security/audit-extra.sync.ts
  - tests/unit/helpers/context-provider-registry.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/unit/runtime-agent-map-component-boundary-hardening.test.ts
  - tests/unit/runtime-agent-map-default-on-deep-validation.test.ts
  - tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts
  - tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts
  - tests/unit/runtime-grounding-authority-effectiveness.test.ts
  - tests/unit/runtime-grounding-default-on-diagnostics.test.ts
  - tests/unit/runtime-grounding-ref-projections.test.ts
  - tests/unit/runtime-grounding-shadow-consumers.test.ts
  - tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts
  - tests/unit/runtime-memory-context-provider.test.ts
  - tests/unit/runtime-memory-runtime-integration.test.ts
  - tests/unit/runtime-provider-tool-registry-real-producer-diagnostic-consumer-validation.test.ts
  - tests/unit/runtime-trace-context-provider.test.ts
  - package.json
  - harness/specs/tasks/dcs-stage5-sekb-closure.md
  - harness/specs/rules/dcs-stage5-sekb-closure-boundary.md
  - harness/src/cli.mjs
  - harness/src/git.mjs
  - harness/src/git.test.mjs
  - team/dcs/README.md
  - team/dcs/dcs-v1.6.1-addendum.md
  - runtime-research/agent-runtime-index.md
  - docs/enhancements/05-adaptive-context-budget.md
expectedUserBehavior: |
  After `confirm_and_save` is called, `context_search(query='principles')`
  returns the corresponding `experience` Block. `context_read('experience')`
  is expandable. `context_write` only writes `notes` Blocks for whitelisted
  roles. Advisory results from `suggest_principles_from_trajectories` do NOT
  write Blocks.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - dcs-stage5-sekb-closure-boundary
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/experience-block-bridge.test.ts src/knowledge/sekb/harness-integration.test.ts --since 848b667ea
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/tools/context-search-tool.test.ts src/context-engine/tools/context-write-tool.test.ts
  - pnpm exec vitest run tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-component-boundary-hardening.test.ts tests/unit/runtime-agent-map-default-on-deep-validation.test.ts tests/unit/runtime-agent-map-default-on-implementation-readiness.test.ts tests/unit/runtime-agent-map-default-on-implementation-spec.test.ts tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-default-on-diagnostics.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-provider-tool-registry-real-producer-diagnostic-consumer-validation.test.ts tests/unit/runtime-trace-context-provider.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/sessions/tools/read.test.ts src/agents/sessions/tools/write.test.ts src/agents/sessions/tools/edit.test.ts src/agents/sessions/tools/edit-diff.test.ts src/agents/apply-patch.test.ts src/agents/agent-tools.read.characterization.test.ts src/agents/sessions/tools/output-accumulator.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/sessions/tools/coding-tools-registration.test.ts src/agents/bash-tools.characterization.test.ts src/agents/dcs-producer-envelope.test.ts
  - node --test openclaw_runtime/scripts/runtime-utf8-inventory.test.mjs
  - node openclaw_runtime/scripts/runtime-utf8-inventory.mjs --root . --all --replacement-allowlist openclaw_runtime/scripts/runtime-utf8-replacement-allowlist.json --output artifacts/runtime-utf8-recovery/t-series-inventory.json
acceptance:
  - confirm_and_save writes experience Block to BlockStore via ContextBlockSink
  - experience Block admission uses confirmed=true and confidence in [0,1]
  - Per-session limit of 3 experience Blocks with deterministic eviction
  - context_search(query='principles') returns experience Blocks
  - context_search with entities uses queryByEntity (SAG mode)
  - context_search without entities uses fallback_mode='vector_only'
  - context_search returns top-K (K <= 5)
  - context_write only writes notes Block (sole agent_writable type)
  - context_write supports append/replace/clear operations
  - context_write enforces role whitelist (planner/architect/implementer)
  - ANTI-8: suggest_principles_from_trajectories does NOT write any Block
  - T1: provider-registry pilot functions deleted with zero production/test imports
  - T2: read strictly decodes UTF-8/UTF-16, strips BOMs, rejects unsupported or binary input, and reports physical lines without phantom rows
  - T2: edit and apply_patch preserve source encoding, mixed physical separators, and terminal-newline state without changing untouched content
  - T2: write reports real UTF-8 byte counts and preserves the DCS working_memory result envelope
  - T2: adaptive read paging adds no blank seam and retains first-page truncation metadata
  - T2: coding tools retain deterministic read/edit/write order, sandbox write policy, workspace guards, and result shapes
  - T2: all tracked Git-blob text is valid UTF-8 and every U+FFFD unit is covered by an exact count-guarded allowlist
  - T2: public plugin-sdk/agent-sessions exports remain unchanged because the audited sessions modules have live runtime or public-plugin consumers
  - All Stage 1-5 tests pass (no regression)
  - All gates pass (typecheck, lint:dcs, test:dcs, harness, contract, comms, build)
docs:
  required: true
  references:
    - team/dcs/dcs-v1.6-spec.md (§阶段5, §第六章, §ANTI-8)
    - team/dcs/dcs-v1.6.1-addendum.md (增补5)
---

# DCS Stage 5: SEKB Distillation Write-Back Closure

## Scope

R6 delivers DCS v1.6 Stage 5 (SEKB closure) + T1 (provider-registry pilot deletion).

### 段A — M6 Stage 5

1. **`confirm_and_save` → `experience` Block bridge**: The SEKB
   `DistillationTool.confirm_and_save` method currently writes only to the
   SEKB-internal `sekb_principles` SQLite table. R6 adds a bridge that also
   writes an `experience` Block to BlockStore via `ContextBlockSink`, using
   `admission = { confirmed: true, confidence: suggestion.confidence }`.

2. **`context_search` tool**: Implements spec Chapter 6 search:
   - Rule-extract candidate entities from query string
   - If entities non-empty: `queryByEntity` (SAG mode)
   - If entities empty: `query` with `fallback_mode='vector_only'`
   - Returns top-K (K ≤ 5)
   - `query='principles'` returns `experience` Blocks

3. **`context_write` tool**: Implements spec Chapter 6 write:
   - Only writes `notes` Block (sole `agent_writable` BlockType)
   - Operations: `append` / `replace` / `clear`
   - Role whitelist: `planner` / `architect` / `implementer`

4. **`context_read('experience')` expandable**: Satisfied by `context_search`
   returning `experience` Blocks — the `on_demand.expand_tool` contract is
   honored.

5. **ANTI-8**: `suggest_principles_from_trajectories` advisory results must
   NOT write any Block. Dedicated negative test required.

### 段B — T1

Delete `createContextProviderRegistryPilot` and `runContextProviderRegistryPilot`
from `provider-registry.ts` (zero production callers confirmed). Migrate tests
to direct `RuntimeContextProviderRegistry` construction through an explicit
test-only helper; do not retain deprecated production exports.

## Implementation Plan

### experience-block-bridge.ts (NEW)

Pure functions, sink-agnostic:
- `buildExperienceBlock(params)`: Constructs `experience` Block from a
  `Principle` + `DistillationSuggestion`. `source_system="sekb"`,
  `mutability="system_managed"`, `compression_depth=0`,
  `presence = { always_on: false, on_demand: { expand_tool: "context_search", auto_register: false }, background: true }`.
  `full_content` = principle's `full_content`. `entities` = `task_types` +
  `context_tags`. `summary` = `## Experience\n{principle.title}`.
- `handleConfirmAndSave(params)`: Calls `ContextBlockSink` with
  `admission = { confirmed: true, confidence: suggestion.confidence, write_origin: "handler" }`.
  Returns `{ accepted: boolean } | undefined`.

### distillation-tool.ts (MODIFIED)

`confirm_and_save` accepts optional `contextBlockSink?: ContextBlockSink` and
optional `sessionId?: string`. When both are provided, calls
`handleConfirmAndSave` after `save_principle`. Best-effort: sink failure does
not block the save. The original SEKB-internal save path is unchanged.

### context-search-tool.ts (NEW)

- `extractEntities(query: string): string[]`: Rule-based extraction (splits on
  whitespace, filters stop words, lowercases). Special case: `query='principles'`
  maps to `block_types=["experience"]`.
- `searchContext(params)`: Uses `BlockStore.queryByEntity` when entities
  non-empty, `BlockStore.query` otherwise. Returns top-K ≤ 5. Sets
  `fallback_mode='vector_only'` on results when no entities were used.

### context-write-tool.ts (NEW)

- `writeContext(params)`: Only writes `notes` Block. Validates role is in
  whitelist. Operations: `append` (concatenate), `replace` (overwrite),
  `clear` (empty). Uses `ContextBlockSink` with
  `admission = { write_origin: "context_write" }`.

### provider-registry.ts (MODIFIED — T1)

Delete `createContextProviderRegistryPilot`, `runContextProviderRegistryPilot`,
and their production-only orchestration. Preserve the compatibility provider
factories and migrate valid coverage to a test-only formal-registry harness.

## RED → GREEN

RED tests written first:
1. `experience-block-bridge.test.ts` — buildExperienceBlock, handleConfirmAndSave
2. `context-search-tool.test.ts` — entity extraction, SAG mode, fallback mode, top-K, principles query
3. `context-write-tool.test.ts` — notes-only, operations, role whitelist, ANTI-7
4. ANTI-8 negative test in experience-block-bridge.test.ts
5. Provider-registry test update for T1 deletion

GREEN implementation follows the plan above.

## T2 Encoding And Structural Convergence

### Encoding contract

- `text-file-codec.ts` is the single strict decoder/encoder for coding-tool
  text files. It accepts UTF-8, UTF-8 BOM, UTF-16LE BOM, UTF-16BE BOM, and
  strongly identified BOM-less UTF-16; it rejects malformed UTF-8, GBK-like
  unsupported bytes, NUL/control-heavy binary data, and odd UTF-16 payloads.
- `read`, `edit`, and `apply_patch` use the codec. Updates preserve the
  original UTF-8 BOM or UTF-16 byte order, physical CRLF/LF/CR separator
  profile, and terminal-newline state.
- `write` remains UTF-8 and reports `Buffer.byteLength(content, "utf8")`.
- Adaptive reads join source pages with one source newline and retain the
  first page's truncation details.

### Structural contract

- `agent-tools.ts` assembles `read`, `edit`, and `write` through an ordered
  per-tool table while preserving sandbox read-only filtering, workspace-root
  guards, container workdir handling, and tool order.
- `bash-tools.exec-host-node.ts` names its shared approval dependencies
  explicitly; no execution or approval behavior changes.
- The sessions SDK audit found no safely removable module. The large sessions
  modules have live embedded-runner consumers and
  `plugin-sdk/agent-sessions.ts` remains a public wildcard surface, so T2 makes
  no public export deletion.

### Repository encoding gate

`runtime-utf8-inventory.mjs --all` scans canonical tracked Git blobs after
binary classification. U+FFFD accounting is count-guarded by
`runtime-utf8-replacement-allowlist.json`; stale, overlapping, unexpected, or
expanded entries fail the gate. Source corruption repaired by T2 is limited to
evidence-backed spans in Electron MCP/agent services, Runtime agent/config/
security sources, and `runtime-research/agent-runtime-index.md`.
