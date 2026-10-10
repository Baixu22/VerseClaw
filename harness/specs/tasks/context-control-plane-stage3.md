---
lifecycleStatus: archived
id: context-control-plane-stage3
title: Context Control Plane Stage 3 Task Ledger Working Context Proposal Accept Reject Projection
taskType: runtime-authority-convergence
intent: Promote Stage 3 into a formal harness spec. Working Context becomes a versioned projection over the existing append-only Task Ledger JSONL. Field updates are proposal events only; accept and reject are independent events with actor, policy digest, and queryable rejection reason; a deterministic materialized projection replays the same event sequence to the same state; fork/handoff merge copies only an explicit task-scoped field list and preserves both sources and versions on conflict. Accepted items are only Mem promotion candidates. Stage 3 writes no Memory and changes no provider prompt path, table, store, daemon, product flag, or default.
touchedAreas:
  - harness/specs/tasks/context-control-plane-stage3.md
  - docs/dev/context-control-plane/DEVLOG.zh-CN.md
  - docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md
  - shared/types/task-ledger.ts
  - shared/task-ledger-working-context.ts
  - electron/services/task-ledger-working-context.ts
  - openclaw_runtime/src/agents/long-task-control/task-ledger.ts
  - openclaw_runtime/src/agents/long-task-control/stage3-working-context.ts
  - openclaw_runtime/src/agents/long-task-control/stage3-golden-run.ts
  - tests/unit/context-control-plane-stage3-contracts.test.ts
  - openclaw_runtime/src/agents/long-task-control/stage3-working-context.test.ts
  - openclaw_runtime/src/agents/long-task-control/stage3-golden-run.test.ts
  - artifacts/context-control-plane/stage3-real-run-evidence.json
ownerDecisions:
  - "Q1 accepted: proposal actor must be user or assistant; accept/reject actor must be user or system; assistant may never accept or reject."
  - "Q2 accepted: explicit sensitivity/trust remain supported; constructor defaults are sensitivity=workspace and trust=proposed; caps are proposalId=128, scalar=2000, string-array item=500, string-array count=20, evidence refs=20, evidence ref=512, evidence label=120, rejectionReason=500."
  - "Q3 accepted: default TTL is 24 hours and max TTL is 7 days; expiry is judged against caller-supplied asOf, projection defaults asOf to the latest event createdAt; expired proposals stay queryable in expired and are omitted from current and pending."
  - "Q4 accepted: same-actor later pending proposal supersedes an earlier same-actor pending proposal; cross-actor pending proposals form a queryable conflict set; current value changes only on an explicit accept, never on a silent tie-break."
  - "Q5 accepted: production fork/handoff copyFields is Objective, Constraints, ConfirmedFacts, Decisions, OpenRisks, NextAction; ActiveFiles and Evidence are not copied."
  - "Q6 accepted: minimal Mem promotion candidate marker is MemPromotionCandidate/v1 with proposalId/field/value/version/actor/evidenceRefs/sensitivity/trust/acceptedAt/policyDigest; projection-only, never a Memory write."
  - "Q7 accepted: Stage 3 real evidence requires a real owner-authorized provider coding turn through the Stage 1/2 DeepSeek write chain; real-ledger-only replay is not E4 evidence."
expectedUserBehavior:
  - The formal Stage 3 task spec exists and harness context/validate pass before any Stage 3 production code is written.
  - Every Q1-Q7 decision is fixed in frontmatter ownerDecisions and implemented exactly as recorded.
  - The existing Task Ledger events.jsonl remains the only durable Working Context truth; no new table, column, store, database, daemon, or second ledger is introduced.
  - Working Context field updates can only be proposal events. Direct field mutation has no write path and is rejected fail-closed.
  - Accept and reject are independent events carrying proposal id, field, version, actor, policy digest, and a queryable rejection reason; there is no automatic accept.
  - Rebuilding the materialized projection from the same event sequence yields the same result; the projection never draws randomness and never reads wall-clock time.
  - Stage 2 readLongTaskLedgerRevision keeps its eventCount/revision/contentDigest semantics and the task_ledger ContextRef adapter remains byte- and schema-compatible.
  - Fork/handoff merge copies only an explicit task-scoped field list and preserves both source/version on conflict; it never silently last-write-wins.
  - Stage 3 flag is default off. Flag off changes no Task Ledger write, read, projection, snapshot, UI, or Working Context behavior.
  - Stage 3 writes no Memory, no provider prompt path migration, and no Mem promotion payload.
  - Product locks defaultOn, liveReady, and productApproved remain false; no commit, push, or PR is created.
requiredProfiles:
  - fast
requiredRules:
  - runtime-authority-convergence-boundary
  - context-family-boundary
  - active-config-guards
  - dcs-stage2-handoff-boundary
humanEvidence: not-required
forbiddenPatterns:
  - modifying electron/services/task-ledger-api.ts, openclaw_runtime/src/agents/long-task-control/store.ts, or openclaw_runtime/src/context-engine/stage2-context-refs.ts except through the regression tests explicitly named in this spec
  - changing the checkpoint/intervention Task Ledger write projection in openclaw_runtime/src/agents/long-task-control/store.ts
  - changing readLongTaskLedgerRevision eventCount/revision/contentDigest semantics or making task_ledger ContextRef carry payload
  - adding a new Task Ledger table, SQLite column, store, daemon, second ledger, second materialization database, or second task-state authority
  - writing Memory, FactStore, Knowledge, or any Mem promotion record; Stage 3 may only project candidate eligibility
  - automatically accepting or rejecting proposals
  - silently last-write-wins for concurrent field proposals or fork/handoff conflicts
  - storing transcript text, file bodies, tool output, raw prompt, credentials, keys, or environment values in Working Context event payloads
  - migrating any provider prompt path or changing provider request bytes, ordering, retries, approvals, or delivery
  - changing defaultOn, liveReady, productApproved, any product flag default, or the product lock to prove availability
  - deviating from any frontmatter ownerDecisions item
  - claiming fixture, mock, or synthetic replay as Stage 3 real evidence
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-control-plane-stage3.md
  - pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage3.md
  - pnpm harness context --spec harness/specs/tasks/context-control-plane-stage2.md
  - pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage2.md
  - pnpm exec vitest run tests/unit/context-control-plane-stage3-contracts.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/long-task-control/stage3-working-context.test.ts --reporter=verbose
  - pnpm exec vitest run tests/unit/task-ledger-service.test.ts tests/unit/task-ledger-reference.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage2-dcs.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/long-task-control/stage3-golden-run.test.ts --reporter=verbose
  - DEEPSEEK_API_KEY=<owner-provided-temp-env> pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/long-task-control/stage3-golden-run.test.ts --reporter=dot --test-timeout=120000
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run lint:check
  - git diff --check
acceptance:
  - The spec references Stage 0 D1-D4, the Stage 1 and Stage 2 formal specs, artifacts/context-control-plane/stage2-real-run-evidence.json, and the Stage 2 key-residue cleanup record in DEVLOG; touchedAreas name only the Stage 3 contract, adapters, runtime appender type extension, spec, DEVLOG, roadmap, and test paths.
  - Harness context and harness validate pass for this spec before and after any production code changes; Stage 2 harness context/validate remain green as regression.
  - L1 acceptance: working_context_proposed events append through the existing events.jsonl appenders only; no new table or column exists; any non-proposal Working Context field update is rejected with a queryable reason.
  - L2 acceptance: accept/reject events record actor, proposalId, field, version, policy digest, and rejection reason; duplicate accept fails closed with a queryable reason; no automatic accept path exists.
  - L3 acceptance: projectTaskLedgerWorkingContext over the same ordered event array always returns deep-equal output; the implementation contains no random source and no Date.now/new Date wall-clock decision.
  - L4 acceptance: existing projectTaskLedgerSnapshot replays logs containing Stage 3 events without failing or creating nodes/edges; readLongTaskLedgerRevision returns the same eventCount/revision/sha256 digest formula for logs with and without Stage 3 events; the task_ledger ContextRef still validates.
  - L5 acceptance: concurrent same-field proposals preserve every proposalId, source, and version in a queryable conflict set; same-actor supersession and cross-actor conflict-set behavior match Q4.
  - L6 acceptance: an expired proposal cannot be accepted; expired items stay in the queryable expired list, are omitted from current/pending, and are never auto-promoted per Q3.
  - L7 acceptance: fork/handoff merge copies only the explicit copyFields list and parent/child association is queryable through the existing session_linked relation forked_from or handoff_from.
  - L8 acceptance: the only possible Mem promotion candidate source is an accepted Working Context entry; no Memory import, write call, or promotion event exists; the marker shape matches Q6.
  - L9 acceptance: the Stage 3 resolver is default off; flag off performs zero Stage 3 JSONL read/write and existing Task Ledger snapshot, query, and UI projections are byte-identical.
  - L10 acceptance: payloads contain only bounded Working Context values and evidence refs plus sensitivity/trust metadata; transcript text, file bodies, tool output, keys, and environment values are rejected.
  - L11 acceptance: invalid event shape, missing actor, missing policy digest, missing proposal reference, version mismatch, and duplicate accept all fail closed and produce queryable warnings or rejection reasons.
  - L12 acceptance: all required gate commands pass; DEVLOG records the full slice; product locks remain false and no commit, push, or PR is created.
docs:
  required: true
  files:
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/stage0/authority-matrix.md
    - docs/dev/context-control-plane/stage0/artifacts-schema.md
    - docs/dev/context-control-plane/stage0/authority-adapters.md
    - docs/dev/context-control-plane/stage0/golden-path-contract.md
    - docs/dev/context-capability-blueprint.md
    - docs/dev/adr/2026-08-16-context-authority-boundaries.md
    - docs/dev/dcs-first-context-engineering.md
    - harness/specs/tasks/context-control-plane-stage1.md
    - harness/specs/tasks/context-control-plane-stage2.md
---

# Context Control Plane Stage 3

Stage 3 turns the Working Context design from ADR decision 4 and development
constraint 6.5 into a versioned Task Ledger discipline:

1. Working Context fields are carried by the existing append-only Task Ledger
   JSONL. Every field update is a proposal event.
2. Accept and reject are independent events with actor, policy digest, and a
   queryable rejection reason.
3. The current Working Context state is a deterministic materialized projection
   rebuilt from events, never a second truth source.
4. Fork/handoff merge copies only an explicit task-scoped field list and keeps
   conflict sources/versions visible.
5. Accepted items may only become Mem promotion candidates; Stage 3 never
   writes Mem and never migrates the provider prompt path.

This spec is the single Stage 3 entry point. All seven Q1-Q7 decisions are
fixed in the frontmatter `ownerDecisions` list and are authoritative for the
implementation below.

## 1. Stage 0, Stage 1, and Stage 2 inputs

This spec consumes and does not rewrite:

- Stage 0 deliverables D1-D4:
  - `docs/dev/context-control-plane/stage0/authority-matrix.md`
  - `docs/dev/context-control-plane/stage0/artifacts-schema.md`
  - `docs/dev/context-control-plane/stage0/authority-adapters.md`
  - `docs/dev/context-control-plane/stage0/golden-path-contract.md`
- `harness/specs/tasks/context-control-plane-stage0.md`
- `harness/specs/tasks/context-control-plane-stage1.md` and Stage 1 evidence.
- `harness/specs/tasks/context-control-plane-stage2.md` and
  `artifacts/context-control-plane/stage2-real-run-evidence.json`.
- The DEVLOG Stage 2 acceptance conclusion and the key-residue repair slice.
  Real provider work continues to require owner authorization plus a
  single-command temporary environment variable; key persistence is forbidden.

The six-artifact schemas in
`shared/types/context-control-plane/artifacts.ts` remain the contract owner.
Stage 3 extends the Task Ledger event contract only. It does not redefine
`ContextRef/v1`, `CompilationSnapshot/v1`, `PromptPlan/v1`, or the
`task_ledger` ContextRef adapter.

## 2. Read-only current state confirmed before this spec

- `shared/types/task-ledger.ts` owns the existing node/edge/session-link event
  contract, `TaskLedgerSnapshot` schemaVersion 1, and warning types.
- `electron/services/task-ledger-service.ts` owns the workspace
  `events.jsonl` append path, `parseTaskLedgerEventLog`, and
  `projectTaskLedgerSnapshot`. It already accepts unknown event type strings
  at parse time and ignores unknown types during projection.
- `electron/services/task-ledger-api.ts` is the external query boundary. It is
  read-only for Stage 3 and is not modified.
- `openclaw_runtime/src/agents/long-task-control/task-ledger.ts` owns the
  runtime long-task JSONL append path (`appendLongTaskLedgerEvents`),
  `ensureLongTaskLedgerRoot`, and the Stage 2 read-only
  `readLongTaskLedgerRevision`.
- `openclaw_runtime/src/agents/long-task-control/store.ts` writes checkpoint
  and intervention projections into the Task Ledger. Stage 3 must not change
  that write projection.
- `openclaw_runtime/src/context-engine/stage2-context-refs.ts` builds the
  Stage 2 `task_ledger` ContextRef from `readLongTaskLedgerRevision` output
  (`revision` plus `sha256:` content digest). Stage 3 must keep that adapter
  semantic unchanged.
- Existing regression tests: `tests/unit/task-ledger-service.test.ts` and
  `tests/unit/task-ledger-reference.test.ts`.

## 3. Working Context authority and minimum field set

Authority is fixed by ADR decision 4 and constraint 6.5: Working Context is a
task-scoped versioned Task Ledger, not long-term memory. The minimum field set
for Stage 3 is exactly:

| Field id | Bounded value shape |
|---|---|
| `Objective` | string |
| `Constraints` | string[] |
| `ConfirmedFacts` | string[] |
| `Decisions` | string[] |
| `OpenRisks` | string[] |
| `ActiveFiles` | string[] |
| `Evidence` | `TaskLedgerEvidenceRef[]` (type/ref/label only, no payload) |
| `NextAction` | string |

No other field id is accepted. Values are bounded Working Context entries, not
transcript text, file bodies, tool output, credentials, or environment values.
The numeric caps are fixed by Q2 and exported as
`STAGE3_WORKING_CONTEXT_LIMITS`.

## 4. Event contract

Extend `shared/types/task-ledger.ts` without changing existing node/edge event
semantics:

- Add three `TaskLedgerEventType` values:
  - `working_context_proposed`
  - `working_context_proposal_accepted`
  - `working_context_proposal_rejected`
- Add payload fields to `TaskLedgerEventPayload`:
  - `workingContextProposal?: TaskLedgerWorkingContextProposal`
  - `workingContextDecision?: TaskLedgerWorkingContextDecision`
- Do not change `TaskLedgerSnapshot`; Working Context gets a separate
  projection type so an empty/legacy log produces the exact same legacy
  snapshot bytes.

The existing event envelope is reused. `actor`, `taskId`, `sessionId`,
`idempotencyKey`, and `createdAt` remain the identity fields. Proposal and
decision events require a non-empty `taskId` so every Working Context write is
task-scoped.

### 4.1 Proposal payload

```ts
type TaskLedgerWorkingContextSensitivity =
  | 'public'
  | 'workspace'
  | 'secret-adjacent';

type TaskLedgerWorkingContextTrust =
  | 'confirmed'
  | 'proposed'
  | 'uncertain';

type TaskLedgerWorkingContextProposal = {
  proposalId: string;
  field: TaskLedgerWorkingContextField;
  value: TaskLedgerWorkingContextFieldValue;
  version: number;
  evidenceRefs: TaskLedgerEvidenceRef[];
  ttl: { issuedAt: string; expiresAt: string };
  sensitivity: TaskLedgerWorkingContextSensitivity;
  trust: TaskLedgerWorkingContextTrust;
};
```

Fixed validation rules:

- `proposalId` is a bounded id, unique across the event log.
- `field` must be one of the eight minimum fields.
- `value` must match the per-field shape in section 3.
- `version` is a positive integer; accept/reject bind to the same version.
- `evidenceRefs` must be bounded refs only.
- `ttl.expiresAt` must be after `ttl.issuedAt`; both are ISO-8601 timestamps
  already present in the event and are never derived from a projection-time
  wall clock.
- Constructor defaults are `sensitivity=workspace` and `trust=proposed`;
  explicit per-event values remain supported. Q2 caps are exported as
  `STAGE3_WORKING_CONTEXT_LIMITS`.
- The top-level event `actor` must be a non-empty existing `TaskLedgerActor`
  value. Proposal actors are `user|assistant`; decision actors are
  `user|system` per Q1.

### 4.2 Decision payload

```ts
type TaskLedgerWorkingContextDecision = {
  proposalId: string;
  field: TaskLedgerWorkingContextField;
  version: number;
  decision: 'accepted' | 'rejected';
  policyDigest: string;      // sha256:<64 lowercase hex>
  rejectionReason?: string;  // required and non-empty when decision=rejected
};
```

Fixed validation rules:

- Accept and reject are separate event types; there is no combined mutation.
- `policyDigest` is required for both accept and reject.
- `rejectionReason` is required and non-empty for reject; it must not be the
  only copy of raw content and must be bounded.
- A proposal can be accepted at most once. The adapter idempotency key must be
  derived from `proposalId` (for example `wc:accept:<proposalId>`), and the
  projection independently fails closed on any second accept for the same
  `proposalId`.
- Rejecting a previously accepted proposal is invalid and must be reported.
- Decision events must reference an existing proposal with the same field and
  version; otherwise the event is invalid and queryable.

## 5. Materialized projection

`shared/task-ledger-working-context.ts` is the single pure implementation of
constructors, projection, and merge. `electron/services/task-ledger-working-context.ts`
re-exports that implementation and adds only a thin appender/read adapter over
the existing workspace JSONL. No table, column, store, daemon, or extra file is
added.

`projectTaskLedgerWorkingContext(events, options?)` is deterministic:

- Input order is the JSONL line order (or the supplied ordered event array).
- No random source is used and `Date.now()`/`new Date()` is never called.
  Expiry is evaluated against an explicit `asOf`; when omitted the projection
  uses the latest event `createdAt` per Q3.
- Proposal events are admitted only when actor, field/value shape, version,
  evidence refs, TTL order, sensitivity, and trust validate.
- Accept events apply only to a prior proposal with matching field/version and
  a valid policy digest. Accepted values form an ordered history; a later
  accept in event order is the current accepted value for that field, while
  every prior accepted value remains queryable.
- Reject events record the proposal id, actor, policy digest, and rejection
  reason in a queryable rejection list.
- Same-actor later pending proposals supersede earlier same-actor pending
  proposals. Cross-actor pending proposals are retained as a queryable
  conflict set with proposalId, version, actor, evidenceRefs, source event id,
  and proposed value. `current` changes only on an explicit accept (Q4).
- Expired proposals are marked `expired`, are never accepted, are never
  auto-promoted, and are omitted from `current` and `pending` (Q3).
- Invalid events, missing actor, missing policy digest, missing proposal
  reference, version mismatch, duplicate accept, and expired accept each
  produce a queryable warning with event id and reason. Invalid events do not
  mutate the projection.

The projection output is a discardable cache and can always be rebuilt from
`events.jsonl`. `electron/services/task-ledger-api.ts` is not modified; the
projection remains queryable through the exported function and regression
tests, not through a new store or API table.

## 6. Write adapters and default-off state

### 6.1 Workspace path

`electron/services/task-ledger-working-context.ts` re-exports the shared
constructors and adds a thin append adapter:

- `createTaskLedgerWorkingContextProposal`
- `createTaskLedgerWorkingContextDecision`
- `appendTaskLedgerWorkingContextEvents`

The append adapter validates first and then calls the existing
`appendTaskLedgerEvents`. It never opens a second JSONL, snapshot file, table,
or daemon.

### 6.2 Runtime long-task path

`openclaw_runtime/src/agents/long-task-control/task-ledger.ts` extends its local
event type union with the same three event type strings and the same payload
shape so `appendLongTaskLedgerEvents` accepts Stage 3 events. Its append,
idempotency, and file path logic are otherwise unchanged.

New `openclaw_runtime/src/agents/long-task-control/stage3-working-context.ts`:

- `resolveStage3WorkingContextState` returns enabled only for an explicit
  caller/config/env opt-in such as `OPENCLAW_STAGE3_TASK_LEDGER_WC=1`.
  The default is false and no product config schema or default changes.
- `appendStage3WorkingContextEvents` validates and delegates to the existing
  `appendLongTaskLedgerEvents`.
- It never writes a projection cache, a snapshot file, a table, or a daemon.
- It reuses `readLongTaskLedgerRevision` unchanged for any read-side revision.

Flag off must be a zero-I/O no-op for Stage 3: no event write, no
`events.jsonl` read, no projection build, and byte-identical existing Task
Ledger snapshots and UI projections.

## 7. Fork and handoff merge

Fork/handoff is a pure merge function, not a ledger copy:

```ts
mergeTaskLedgerWorkingContext(parent, child, options: {
  copyFields: TaskLedgerWorkingContextField[];
  relation: 'forked_from' | 'handoff_from';
})
```

- Only fields named in `copyFields` are considered. The function never
  defaults to copy-all and never reads a wall clock.
- If parent and child have accepted values for the same copied field, both
  source projections and both versions are preserved in a queryable conflict
  set. Silent last-write-wins is forbidden.
- The exact production `copyFields` list is Q5.
- Parent/child association is already queryable through the existing
  `session_linked` event relation `forked_from` or `handoff_from`; Stage 3
  adds no new session link table or event type.

## 8. Stage 2 regression contract

The Stage 2 read-only function must keep its exact existing semantics:

- `readLongTaskLedgerRevision` reads the existing append-only `events.jsonl`,
  selects only lines whose parsed `taskId` equals `taskLedgerRootId`, and
  returns:
  - `eventCount` = number of owned lines;
  - `contentDigest` = `sha256:` plus SHA-256 of `ownedLines.join('\n')`;
  - `revision` = `rev_${eventCount}_${contentDigest.slice(0, 16)}`.
- New Stage 3 events owned by the same root id are counted and digested by the
  same read-only function. No new file, cache, or database participates.
- `projectTaskLedgerSnapshot` continues to ignore unknown event types, so a
  log containing Stage 3 events replays to the same legacy node/edge/session
  projection as the same log with those events omitted.
- `openclaw_runtime/src/context-engine/stage2-context-refs.ts` is not
  modified. Its `buildStage2TaskLedgerContextRef` still accepts only the
  unchanged `revision` and `sha256:` content digest pair and still stores no
  payload.

## 9. Owner decisions Q1-Q7

The frontmatter `ownerDecisions` list is authoritative:

- Q1: proposal actor is `user` or `assistant`; accept/reject actor is `user`
  or `system`; `assistant` can never accept or reject.
- Q2: constructor defaults are `sensitivity=workspace` and `trust=proposed`,
  with the numeric caps listed in frontmatter and exported from
  `STAGE3_WORKING_CONTEXT_LIMITS`.
- Q3: default TTL is 24 hours, max TTL is 7 days; expiry uses an explicit
  `asOf` and the projection default is the latest event `createdAt`; expired
  proposals stay queryable in `expired` and are omitted from `current` and
  `pending`.
- Q4: same-actor later pending proposals supersede earlier same-actor pending
  proposals; cross-actor pending proposals form a queryable conflict set;
  `current` changes only on an explicit accept.
- Q5: production fork/handoff `copyFields` is
  `Objective, Constraints, ConfirmedFacts, Decisions, OpenRisks, NextAction`;
  `ActiveFiles` and `Evidence` are not copied.
- Q6: the projection-only marker `MemPromotionCandidate/v1` carries
  proposalId/field/value/version/actor/evidenceRefs/sensitivity/trust/
  acceptedAt/policyDigest and never performs a Memory write.
- Q7: Stage 3 real evidence is a real owner-authorized provider coding turn
  through the Stage 1/2 DeepSeek write chain; ledger-only replay is not E4.

Missing actor, missing policy digest, version mismatch, duplicate accept, and
expired accept remain fail-closed regardless of the decisions above.

## 10. L1-L12 acceptance mapping

| Acceptance | Verification |
|---|---|
| L1 | Contract test proves only `working_context_proposed` can introduce a field value; direct field mutation has no constructor or write path. Appender tests prove writes use the existing JSONL appenders and no table/column is added. |
| L2 | Contract and projection tests prove accept/reject events carry actor, proposalId, field, version, policy digest, and rejection reason; duplicate accept is rejected with a queryable reason. |
| L3 | Replay test builds the projection twice from the same event array and asserts deep equality; source scan proves no `Math.random`, `Date.now`, or `new Date()` in projection code. |
| L4 | Regression tests run `projectTaskLedgerSnapshot` over a log with Stage 3 events and compare it to the same log without them; `readLongTaskLedgerRevision` is asserted on logs with and without Stage 3 events; the Stage 2 task-ledger ContextRef still validates. |
| L5 | Projection test creates two pending proposals for one field and asserts every proposalId/source/version is retained in the conflict set. |
| L6 | Projection test proves an expired proposal cannot be accepted, is marked expired, and is never auto-promoted. |
| L7 | Merge test proves only `copyFields` entries are copied and parent/child accepted values coexist with source/version records; session link regression proves the existing `forked_from`/`handoff_from` relation is queryable. |
| L8 | Source scan proves no Memory import or write call exists; projection test proves only accepted entries enter promotionCandidates and each marker matches MemPromotionCandidate/v1 (Q6). |
| L9 | Flag-off test proves the Stage 3 resolver defaults false and performs zero Stage 3 read/write; existing snapshot output is byte-identical. |
| L10 | Validation tests reject transcript text, file bodies, tool output, key-like strings, and environment values in proposal payloads. |
| L11 | Negative tests cover invalid event shape, missing actor, missing policy digest, missing proposal reference, version mismatch, duplicate accept, and expired accept; every case returns a queryable reason. |
| L12 | All required gate commands pass; DEVLOG records HEAD SHA, dirty patch summary, harness output, and L1-L12 results; no commit, push, or PR. |

## 11. Q7 real evidence (owner decision fixed)

`openclaw_runtime/src/agents/long-task-control/stage3-golden-run.ts` reuses the
accepted Stage 1/2 real DeepSeek `write` chain, then appends one real Stage 3
proposal and one accept to the same long-task ledger root and reads the
revision before/after through `readLongTaskLedgerRevision`. The test writes
`artifacts/context-control-plane/stage3-real-run-evidence.json` containing only
model/rootId/proposalId/revision digests/Stage 2 receipt ids and refs.

- The key is read only from the caller or the process environment and is
  injected by the owner as a single-command temporary environment variable.
  No key is printed, written to a file, or persisted to Process/User/Machine
  environment.
- Fixture, mock, cached tool block, or ledger-only replay is not accepted as
  Q7 evidence.

## 12. Stop and upgrade conditions

Stop and record in DEVLOG without continuing if:

- proposal/accept/reject cannot stay append-only and backward compatible with
  the existing two JSONL appenders;
- the materialized projection cannot be rebuilt deterministically from events;
- Stage 2 `readLongTaskLedgerRevision` or the `task_ledger` ContextRef
  regression fails;
- flag off changes any existing Task Ledger or Working Context behavior;
- a new table, store, daemon, or second task-state authority becomes
  necessary;
- any frontmatter `ownerDecisions` item cannot be implemented as recorded.

## 13. Done definition

- This formal spec exists and `pnpm harness context --spec ...` plus
  `pnpm harness validate --spec ...` pass before and after production code.
- All frontmatter `ownerDecisions` items are implemented exactly as recorded.
- Proposal/accept/reject events are append-only and replayable; actor and
  rejection reason are queryable.
- Projection is deterministic; fork/handoff merge copies the explicit Q5 list
  and preserves conflicts.
- Stage 2 regression and task-ledger ContextRef semantics pass unchanged.
- Flag default off and off-path parity pass; no Mem write exists.
- Q7 real provider evidence is recorded in
  `artifacts/context-control-plane/stage3-real-run-evidence.json` with no key,
  prompt, tool arguments, or tool output.
- All required gates pass; product locks remain false; DEVLOG is complete;
  no commit, push, or PR.
