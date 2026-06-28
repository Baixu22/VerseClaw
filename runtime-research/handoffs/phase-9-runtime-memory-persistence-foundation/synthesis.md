# Phase 9 Synthesis: Runtime Memory Persistence Foundation

## Decision

Phase 9 is accepted only as a default-off local sanitized Runtime Memory persistence foundation.

The accepted scope is the standalone `openclaw_runtime.runtime-core.memory-persistence` local SQLite proof for sanitized episode/fact/invalidation records, plus lane evidence proving owner/schema, idempotent migration, retention, redaction, invalidation, rollback, flag-off parity, current-valid query behavior, durable promotion gates, and no runtime authority.

This does not accept runtime cutover, default-on memory recording/provider/persistence/extraction/promotion, provider ordering cutover, raw chat/transcript/trace/prompt/tool/env/secret retention, unverified durable facts, service/exporter/database-service/listener work, or memory-derived completion/verifier/security/retry/tool/runtime authority.

## Inputs Reviewed

| Input | Result | Notes |
|---|---|---|
| `AGENTS.md` | reviewed | Root harness routing, renderer/Main boundary, docs sync, comms checklist, and pnpm caveats reviewed. |
| `C:\Users\27933\.codex\RTK.md` | reviewed | RTK preference reviewed; `rtk` was not on PATH, but `C:\Users\27933\.cherrystudio\bin\rtk.exe` was available for direct validation commands. |
| `openclaw_runtime/AGENTS.md` | reviewed | Runtime subtree rules reviewed, including SQLite state-storage policy and no service/listener/exporter constraints. |
| `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | reviewed/validated | Defines Phase 9 as default-off local sanitized persistence only. |
| Phase 9 README, parallel lanes, and submission template | reviewed | Boundary rejects default-on behavior, raw retention, unverified facts, services/exporters/database services/listeners, provider ordering cutover, and runtime authority. |
| Phase 9 Lane A-E submissions | reviewed/rechecked | Each has exactly one `Status: accepted` line; claims were revalidated against code/tests/scans. |
| `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/synthesis.md` | reviewed | Phase 8 accepted docs/evidence readiness only and did not accept runtime persistence cutover. |
| `harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md` | reviewed/validated | Phase 8 remains prerequisite cutover-readiness boundary. |
| `harness/specs/tasks/phase-7-runtime-memory-provider.md` | reviewed/validated | Phase 7 accepted default-off local readonly/proposal-only foundation only. |
| `runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md` | reviewed | Confirms no persistence/default-on/provider-ordering cutover was accepted in Phase 7. |
| `runtime-research/agent-runtime-index.md` | reviewed | Current index still listed Phase 9 as entry-ready before this synthesis. |
| Harness context rules/layer files | reviewed | Renderer boundary, backend communication, api-client transport, host-api/host-events fallback, gateway readiness, comms regression, docs sync, active config guards, and runtime layer reviewed. |
| Focused runtime memory source/tests | reviewed/rechecked | `memory-context.ts`, `memory-store.ts`, `memory-persistence.ts`, `memory-proposal-shadow.ts`, `memory-context-provider.ts`, provider registry, config schema/help/labels, and focused tests reviewed. |

## Lane Classification

| Lane | Result | Reason |
|---|---|---|
| `lane-a-persistence-spec-boundary` | accepted | Establishes the Phase 9 boundary and rejects default-on persistence, runtime cutover, raw retention, unverified durable facts, provider-ordering cutover, services/exporters/database services/listeners, and runtime authority. No runtime behavior changed. |
| `lane-b-local-store-schema-migration` | accepted | Current code/test evidence proves a standalone default-off local SQLite persistence proof with named owner/schema, idempotent migration, sanitized writes, retention bounds, flag-off no-open parity, rollback-by-disable, and candidate records remaining candidates. |
| `lane-c-retention-redaction-rollback` | accepted | Refreshed evidence acknowledges the current persistence implementation and proves retention/redaction/invalidation/rollback only within the default-off foundation. It does not accept runtime cutover. |
| `lane-d-flag-off-provider-fact-parity` | accepted | Proves default provider ordering remains legacy context engine then loop context pack, memory provider is optional/readonly/no-authority, durable facts require promotion evidence, and candidates/LLM-like proposals do not become durable facts. |
| `lane-e-validation-docs-synthesis-readiness` | accepted | Rechecked status lines, harness validation, focused tests, typecheck, renderer/raw/service/persistence scans, and comms replay/compare due dirty communication-path files. |

## Status Line Audit

| Submission | Count | Line |
|---|---:|---|
| `lane-a-persistence-spec-boundary.md` | 1 | `Status: accepted` |
| `lane-b-local-store-schema-migration.md` | 1 | `Status: accepted` |
| `lane-c-retention-redaction-rollback.md` | 1 | `Status: accepted` |
| `lane-d-flag-off-provider-fact-parity.md` | 1 | `Status: accepted` |
| `lane-e-validation-docs-synthesis-readiness.md` | 1 | `Status: accepted` |

Command:

```text
rg -n "^Status:" runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-*.md
```

Result: exactly one accepted status line per A-E submission.

## Persistence Foundation Audit

| Surface | Evidence | Result |
|---|---|---|
| Store owner and schema | `RUNTIME_MEMORY_PERSISTENCE_OWNER` is `openclaw_runtime.runtime-core.memory-persistence` in `openclaw_runtime/src/runtime-core/memory-persistence.ts:42`; schema version is `1` at line 44; local SQLite tables are created for meta, episodes, idempotency keys, facts, and invalidations at lines 209-305. | pass |
| Local store, not database service | The owner opens the existing shared state SQLite handle through `openOpenClawStateDatabase` only inside the persistence owner at `memory-persistence.ts:325` and write transaction path at lines 445-451. Service/exporter/listener scan over focused memory code/tests returned `NO_MATCHES`. | pass |
| Migration and idempotency | `migrate()` is flag-gated at `memory-persistence.ts:342-345`; schema/meta upsert is idempotent at lines 456-477; episode dedupe/merge uses idempotency-key/canonical episode handling at lines 480-500; fact and invalidation dedupe avoid overwriting canonical records at lines 508-564; focused persistence tests passed. | pass |
| Retention and redaction | Store defaults remain 256 episodes, 512 facts, and 256 invalidations at `memory-store.ts:26-28`; trimming occurs in store and persistence rows; persistence sanitizes episode/fact/invalidation writes through existing Runtime Memory sanitizers at `memory-persistence.ts:813-860`; focused tests assert raw `stdout dump` and `raw prompt` are absent from persisted SQLite JSON. | pass |
| Rollback and flag-off parity | `migrate`, `appendEpisode`, `appendFact`, `invalidateFact`, and `loadStore` all return skipped/disabled before DB open when `runtime.memory.persist` is false at `memory-persistence.ts:342-413`; `tests/unit/runtime-memory-persistence.test.ts` proves an injected throwing opener is never called; import scan found no persistence import into TaskLoop, Gateway, Electron, renderer, shared contracts, provider registry, or runtime-core barrel. | pass |
| Current-valid query behavior | `isRuntimeMemoryFactValidAt` excludes invalidated/expired facts by default at `memory-context.ts:900-928`; `matchesVerification` excludes candidate/rejected/invalidated facts unless explicitly requested at lines 1176-1194; store applies only accepted invalidations at `memory-store.ts:306-324`; focused tests passed. | pass |
| Durable promotion gate | `isRuntimeMemoryTemporalFact` requires accepted verification status, finite `acceptedAt`, and promotion evidence at `memory-context.ts:570-584`; `factToRow` persists candidates with `record_kind = "candidate"`, `proposed_at`, and null `promotion_json` at `memory-persistence.ts:758-784`; focused persistence tests assert verified-looking candidates remain candidates. | pass |
| Provider ordering and authority boundary | Default registry remains `createLegacyContextEngineProvider()`, `createLoopContextPackProvider()`, then explicit extras at `provider-registry.ts:252-259`; `RuntimeMemoryProvider` is `enabledByDefault: false`, `shadowOnly: true`, and marks no completion/verifier/security/retry/tool/runtime authority at `memory-context-provider.ts:65-84` and repeated result metadata. | pass |

## Rejected Boundary Audit

| Rejected Surface | Evidence | Result |
|---|---|---|
| Raw chat-log/transcript memory | Raw-retention scan matches in production memory code are denylist/redaction classifiers in `memory-context.ts`; negative tests assert rejection/redaction; `memory-persistence.ts` raw-retention scan returned `NO_MATCHES`. | pass |
| Raw trace-dump memory | Raw trace/traceparent/tracestate/baggage matches are rejection patterns or negative fixtures; no persistence write path stores raw trace context. | pass |
| Raw prompt/tool/env/secret retention | Sanitizers reject or redact prompt/tool/env/secret markers before store/persistence; persistence tests assert raw tool/prompt strings are absent from DB JSON. | pass |
| Unverified durable facts | Candidate and durable shapes remain separate; durable facts require accepted status plus verifier, human, or deterministic-rule promotion evidence; candidates are persisted as `record_kind = "candidate"` and do not gain promotion fields. | pass |
| Default-on memory behavior | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` keeps `shadow`, `provider`, `proposeFacts`, and `persist` false at `memory-context.ts:129-134`; production default-on scan over memory/config files returned `NO_MATCHES`. | pass |
| Provider-ordering cutover | Default provider registry ordering is unchanged and memory appears only as an explicit extra provider. No provider ordering cutover is accepted. | pass |
| Persistence without owner/schema/migration/rollback proof | Owner/schema/migration/idempotency/retention/redaction/rollback evidence is present and tested. Accepted scope remains standalone and default-off. | pass |
| Service/exporter/database-service/listener/second runtime | Focused service/exporter/listener scan returned `NO_MATCHES`; local SQLite file state is not a graph/database service, daemon, listener, HTTP/WebSocket server, OTLP exporter, collector, Temporal service, second Gateway, or second runtime. | pass |
| Memory-derived completion/verifier/security/retry/tool/runtime authority | Provider metadata and tests declare no-authority; persistence import scan found no wiring into TaskLoop, Gateway, tool policy, verifier, security, retry, or renderer paths. | pass |

## Validation Evidence

| Command / Test | Result | Covers | Gaps |
|---|---|---|---|
| `pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | failed before harness | Required bare pnpm attempt | Blocked by `ERR_PNPM_IGNORED_BUILDS`; equivalent `corepack pnpm` commands were run. |
| `corepack pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 context/read order | pnpm warning only. |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 spec validity | none |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md` | pass | Phase 8 prerequisite spec validity | none |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Phase 7 prerequisite spec validity | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-persistence.test.ts` | pass, 6 files / 36 tests | Runtime memory contracts, store, proposal shadow, provider, registry, and persistence proof | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node TypeScript | no diagnostics |
| Renderer boundary scan over `src/pages src/components` | pass/no matches | No direct renderer IPC/Gateway HTTP/WebSocket bypass | `NO_MATCHES` |
| Raw-retention scan over focused memory/config/test surface | pass/reviewed | No raw persistence write path | Matches are sanitizer denylist/redaction code, negative fixtures/assertions, or pre-existing config transcript/secret help/labels. |
| Raw-retention scan over `memory-persistence.ts` | pass/no matches | Persistence implementation stores no raw marker literals | `NO_MATCHES` |
| Service/exporter/database/listener scan over focused memory code/tests | pass/no matches | No service/exporter/listener additions | `NO_MATCHES` |
| Persistence scan over focused memory/config/test surface | pass/reviewed | Intended default-off local SQLite proof only | Matches are `memory-persistence.ts`, config gate/help/labels, and tests; no JSONL transcript import or raw file writer path. |
| Persistence runtime-authority import scan | pass/no matches | No import/wiring into TaskLoop, Gateway, Electron, renderer, shared, provider registry, or runtime-core index | `NO_MATCHES` |
| Production memory default-on scan | pass/no matches | No production memory/config default true | `NO_MATCHES`; `persist: true` appears only in explicit opt-in tests. |
| `corepack pnpm run comms:replay` | pass | Required because current dirty worktree includes Main/Gateway/host-api/shared/provider-related communication files | no output beyond successful script invocation |
| `corepack pnpm run comms:compare` | pass | Communication regression compare | no output beyond successful script invocation |

## Design Conflicts And Follow-Ups

| Conflict / Gap | Evidence | Resolution |
|---|---|---|
| Phase 8 said persistence was design-only, but current Phase 9 code now includes a standalone persistence owner. | Phase 8 synthesis blocks persistence implementation until Phase 9 proof; Phase 9 Lane B/D code/tests prove the new default-off local persistence foundation. | Resolved for foundation only. Runtime cutover remains blocked. |
| Lane C had to avoid stale no-implementation language. | Lane C was refreshed and Lane D/E revalidated current `memory-persistence.ts`. | Resolved; synthesis relies on current code/tests/scans, not stale lane text. |
| Config help still frames `runtime.memory.persist` as reserved/future Phase 9 validation. | `openclaw_runtime/src/config/schema.help.ts:2011-2012` says setting the flag does not implement persistence/write files/databases. This remains true for runtime wiring, because persistence is standalone and not imported by runtime authority paths. | Not blocking for this synthesis. Update config help before making the persistence API user/operator-facing or wiring runtime writes. |
| Current worktree includes unrelated dirty communication files. | `git status -sb` shows Main/Gateway/host-api/shared/provider-related changes outside this synthesis. | `corepack pnpm run comms:replay` and `corepack pnpm run comms:compare` both passed. |

## Ready For Cutover?

No runtime cutover is ready.

Phase 9 is ready only as a default-off local sanitized persistence foundation. It is not ready for default-on persistence, default provider registration, provider ordering cutover, automatic fact extraction/promotion, raw transcript/chat/trace/tool/env retention, or any memory-derived runtime authority.

## Required Fixes Before Next Phase

1. Add a fresh cutover task spec before wiring persistence into TaskLoop, Gateway, provider ordering, runtime execution, verifier, tool policy, security policy, retry policy, or user-visible behavior.
2. Keep `runtime.memory.persist`, `runtime.memory.provider`, `runtime.memory.shadow`, and `runtime.memory.proposeFacts` default false until a later synthesis explicitly accepts a specific cutover.
3. Before any operator-facing persistence workflow, refresh config help/docs so the standalone Phase 9 persistence owner is described accurately without implying runtime cutover.
4. Continue proving no raw chat/transcript/trace/prompt/payload/checkpoint/tool/env/secret retention and no candidate/LLM proposal durable promotion.
5. Run comms replay/compare for any Main/Gateway/host-api/api-client/provider transport path change.

## agent-runtime-index.md Update To Apply

```text
Runtime Memory Provider:
  code: openclaw_runtime/src/runtime-core/memory-context.ts; openclaw_runtime/src/runtime-core/memory-store.ts; openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts; openclaw_runtime/src/runtime-core/memory-persistence.ts; openclaw_runtime/src/context-engine/memory-context-provider.ts; openclaw_runtime/src/runtime-core/index.ts
  tests: tests/unit/runtime-memory-context-contracts.test.ts; tests/unit/runtime-memory-store.test.ts; tests/unit/runtime-memory-proposal-shadow.test.ts; tests/unit/runtime-memory-context-provider.test.ts; tests/unit/runtime-memory-persistence.test.ts; tests/unit/runtime-feature-config-schema.test.ts; tests/unit/context-provider-registry.test.ts
  status: accepted_phase_7_runtime_memory_provider_shadow_readonly_proposal_only; accepted_phase_8_runtime_memory_cutover_readiness_docs_only_validated_after_lane_f_config_schema_parity; accepted_phase_9_runtime_memory_persistence_foundation_default_off_local_sanitized_only
  next: Runtime cutover, default-on memory behavior, provider-ordering cutover, durable automatic promotion, raw retention, service/exporter/database-service/listener work, and memory runtime authority remain blocked until a fresh cutover spec and synthesis accept them.
```

```text
Status: accepted
```
