---
lifecycleStatus: archived
id: context-control-plane-stage2
title: Context Control Plane Stage 2 ContextRef CompilationSnapshot DCS PromptPlan
taskType: runtime-authority-convergence
intent: Promote Stage 2 into a formal harness spec. Golden coding turn adapters produce real digest-only ContextRef/v1 for user intent, Task Ledger, and tool result; a stateless DCS service compiles them into an immutable CompilationSnapshot/v1 and a sealed PromptPlan/v1; Provider Guard consumes only the sealed PromptPlan/snapshot carriers and never recompiles, filters, or changes policy. Everything stays observational: default flag off, flag-on send bytes unchanged, and the existing prompt production path is not migrated.
touchedAreas:
  - harness/specs/tasks/context-control-plane-stage2.md
  - docs/dev/context-control-plane/DEVLOG.zh-CN.md
  - openclaw_runtime/src/context-engine/stage2-context-refs.ts
  - openclaw_runtime/src/context-engine/stage2-transform-graph.ts
  - openclaw_runtime/src/context-engine/stage2-catalog-epoch.ts
  - openclaw_runtime/src/context-engine/stage2-dcs.ts
  - openclaw_runtime/src/context-engine/stage2-dcs-evidence.ts
  - openclaw_runtime/src/agents/stage1-request-envelope.ts
  - openclaw_runtime/src/agents/shadow-census.ts
  - openclaw_runtime/src/agents/receipt-store.ts
  - openclaw_runtime/src/agents/long-task-control/task-ledger.ts
  - openclaw_runtime/src/agents/stage1-golden-run.ts
  - openclaw_runtime/src/agents/stage2-golden-run.ts
  - openclaw_runtime/src/context-engine/stage2-dcs.test.ts
  - openclaw_runtime/src/agents/stage2-golden-run.test.ts
  - tests/unit/context-control-plane-stage2-contracts.test.ts
  - tests/unit/context-control-plane-stage2-provider-guard.test.ts
  - artifacts/context-control-plane/stage2-real-run-evidence.json
expectedUserBehavior:
  - The formal Stage 2 task spec exists and harness context/validate pass before production code is written.
  - User intent, Task Ledger, and tool result owner boundaries each produce a real ContextRef/v1 containing ref/revision/digest/ACL/retention/provenance and never copying payload.
  - DCS compiles the ContextRef set into an immutable CompilationSnapshot/v1 and a sealed PromptPlan/v1 with selected/omitted/order/budget/why.
  - Identical compilation inputs produce identical snapshotId/planId/snapshotDigest/planDigest and decision content.
  - Snapshot/plan evidence is recoverable through the existing append-only ReceiptStore without a new table, store, or database.
  - Provider Guard accepts only a sealed PromptPlan with its matching snapshot; it does not recompile, re-filter, or alter policy.
  - Stage 2 flag is default off. Flag-on observation changes no provider request byte, message order, tool set, retry, approval, or delivery.
  - The golden coding turn evidence uses the real DeepSeek model and the real write tool/effect chain; fixtures never count as golden evidence.
  - Unregistered direct system-prompt mutation on the Stage 2 golden path is zero.
  - Product locks defaultOn, liveReady, and productApproved remain false; no commit, push, or PR is created.
requiredProfiles:
  - fast
requiredRules:
  - runtime-authority-convergence-boundary
  - coding-runtime-workspace-dcs-producer-boundary
  - context-family-boundary
  - active-config-guards
humanEvidence: not-required
forbiddenPatterns:
  - modifying attempt.ts, get-reply-run.ts, role-spawn.ts, or any provider transport path unless this spec explicitly lists the exact wiring point
  - changing defaultOn, liveReady, productApproved, or any product/flag default to prove availability
  - adding a new provider, flag store, daemon, permission database, second approval ledger, third durable memory writer, or fourth capability catalog
  - storing payload text, raw prompt, raw tool output, credentials, or environment values in ContextRef, snapshot, plan, or receipts
  - making DCS a database or owner of original facts; snapshot/plan artifacts are memory plus existing ReceiptStore evidence only
  - letting producers perform admission, budget, selection, ordering, or omission; those decisions belong to DCS
  - treating PromptPlan as a permission, grant, execution credential, or provider request byte contract in Stage 2
  - migrating Memory, Skill, CVK, FactStore, the existing prompt path, or learning-based ranking
  - implementing Task Ledger proposal/accept/reject, semantic compression, context diff, policy simulation, or replay debugger
  - claiming golden evidence from fixtures, mocks, or cached tool blocks
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-control-plane-stage2.md
  - pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage2.md
  - pnpm exec vitest run tests/unit/context-control-plane-stage2-contracts.test.ts tests/unit/context-control-plane-stage2-provider-guard.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage2-dcs.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage2-golden-run.test.ts --reporter=verbose
  - DEEPSEEK_API_KEY=<owner-provided-temp-env> pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage2-golden-run.test.ts --reporter=dot --test-timeout=120000
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run lint:check
  - git diff --check
acceptance:
  - The spec references D1-D4 from docs/dev/context-control-plane/stage0/ plus the Stage 1 formal spec and evidence; touchedAreas name only Stage 2 adapter, DCS, evidence, Provider Guard carrier, receipt reference, Task Ledger read, and golden runner paths.
  - Harness context and harness validate pass before and after production code changes.
  - ContextRef acceptance covers C1, C2, and C3: user intent ref from the real run prompt, task ledger ref from the append-only long-task ledger with a readable revision/digest, and tool result ref from a real ArchiveHandle checksum/uri; no payload field exists on any ref.
  - DCS acceptance covers C4, C5, C6, and C7: snapshot freezes contextRefs/taskLedgerRevision/catalogEpoch/policyEpoch/policyDigest/modelProfile/transformGraph/budget; plan records selected/omitted/order/budget/why and seals; identical inputs give identical snapshotId/planId/digests and decision content; missing user intent fails closed.
  - Evidence acceptance covers C8, C9, and C17: snapshot and plan evidence is persisted through existing runtime_receipts kind=context rows with deterministic idempotency keys and can be queried back by snapshotDigest; the post-fetch RequestEnvelope digest is appended into the same snapshot correlation so snapshot -> PromptPlan -> RequestEnvelope is recoverable; no new table or raw payload storage.
  - Provider Guard acceptance covers C10, C11, C12, and C13: sealed PromptPlan drives envelope planId/snapshotId; unsealed plan is rejected observationally; snapshot/plan mismatch is rejected; transform graph and plan fields are consumed from the DCS artifact, not recomputed by the guard.
  - Golden path acceptance covers C14 and C15: the real DeepSeek write turn uses the Stage 1 grant/Tool Guard/EffectReceipt chain, produces pre-tool user-intent+task-ledger compile and post-tool three-source compile, and writes redacted stage2-real-run-evidence.json; flag off keeps provider bytes unchanged.
  - Direct mutation acceptance covers C16: a static source test over the Stage 2 golden path modules proves zero direct system-prompt mutation and zero DCS compiler calls from Provider Guard.
  - All required gate commands pass in the working tree; product locks remain false and no commit, push, or PR is created.
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
    - docs/architecture-overview.md
    - harness/specs/tasks/context-control-plane-stage1.md
---
# Context Control Plane Stage 2

Stage 2 turns the Stage 0 data/context artifacts into observational golden-path
behavior:

1. Three owner-boundary adapters produce `ContextRef/v1`: user intent,
   Task Ledger, and tool result.
2. A stateless DCS service compiles refs into an immutable
   `CompilationSnapshot/v1` and a sealed `PromptPlan/v1`.
3. Provider Guard consumes only the DCS artifacts; it never recompiles,
   re-filters, or changes policy.

The spec is the single Stage 2 entry point. No existing prompt production path
is migrated; flag-off and flag-on send behavior remain byte-identical.

## 1. Stage 0 and Stage 1 inputs

This spec consumes and does not rewrite the Stage 0 deliverables D1-D4 and the
accepted Stage 1 spec/evidence:

- `docs/dev/context-control-plane/stage0/authority-matrix.md`
- `docs/dev/context-control-plane/stage0/artifacts-schema.md`
- `docs/dev/context-control-plane/stage0/authority-adapters.md`
- `docs/dev/context-control-plane/stage0/golden-path-contract.md`
- `harness/specs/tasks/context-control-plane-stage1.md`
- Stage 1 code, tests, and DEVLOG real DeepSeek golden-run evidence.

The Stage 0 six-artifact schema in
`shared/types/context-control-plane/artifacts.ts` remains the contract owner.
Stage 2 imports and normalizes `ContextRef/v1`, `CompilationSnapshot/v1`, and
`PromptPlan/v1`; it does not add payload-bearing fields.

## 2. Wiring points

### 2.1 ContextRef adapters

New `openclaw_runtime/src/context-engine/stage2-context-refs.ts`:

- `buildStage2UserIntentContextRef`: owner `transcript`, kind `user_intent`.
  It receives the real run prompt/session entry identity, computes
  `sha256:<contentDigest>`, and keeps only ref/revision/digest/ACL/retention/
  provenance/lifecycle. It never retains the prompt string.
- `buildStage2TaskLedgerContextRef`: owner `task_ledger`, kind `task_ledger`.
  `openclaw_runtime/src/agents/long-task-control/task-ledger.ts` gains a
  read-only revision reader over the existing append-only JSONL. The reader
  returns event count, revision, and `sha256` content digest; it writes nothing
  and stores no payload.
- `buildStage2ToolResultContextRef`: owner `archive`, kind `tool_result`.
  It accepts a real `ArchiveHandle` (`uri`, `checksum`, `byteLength`) and uses
  checksum as content digest and revision; raw tool output never enters the ref.

Each adapter returns `{ ok: true, ref } | { ok: false, reason }` and validates
the result with the Stage 0 `normalizeContextRef`. Adapters perform no budget,
selection, ordering, or omission decisions.

### 2.2 DCS compile

New files:

- `openclaw_runtime/src/context-engine/stage2-transform-graph.ts` projects the
  existing RC-03 seal registry into `RegisteredTransform[]`; no producer is
  invented and no unregistered producer enters the graph.
- `openclaw_runtime/src/context-engine/stage2-catalog-epoch.ts` derives
  `catalogEpoch` from the V3 shadow-catalog `snapshotHash` and `policyEpoch`
  from the effective policy digest. It is a read-only projection, not a new
  catalog authority.
- `openclaw_runtime/src/context-engine/stage2-dcs.ts` implements
  `compileStage2Dcs` with the fixed Stage 2 rule
  `stage2-dcs:v1:deterministic-observational`. It:
  - freezes `contextRefs` fingerprints, `taskLedgerRevision`, `catalogEpoch`,
    `policyEpoch`, `policyDigest`, `modelProfile`, `transformGraph`, and budget
    into an immutable `CompilationSnapshot/v1`;
  - builds `selected`/`omitted`/`order`/`budget`/`why` and seals a
    `PromptPlan/v1`;
  - fails closed with a queryable reason when user intent is missing,
    task-ledger revision conflicts, transform graph is empty, or user intent
    exceeds the input budget;
  - uses deterministic UUID-shaped ids derived from canonical input, so equal
    inputs produce equal snapshot/plan ids and digests. Wall-clock time is not
    injected; callers supply `observedAt`.
- `openclaw_runtime/src/context-engine/stage2-dcs-evidence.ts` persists two
  digest-only evidence rows through the existing `ReceiptStore`
  (`kind=context`, version 1): one for the snapshot and one for the sealed
  plan. Idempotency keys are `ctx:v2:snapshot:<snapshotDigest>` and
  `ctx:v2:plan:<planDigest>`. Selected refs encode snapshot inputs and plan
  decisions; raw content never enters receipts.
- DCS keeps only an in-memory discardable registry for the current process.
  Evidence is recoverable from the append-only receipt rows and deterministic
  recompilation.

### 2.3 Provider Guard consumes the sealed plan

`openclaw_runtime/src/agents/stage1-request-envelope.ts` gains typed carrier
inputs on `ShadowReceiptOptions`:

- `stage2PromptPlan`: `{ schema, planId, snapshotId, planDigest, sealed, identity }`.
- `stage2Snapshot`: `{ schema, snapshotId, snapshotDigest, transformGraph, policyDigest, modelProfile }`.

When carriers are present the envelope builder must:

- reject an unsealed plan with `prompt-plan-not-sealed`;
- reject a snapshot mismatch with `snapshot-plan-mismatch`;
- take `planId`, `snapshotId`, identity, and `transforms` from the DCS
  artifacts only;
- never call any DCS compile function, never re-derive transforms from
  `rc03Plan`, and never change policy.

Without carriers the existing Stage 1 RC-03 observational path remains the
legacy fallback and is byte-identical to Stage 1.

`openclaw_runtime/src/agents/receipt-store.ts` extends the bounded receipt
reference grammar with `ref:compilation-snapshot:` and `ref:prompt-plan:`
prefixes so snapshot/plan evidence refs are canonical. No new table, column,
kind, or lifecycle policy is added.

### 2.4 Golden coding turn

`openclaw_runtime/src/agents/stage2-golden-run.ts` is explicit-invoke only and
reuses the accepted Stage 1 real provider/tool chain:

1. Ensures a real long-task ledger root and creates the user-intent ref.
2. Reads the ledger revision and creates the task-ledger ref.
3. Compiles the pre-tool snapshot/plan and passes both carriers into the
   existing Stage 1 golden runner (modified only by optional carrier fields).
4. The real DeepSeek model calls the real `write` tool through approval,
   minimal grant, Tool Guard, journal, and EffectReceipt exactly as Stage 1.
5. The write result is archived through the existing
   `createContextArchiveHandleForPayloadSync`; the returned handle creates the
   tool-result ref.
6. A post-tool DCS compile contains all three ref kinds and is persisted as
   recoverable evidence.
7. A redacted `artifacts/context-control-plane/stage2-real-run-evidence.json`
   records digests/refs only; no key, prompt, tool arguments, or tool output.

The Stage 2 flag is default off. `resolveStage2DcsState` only enables from an
explicit config slice or env override; default false never changes bytes.
## 3. Stage 2 decision rule

The observational rule is deterministic and fully explainable:

- Admission: active refs only; each refId appears once.
- Policy gate: a ref whose `acl.allowedActors` does not intersect
  `session:<sessionKey>` / `run:<runId>` is omitted with `policy-denied`.
- Lifecycle gate: non-active refs are omitted with `stale`.
- Order: `user_intent` before `task_ledger` before `tool_result`; ties by
  refId ascending.
- Projection (plan-only, not prompt bytes): `user_intent=verbatim`,
  `task_ledger=index_only`, `tool_result=index_only`.
- Budget: char-unit estimates are supplied as compilation input (factual size
  hints from owner payload length, never selection policy). Requested units are
  all admitted unique refs; selected units stop at
  `budget.limit - budget.outputReserve`. Non-user-intent refs over budget are
  omitted with `budget-drop`; user intent over budget fails closed.
- Missing user intent fails the whole compilation with
  `missing-user-intent`.

Producers never decide any of these outcomes.

## 4. Required tests mapped to acceptance

| Test | Coverage |
|---|---|
| C1 | user-intent ContextRef validates and contains no payload field. |
| C2 | long-task ledger revision reader is read-only, append-sensitive, and produces a valid task-ledger ref. |
| C3 | real ArchiveHandle produces a valid tool-result ref whose digest equals the archive checksum. |
| C4 | snapshot freezes every required version input and validates against Stage 0 schema. |
| C5 | plan selected/omitted/order/budget/why validate; missing user intent and ledger revision conflict fail closed. |
| C6 | identical inputs produce identical snapshotId/planId/snapshotDigest/planDigest and decision content. |
| C7 | sealed=false is never emitted by DCS; planDigest is stable. |
| C8 | snapshot/plan evidence persists through runtime_receipts kind=context and is queryable by snapshotDigest. |
| C9 | receipt reference grammar accepts compilation evidence refs and still rejects raw payload shapes. |
| C10 | Provider Guard envelope uses sealed planId/snapshotId and snapshot transform graph. |
| C11 | unsealed plan carrier returns `prompt-plan-not-sealed`. |
| C12 | snapshot/plan mismatch returns `snapshot-plan-mismatch`. |
| C13 | static source test proves Provider Guard does not import or call DCS compile and does not mutate system prompt. |
| C14 | Stage 2 golden runner preflight rejects missing key and path escape without network; flag-off stays off by default. |
| C15 | owner-authorized real DeepSeek run executes the real write chain and produces pre-tool and post-tool three-source evidence. |
| C16 | direct system-prompt mutation scan over Stage 2 golden path files equals zero. |
| C17 | RequestEnvelope digest is recoverable through the same snapshot correlation as its snapshot/plan evidence. |

## 5. Stop and upgrade conditions

Stop and record in DEVLOG without continuing if:

- any of the three owner boundaries cannot produce a digest-only ref;
- identical canonical inputs cannot produce a stable snapshot/plan digest;
- snapshot/plan evidence cannot be recovered through the existing
  `ReceiptStore` without a new table;
- Provider Guard requires a compile call or policy derivation to build the
  envelope;
- flag-on observation changes any provider request byte;
- the real run requires changing a default or product lock.

## 6. Done definition

- This formal spec exists and `pnpm harness context --spec ...` plus
  `pnpm harness validate --spec ...` pass before and after code.
- Three real golden-path sources produce `ContextRef/v1` with no payload copy.
- `CompilationSnapshot/v1` freezes all version inputs and `PromptPlan/v1` is
  sealed, stable for equal inputs, and explains selected/omitted/why.
- Snapshot/plan evidence and the golden-path RequestEnvelope digest are recoverable through the existing receipt store.
- Provider Guard consumes only the sealed plan/snapshot carriers.
- Golden-path direct system-prompt mutation equals zero.
- Default flag off; flag-on send bytes unchanged.
- Product locks remain false; DEVLOG is updated; no commit, push, or PR.
