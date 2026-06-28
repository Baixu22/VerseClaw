# Line C Grounding Spine Impl Lane D Consumer Projections

## Scope

- Added consumer-side derived projection helpers in `openclaw_runtime/src/runtime-core/grounding.ts`.
- Added focused projection coverage in `tests/unit/runtime-grounding-ref-projections.test.ts`.
- Did not change Memory, AgentMap, or Symbol producer contracts.
- Did not register providers, change provider ordering, add runtime cutover, add persistence, add services/listeners/exporters, or add patch apply behavior.

## Implementation

- `groundingRefsFromMemoryEpisode(...)` at `openclaw_runtime/src/runtime-core/grounding.ts:845`
  - Projects sanitized memory episode source material as `supplied`.
  - Projects linked source/evidence refs as `projected`.
  - Rejects raw memory/source material as `untrusted` with `sanitization.rejectedReason`.
  - Marks memory output as non-promoting source material.
- `groundingRefsFromMemoryFact(...)` at `openclaw_runtime/src/runtime-core/grounding.ts:910`
  - Projects accepted facts as scoped `verified` only for the fact record itself.
  - Keeps linked source/evidence refs `projected`; linked refs are not auto-verified.
  - Projects candidate facts as `projected`.
- `groundingRefsFromMemoryProposal(...)` at `openclaw_runtime/src/runtime-core/grounding.ts:991`
  - Projects invalidation proposals as `projected`, including candidate/proposal trust metadata.
- `groundingRefsFromAgentMapResult(...)` and `groundingRefsFromAgentMapTag(...)` at `openclaw_runtime/src/runtime-core/grounding.ts:1055` and `openclaw_runtime/src/runtime-core/grounding.ts:1142`
  - Projects AgentMap file/symbol refs as readonly supplied/projected links with no prompt/provider/runtime authority.
- `groundingRefsFromSymbolNode(...)`, `groundingRefsFromSymbolReference(...)`, and `groundingRefsFromSymbolCheckpoint(...)` at `openclaw_runtime/src/runtime-core/grounding.ts:1205`, `openclaw_runtime/src/runtime-core/grounding.ts:1268`, and `openclaw_runtime/src/runtime-core/grounding.ts:1313`
  - Projects Symbol node/reference/checkpoint refs as relevance/evidence links only.
- Every helper funnels output through `sanitizeGroundingRef(...)`; every emitted ref has `authority: "none"` and `rawRetained: false`.

## Tests

- Added `tests/unit/runtime-grounding-ref-projections.test.ts`.
- Covers:
  - memory episode/fact/proposal projection
  - no durable fact promotion from grounding alone
  - raw memory/source fields rejected or untrusted
  - AgentMap file/symbol refs projection
  - Symbol node/reference/checkpoint projection
  - consumer projection does not register providers or change default ordering
  - authority always `none`

## Validation

- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` - pass
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` - pass
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-tool-contracts.test.ts tests/unit/runtime-symbol-tool-readonly.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/context-provider-registry.test.ts` - pass, 15 files / 82 tests
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` - pass
- Persistence/service/listener/exporter scan over touched files - no matches
- Patch apply scan over touched files - no matches
- Runtime wiring scan for `GroundingRef|GroundingQuery|grounding` under agents/gateway/electron/shared/src - no GroundingRef/GroundingQuery runtime wiring; only pre-existing lowercase prose/backgrounding matches
- Raw-retention scan over touched files - matches only expected contract fields and the raw rejection test fixture

Local note: `rtk` and plain `git` were not available in this PowerShell PATH, so validation used equivalent `node` / `rg` commands and Git for Windows by absolute path for status checks.

Status: accepted
