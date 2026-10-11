---
id: error-governance-boundary
title: Error Governance Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
severity: error
driven_by: agent
pathPatterns:
  - docs/dev/error-governance-decision-record.md
  - scripts/check-error-governance.mjs
  - tests/unit/error-governance-boundary.test.ts
touchedAreas:
  - docs/dev/error-governance-decision-record.md
  - harness/specs/rules/error-governance-boundary.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - scripts/check-error-governance.mjs
  - scripts/check-error-governance.d.mts
  - tests/unit/error-governance-boundary.test.ts
  - tests/unit/fixtures/error-governance/**
requiredTests:
  - node scripts/check-error-governance.mjs
  - node node_modules/vitest/vitest.mjs run tests/unit/error-governance-boundary.test.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/scenarios/gateway-backend-communication.md
---

# Error Governance Boundary

This rule turns the error/problem governance draft attached to GitHub issue #115
into constraints that the current tree can actually enforce. Markdown is not a
gate, so **every hard claim below names the executable check that fails when the
claim stops being true**. The decisions themselves are recorded in
`docs/dev/error-governance-decision-record.md`.

The single source of executable truth is `node scripts/check-error-governance.mjs`.
It reads this file's machine-readable surface block, the real Main-process error
codes, the real renderer error classes and the real waiting/approval unions, and
compares them. It fails closed: a missing rule, a missing or unparsable surface
block, an unresolvable referenced path and a stale declared gap are all failures,
never silent skips.

The rule is bound to the `gateway-backend-communication` scenario. The scenario's
`requiredRules` entry is itself verified by the check, so removing the wiring
fails the check instead of silently detaching the rule.

## R1 — One envelope, the existing one

`HostResponse` is the only host-api envelope. It stays as declared in
`shared/host-api/types.ts` and `electron/main/ipc/host-contract.ts`; `AppError`
and `HostErrorCode` are the only error taxonomies an error surface may render.
Creating a third envelope, a parallel `AppError` class, or a second code union is
a failure, not a refactor.

Executable check: the `error-envelope-reused` check of
`node scripts/check-error-governance.mjs` reads the declared envelope symbol,
requires it to be `HostResponse`, requires `allowedErrorTypes` to be exactly
`AppError` and `HostErrorCode`, and requires each symbol to really be declared in
its owner file. A surface block that names any other envelope, or a symbol that
does not exist in its owner, fails with `error-governance.parallel-envelope` or
`error-governance.parallel-error-type`.

## R2 — One closed class per layer

Main answers with `HostErrorCode`; the renderer classifies into the closed
`APP_ERROR_CODES` set in `src/lib/error-model.ts`. A layer must not surface a code
outside its own closed set, and the declared mapping for a Main code must equal
what the real classifier returns.

Executable checks: `error-surfaces-in-range` rejects a surface that renders a
code outside its layer's closed set (`error-governance.out-of-range-error-surface`),
and `error-mapping-matches-classifier` rejects a declared mapping that disagrees
with `mapBackendErrorCode` (`error-governance.error-mapping-drift`).

## R3 — A missing mapping is either fixed or declared

Every Main-process error code must have a declared renderer mapping. A code whose
renderer classification is `UNKNOWN` is a gap that must be declared explicitly in
both `hostErrorCodeMappings` and `declaredUnknownMappings`, with the reason
written down in the decision record. Silence about a code is a failure.

Executable checks: `host-error-code-mapping-complete` fails with
`error-governance.missing-error-mapping` when a real code has no row;
`error-mapping-matches-classifier` fails with
`error-governance.undeclared-unknown-mapping` when an `UNKNOWN` classification is
not declared. There is no wildcard row and no "default" mapping.

## R4 — Waiting and approval types stay fail-closed

No waiting or approval type may be auto-approved by automation, and no waiting
state may execute effects. Any request whose approval type or waiting status is
not in the declared taxonomy is held: no approval, no action. The declared
taxonomy must cover the real unions in `shared/host-api/contract.ts`; a new union
member is a failure until it has a declared decision, so a new waiting type can
never inherit an "approved" default by accident.

Executable checks: `waiting-type-coverage` fails with
`error-governance.missing-waiting-type` / `error-governance.unknown-waiting-type`;
`no-auto-approval` fails with `error-governance.auto-approval-declared`,
`error-governance.executed-action-without-decision` or
`error-governance.effects-during-wait`. The runtime behaviour of
`resolveWaitingDecision` — unknown type held, known type processed per its schema
— is pinned by `tests/unit/error-governance-boundary.test.ts`.

## R5 — Declared gaps stay honest

A gap declared in the surface block is a claim about this tree, so each declared
gap must be backed by an executable probe. A gap whose defect has been fixed (its
probe no longer reproduces) is a failure, exactly like an undeclared defect.

Executable check: `declared-gaps-match-tree` fails with
`error-governance.stale-declared-gap`, `error-governance.undeclared-gap`,
`error-governance.unverifiable-declared-gap` or
`error-governance.missing-gap-evidence`.

## R6 — Correlation ids stay separate

The renderer generates the local correlation id; Main echoes it. The provider-side
`requestId` is a different, redacted identifier (see
`openclaw_runtime/src/agents/provider-http-errors.ts` and
`openclaw_runtime/src/logging/diagnostic-support-log-redaction.ts`) and must never
be presented as the local id or the other way round.

Executable checks: `request-id-attribution` fails when the renderer stops
generating the id or Main stops echoing it; `decision-record-anchors` fails when
the record stops naming the provider request id; `record-disambiguation-anchors`
fails when the record collapses the two identifiers — or the stable per-layer code
sets, or the five recoverability / replay / switch / post-fix-retry / cooldown
situations — into one statement.

## R7 — No human prerequisite, no real-human claim

- No node, rule, scenario, task spec or acceptance criterion may require a human verdict.
- No artifact may require human data or a human UI step as a precondition.
- Any step that would otherwise need a person is implemented as an automated, agent-driven equivalent labelled `driven_by: agent`.
- No artifact may describe automated evidence as real-human evidence.

Executable checks: `no-human-prerequisite` scans this rule, the decision record
and the scenario line by line and fails with
`error-governance.human-prerequisite` on any human-prerequisite wording that is
not negated on the same line; `agent-driven-labelling` fails with
`error-governance.missing-agent-driven-label` when the label is removed.

## Boundaries

- This rule does not change any product default, limit or frozen value, and it
  does not freeze the "100 RPM" suggestion from the draft. A change to a product
  lock is a separate decision with its own record.
- This rule does not create a second error table. The machine-readable block
  below is a declaration of what already exists, kept honest by the probes; the
  authoritative sources remain `src/lib/error-model.ts`,
  `electron/main/ipc/host-contract.ts` and `shared/host-api/types.ts`.
- This rule does not require an E2E run. It governs static contracts and the
  agent-driven decision table, which is exactly what the check and the unit test
  can prove.

## Machine-readable error surface

The block below is parsed by `node scripts/check-error-governance.mjs`. Editing
the prose without editing this block changes nothing that the check can see.

```json error-governance-surface
{
  "schema": "clawx.error-governance.surface.v1",
  "envelope": {
    "symbol": "HostResponse",
    "owners": [
      "shared/host-api/types.ts",
      "electron/main/ipc/host-contract.ts"
    ],
    "errorTypeSymbol": "AppError",
    "errorTypeOwner": "src/lib/error-model.ts"
  },
  "allowedErrorTypes": [
    "AppError",
    "HostErrorCode"
  ],
  "hostErrorCodeMappings": [
    { "code": "VALIDATION", "rendererClass": "CONFIG", "classifier": "src/lib/error-model.ts#mapBackendErrorCode" },
    { "code": "UNSUPPORTED", "rendererClass": "CHANNEL_UNAVAILABLE", "classifier": "src/lib/error-model.ts#mapBackendErrorCode" },
    { "code": "INTERNAL", "rendererClass": "UNKNOWN", "classifier": "src/lib/error-model.ts#mapBackendErrorCode" },
    { "code": "TIMEOUT", "rendererClass": "TIMEOUT", "classifier": "src/lib/error-model.ts#mapBackendErrorCode" }
  ],
  "declaredUnknownMappings": [
    {
      "code": "INTERNAL",
      "id": "internal-has-no-dedicated-renderer-class",
      "reason": "src/lib/error-model.ts has no CODE_SIGNALS entry for INTERNAL, so every unclassified Main failure is rendered as UNKNOWN. The decision record declares this gap; closing it is a renderer change, not part of issue #115."
    }
  ],
  "errorSurfaces": [
    {
      "id": "renderer-host-api-request",
      "owner": "src/lib/host-api-client.ts",
      "envelope": "HostResponse",
      "errorTypeSymbol": "AppError",
      "codes": [
        "AUTH_INVALID",
        "AUTH_PERMANENT",
        "TIMEOUT",
        "RATE_LIMIT",
        "PERMISSION",
        "CHANNEL_UNAVAILABLE",
        "CONVERSATION_STATE",
        "NETWORK",
        "CONFIG",
        "GATEWAY",
        "BILLING",
        "OVERLOADED",
        "MODEL_NOT_FOUND",
        "UNKNOWN"
      ]
    },
    {
      "id": "main-host-dispatch",
      "owner": "electron/main/ipc/host-invoke.ts",
      "envelope": "HostResponse",
      "errorTypeSymbol": "HostErrorCode",
      "codes": [
        "VALIDATION",
        "UNSUPPORTED",
        "INTERNAL",
        "TIMEOUT"
      ]
    }
  ],
  "declaredGaps": [
    {
      "id": "duplicate-host-response-copies",
      "state": "gap",
      "probe": "duplicate-host-response-copies",
      "evidence": "shared/host-api/types.ts",
      "summary": "HostResponse is declared twice, once renderer-facing and once Main-facing, with different optionality for id, error, code and message."
    },
    {
      "id": "duplicate-app-error-code-unions",
      "state": "gap",
      "probe": "duplicate-app-error-code-unions",
      "evidence": "electron/main/ipc/request-helpers.ts",
      "summary": "AppErrorCode is declared twice with different members: the closed renderer set in src/lib/error-model.ts and the Main-process request-helper union in electron/main/ipc/request-helpers.ts."
    }
  ],
  "waitingTypes": {
    "owner": "shared/host-api/contract.ts",
    "unions": {
      "approvalType": "AgentBrowserTaskApproval[\"status\"]",
      "waitingStatus": "AgentBrowserTaskStatus"
    },
    "approvalType": {
      "pending": { "decision": "hold", "autoApprove": false, "executedAction": null },
      "approved": { "decision": "execute-once", "autoApprove": false, "executedAction": "agent-browser-task-run" },
      "consumed": { "decision": "hold", "autoApprove": false, "executedAction": null },
      "rejected": { "decision": "deny", "autoApprove": false, "executedAction": null }
    },
    "waitingStatus": {
      "queued": { "waiting": false, "effectsAllowed": true },
      "running": { "waiting": false, "effectsAllowed": true },
      "waiting-approval": { "waiting": true, "effectsAllowed": false },
      "paused": { "waiting": false, "effectsAllowed": false },
      "completed": { "waiting": false, "effectsAllowed": false },
      "failed": { "waiting": false, "effectsAllowed": false },
      "cancelled": { "waiting": false, "effectsAllowed": false },
      "interrupted": { "waiting": false, "effectsAllowed": false }
    }
  }
}
```

## Validation

- `node scripts/check-error-governance.mjs` — reconciles this rule's surface
  block with `electron/main/ipc/host-contract.ts`, `src/lib/error-model.ts`,
  `shared/host-api/types.ts`, `src/lib/host-api-client.ts`,
  `electron/main/ipc/host-invoke.ts`, the decision record and this scenario.
- `node node_modules/vitest/vitest.mjs run tests/unit/error-governance-boundary.test.ts --maxWorkers=1`
  — pins the fail-closed waiting/approval decisions and the rejection of each
  deliberately broken governance axis.
- `node harness/src/cli.mjs validate --spec harness/specs/scenarios/gateway-backend-communication.md`
  — proves the rule is wired into the scenario that owns this boundary.
