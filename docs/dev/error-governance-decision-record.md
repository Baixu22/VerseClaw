# Error and problem governance: decision record (GitHub issue #115)

- Status: the attached draft is converted into explicit decisions. Nothing here is
  a product lock, a default change or a release claim.
- driven_by: agent; actor: automated agent. Every step below is executed, verified
  and re-runnable by automation. No real-human evidence is claimed anywhere in
  this record.
- Tree: branch `codex/p2-issues-batch4-20261010`, based on `origin/main` 15f0327b5.
- Rule: `harness/specs/rules/error-governance-boundary.md`
- Scenario: `harness/specs/scenarios/gateway-backend-communication.md`
- Executable check: `node scripts/check-error-governance.mjs`
- Tests: `tests/unit/error-governance-boundary.test.ts`

## 0. How to read this record

Every item carries exactly one state:

- **existing (已有)** — already true in this tree. The record pins it and adds it
  to the machine-readable surface so it cannot drift silently.
- **gap (缺口)** — a verified inconsistency between the draft, the policy text and
  the shipped code. Declared with a real evidence path and an executable probe.
- **proposal (提案)** — a decision this record makes, together with the automated
  check that enforces it.

Two conventions make the record checkable rather than aspirational:

1. A repository path written in `backticks` is a claim that the path resolves.
   `node scripts/check-error-governance.mjs` fails with
   `error-governance.missing-reference` when it does not. Files this tree does
   **not** contain are therefore written as plain text on purpose.
2. Every gap is declared in the surface block of
   `harness/specs/rules/error-governance-boundary.md` together with a probe.
   A probe that stops reproducing fails the check
   (`error-governance.stale-declared-gap`), so a fixed gap cannot leave a stale
   claim behind.

## 1. Envelope and error type: reuse, no third envelope

**Decision.** `HostResponse` and the existing host-api envelope are reused, and
`AppError` is reused. No third envelope is created, and no parallel error
taxonomy is introduced. This is the direct answer to the draft's proposal to add
another envelope and another error table.

| Item | State | Current evidence |
| --- | --- | --- |
| The host-api request/response envelope exists with `id`, `ok`, `data`/`error` | existing | `shared/host-api/types.ts` declares `HostRequest`, `TypedHostRequest` and `HostResponse` |
| Main answers with the same envelope and echoes the request id on every branch | existing | `electron/main/ipc/host-invoke.ts` (`dispatchHostRequest`) returns `{ id, ok: false, error: { code, message } }` for sender/auth, format, dangerous-key, payload, unsupported, timeout and internal failures, and `{ id, ok: true, data }` on success; `electron/preload/index.ts` exposes `hostInvoke` over `host:invoke` |
| The envelope type is declared twice and can drift | gap (duplicate-host-response-copies) | `shared/host-api/types.ts` makes `id`, `error`, `code` and `message` optional; `electron/main/ipc/host-contract.ts` makes `error.code` and `error.message` required. Both are named `HostResponse` |
| The renderer surfaces the Main error code and details | existing | `src/lib/host-api-client.ts` (`invokeHost`) maps `response.error.code` through `mapBackendErrorCode`, preserves `response.id` as `AppError.requestId`, and carries structured `details` into `src/lib/error-model.ts`; bridge rejection and renderer timeout are recorded on the same request id |
| The Main-process duplicate `AppErrorCode` union is gone | existing | the former request-helper copy was removed with the flat IPC surface; the renderer keeps its closed `AppErrorCode` in `src/lib/error-model.ts`, and Main answers with `HostErrorCode` from `electron/main/ipc/host-contract.ts` |
| One declared surface block, one envelope symbol, one allowed error-type list | proposal | `node scripts/check-error-governance.mjs` checks `error-envelope-reused`: a declared envelope that is not `HostResponse`, a symbol that no owner file declares, or an `allowedErrorTypes` list other than `AppError` plus `HostErrorCode` fails with `error-governance.parallel-envelope` / `error-governance.parallel-error-type` |

Consequence for future work: unifying the two `HostResponse` declarations is
allowed, but it must be done **in place** — the renderer keeps consuming the same
envelope, and `AppError` stays the renderer taxonomy. The former Main-process
`AppErrorCode` copy has already been removed with the flat IPC surface. Adding a
third name is the failure this record exists to prevent.

A domain-specific internal carrier is different from a third renderer taxonomy.
`shared/sandbox/errors.ts` adds `SandboxDenialError` so a real sandbox/gate
refusal can carry `mechanism`, `path` and `operation`. Its stable code is
`SANDBOX_DENIED`; `src/lib/error-model.ts` maps that code to `PERMISSION`, and
`electron/main/ipc/host-invoke.ts` preserves the whitelisted diagnostic fields in
the existing `HostResponse` details. Browser/cron gate refusals throw the typed
error; terminal/gateway keep their result-shaped contracts and expose the same
fields as `sandboxDenial` on a blocked result. This is an internal carrier, not a
new host envelope or renderer error class.

## 2. Transport: typed IPC to Main, no transport revival

**Decision.** The actual transport stays what it is today. The draft's claim that
the product is still on a `WS -> HTTP -> IPC` fallback chain is stale and must not
be reintroduced into policy text.

| Item | State | Current evidence |
| --- | --- | --- |
| Renderer talks to Main through typed IPC; Main owns the Gateway WebSocket | existing | `harness/specs/rules/api-client-transport-policy.md` ("Gateway RPC transport is IPC-only"), `harness/specs/rules/host-api-fallback-policy.md` (typed `hostApi` facade plus `host:invoke`; the local Host API HTTP server on 127.0.0.1:13210 and the browser fallback are removed), `electron/preload/index.ts` |
| The scenario's allowed-flow line named a renderer client that does not exist | gap, corrected in this change set | the scenario claimed the flow passes through src/lib/host-api-client.ts (absent in this tree). The line now names `src/lib/host-api.ts` and `src/lib/host-api-client.ts`. Older policy text elsewhere still names the absent file; `docs/architecture-overview.md` already records that fact, and the remaining occurrences are out of this issue's scope |

## 3. Error classes and the missing mapping

**Decision.** The stable code for each layer is the layer's own closed set: Main
surfaces `HostErrorCode`, the renderer classifies into the closed `APP_ERROR_CODES`
set. Every Main code is either mapped, or declared as a known gap with a reason.
There is no wildcard row, no "default" mapping and no silent success substitution.

| Main code | Declared renderer class | State |
| --- | --- | --- |
| `VALIDATION` | `CONFIG` | existing |
| `UNSUPPORTED` | `CHANNEL_UNAVAILABLE` | existing |
| `TIMEOUT` | `TIMEOUT` | existing |
| `INTERNAL` | `UNKNOWN` | gap: declared as `internal-has-no-dedicated-renderer-class` |

Evidence for the real classifier: `src/lib/error-model.ts` declares `AppError`,
the closed `AppErrorCode` union, the runtime `APP_ERROR_CODES` list, the
`CODE_SIGNALS` and `STATUS_SIGNALS` tables, `mapBackendErrorCode`,
`readErrorSignals` and `normalizeAppError`. It has no `CODE_SIGNALS` entry for
`INTERNAL`, so an unclassified Main failure renders as `UNKNOWN`. User-facing copy
and the copyable error reference already exist in `src/lib/error-message.ts`
(`getErrorCopy`, `toUserMessage`, `ErrorActionKind`) and `src/lib/user-error.ts`
(`describeUserError`, `makeErrorId`, `toastUserError`); the draft's claim that the
renderer has no error model is stale.

Executable enforcement: `host-error-code-mapping-complete` fails with
`error-governance.missing-error-mapping` when a real `HostErrorCode` has no row;
`error-mapping-matches-classifier` fails with
`error-governance.error-mapping-drift`, `error-governance.undeclared-unknown-mapping`
or `error-governance.out-of-range-error-surface` when the declaration disagrees
with `src/lib/error-model.ts` or leaves the closed class set.

Closing `internal-has-no-dedicated-renderer-class` means adding a renderer class
and copy for `INTERNAL`. That is a renderer feature change with locale coverage
implications, so it is deliberately **not** done by this documentation/governance
change; the gap is declared instead, and the check will fail if the declaration
goes stale.

## 4. Waiting and approval types stay fail-closed

**Decision.** An approval type or waiting status that the declared taxonomy does
not recognize is held: no auto-approval, no executed action. A recognized approval
type is processed per its declared schema. Automation never grants an approval on
its own behalf.

| Item | State | Current evidence |
| --- | --- | --- |
| The real waiting/approval unions exist and are typed | existing | `shared/host-api/contract.ts` declares `AgentBrowserTaskStatus` (8 members) and `AgentBrowserTaskApproval` with `status: 'pending' \| 'approved' \| 'consumed' \| 'rejected'` |
| Approval is a real gate that cannot widen scope | existing | `harness/specs/rules/agent-browser-supervised-task-boundary.md` R1/R2; `packages/versebrowser/src/engine/task-service.ts` (embedded module) only leaves `waiting-approval` through `approve`/`reject`, and `run` requires an unused `approved` approval |
| A declared per-type decision table with `autoApprove: false` for every type | proposal | the `waitingTypes` block of `harness/specs/rules/error-governance-boundary.md`; `no-auto-approval` fails with `error-governance.auto-approval-declared`, `error-governance.executed-action-without-decision` or `error-governance.effects-during-wait` |
| Taxonomy coverage of the real unions | proposal | `waiting-type-coverage` fails with `error-governance.missing-waiting-type` when a real union member has no decision, and with `error-governance.unknown-waiting-type` when a declared member does not exist. A new status added to the contract therefore fails the check until it has a decision |
| Runtime fail-closed behaviour | proposal | `resolveWaitingDecision` returns `{ recognized: false, decision: 'hold', autoApprove: false, executedAction: null }` for an unknown approval type, an unknown waiting status, a non-string or a missing field. `tests/unit/error-governance-boundary.test.ts` pins that result, pins the known-type schema handling, and includes a deliberately failing fixture |

## 5. Disambiguation: identifiers

**Decision.** The local correlation id and the provider-side request id are
different identifiers with different lifetimes and different privacy properties.
They must not be mixed, substituted for each other, or presented to a user as the
same value.

| Identifier | State | Owner and rule |
| --- | --- | --- |
| Local correlation id | existing (with a declared gap) | generated by `createRequestId` in `src/lib/host-api-client.ts` as `HostRequest.id`, echoed by Main as `HostResponse.id` in `electron/main/ipc/host-invoke.ts`. The envelope type still makes `id` optional, so "every legal request returns a correlation id" is a behaviour, not a type guarantee. `request-id-attribution` fails if either side drops it |
| Provider request id | existing | carried on provider failures in `openclaw_runtime/src/agents/provider-http-errors.ts` (`requestId`, rendered as `[request_id=...]`) and treated as a redactable log key in `openclaw_runtime/src/logging/diagnostic-support-log-redaction.ts`. It is provider-owned, so it must be treated as provider data |
| Stability of code/type per layer | existing | Main codes are the closed `HostErrorCode` set; renderer classes are the closed `APP_ERROR_CODES` set. The renderer class is a stable product-facing class; the raw provider token is not, and only feeds `CODE_SIGNALS` / `STATUS_SIGNALS` in `src/lib/error-model.ts` |

The draft's `requestId` requirement (cited there as DEC-21) cannot be checked
against this tree: no DEC-21 identifier exists anywhere in the repository. The
requirement is therefore restated here in terms of the two real identifiers above.

## 6. Disambiguation: recoverability, replay, switching, retry, cooldown

**Decision.** These five situations are distinct and must not be collapsed into a
single "retryable" flag or into one billing rule.

| Situation | Meaning | State / evidence |
| --- | --- | --- |
| Recoverability | whether the class is recoverable at all, and which affordance the UI offers | existing: `src/lib/error-message.ts` (`getErrorCopy`, `ErrorActionKind`) and `retryable`/`action` in `src/lib/user-error.ts` |
| Replay safety of the same operation | whether repeating the identical request is safe | proposal: decided per operation, never by error class alone. No new taxonomy is introduced; callers must not treat `RATE_LIMIT` or `BILLING` as blanket replay permission |
| Profile or model switch | moving the same logical request to another auth profile or model | existing: `openclaw_runtime/src/agents/failover-error.ts` (`FailoverError.reason`, `resolveFailoverStatus`, `coerceToFailoverError`) |
| Post-fix retry | retrying after the cause was actually changed (key rotated, quota raised, config fixed) | proposal: allowed, and deliberately not modelled as a cooldown probe. `shouldPreserveTransientCooldownProbeSlot` in `openclaw_runtime/src/agents/failover-policy.ts` keeps transient probe budget intact for `model_not_found`, `format`, `auth`, `auth_permanent` and `session_expired` |
| Cooldown probing | a scheduled, non-user-initiated probe of a cooling-down profile | existing: `openclaw_runtime/src/agents/failover-policy.ts` (`shouldAllowCooldownProbeForReason`, `shouldUseTransientCooldownProbeSlot`) |

The draft's "billing must not be retried" is therefore **not** adopted as written.
The tree allows a billing profile to be probed during cooldown
(`shouldAllowCooldownProbeForReason` includes `billing`) while a billing failure
does not consume a transient probe slot
(`shouldUseTransientCooldownProbeSlot` excludes `billing`). That is a deliberate
distinction between "may be probed" and "may spend the transient budget", and this
record keeps it instead of flattening it.

## 7. Disambiguation: normal refusal versus thrown FailoverError

**Decision.** A refusal the runtime can answer normally is returned as a normal
result. A `FailoverError` is thrown only when the failure is a provider/model
failure that carries failover metadata, and local runtime coordination failures
abort the fallback chain instead of consuming candidate slots.

| Case | State | Evidence |
| --- | --- | --- |
| Thrown failover failure | existing | `openclaw_runtime/src/agents/failover-error.ts` (`FailoverError`, `isFailoverError`, `resolveFailoverReasonFromError`, `coerceToFailoverError`) |
| Unclassifiable refusal | existing | `coerceToFailoverError` returns `null` when no failover reason resolves, so the caller keeps its own result instead of manufacturing a `FailoverError` |
| Local coordination failure | existing | `isNonProviderRuntimeCoordinationError` marks session-write-lock contention and embedded-attempt takeover as non-provider failures; the fallback chain must abort rather than retry another model |
| Operator-facing remediation | existing | `buildFailoverRemediationHint` only produces a re-authentication command for `auth` / `auth_permanent` |

No new failover error class is introduced by this record: a refusal stays a
normal return value, and `FailoverError` stays the only thrown failover carrier.

## 8. Versioning and deprecation windows

**Decision.** A version identifier or a deprecation window is declared **only**
for a contract that has an independent consumer outside the same release: the
host-api envelope and the provider-facing runtime surfaces. For contracts that are
only consumed by the renderer and Main inside one package, this record declares no
dual-stack window and no two-minor deprecation period, because there is no
independent consumer to protect.

| Item | State | Note |
| --- | --- | --- |
| Versioned/consumer-facing surfaces | existing, unchanged | the host-api envelope and the OpenClaw runtime surfaces keep their existing stability expectations |
| Renderer/Main-internal contract versioning | proposal: not added | adding a two-minor dual stack for `HostResponse` or `AppError` would contradict section 1 (reuse in place) and would create the drift this issue is about |
| Service-level and rate-limit defaults | proposal: not decided here | no rate limit, quota or product default is declared, changed or frozen by this record |

## 9. Human prerequisites removed

**Decision.** No node, rule, scenario, task spec or acceptance criterion may require a human verdict, human data or a human UI step.

Any step that would otherwise need a person is implemented as an automated, agent-driven equivalent and labelled `driven_by: agent`.

| Item | State | Evidence |
| --- | --- | --- |
| Repository owner policy: no human-operated prerequisite | existing | `harness/specs/rules/task-forest-autoclose-and-roles.md` and the repository `AGENTS.md` human-in-the-loop policy |
| The draft's rule 7 wording ("for a human decision; automation must not approve it") | gap, rejected | that wording contradicts the owner policy above. The replacement is automated: `resolveWaitingDecision` holds the request, records the decision and executes nothing |
| Enforcement | proposal | `no-human-prerequisite` scans the rule, this record and the scenario line by line and fails with `error-governance.human-prerequisite`; `agent-driven-labelling` fails with `error-governance.missing-agent-driven-label` when the `driven_by: agent` label is removed |
| Claiming real-human evidence | existing prohibition | automated evidence must never be described as real-human evidence. Nothing in this change is claimed as a real-human review, verdict or test |

Line-level negation is intentional: these artifacts must be able to *forbid* a
human prerequisite. A line that mentions such a prerequisite together with its
negation is compliant; a line that makes it a requirement fails.

## 10. Explicitly not decided here

- No product lock, default value, rate limit or quota is changed or frozen. In
  particular, the draft's "100 RPM" suggestion is **not** adopted: the string does
  not occur anywhere in this tree, and adopting a limit is a product decision with
  its own record.
- The renderer correlation gap (`renderer-drops-host-error-code`) is closed by
  the P1 host error-boundary change set: `invokeHost` preserves the Main error
  code, structured details and request id, and the governance surface no longer
  declares that defect. The former duplicate Main-process `AppErrorCode` union
  was removed with the flat IPC surface, so the only remaining code-level gap is
  `duplicate-host-response-copies`, which is declared and probed here.
- No third host envelope and no second machine-readable surface list is created.
  A domain-specific internal carrier such as `SandboxDenialError` must map into
  the existing `AppError` taxonomy; the surface block in the rule remains a
  declaration of what exists and is reconciled with the real sources by the check.
- The draft document itself is not in this tree: docs/governance/manus-alignment-error-problem-openness.zh-CN.md
  is absent, so nothing in it is treated as an effective specification.

## 11. Verification

- `node scripts/check-error-governance.mjs` — reconciles this record, the rule,
  the scenario and the surface block with `shared/host-api/types.ts`,
  `electron/main/ipc/host-contract.ts`, `shared/host-api/contract.ts`,
  `electron/main/ipc/host-invoke.ts`, `src/lib/host-api-client.ts` and
  `src/lib/error-model.ts`. Fails closed on a missing input.
- `node node_modules/vitest/vitest.mjs run tests/unit/error-governance-boundary.test.ts --maxWorkers=1`
  — pins the fail-closed waiting decisions and rejection of each deliberately
  broken governance axis, including a failing fixture.
- `node harness/src/cli.mjs validate --spec harness/specs/scenarios/gateway-backend-communication.md`
  — proves the rule is wired into the scenario.
- `node harness/src/cli.mjs validate --spec harness/specs/rules/error-governance-boundary.md`
  — structural validation of the rule itself.
