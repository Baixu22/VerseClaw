---
id: context-control-plane-stage4
title: Context Control Plane Stage 4 Unified CapabilityGrant Tool Guard and Subagent Attenuated Delegation
taskType: runtime-authority-convergence
intent: Promote Stage 4 into a formal harness spec. CapabilityGrant/v1 becomes a unified pure-derived execution credential from the existing durable ApprovalLedger, policy digest, and session identity. It supports TTL, revocation epoch, explicit restart invalidation, and delegation whose child scope, TTL, and delegation depth are strictly bounded by the parent. A default-off Tool Guard executes at the tool dispatch point after MCP/tool policy filtering and verifies actor, scope, TTL, approval ref, governance, effect idempotency, revocation, and parent chain before any tool body runs. Every issue, denial, and revocation appends an in-memory audit record carrying policy digest and actor chain; durable effect truth remains the existing approval ledger plus effect receipts. No second permission database, approval ledger, or product-lock change is introduced.
touchedAreas:
  - harness/specs/tasks/context-control-plane-stage4.md
  - docs/dev/context-control-plane/DEVLOG.zh-CN.md
  - docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md
  - openclaw_runtime/src/agents/stage4-capability-grant.ts
  - openclaw_runtime/src/agents/stage4-tool-guard.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - tests/unit/context-control-plane-stage4-contracts.test.ts
  - openclaw_runtime/src/agents/stage4-capability-grant.test.ts
  - openclaw_runtime/src/agents/stage4-tool-guard.test.ts
ownerDecisions:
  - "D1 accepted: Stage 4 active grants are process-local derived credentials; restart always resolves them as explicitly invalid with reason grant-not-recoverable-after-restart."
  - "D2 accepted: Stage 4 grant audit is an in-memory append-only trail; durable authorization and effect truth remain ApprovalLedger and EffectReceiptStore, and no new table or store is created."
  - "D3 accepted: the default guarded tool remains write; non-write tools pass through unchanged and no existing tool permission is widened."
  - "D4 accepted: root grants carry no delegation field; child grants carry delegation.parentGrantId and delegation.maxDepth. A child is only derivable from an active parent, must use actorKind delegate, and must have scope and TTL strictly bounded by the parent."
expectedUserBehavior:
  - The formal Stage 4 task spec exists and harness context/validate pass before any Stage 4 production code is written.
  - Stage 0 CapabilityGrant/v1 remains the only grant contract; no second permission database or approval ledger is introduced.
  - deriveStage4CapabilityGrant only returns an active grant after an ApprovalLedger row is in execution_started with decision approved and a valid resolved_by.
  - verifyStage4CapabilityGrant denies grant-missing, grant-not-active, ttl-expired, ttl-not-yet-valid, actor-mismatch, scope-resource-mismatch, scope-action-mismatch, scope-purpose-mismatch, approval-mismatch, governance-mismatch, policy-digest-mismatch, effect-idempotency-mismatch, revoked, and every child escalation reason before any executor runs.
  - Every denied, revoked, or issued grant appends an audit record with policy digest and actor chain; denial and revocation reasons are queryable through Stage4GrantAuthority and Stage4GrantAuditTrail.
  - Restart recovery is explicit invalidation: active process-local grants are not recovered after restart and resolve to grant-not-recoverable-after-restart.
  - Child grants are denied when the parent grant is missing, revoked, expired, or not active; when child scope/action/task branch/purpose exceeds parent; when child TTL is not inside parent TTL; and when child delegation depth is not strictly less than the parent remaining depth.
  - Stage 4 Tool Guard is default off and sits at the same tool dispatch point as Stage 1, after MCP/tool policy filtering and before before_tool_call wrapping; flag off changes no tool set, request bytes, or product default.
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
  - adding a second permission database, approval ledger, grant table, or durable grant store
  - letting a model, Skill, renderer, or plugin register an executor
  - widening any existing tool permission or allowing wildcard actions
  - granting a child more resource, action, task branch, purpose, TTL, or delegation depth than its parent
  - modifying the existing MCP policy or tool allow-deny pipeline to authorize execution
  - changing defaultOn, liveReady, productApproved, any product flag default, or the product lock to prove availability
  - committing, pushing, or creating a PR
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-control-plane-stage4.md
  - pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage4.md
  - pnpm harness context --spec harness/specs/tasks/context-control-plane-stage3.md
  - pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage3.md
  - pnpm exec vitest run tests/unit/context-control-plane-stage4-contracts.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage4-capability-grant.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage4-tool-guard.test.ts --reporter=verbose
  - pnpm exec vitest run tests/unit/context-control-plane-stage1-grant-tool-guard.test.ts tests/unit/context-control-plane-stage3-contracts.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage1-minimal-grant.test.ts src/agents/stage1-tool-guard.test.ts --reporter=verbose
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run lint:check
  - git diff --check
acceptance:
  - Harness context and validate pass for this spec before and after production code changes; Stage 3 harness context/validate remain green as regression.
  - L1 acceptance: deriveStage4CapabilityGrant produces a schema-valid CapabilityGrant/v1 only from an execution_started approval row with decision approved; denied, not-yet-started, expired, missing resolved_by, wildcard action, malformed policy digest, and invalid identity/scope/toolCallId/delegation are rejected with queryable reasons.
  - L2 acceptance: verifyStage4CapabilityGrant allows the exact actor/scope/approval/governance/policy/idempotency call and denies every mismatch before execution.
  - L3 acceptance: expired and revoked grants are denied with zero executor side effects and the denial reason is queryable.
  - L4 acceptance: every child escalation counterexample fails closed across the complete ancestor chain: missing parent or ancestor, revoked parent or ancestor, expired parent or ancestor, broader resource, different action, broader task branch, different purpose, TTL outside parent, and non-decreasing delegation depth.
  - L5 acceptance: restart recovery resolves every active grant to grant-not-recoverable-after-restart; the policy is explicit invalidation, not silent reuse.
  - L6 acceptance: Stage4GrantAuditTrail records issue, denial, and revocation with policy digest and actor chain; listDenials and listRevocations expose queryable reasons.
  - L7 acceptance: wrapToolWithStage4ToolGuard is default off, guards write only by default, blocks denied or invalid calls before the executor runs, and records a real EffectReceipt plus ledger outcome on success through the existing ApprovalLedger and EffectReceiptStore.
  - L8 acceptance: Stage 1 and Stage 3 regression tests remain green; no Stage 1 or Stage 3 production path is rewritten.
  - L9 acceptance: all required gate commands pass; product locks remain false and no commit, push, or PR is created.
docs:
  required: true
  files:
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md
    - docs/dev/context-control-plane/STAGE4-DEV-PROMPT.zh-CN.md
    - docs/dev/context-control-plane/DEVLOG.zh-CN.md
    - docs/dev/context-control-plane/stage0/authority-matrix.md
    - docs/dev/context-control-plane/stage0/artifacts-schema.md
    - docs/dev/context-control-plane/stage0/authority-adapters.md
    - docs/dev/context-control-plane/stage0/golden-path-contract.md
    - docs/dev/context-capability-blueprint.md
    - docs/dev/adr/2026-08-16-context-authority-boundaries.md
    - harness/specs/tasks/context-control-plane-stage1.md
    - harness/specs/tasks/context-control-plane-stage3.md
---

# Context Control Plane Stage 4

Stage 4 turns the Stage 1 temporary minimal grant into the unified
`CapabilityGrant/v1` execution credential:

1. A pure derivation rule takes an `execution_started` approval row, session
   identity, policy digest, and tool-call identity and returns an active
   `CapabilityGrant/v1`. The grant is an in-memory credential, never a database
   row.
2. Delegation and attenuation are pure functions. A child grant may only be
   derived from an active parent grant, must use `actorKind: "delegate"`, and
   must have resource, action, task branch, purpose, TTL, and delegation depth
   strictly bounded by the parent.
3. Tool Guard is a default-off tool-dispatch adapter. It runs after the existing
   MCP/tool policy pipeline and before `before_tool_call` wrapping, and verifies
   actor, scope, TTL, approval ref, governance, effect idempotency, revocation,
   and parent chain before the executor body runs.
4. Restart recovery is explicit invalidation. Active grants are process-local
   derived credentials and are never silently revived after restart.
5. Audit is an in-memory append-only trail. Every issue, denial, and revocation
   records policy digest and actor chain. Durable truth stays in the existing
   ApprovalLedger and EffectReceiptStore.

This spec is the single Stage 4 entry point. The frontmatter ownerDecisions are
authoritative for the implementation below.

## 1. Stage 0, Stage 1, and Stage 3 inputs

This spec consumes and does not rewrite:

- Stage 0 deliverables D1-D4:
  - `docs/dev/context-control-plane/stage0/authority-matrix.md`
  - `docs/dev/context-control-plane/stage0/artifacts-schema.md`
  - `docs/dev/context-control-plane/stage0/authority-adapters.md`
  - `docs/dev/context-control-plane/stage0/golden-path-contract.md`
- `harness/specs/tasks/context-control-plane-stage0.md`
- `harness/specs/tasks/context-control-plane-stage1.md` and Stage 1 evidence.
- `harness/specs/tasks/context-control-plane-stage3.md` and Stage 3 regression
  tests. Stage 3 Working Context is not modified.

The `CapabilityGrant/v1` schema in
`shared/types/context-control-plane/artifacts.ts` remains the contract owner.
Stage 4 implements the schema fields already frozen there; it does not add a
new grant schema or a durable grant table.

## 2. Read-only current state confirmed before this spec

- `openclaw_runtime/src/agents/stage1-minimal-grant.ts` owns the temporary
  minimal derivation and verification used by Stage 1.
- `openclaw_runtime/src/agents/stage1-tool-guard.ts` owns the Stage 1
  tool-dispatch wrapper and effect receipt correlation.
- `openclaw_runtime/src/agents/agent-tools.ts` owns the shared tool surface and
  already inserts Stage 1 Tool Guard after policy filtering and before
  `before_tool_call` wrapping when `options.stage1ToolGuard` is provided.
- `openclaw_runtime/src/agents/approval-ledger.ts` owns the durable approval
  sequence; `effect-receipt.ts` owns the durable effect receipt correlation.
- The Stage 4 implementation only adds a pure grant module and a default-off
  tool-dispatch adapter; it does not change the approval ledger, effect receipt
  store, MCP policy, or tool allow-deny pipeline.

## 3. Unified CapabilityGrant derivation

`deriveStage4CapabilityGrant(input)` is the only production path that creates a
Stage 4 grant. It is a pure function of its inputs.

Inputs:

- `approvalRow` from the existing ApprovalLedger; the row must have
  `state: "execution_started"` and `decision: "approved"`.
- `actor` from session identity (`sessionKey`, `runId`, `attemptIndex`,
  `modelCallIndex`, `actorKind`).
- `scope` (`taskBranchId`, `resource`, `action`, `purpose`) from the tool call.
- `policyDigest` from the effective policy that approved the call.
- `toolCallId` from the runtime tool execution point.
- optional `ttlMs`, `issuedAtMs`, `nowMs`, `parentGrant`, `delegation`,
  `resolveParentGrant`, and `revokedGrantIds`.

Every input field is validated against the Stage 0 `CapabilityGrant/v1` schema
constraints before a grant is returned; schema-invalid input never produces an
active grant.

Derivation rule: `grant-adapter/v1:derive-unified-from-approved-ledger`, version
`2`.

Rejections:

- `approval-not-approved`, `approval-not-execution-started`, `approval-expired`,
  `resolved-by-missing`, `invalid-identity`, `invalid-scope`, `invalid-ttl`,
  `invalid-policy-digest`, `invalid-tool-call-id`, `invalid-approval-ref`,
  `invalid-governance`, `invalid-delegation`, `wildcard-action`,
  `parent-grant-missing`, `parent-grant-mismatch`, `parent-grant-not-active`,
  `parent-scope-escalation`, `parent-ttl-escalation`,
  `delegation-requires-delegate-actor`, `delegation-depth-exceeded`.

The returned grant always has `status: "active"` and `effectIdempotency.key`
equal to `<grantId>:<approvalId>:<toolCallId>` with namespace `coding-tool`.
Root grants have no `delegation` field. Child grants carry
`delegation.parentGrantId` and `delegation.maxDepth`; they are derived only
when `parentGrant` is supplied and active.

## 4. Verification

`verifyStage4CapabilityGrant(input)` is the only production path that authorizes
a Stage 4 tool call. It never mutates a grant and never calls an executor.

It checks in order:

1. `grantId` is not in the revoked set.
2. `status` is `active`; `revoked` and `expired` grants are denied.
3. `scope.action` is not `*`.
4. TTL is valid for `nowMs`.
5. actor, resource, action, purpose match exactly.
6. approval id, resolved governance actor, and policy digest match exactly.
7. effect idempotency key equals `<grantId>:<approvalId>:<toolCallId>`.
8. when `delegation` exists, the complete parent chain is resolved and
   checked link by link, starting from the direct parent and walking through
   every ancestor delegation until the root. A missing resolver entry for any
   ancestor fails closed.

Parent-chain checks (applied to every link in the chain):

- missing parent grant or missing ancestor -> `parent-grant-missing`.
- parent grant id mismatch -> `parent-grant-mismatch`.
- parent revoked, expired, or not active -> `parent-grant-not-active`.
- child actor kind is not `delegate` -> `delegation-requires-delegate-actor`.
- child resource/action/task branch/purpose is not bounded by parent ->
  `parent-scope-escalation`.
- child TTL is not contained in parent TTL -> `parent-ttl-escalation`.
- parent has a delegation field and child `maxDepth` is not strictly less than
  parent `maxDepth` -> `delegation-depth-exceeded`.

A child resource is bounded when it equals the parent resource or starts with
`<parent resource>/`. A child task branch is bounded when it equals the parent
task branch or starts with `<parent task branch>/`. Child action and purpose
must equal parent action and purpose; wildcards remain forbidden.

## 5. Revocation, expiration, and restart recovery

- `revokeStage4CapabilityGrant(grant, input)` returns a new grant object with
  `status: "revoked"` and `revocation.revokedAt`, `revocation.reason`, and
  `revocation.revocationEpoch`. Re-applying revocation is idempotent.
- `markStage4GrantExpired(grant, nowMs)` returns a new grant object with
  `status: "expired"` when `nowMs` is past `ttl.expiresAt`.
- `recoverStage4GrantAfterRestart(grantId)` always returns
  `grant-not-recoverable-after-restart`. Stage 4 chooses explicit invalidation:
  active grants are process-local and are never revived after restart.

## 6. Audit trail

`Stage4GrantAuditTrail` is an in-memory append-only trail. Each record has:

- `recordId`, `event` (`grant-issued` | `grant-denied` | `grant-revoked`),
  `grantId`, `policyDigest`, `actorChain`, `reason`, and `atMs`.

`Stage4GrantAuthority` appends an audit record on every issue, denial, and
revocation. `listDenials()` and `listRevocations()` expose queryable reasons.
The trail is intentionally process-local; durable effect and approval facts
remain in the existing ledger and receipt store.

## 7. Tool Guard execution point

`wrapToolWithStage4ToolGuard(tool, options)` is the Stage 4 execution-point
adapter. It is inert unless `options.enabled === true`, and
by default only
wraps the owner-selected `write` tool. Non-write tools pass through unchanged.

The wrapper:

1. resolves the file path from the write tool parameters; a missing path is
   blocked before any ledger write;
2. reserves and approves through the existing `ApprovalLedger` with idempotency
   key `stage4:write:<toolCallId>`;
3. marks `execution_started`;
4. derives a Stage 4 grant and verifies it;
5. only then calls the original executor;
6. records the outcome through the existing `EffectReceiptStore` and
   `ApprovalLedger.recordEffectOutcome`, then marks the grant expired.

A denied verdict returns the existing blocked-tool result and never calls the
original executor.

## 8. Wiring in `agent-tools.ts`

`buildAgentTools` already materializes the tool surface and applies MCP/tool
policy filtering. Stage 4 adds an optional `stage4ToolGuard` option. When
provided, `wrapToolWithStage4ToolGuard` is applied at the same point as the
Stage 1 adapter: after the policy pipeline and before `before_tool_call`
wrapping. When both Stage 1 and Stage 4 options are present, Stage 4 wins for
the guarded tool. When neither is present, tool construction remains
byte-for-byte equivalent to the legacy path.

## 9. Verification commands

The frontmatter `requiredTests` list is the complete Stage 4 gate. The real
provider run is intentionally not repeated because Stage 4 changes only the
grant/Tool Guard layer; Stage 1/Stage 3 evidence already owns real-provider
evidence and Stage 1/Stage 3 regression tests must stay green.
