---
id: context-control-plane-stage1
title: Context Control Plane Stage 1 Provider Guard Minimal Grant Tool Guard EffectReceipt
taskType: runtime-authority-convergence
intent: Promote the Stage 1 task draft into the formal harness spec for Provider Guard RequestEnvelope observation over the golden coding turn, one real tool call protected by a temporary minimal CapabilityGrant and Tool Guard, and a real EffectReceipt written from the existing approval/effect chain. All ten draft questions are resolved: the constraint-decidable ones are frozen and the owner decisions below are fixed.
touchedAreas:
  - harness/specs/tasks/context-control-plane-stage1.md
  - docs/dev/context-control-plane/DEVLOG.zh-CN.md
  - openclaw_runtime/src/agents/provider-transport-fetch.ts
  - openclaw_runtime/src/agents/shadow-census.ts
  - openclaw_runtime/src/agents/receipt-store.ts
  - openclaw_runtime/src/agents/effect-receipt.ts
  - openclaw_runtime/src/agents/stage1-request-envelope.ts
  - openclaw_runtime/src/agents/stage1-minimal-grant.ts
  - openclaw_runtime/src/agents/stage1-tool-guard.ts
  - openclaw_runtime/src/agents/stage1-effect-projection.ts
  - openclaw_runtime/src/agents/stage1-golden-run.ts
  - openclaw_runtime/src/agents/stage1-break-glass.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/state/openclaw-state-db.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-db.generated.d.ts
  - tests/unit/context-control-plane-stage1-contracts.test.ts
  - tests/unit/context-control-plane-stage1-provider-guard.test.ts
  - tests/unit/context-control-plane-stage1-grant-tool-guard.test.ts
  - tests/unit/context-control-plane-stage1-effect-receipt.test.ts
  - openclaw_runtime/src/agents/stage1-request-envelope.test.ts
  - openclaw_runtime/src/agents/stage1-minimal-grant.test.ts
  - openclaw_runtime/src/agents/stage1-tool-guard.test.ts
  - openclaw_runtime/src/agents/stage1-effect-receipt.test.ts
  - openclaw_runtime/src/agents/stage1-break-glass.test.ts
  - openclaw_runtime/src/agents/stage1-golden-run.test.ts
  - artifacts/context-control-plane/stage1-real-run-evidence.json
  - tests/unit/runtime-memory-consumer-llm-judge.test.ts
  - tests/unit/runtime-memory-write-path-llm-judge.test.ts
  - tests/unit/runtime-memory-write-path-semantic-real.test.ts
ownerDecisions:
  - "Q1 accepted: golden tool is write; real run writes a controlled sentinel file inside the workspace."
  - "Q3 accepted: envelopeDigest is anchored to the final providerBody read by buildGuardedModelFetch after provider-specific finalizers."
  - "Q5 accepted: TTL issuedAt is the markExecutionStarted success time; expiresAt = min(issuedAt + 60000, approvalRow.expires_at_ms)."
  - "Q6 accepted: Tool Guard is a runtime tool-dispatch adapter in agent-tools.ts, inserted after policy filtering and before before_tool_call wrapping."
  - "Q7 accepted: Stage 1 adds no retention table or query API; EffectReceipt and runtime_receipts keep their existing lifecycle policy."
  - "Q8 accepted: break-glass reuses the existing Inbox/ApprovalLedger with a distinct policy digest and audit marker; no second ledger."
  - "Q9 accepted: egress static constraint is the harness spec plus required harness rules and negative tests; no new lint rule in Stage 1."
  - "Q10 accepted: real-provider run uses DEEPSEEK_API_KEY from the launching environment, model deepseek/deepseek-v4-flash, redacted logs, owner-authorized only."
expectedUserBehavior:
  - The formal Stage 1 task spec exists and is valid; all owner decision items are resolved before production code.
  - Flag off keeps provider request bytes, message order, tool set, retries, approval, and delivery byte-identical to the legacy path.
  - Flag on keeps send behavior unchanged and only appends RequestEnvelope/wire receipt diagnostics.
  - The golden path produces a structured RequestEnvelope/v1 covering system, messages, tools, media, and registered transforms with a stable envelopeDigest and a WireReceipt/v1 association.
  - One real coding tool call passes through approval -> temporary minimal grant -> Tool Guard -> real execution and then produces a queryable EffectReceipt/v1.
  - Receipts never store raw proposal, tool arguments, tool output, prompt text, or credentials.
  - Product locks defaultOn, liveReady, and productApproved remain false; no commit, push, or PR is created.
residualPaths:
  - tests/unit/runtime-memory-consumer-llm-judge.test.ts
  - tests/unit/runtime-memory-write-path-llm-judge.test.ts
  - tests/unit/runtime-memory-write-path-semantic-real.test.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-authority-convergence-boundary
  - coding-mutation-consistency-boundary
  - coding-runtime-workspace-dcs-producer-boundary
humanEvidence: not-required
forbiddenPatterns:
  - modifying attempt.ts, get-reply-run.ts, role-spawn.ts, or any provider path unless this spec explicitly lists the minimum wiring point and the owner approves it
  - changing defaultOn, liveReady, productApproved, or any product/flag default to prove availability
  - adding a new provider, flag, store, daemon, permission database, second approval ledger, third durable memory writer, or fourth capability catalog
  - migrating any existing prompt path or implementing Stage 2+ ContextRef->CompilationSnapshot->DCS->PromptPlan compilation
  - implementing complete CapabilityGrant attenuation, cross-restart grant recovery, or full revocation
  - implementing Task Ledger proposal/accept/reject, Memory convergence, learning-based ranking, context diff, policy simulation, or replay debugger
  - claiming real tool execution or EffectReceipt from fixtures, mocks, or synthetic agent-surrogate evidence
  - storing raw proposal, tool parameters, tool output, channel content, prompt text, credentials, cookies, or environment values in receipts
  - creating a second permission authority beside the existing MCP/tool policy
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-control-plane-stage1.md
  - pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage1.md
  - pnpm exec vitest run tests/unit/context-control-plane-stage1-contracts.test.ts tests/unit/context-control-plane-stage1-provider-guard.test.ts tests/unit/context-control-plane-stage1-grant-tool-guard.test.ts tests/unit/context-control-plane-stage1-effect-receipt.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage1-request-envelope.test.ts src/agents/stage1-minimal-grant.test.ts src/agents/stage1-tool-guard.test.ts src/agents/stage1-effect-receipt.test.ts src/agents/stage1-break-glass.test.ts src/agents/stage1-golden-run.test.ts --reporter=verbose
  - DEEPSEEK_API_KEY=<owner-provided-temp-env> pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage1-golden-run.test.ts --reporter=dot --test-timeout=120000
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check -- docs/dev/context-control-plane harness/specs/tasks/context-control-plane-stage1.md openclaw_runtime/src/agents tests/unit/context-control-plane-stage1-*.test.ts
acceptance:
  - The spec references D1-D5 from docs/dev/context-control-plane/stage0/ and the Stage 0 harness spec, and its touchedAreas name the exact Provider Guard, grant, Tool Guard, and EffectReceipt wiring points.
  - The ten Stage 1 draft questions are each frozen from the Stage 0 constraints or fixed by the ownerDecisions frontmatter; none are left blocked.
  - Harness context and harness validate pass before and after production code changes.
  - Provider Guard acceptance covers T2, T3, T4, T5, T6, T7, and T8 with flag-off byte parity and flag-on unchanged send behavior.
  - Grant and Tool Guard acceptance covers T9 and T10, including deny/expired/governance-mismatch/cross-resource with zero side effects.
  - EffectReceipt acceptance covers T11, T12, T13, and T14 with a real domain journal reference and the full approval state sequence queryable.
  - Stage 1 queryable fields listed in golden-path-contract.md section 5 are all readable through public query paths (T15).
  - All required gate commands pass in the working tree (T16); communication replay and compare pass because the guarded fetch path is touched.
  - The five egress proofs exist: provider allowlist, static code constraint, runtime census, negative tests, and break-glass audit path.
  - Product locks remain false and no commit, push, or PR is created.
docs:
  required: true
  files:
    - docs/dev/context-control-plane/stage0/authority-matrix.md
    - docs/dev/context-control-plane/stage0/artifacts-schema.md
    - docs/dev/context-control-plane/stage0/authority-adapters.md
    - docs/dev/context-control-plane/stage0/golden-path-contract.md
    - docs/dev/context-control-plane/stage0/stage1-task-draft.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-capability-blueprint.md
    - docs/dev/adr/2026-08-16-context-authority-boundaries.md
---

# Context Control Plane Stage 1

Stage 1 turns three Stage 0 contract pieces into real golden-path behavior:

1. Provider Guard `RequestEnvelope/v1` observation over `buildGuardedModelFetch` + RC-02/RC-03.
2. One real coding tool call through `approval -> temporary minimal grant -> Tool Guard`.
3. A real `EffectReceipt/v1` correlated to the approval ledger and the domain journal.

The spec is the single Stage 1 entry point. All owner decision items are resolved below. The executing agent implements exactly those decisions and never widens scope.

## 1. Stage 0 inputs

This spec consumes and does not rewrite the five Stage 0 deliverables:

- D1 `docs/dev/context-control-plane/stage0/authority-matrix.md`
- D2 `docs/dev/context-control-plane/stage0/artifacts-schema.md`
- D3 `docs/dev/context-control-plane/stage0/authority-adapters.md`
- D4 `docs/dev/context-control-plane/stage0/golden-path-contract.md`
- D5 `docs/dev/context-control-plane/stage0/stage1-task-draft.md`
- plus `harness/specs/tasks/context-control-plane-stage0.md`

Stage 0 remains the authority for schema fields, owner boundaries, rejection
reasons, and the golden path chain. Stage 1 adds only the adapters and
observational behavior already designated for Stage 1 in D3/D4/D5.

## 2. Real wiring points

The following paths are the exact Stage 1 wiring points. No other production
path may change.

### 2.1 Provider Guard observation

- `openclaw_runtime/src/agents/provider-transport-fetch.ts`:
  - keep the existing `buildGuardedModelFetch` guard pipeline unchanged;
  - at the existing `providerBody` capture point (after provider-specific
    finalizers hand the body to the guarded fetch), build the structured
    `RequestEnvelope/v1` projection for `system`, `messages`, `tools`,
    `media`, and all registered transforms;
  - compute `envelopeDigest` and pass it out-of-band to the receipt boundary;
    no request byte, ordering, retry, approval, or delivery behavior changes.
- `openclaw_runtime/src/agents/shadow-census.ts`:
  - reuse the existing digest-only `ReceiptStore` append path and the
    shadow census failure diagnostics (`final-wire-body-unavailable`,
    `final-wire-body-invalid`, `wire-owner-incomplete`,
    `receipt-store-write-failed`);
  - add only the Stage 1 envelope/wire correlation fields needed by T3/T4/T6.
- `openclaw_runtime/src/context-engine/rc03-seal-hook.ts`:
  - consume the existing sealed `CompilePlan/v1` and post-seal transform ids;
  - register every transform present on the golden path; any unregistered
    semantic mutation is a diagnostic (observational) and is never silently
    ignored.

### 2.2 Temporary minimal grant

- `openclaw_runtime/src/agents/approval-ledger.ts` is the durable approval
  truth and is reused as-is for state transitions. Stage 1 does not add a
  second ledger or a grant table.
- New `openclaw_runtime/src/agents/stage1-minimal-grant.ts` derives a
  `CapabilityGrant/v1` only after `approvalLedger.markExecutionStarted` wins
  the single-transaction transition. The derived grant contains only:
  `actor`, `scope`, `approvalRef`, `ttl`, `effectIdempotency`, and
  `status`; delegation/revocation are empty in the single-tool Stage 1 slice.
- `openclaw_runtime/src/agents/effect-receipt.ts` remains the EffectReceipt
  writer and the idempotency/content-conflict authority; Stage 1 only passes
  the real post-execution outcome and journal ref.

### 2.3 Tool Guard and EffectReceipt

- New `openclaw_runtime/src/agents/stage1-tool-guard.ts` checks the grant
  fields immediately before the selected tool `execute` runs and denies with
  a structured reason on any mismatch; a deny executes zero side effects.
- The execution wrapper is inserted at the existing tool wrapping boundary in
  `openclaw_runtime/src/agents/agent-tools.ts` (after policy filtering,
  before hook wrapping) so the provider/SDK call path is not modified.
- EffectReceipt is written only after the real executor returns
  `applied | not_applied | unknown`, and the same outcome is then recorded in
  the approval ledger in the frozen sequence
  `approved -> execution_started -> applied|not_applied|unknown ->
  reconciled|needs_reconciliation`.

## 3. Stage 1 draft open questions

### 3.1 Frozen by the Stage 0 constraints

- **Q2 fail-closed timing**: Stage 1 is observational only. Fail-closed is
  not enabled in this stage and remains an owner-gated future decision.
- **Q4 provider SDK finalizer/streaming/media/non-JSON wire**: only the golden
  coding turn is in scope. Non-golden surfaces are recorded as known gaps in
  DEVLOG and must not be silently claimed as covered.
- **Q5 TTL semantics**: the grant TTL covers exactly one tool call and must
  not exceed the approval row TTL.
- **Q7 retention principle**: receipts remain digest/ref-only and retention or
  query visibility must never exceed the existing `runtime_receipts`
  deletion policy.
- **Q10 real-provider run**: no real provider or real remote side effect runs
  without explicit owner authorization; no key is committed. Synthetic
  fixtures never count as T11.

### 3.2 Owner decisions now fixed

The frontmatter `ownerDecisions` list is authoritative: Q1=write, Q3=guarded
providerBody, Q5=60s ceiling bounded by approval expiry, Q6=runtime tool
dispatch adapter in agent-tools.ts, Q7=existing lifecycle policy only,
Q8=Inbox/ApprovalLedger with distinct digest, Q9=harness rules only,
Q10=DeepSeek env key with redaction and owner authorization.

## 4. Implementation slices (only after owner unblock)

### Slice A: RequestEnvelope observation

- Derive one `TurnIdentity` from the same session/run context used by
  ContextReceipt/WireReceipt/EffectReceipt; missing identity fields are a
  diagnostic in observational mode, never an `unknown` field.
- Build the envelope over the body read at the guarded fetch boundary.
- Persist only digest/ref/correlation fields. Raw prompt, messages, tool
  schemas, media bytes, and parameters never enter `runtime_receipts`.
- Flag off: no envelope construction may alter bytes, order, tools, retries,
  approval, or delivery. Flag on: same send path, append-only diagnostics.

### Slice B: one real tool call

- Use only the owner-selected coding tool that already has a workspace guard,
  approval surface, and write/domain journal.
- The model call must be a real provider/model response; T11 evidence is not
  satisfied by replaying a cached tool block or fixture.

### Slice C: minimal grant + Tool Guard + EffectReceipt

- `markExecutionStarted` wins first; then and only then is an `active` grant
  derived in memory. Expiry or completion moves it out of `active` without a
  grant database row.
- Tool Guard validates actor, scope.resource, scope.action, purpose, approval
  ref, TTL, and effect idempotency key. Any mismatch denies with a queryable
  reason.
- After real execution, write `EffectReceipt/v1` then
  `approvalLedger.recordEffectOutcome`. `unknown` enters
  `needs_reconciliation` and is never auto-replayed.

## 5. Required tests mapped to D5

| Test | Coverage |
|---|---|
| T1 | `context-control-plane-stage1-contracts.test.ts` keeps the six Stage 0 schemas valid and rejects raw content/unknown fields. |
| T2 | `stage1-provider-guard` flag-off byte parity against the legacy guarded fetch path. |
| T3 | golden fixture shows system/messages/tools/media/transforms coverage markers. |
| T4 | stable `envelopeDigest` for identical input; any field change changes the digest. |
| T5 | all pre-seal semantic producers are registered; unregistered mutation is diagnosed/rejected per observational mode. |
| T6 | unavailable/invalid final wire body or incomplete owner census produces a census diagnostic and never changes send behavior. |
| T7 | injected unregistered transform/egress increases the census count; normal golden path count is zero. |
| T8 | `stage1-break-glass.ts` writes a distinct-policy ApprovalLedger audit record (`stage1:break-glass:` namespace, denied marker) with zero WireReceipt/EffectReceipt rows, so it does not mix into normal coverage. |
| T9 | approved ledger row derives an active minimal grant; denied/expired/conflict/governance-mismatch derives none. |
| T10 | Tool Guard allows a matching grant and denies any field mismatch with zero side effects. |
| T11 | one owner-authorized real coding tool execution writes the real domain journal; the real test also writes redacted `artifacts/context-control-plane/stage1-real-run-evidence.json` (no key/prompt/tool args/output). |
| T12 | same idempotency key + same content is idempotent; different content is `content-conflict`; no duplicate effect. |
| T13 | `unknown` outcome never replays and lands in `needs_reconciliation`. |
| T14 | approval pending/completed and EffectReceipt rows remain queryable after reopen/restart. |
| T15 | every D4 section 5 queryable field has a public query path. |
| T16 | all required gate commands pass. |

## 6. Egress proof set

Stage 1 must produce all five proofs for the golden path only:

1. provider egress allowlist for the selected provider endpoint;
2. static code constraint (this harness spec + required rules) against
   unregistered semantic mutation;
3. runtime owner census from the existing `buildWireOwnerCensus`;
4. negative tests T5/T6/T7/T9/T10;
5. break-glass audit path implemented in `stage1-break-glass.ts`: one durable
   ApprovalLedger row under `stage1:break-glass:` idempotency namespace and a
   distinct `stage1-break-glass-audit-under-owner-policy:v1` policy digest;
   zero WireReceipt/EffectReceipt rows keep it out of normal coverage.

## 7. Stop and upgrade conditions

Stop and record in DEVLOG without continuing if:

- golden path cannot reach 100% structured envelope coverage;
- the temporary minimal grant cannot be derived from the existing
  approval/effect chain;
- Tool Guard creates a second authority beside the existing MCP/tool policy;
- RequestEnvelope canonical serialization cannot be made deterministic;
- observational mode shows non-zero byte/performance drift against flag-off;
- any frontmatter `ownerDecisions` item is not implemented as written.

## 8. Done definition

- This formal spec exists and `pnpm harness context --spec ...` plus
  `pnpm harness validate --spec ...` pass.
- All `ownerDecisions` items are fixed and implemented exactly as written.
- Golden path has `RequestEnvelope/v1` coverage; one real tool call executes
  after grant + Tool Guard and produces a queryable `EffectReceipt/v1`.
- Unregistered egress on the golden path equals zero with all five proofs.
- Flag-off parity is byte-identical; all required gate commands pass.
- Product locks remain false; DEVLOG is updated with raw command summaries;
  no commit, push, or PR is created.
