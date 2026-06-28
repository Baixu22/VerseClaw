# Phase 9 Lane B: Local Store Schema Migration

## Scope Confirmation

- Lane: `lane-b-local-store-schema-migration`
- Output file: `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-b-local-store-schema-migration.md`
- Files reviewed:
  - `AGENTS.md`
  - `C:\Users\27933\.codex\RTK.md`
  - `openclaw_runtime/AGENTS.md`
  - `runtime-research/agent-runtime-index.md`
  - `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`
  - `harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md`
  - `harness/specs/tasks/phase-7-runtime-memory-provider.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/README.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/parallel-lanes.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/window-prompts.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submission-template.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-a-persistence-spec-boundary.md`
  - `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/synthesis.md`
  - `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/README.md`
  - `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/parallel-lanes.md`
  - `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-f-config-flag-schema-parity.md`
  - `runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md`
  - `runtime-research/handoffs/phase-7-runtime-memory-provider/README.md`
  - `runtime-research/handoffs/phase-7-runtime-memory-provider/parallel-lanes.md`
  - `openclaw_runtime/src/runtime-core/memory-context.ts`
  - `openclaw_runtime/src/runtime-core/memory-store.ts`
  - `openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts`
  - `openclaw_runtime/src/context-engine/memory-context-provider.ts`
  - `openclaw_runtime/src/config/types.openclaw.ts`
  - `openclaw_runtime/src/config/zod-schema.ts`
  - `openclaw_runtime/src/state/openclaw-state-db.ts`
  - `openclaw_runtime/src/state/openclaw-state-db.paths.ts`
  - `openclaw_runtime/src/infra/kysely-sync.ts`
  - `openclaw_runtime/src/infra/kysely-node-sqlite.ts`
  - `tests/unit/runtime-memory-context-contracts.test.ts`
  - `tests/unit/runtime-memory-store.test.ts`
  - `tests/unit/runtime-memory-proposal-shadow.test.ts`
  - `tests/unit/runtime-memory-context-provider.test.ts`
- Files changed:
  - `openclaw_runtime/src/runtime-core/memory-persistence.ts`
  - `openclaw_runtime/src/runtime-core/memory-store.ts`
  - `tests/unit/runtime-memory-persistence.test.ts`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-b-local-store-schema-migration.md`
- Runtime behavior changed: no existing runtime path changed; this adds a standalone opt-in persistence proof API only.
- Main/Gateway/host-api/api-client paths changed: no.

## Executive Summary

Lane B implemented a minimal default-off local SQLite persistence proof for sanitized Runtime Memory records. The local store owner is `openclaw_runtime.runtime-core.memory-persistence`; it uses the existing OpenClaw shared state SQLite handle only when `runtime.memory.persist` is explicitly true. With the flag false, `migrate`, `appendEpisode`, `appendFact`, `invalidateFact`, and `loadStore` all return skipped results before opening or touching SQLite.

This does not enable persistence by default, does not register a provider, does not change provider ordering, does not touch TaskLoop/Gateway/renderer paths, and does not make memory authoritative. Candidate and unpromoted facts stay non-durable candidate records unless a caller supplies an already valid durable fact with accepted verification status and promotion evidence.

## Store Owner And Schema

Local store owner:

- `RUNTIME_MEMORY_PERSISTENCE_OWNER = "openclaw_runtime.runtime-core.memory-persistence"` at `openclaw_runtime/src/runtime-core/memory-persistence.ts:42`.
- `RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION = 1` at `openclaw_runtime/src/runtime-core/memory-persistence.ts:44`.
- The owner opens the existing shared state SQLite database through `openOpenClawStateDatabase` only inside the persist-enabled transaction path at `memory-persistence.ts:325` and `memory-persistence.ts:445`.

Schema shape:

- `runtime_memory_meta` records owner/schema version and idempotent migration timestamps at `memory-persistence.ts:209`.
- `runtime_memory_episodes` stores sanitized episode records at `memory-persistence.ts:217`.
- `runtime_memory_episode_idempotency_keys` maps every observed episode idempotency key to the canonical episode id at `memory-persistence.ts:234`.
- `runtime_memory_facts` stores sanitized temporal fact candidates and durable facts at `memory-persistence.ts:247`.
- `runtime_memory_invalidations` stores sanitized invalidation proposals at `memory-persistence.ts:283`.

Retained episode fields:

- `schema_version`, `episode_id`, `task_id`, `kind`, `reference_time`, `idempotency_key`, `bounded_summary`, `source_refs_json`, `evidence_refs_json`, optional `metadata_json`, `redaction_status`, `record_json`, `created_at`, `updated_at`.

Retained fact fields:

- `schema_version`, `fact_id`, `record_kind` (`candidate` or `fact`), optional `task_id`, `subject`, `predicate`, `object_summary`, `confidence`, `source`, `verification_status`, `valid_at`, optional `invalid_at`, optional `expired_at`, `reference_time`, `source_episode_refs_json`, `evidence_refs_json`, optional `metadata_json`, candidate `proposed_at`, durable `accepted_at`, durable `promotion_json`, `record_json`, `created_at`, `updated_at`.

Retained invalidation fields:

- `schema_version`, `invalidation_id`, `fact_id`, `reason`, `invalid_at`, `reference_time`, `proposed_by`, `verification_status`, `source_episode_refs_json`, `evidence_refs_json`, optional `replacement_fact_id`, optional `metadata_json`, `record_json`, `created_at`, `updated_at`.

Redacted/rejected fields:

- Persistence reuses Runtime Memory sanitizers for episode/fact/invalidation records before write at `memory-persistence.ts:815`, `memory-persistence.ts:830`, and `memory-persistence.ts:849`.
- Post-sanitization value scanning rejects raw string values before persistence at `memory-persistence.ts:860` and `memory-persistence.ts:864`.
- Sensitive metadata can be retained only as sanitized metadata; the focused test proves `toolOutput: "stdout dump"` and `prompt: "raw prompt"` are not present in persisted SQLite JSON at `tests/unit/runtime-memory-persistence.test.ts:84`, `tests/unit/runtime-memory-persistence.test.ts:134`, `tests/unit/runtime-memory-persistence.test.ts:237`, and `tests/unit/runtime-memory-persistence.test.ts:238`.
- Raw source-ref output is rejected before write at `tests/unit/runtime-memory-persistence.test.ts:108` through `tests/unit/runtime-memory-persistence.test.ts:122`.

Rejected persistence inputs:

- Raw chat logs, transcripts/jsonl, raw traces, prompt dumps, full payloads, full checkpoints, full tool args/output, env, secrets, authorization/password/api keys, baggage, tracestate, and traceparent remain outside the persistence API. The touched production file has no raw-retention matches; scan matches were only negative test fixtures/assertions.

## Migration, Idempotency, And Disabled Parity

Migration path:

- `migrate()` is a persist-flag-gated method at `memory-persistence.ts:342`.
- Schema migration uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` DDL at `memory-persistence.ts:209` through `memory-persistence.ts:305`.
- `ensureRuntimeMemoryPersistenceSchema` upserts one meta row for owner/schema version at `memory-persistence.ts:456` through `memory-persistence.ts:477`.
- The idempotency test calls `migrate()` twice and verifies one meta row at `tests/unit/runtime-memory-persistence.test.ts:76`, `tests/unit/runtime-memory-persistence.test.ts:81`, and `tests/unit/runtime-memory-persistence.test.ts:211`.

Idempotency strategy:

- Episodes dedupe by idempotency-key mapping first, then canonical `episode_id`, and merge source/evidence refs at `memory-persistence.ts:480` and `memory-persistence.ts:572`.
- Every observed episode idempotency key is stored in `runtime_memory_episode_idempotency_keys` at `memory-persistence.ts:673`.
- Facts dedupe by `fact_id` without overwriting canonical truth at `memory-persistence.ts:508`.
- Invalidations dedupe by `invalidation_id` at `memory-persistence.ts:537`.
- Tests prove duplicate episode alias mapping, duplicate fact non-overwrite, and two idempotency-key rows at `tests/unit/runtime-memory-persistence.test.ts:91`, `tests/unit/runtime-memory-persistence.test.ts:176`, and `tests/unit/runtime-memory-persistence.test.ts:214`.

Retention:

- Persistence reuses the existing store bounds exported from `RuntimeMemoryStore`: 256 episodes, 512 facts, 256 invalidations at `openclaw_runtime/src/runtime-core/memory-store.ts:26`.
- SQLite rows are trimmed after accepted inserts at `memory-persistence.ts:500`, `memory-persistence.ts:529`, `memory-persistence.ts:558`, and `memory-persistence.ts:954`.
- The retention test sets max 1 for all three collections and verifies both hydrated store stats and SQLite row counts at `tests/unit/runtime-memory-persistence.test.ts:252` through `tests/unit/runtime-memory-persistence.test.ts:306`.

Disabled parity:

- Every public operation checks `persistEnabled()` before opening SQLite: `migrate` at `memory-persistence.ts:343`, `appendEpisode` at `memory-persistence.ts:361`, `appendFact` at `memory-persistence.ts:378`, `invalidateFact` at `memory-persistence.ts:395`, and `loadStore` at `memory-persistence.ts:411`.
- `persistEnabled()` reads only `runtime.memory.persist` through the existing flag parser at `memory-persistence.ts:441`.
- The disabled test injects an `openDatabase` function that throws and proves no open call occurs across migrate/write/load paths at `tests/unit/runtime-memory-persistence.test.ts:31` through `tests/unit/runtime-memory-persistence.test.ts:60`.

Rollback:

- Set `runtime.memory.persist` false. New persistence reads, writes, and schema migrations stop before DB open.
- Existing persisted SQLite data is preserved; no rollback code deletes user data.
- Since this proof is not wired into TaskLoop, Gateway, provider registration, or renderer code, disabling the flag leaves existing runtime behavior unchanged.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Local store owner is runtime-core memory persistence. | file | `openclaw_runtime/src/runtime-core/memory-persistence.ts` | `RUNTIME_MEMORY_PERSISTENCE_OWNER` at line 42 | Owner is not renderer/Gateway/provider/plugin/exporter. |
| Schema is local SQLite and versioned. | file | `openclaw_runtime/src/runtime-core/memory-persistence.ts` | schema DDL at lines 209, 217, 234, 247, 283 | Uses local SQLite handle, no service/daemon/listener. |
| Persistence is default-off and no-open when disabled. | file/test | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | guards at lines 343, 361, 378, 395, 411; test starts line 31 | Disabled test injects throwing opener and observes zero calls. |
| Migration is idempotent. | file/test | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | meta upsert lines 456-477; test line 76 and line 211 | `migrate()` twice keeps one `runtime_memory_meta` row. |
| Episodes dedupe idempotently and merge refs. | file/test | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | `persistEpisode` line 480; lookup line 572; alias test line 91 | Mapping table preserves alias idempotency keys. |
| Facts and invalidations dedupe without overwrite. | file/test | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | fact line 508; invalidation line 537; duplicate fact test line 176 | Duplicate fact returns original persisted value. |
| Retention uses existing bounds. | file/test | `memory-store.ts`; `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | defaults line 26; trim line 954; test line 252 | Defaults are 256/512/256; test proves tighter bounds. |
| Raw values are rejected or redacted before persistence. | file/test/scan | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts`; raw-retention scan | sanitizer lines 815, 830, 849; value scan line 860; assertions lines 237-238 | Raw scan matches only negative test fixtures/assertions. |
| Candidate/unpromoted facts do not become durable facts. | file/test | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | `record_kind` row mapping line 760; candidate test lines 147, 222, 239-242 | Candidate with `verificationStatus: "verified"` keeps `record_kind = candidate` and `promotion_json = null`. |
| Current-valid query behavior survives hydrate. | test | `tests/unit/runtime-memory-persistence.test.ts` | lines 185-207 | Default query returns only active durable fact; candidates/invalidated require explicit query. |
| No Main/Gateway/renderer/transport change. | scan | renderer bypass scan over `src/pages src/components`; touched-file service scan | no matches | Comms replay/compare not required. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | `tests/unit/runtime-memory-persistence.test.ts:31`; `memory-persistence.ts:343`, `:361`, `:378`, `:395`, `:411` | pass | Disabled path does not open SQLite. |
| Store owner and schema | `memory-persistence.ts:42`; `memory-persistence.ts:209-305` | pass | Owner/schema implemented as local SQLite proof. |
| Migration and idempotency | `memory-persistence.ts:456-477`; `tests/unit/runtime-memory-persistence.test.ts:76`, `:211` | pass | Migration is idempotent DDL plus owner meta upsert. |
| Retention and redaction | `memory-store.ts:26-28`; `memory-persistence.ts:954`; `tests/unit/runtime-memory-persistence.test.ts:237-238`, `:252-306` | pass | Redaction uses existing sanitizers; retention trims rows. |
| Raw chat/raw trace rejection | raw-retention scan; `memory-persistence.ts:860`; existing `runtime-memory-context-contracts.test.ts` | pass | Touched implementation has no raw-retention matches. |
| No raw retention | `corepack pnpm test ...runtime-memory-persistence...`; raw scan | pass | Negative fixtures are asserted absent from SQLite. |
| No service/exporter/database/listener | service/exporter scan over touched files | pass | `NO_MATCHES`; local SQLite is a file DB, not a database service. |
| Source episode/evidence refs | `runtime_memory_episodes` / `runtime_memory_facts` schema; hydration test | pass | Source/evidence refs retained as sanitized JSON arrays. |
| Durable promotion gate | `record_kind`, `promotion_json`; `tests/unit/runtime-memory-persistence.test.ts:147`, `:239-242` | pass | Candidate/LLM-like proposal does not become durable fact. |
| Current-valid query exclusion | `tests/unit/runtime-memory-persistence.test.ts:185-207` | pass | Candidate and invalidated facts require explicit query flags. |
| Rollback proof | disabled guards and test | pass | Setting flag false stops all new persistence reads/writes and preserves data. |
| Comms replay/compare if required | Main/Gateway/host-api/api-client paths unchanged | not applicable | No communication path changed. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | `runtime.memory.persist` remains parsed by existing default-false flags; persistence API skips unless explicit true. |
| No raw chat-log/raw trace memory | pass | Touched production raw scan has no matches; negative fixture scan matches only test inputs/assertions. |
| No unverified durable facts | pass | Candidate facts persist as `record_kind = candidate`; durable fact shape still comes from existing accepted fact guard. |
| No persistence without owner/schema/migration/rollback proof | pass | Owner/schema/migration/rollback proof implemented and tested. |
| No provider-ordering cutover without parity proof | pass | No provider registry or provider ordering files changed by Lane B. |
| No runtime authority | pass | No TaskLoop, verifier, security, retry, tool permission, runtime policy, Gateway, or renderer path changed. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | failed before harness | Required bare pnpm attempt | Blocked by ignored-builds install gate; switched to `corepack pnpm` per task instruction. |
| `corepack pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 context/read list | none |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 spec validity | pnpm emitted existing package-manager warning only. |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md` | pass | Phase 8 prerequisite spec validity | pnpm emitted existing package-manager warning only. |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Phase 7 prerequisite spec validity | Extra validation from Phase 9 task spec. |
| `corepack pnpm test tests/unit/runtime-memory-persistence.test.ts` | pass, 1 file / 3 tests | New persistence proof | none |
| `corepack pnpm test tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts` | pass, 6 files / 36 tests | Focused runtime memory contracts/store/proposal/provider/registry behavior | none |
| `corepack pnpm run typecheck:node` | pass | Node TypeScript for code/test changes | none |
| Raw-retention scan over `openclaw_runtime/src/runtime-core/memory-persistence.ts openclaw_runtime/src/runtime-core/memory-store.ts tests/unit/runtime-memory-persistence.test.ts` | pass/reviewed | No raw retention in touched production files | Matches only negative test fixtures/assertions at test lines 84, 116, 134, 237, 238. |
| Service/exporter/listener scan over touched files | pass/no matches | No service/exporter/database-service/listener/daemon/server additions | Output: `NO_MATCHES`. |
| Persistence scan over touched files | pass/reviewed | Intended local SQLite persistence only | Matches are the new opt-in local SQLite owner/schema/API/tests. |
| Renderer IPC/Gateway bypass scan over `src/pages src/components` | pass/no matches | Renderer boundary | Output: `NO_MATCHES`. |
| README sync search over `README.md README.zh-CN.md README.ja-JP.md` | reviewed/no update | Docs sync | No user-visible flow/interface changed; no README update needed. |

Environment notes:

- `rtk --version` failed because `rtk` is not on the current PowerShell PATH.
- Bare `pnpm harness context ...` failed before harness execution with `[ERR_PNPM_IGNORED_BUILDS]`; `corepack pnpm` ran the equivalent commands successfully.
- PowerShell PATH did not expose `git`; `C:\Program Files\Git\cmd\git.exe` was used for status/diff checks.
- The worktree contains many pre-existing unrelated changes/untracked Phase files. Lane B touched only the files listed above.

## Design Conflicts

| Conflict | Evidence | Resolution |
|---|---|---|
| Root storage policy prefers SQLite, while Phase 9 forbids a database service. | `openclaw_runtime/AGENTS.md` storage rules; Phase 9 forbidden patterns. | Use existing local shared SQLite handle, no service/daemon/listener/server/exporter. |
| Adding schema to global state DB open would write DDL even with memory persistence false. | Flag-off parity requires no reads/writes when `runtime.memory.persist` is false. | Keep runtime memory schema migration inside the persistence owner and run it only after the persist flag gate. |
| Sanitized metadata retains sensitive key names with `[redacted]` values. | Existing sanitizer behavior in `memory-context.ts`; persistence test with `toolOutput` metadata. | Persistence rejects raw string values after sanitization while allowing redacted metadata keys as redaction evidence. |
| Candidate with `verificationStatus: "verified"` could be mistaken for durable. | Existing candidate shape permits statuses; durable facts require promotion evidence. | Persist `record_kind = candidate` and `promotion_json = null`; current-valid default queries exclude it unless explicitly requested by status. |

## Decision

```text
Status: accepted
```
