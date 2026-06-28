# lane-a-backend-verification-shadow-mvp: Backend Verification Shadow MVP

## Scope Confirmation

- Lane: `lane-a-backend-verification-shadow-mvp`
- Output file: `runtime-research/handoffs/phase-5-evidence-verifier/submissions/lane-a-backend-verification-shadow-mvp.md`
- Lane-owned submission plus runtime index tracker: yes
- Phase 5 implementation paths covered: `openclaw_runtime/src/runtime-core/evidence-verifier.ts`, `openclaw_runtime/src/runtime-core/index.ts`, existing backend verifier shadow/RPC/sampling paths, and `scripts/verify-security-shadow-mvp.mjs` validation wrapper.
- Ancillary cleanup touched: `src/lib/host-events.ts` removed stale update-event facade entries already absent from `shared/host-events/contract.ts`, so the required verifier script web typecheck can pass in this dirty worktree.
- Test paths covered: `tests/unit/runtime-evidence-verifier-contracts.test.ts`, verifier shadow contract/sampling tests, Gateway `tools.invoke` regression, and `tests/unit/host-events.test.ts` for ancillary contract consistency.
- Required reading completed: `C:\Users\27933\.codex\RTK.md`, `AGENTS.md`, `openclaw_runtime/AGENTS.md`, scoped runtime `AGENTS.md` files for agents/gateway/server-methods, runtime research index/roadmap/migration/core-spec section 6, Phase 4 synthesis, Phase 2 lane-e verifier shadow, and all three Phase 5 harness task specs plus their routed rules/layers.
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-security-verification-shadow-mvp.md`
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-event-log-verification-shadow.md`
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-verification-auto-sampling-mvp.md`
  - `rtk node scripts/verify-security-shadow-mvp.mjs`
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - boundary scans for renderer IPC/Gateway bypass and second runtime services

## Executive Summary

- Backend security/verification shadow is accepted as a Phase 5 shadow verifier MVP, not as a completion gate.
- `openclaw_runtime/src/runtime-core/evidence-verifier.ts` is also accepted as the standalone deterministic evidence verifier contract surface: it defines file/test/tool/trace/human evidence kinds, completed/failed/blocked/cancelled/insufficient-evidence decisions, default-off `runtime.evidenceVerifier.shadow` / `runtime.evidenceVerifier.pilot` flags, and `legacyDecisionUnaffected: true` reports.
- `openclaw_runtime/src/security-verification-shadow/index.ts` owns bounded in-memory sanitized records, deterministic security decisions, deterministic tool-call/event-log/checkpoint verification, health levels, and additive Observability spans.
- Gateway exposes `security.*` and `verification.*` methods through existing server-method descriptors; no renderer route, direct IPC, direct Gateway HTTP/WS, or second runtime service is added.
- `verification.run` supports `tool_call`, `event_log`, and `checkpoint` subjects, rejects ambiguous event+checkpoint input, and stores only sanitized counts/ids/status/diagnostic codes.
- Runtime event-log append and checkpoint serialization can feed observe-only auto-samples when explicit shadow options or default-off runtime shadow flags enable them.
- The layer does not execute lint, typecheck, tests, shell commands, or LLM judges during runtime verification behavior.
- Existing `tools.invoke`, approval waiting, retry, error mapping, and return payload behavior remains legacy-authoritative with flags off.
- This acceptance does not authorize a default-on verifier gate, code-task completion blocking, persistence of raw evidence payloads, or failed/blocked taxonomy cutover for TaskLoop terminal status.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Shadow records are bounded, sanitized, and process-local. | file | `openclaw_runtime/src/security-verification-shadow/index.ts` | `SecurityVerificationShadowRecord` lines 116-130; `MAX_SHADOW_RECORDS` line 158; `recordSecurityVerificationShadow` lines 730-780 | Ring buffer holds summaries; request/result/event/checkpoint raw payloads are not persisted. |
| Tool-call verifier classifies tool errors as failed and missing evidence as insufficient evidence. | file | `openclaw_runtime/src/security-verification-shadow/index.ts` | `evaluateVerificationShadow` lines 501-552 | Ordinary tool `error`/`denied` maps to `failed`, not `blocked`. |
| Event-log verifier replays canonical runtime events and stores only counts/status/diagnostics. | file | `openclaw_runtime/src/security-verification-shadow/index.ts` | `evaluateRuntimeEventLogShadow` lines 554-612 | Uses `replayRuntimeTaskEvents`; no full event payload retention. |
| Checkpoint verifier deserializes runtime checkpoint snapshots and stores only summary fields. | file | `openclaw_runtime/src/security-verification-shadow/index.ts` | `evaluateRuntimeCheckpointShadow` lines 614-678 | Uses `deserializeRuntimeCheckpoint`; no raw checkpoint persistence. |
| Health levels are deterministic and summary-based. | file | `openclaw_runtime/src/security-verification-shadow/index.ts` | `resolveSecurityVerificationShadowHealthLevel` lines 243-256; `getSecurityVerificationShadowSummary` lines 826-867 | `failed` => failing; would-block/insufficient evidence => degraded; otherwise healthy. |
| Gateway exposes verification RPCs without enforcement. | file | `openclaw_runtime/src/gateway/server-methods/security-verification-shadow.ts` | `security.policy.simulate` lines 91-106; `verification.run` lines 124-160; `verification.results.list` lines 167-187 | `security.policy.simulate` returns `recorded: false`; `verification.run` records shadow summaries only. |
| Event+checkpoint ambiguity is rejected deterministically. | file/test | `openclaw_runtime/src/gateway/server-methods/security-verification-shadow.ts`; `tests/unit/security-verification-shadow-contract.test.ts` | handler lines 124-130; test lines 377-384 | RPC accepts either `events` or `checkpoint`, not both. |
| Auto-sampling is default-off, observe-only, and failure-tolerant. | file/test | `openclaw_runtime/src/runtime-core/verification-shadow-sampling.ts`; `tests/unit/runtime-verification-auto-sampling.test.ts` | emit helpers lines 88-134; tests lines 55-77 and 167-197 | Sink failures are swallowed and cannot change append/serialize results. |
| Event-log and checkpoint producers feed the sampler only through explicit shadow options. | file | `openclaw_runtime/src/runtime-core/event-log.ts`; `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts` | event append sample lines 277-281; checkpoint sample lines 191-195 | No default-on sampling or external command execution. |
| Standalone runtime evidence verifier contract defines normalized evidence kinds, decisions, finding taxonomy, and default-off flags. | file/test | `openclaw_runtime/src/runtime-core/evidence-verifier.ts`; `tests/unit/runtime-evidence-verifier-contracts.test.ts` | constants lines 18-122; feature-flag resolver lines 396-410; tests lines 25-82 | `runtime.evidenceVerifier.shadow` and `runtime.evidenceVerifier.pilot` both default false; no gate flag is accepted. |
| Standalone verifier decisions are deterministic and preserve legacy authority. | file/test | `openclaw_runtime/src/runtime-core/evidence-verifier.ts`; `tests/unit/runtime-evidence-verifier-contracts.test.ts` | `evaluateEvidenceVerifier` lines 414-455; `decideEvidenceVerifier` lines 661-674; tests lines 88-171 and 232-244 | Reports include `legacyDecisionUnaffected: true`; completed/failed/cancelled/replay-gap decisions are contract-tested. |
| Standalone verifier maps ordinary tool/test failures to `failed` and reserves `blocked` for explicit external dependency evidence. | file/test | `openclaw_runtime/src/runtime-core/evidence-verifier.ts`; `tests/unit/runtime-evidence-verifier-contracts.test.ts` | finding codes lines 65-75; failed/blocked sets lines 204-220; obligation/tool findings lines 502-600; tests lines 174-216 | `blocked_without_external_dependency` is a failed finding; `external_dependency_blocked` is the only blocked finding code. |
| Standalone verifier returns insufficient evidence for missing file/test/tool refs without running tests or tools. | file/test | `openclaw_runtime/src/runtime-core/evidence-verifier.ts`; `tests/unit/runtime-evidence-verifier-contracts.test.ts` | `findMissingEvidence` lines 550-573; `missingEvidenceCode` lines 696-707; tests lines 218-230 | It evaluates supplied evidence refs only; it does not execute external validation commands at runtime. |
| No raw prompts, secrets, full tool output, full events, or full checkpoints are retained in records. | test | `tests/unit/security-verification-shadow.test.ts`; `tests/unit/security-verification-shadow-contract.test.ts`; `tests/unit/runtime-verification-auto-sampling.test.ts` | no-raw helpers lines 96-100, 42-45, 44-47; event/checkpoint cases lines 153-200, 261-384, 55-197 | Fixtures inject `raw-prompt`, `hidden-token`, `secret-value`, and full output strings and assert absence. |
| Required end-to-end verifier script passed. | command | `rtk node scripts/verify-security-shadow-mvp.mjs` | pass: 3 harness context/validate pairs, 3 shadow test files / 24 tests, Gateway regression 1 file / 7 tests, node+web typecheck, comms replay/compare | Final rerun passed after a transient earlier typecheck failure was rechecked cleanly. |
| Required node typecheck passed independently. | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Explicit command required by Phase 5 packet. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/security-verification-shadow/index.ts` provides the deterministic shadow evaluator, in-memory bounded record buffer, sanitized tool/event/checkpoint summaries, status/summary APIs, Observability trace projection, and runtime-core sampling sink registration.
- `openclaw_runtime/src/gateway/server-methods/security-verification-shadow.ts` exposes `security.health`, `security.policy.get`, `security.policy.simulate`, `security.intercepts.list`, `verification.health`, `verification.run`, `verification.status`, `verification.results.list`, and `verification.results.get`.
- `openclaw_runtime/src/runtime-core/verification-shadow-sampling.ts` provides the observe-only sampler interface used by `RuntimeTaskEventLogStore.append(...)` and `serializeRuntimeCheckpoint(...)`.
- `openclaw_runtime/src/runtime-core/evidence-verifier.ts` provides the standalone evidence verifier contract/evaluator for supplied obligations, evidence refs, tool results, and event replay summaries.
- `openclaw_runtime/src/runtime-core/index.ts` exports the evidence verifier contract through the runtime-core barrel.
- `scripts/verify-security-shadow-mvp.mjs` runs the three harness specs, focused tests, Gateway tools.invoke regression, typechecks, and comms replay/compare.

Feature flags and defaults:

- Gateway-visible shadow enablement: `security.validationShadow.enabled` or `OPENCLAW_SECURITY_VERIFICATION_SHADOW=1`.
- Runtime auto-sampling defaults off unless explicit sampler options are passed or runtime `eventLog.shadow` / `checkpointSerializer.shadow` flags are true.
- Standalone evidence verifier flags default off at `runtime.evidenceVerifier.shadow` and `runtime.evidenceVerifier.pilot`.
- No verifier gate is default-on and no runtime behavior depends on verifier records.

Tests:

- `tests/unit/security-verification-shadow.test.ts`
- `tests/unit/security-verification-shadow-contract.test.ts`
- `tests/unit/runtime-verification-auto-sampling.test.ts`
- `tests/unit/runtime-evidence-verifier-contracts.test.ts`
- `openclaw_runtime/src/gateway/server-methods/tools-invoke-mcp-fallback.test.ts` through the verification script

Docs:

- `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` already describe the default-off security/verification shadow layer and its no-blocking/no-raw-persistence limits.

## Verifier / Evidence Surface

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Tool-call verification | `ToolCallRequest` / `ToolCallResult` -> sanitized request/result summaries | shadow-only, no active blocking | `security.validationShadow.enabled` for status; `tools.invoke` recording remains observe-only | `evaluateSecurityShadow`, `evaluateVerificationShadow`, `recordSecurityVerificationShadow`; tests lines 103-149 and 479-589 |
| Event-log verification | RuntimeTaskEvent array -> replay diagnostics and aggregate counts | shadow-only; no external command execution | manual `verification.run` or explicit/default-off sampling | `evaluateRuntimeEventLogShadow`; contract tests lines 261-309 |
| Checkpoint verification | serialized checkpoint/snapshot -> deserialize diagnostics and aggregate counts | shadow-only; no raw checkpoint persistence | manual `verification.run` or explicit/default-off sampling | `evaluateRuntimeCheckpointShadow`; contract tests lines 311-376 |
| Runtime auto-sampling | event-log append/checkpoint serialize -> registered sampler sink | observe-only; sink failures swallowed | explicit `shadow` option or runtime shadow flags | `verification-shadow-sampling.ts` lines 88-134; auto-sampling tests lines 55-197 |
| Standalone evidence verifier contract | obligations/evidence refs/tool results/event replay summary -> deterministic report | contract/shadow surface only; no TaskLoop terminal cutover | `runtime.evidenceVerifier.shadow` / `runtime.evidenceVerifier.pilot`, both default false | `evaluateEvidenceVerifier`; contract tests lines 25-244 |
| Health summary | bounded record buffer -> deterministic counts and `healthLevel` | backend-only status signal | same status path; no enforcement | `getSecurityVerificationShadowSummary`, `getSecurityVerificationShadowStatus`; tests lines 269-292 and 111-121 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| `tools.invoke` execution and response shape | Legacy execution remains authoritative; shadow records do not alter result/approval/retry/error mapping. | `rtk node scripts/verify-security-shadow-mvp.mjs` passed Gateway tools.invoke regression, 1 file / 7 tests. | Low for shadow mode; future active interceptor needs a fresh spec. |
| Renderer/Main/Gateway transport ownership | Renderer still uses typed host-api/api-client; no Phase 5 renderer direct IPC or direct Gateway HTTP/WS. | Focused `src/pages src/components` boundary scan returned no matches. | Low; Gateway methods are backend-only. |
| Runtime event-log/checkpoint append/serialize return shapes | Sampling is optional and errors are swallowed. | `tests/unit/runtime-verification-auto-sampling.test.ts` lines 167-197. | Low; do not make sampling a completion gate without a new task spec. |
| Runtime-core evidence verifier reports | Evaluator returns a report from supplied summaries and marks `legacyDecisionUnaffected: true`; no TaskLoop/Gateway path consumes it as an authority. | `openclaw_runtime/src/runtime-core/evidence-verifier.ts` lines 414-455; `tests/unit/runtime-evidence-verifier-contracts.test.ts` lines 88-111 and 232-244. | Low for contract-only use; future TaskLoop adapter must be separately specced. |
| TaskLoop completion status | Existing TaskLoop gates and terminal taxonomy remain unchanged. | No TaskLoop code was changed in this lane; Phase 2 verifier shadow remains warning-only. | Medium; future Phase 5 completion gate must resolve failed-vs-blocked taxonomy explicitly. |

## Replay / Idempotency Audit

| Replay Focus | Result | Evidence | Gap |
|---|---|---|---|
| No side-effect tool re-execution | pass | Event-log/checkpoint verifier only calls replay/deserialization helpers; no executor/tool/Gateway transport references in focused service scan. | This lane validates shadow records, not resume authority cutover. |
| Completed tool results reused by idempotency key | not-run | Covered by Phase 4 resume shadow, not this verifier lane. | Future verifier gate should consume idempotency evidence but not own replay cutover. |
| Missing tool result returns waiting/verifying diagnostic | not-run | Covered by Phase 4 resume shadow. | This lane maps missing tool-call result to `insufficient_evidence`, not TaskLoop waiting state. |
| Schema/version marker handled | pass | Event-log and checkpoint diagnostics covered by `runtime-event-log-store.test.ts`, `runtime-checkpoint-serializer.test.ts`, and verifier tests lines 201-238. | None for shadow validation. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Security shadow harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-security-verification-shadow-mvp.md` | pass | Required reading/routing for base tool-call shadow MVP. | None. |
| Event-log verification harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-event-log-verification-shadow.md` | pass | Required reading/routing for event/checkpoint verifier shadow. | None. |
| Auto-sampling harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-verification-auto-sampling-mvp.md` | pass | Required reading/routing for default-off auto-sampling MVP. | None. |
| Runtime evidence verifier contract tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-evidence-verifier-contracts.test.ts` | pass | Standalone file/test/tool/trace evidence taxonomy, default-off flags, failed-vs-blocked semantics, immutability, legacy unaffected marker. | Contract-only; does not enable a completion gate. |
| Host-events contract consistency check | `rtk node node_modules/vitest/vitest.mjs run tests/unit/host-events.test.ts`; `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json --composite false` | pass | Confirms stale update-event facade removal matches the already-updated host-event contract and keeps required web typecheck green. | Ancillary cleanup only; unrelated to verifier runtime behavior. |
| Combined verifier script | `rtk node scripts/verify-security-shadow-mvp.mjs` | pass | Harness validate for all three specs, focused verifier tests, Gateway regression, node/web typecheck, comms replay/compare. | None. |
| Required node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime/electron TypeScript surfaces. | None. |
| README doc sync review | `rtk node -e "<README term scan>"` over `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` | pass | English/Chinese/Japanese README coverage for default-off shadow layer. | Russian README not in required docs list for these task specs. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on verifier gate | pass | Shadow status/records only; `security.policy.get` reports `enforcement: "observe-only"`, tests cover `recorded: false` for simulate, and standalone `DEFAULT_EVIDENCE_VERIFIER_FEATURE_FLAGS` is `{ shadow: false, pilot: false }`. |
| No renderer direct IPC | pass | Focused scan over `src/pages src/components` for `window.electron.ipcRenderer.invoke` / `ipcRenderer.invoke(` returned no matches. |
| No renderer direct Gateway HTTP/WS | pass | Focused scan over `src/pages src/components` for `127.0.0.1:18789`, `localhost:18789`, and `new WebSocket(` returned no matches. |
| No second runtime service/listener/Gateway/Temporal | pass | Focused scan over Phase 5 runtime/security/gateway/test/script paths for server/listener/WebSocketServer/GatewayManager/Temporal patterns returned no matches. |
| No external test/lint/typecheck execution inside runtime verifier behavior | pass | Runtime verifier code calls deterministic evaluators/replay/deserialization only; standalone `evaluateEvidenceVerifier` evaluates supplied evidence summaries only; external commands appear only in `scripts/verify-security-shadow-mvp.mjs`. |
| No LLM judge | pass | Search/read of verifier paths found deterministic code only; `security.policy.get` reports `llmJudge: false`. |
| No raw prompts/full payload persistence | pass | Sanitization tests assert absence of `raw-prompt`, `hidden-token`, `secret-value`, and `complete tool output`. |
| Flag-off parity covered | pass | Auto-sampling tests line 55 prove event-log/checkpoint sampling records nothing by default; verifier script covers tools.invoke regression. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Phase 5 target verifier eventually wants completion evidence gates, but current implementation is observe-only. | `security.policy.get` returns `enforcement: "observe-only"`; Phase 4 synthesis says verification sampling is not a completion gate. | No default-on verifier gate in this phase. | Accept this lane only as shadow verifier MVP; require a fresh task spec before any blocking completion behavior. |
| TaskLoop legacy blocked/failed taxonomy is not changed here. | Phase 2 verifier shadow notes active TaskLoop gate/taxonomy remains legacy; standalone verifier tests cover the target taxonomy without TaskLoop cutover. | `blocked` should mean external dependency in target verifier taxonomy. | Future TaskLoop adapter must define failed-vs-blocked cutover tests before affecting terminal status. |
| Auto-sampling can make backend health degraded/failing but must not influence runtime behavior. | `verification-shadow-sampling.ts` swallows sink failures; tests assert append/serialize shapes stay unchanged. | Health signal only until accepted gate rollout. | Keep health summaries backend-only and non-gating. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Code-task evidence verifier TaskLoop adapter spec
New code path: approved TaskLoop adapter that consumes openclaw_runtime/src/runtime-core/evidence-verifier.ts reports
Legacy path wrapped: TaskLoop evidence gate and security-verification shadow records as inputs only
Shadow / pilot boundary: warning-only first; no default-on gate
Feature flag: runtime.evidenceVerifier.shadow or a narrower future code-task pilot flag
Tests: TaskLoop legacy payload parity; file/test/tool/trace evidence refs; patch-without-test fails verifier taxonomy; tool error failed; blocked only with external dependency
Harness: new Phase 5 completion-gate task spec before implementation
Rollback: disable new gate flag; keep shadow records
Done when: verifier decisions are traceable to evidence refs and legacy TaskLoop payloads stay unchanged with flags off
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Which runtime owner should feed real file/test evidence into a future gate? | The current shadow validates supplied summaries; it does not collect test command evidence itself. | maintainer | yes before gate rollout |
| Should Gateway `security.*`/`verification.*` records become a dashboard input? | Health levels are already deterministic but not user-visible. | maintainer/product | no |
| When can TaskLoop terminal taxonomy change from legacy `blocked` uses to target failed/external-blocked semantics? | This is required before enforcing completion status. | maintainer | yes before completion gate |

## Handoff Notes

- This lane accepts the backend-only, deterministic, sanitized verification shadow MVP and the standalone runtime-core evidence verifier contract/evaluator.
- This lane does not accept a blocking verifier gate, default-on auto-sampling, raw evidence persistence, new runtime service, renderer transport ownership, or TaskLoop terminal-status cutover.
- `src/lib/host-events.ts` was adjusted only to align with the existing removal of `updates` host events from `shared/host-events/contract.ts`; it is not a Phase 5 verifier behavior change.
- The full verifier script and independent node typecheck passed using `C:\Users\27933\.cherrystudio\bin\rtk.exe` because plain `rtk` is not on PATH.
- PowerShell emits an unrelated `starship` profile warning on every shell invocation; it did not affect command results.
