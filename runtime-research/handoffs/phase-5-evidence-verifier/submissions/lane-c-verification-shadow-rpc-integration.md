# lane-c-verification-shadow-rpc-integration: Verification Shadow RPC Integration

## Scope Confirmation

- Lane: `lane-c-verification-shadow-rpc-integration`
- Output file: `runtime-research/handoffs/phase-5-evidence-verifier/submissions/lane-c-verification-shadow-rpc-integration.md`
- Lane-owned file only: yes for this submission; implementation stayed within the requested backend verifier/RPC/test surface.
- Implementation paths touched:
  - `openclaw_runtime/src/security-verification-shadow/index.ts`
  - `openclaw_runtime/src/gateway/server-methods/security-verification-shadow.ts`
- Test paths touched:
  - `tests/unit/security-verification-shadow.test.ts`
  - `tests/unit/security-verification-shadow-contract.test.ts`
- Validation wrapper touched: no; `scripts/verify-security-shadow-mvp.mjs` already included the focused verifier/RPC tests updated here.
- Required reading completed: root `AGENTS.md`, `openclaw_runtime/AGENTS.md`, scoped Gateway `AGENTS.md`, Phase 5 handoff README/template, and `harness/specs/tasks/phase-5-evidence-verifier.md` context.

## Executive Summary

- Integrated the canonical Evidence Verifier decision model into the backend-only `verification.run` RPC path.
- `verification.run` now accepts optional `evidenceVerifier` or `verifier` input for existing `tool_call`, `event_log`, and `checkpoint` subjects.
- Shadow records store only a compact `evidenceVerifier` summary: decision, finding count, evidence-ref count, required evidence kinds, finding codes/categories, and `legacyDecisionUnaffected`.
- Raw objectives, full findings, finding messages, metadata, evidence refs, tool args, event payloads, checkpoints, and tool output are not retained in records or RPC list/get responses.
- `verification.results.list` and `security.intercepts.list` can filter by `verifierDecision` / `evidenceVerifierDecision`; existing `decision` continues to mean security decision for compatibility.
- Summary/status now include `evidenceVerifierDecisionCounts` and evidence verifier finding counts; health remains deterministic and observe-only.
- No active blocking, no UI, no renderer transport changes, no second service, no LLM judge, and no runtime external command execution were introduced.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Records have a sanitized canonical verifier decision summary. | file | `openclaw_runtime/src/security-verification-shadow/index.ts` | `EvidenceVerifierDecisionSummary` lines 61-69; `summarizeEvidenceVerifierDecision` line 368 | Stores only counts, codes, categories, required kinds, and decision. |
| `recordSecurityVerificationShadow` accepts optional verifier input without changing existing subject selection. | file | same | `recordSecurityVerificationShadow` line 785; summary attachment line 816 | Existing `tool_call` / `event_log` / `checkpoint` subject behavior stays intact. |
| Summary/status count verifier decisions and deterministic health can include verifier failures/degraded states. | file | same | `resolveSecurityVerificationShadowHealthLevel` line 271; `getSecurityVerificationShadowSummary` line 887; status line 953 | Adds counts; still observe-only. |
| Records can be filtered by canonical verifier decision. | file | same | `SecurityVerificationShadowRecordFilter` lines 148-154; `getSecurityVerificationShadowRecords` line 865 | `verifierDecision` is separate from security decision. |
| Gateway RPC accepts verifier input and returns verifier summaries. | file | `openclaw_runtime/src/gateway/server-methods/security-verification-shadow.ts` | `readEvidenceVerifierInput` line 63; `verificationRunResponse` line 92; `verification.run` line 160 | Supports `evidenceVerifier` and `verifier`. |
| Gateway list filters include verifier decision without breaking legacy security `decision`. | file | same | `readEvidenceVerifierDecision` line 56; filter mapping lines 79-80 | `decision` remains security decision; `verifierDecision` / `evidenceVerifierDecision` are canonical verifier filters. |
| RPC list output includes sanitized verifier summaries. | file | same | list mapping line 223 | Returned records expose the same compact summary. |
| Sanitized records include verifier decisions and exclude sensitive raw payloads. | test | `tests/unit/security-verification-shadow.test.ts` | `stores sanitized canonical evidence verifier decision summaries` line 202 | Injects raw/sensitive strings and asserts absence. |
| Existing simulate -> run -> list/filter -> get -> intercepts -> status flow remains stable with verifier summaries. | test | `tests/unit/security-verification-shadow-contract.test.ts` | regression fixture line 54; verifier payload line 128; verifier filters lines 214 and 261 | Covers flow plus runId/source/status/security decision/verifier decision filtering. |
| Required verifier script passed. | command | `rtk node scripts/verify-security-shadow-mvp.mjs` | pass | Harness context/validate for 3 specs, 25 verifier tests, Gateway regression 7 tests, node/web typecheck, comms replay/compare. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/security-verification-shadow/index.ts` imports `evaluateEvidenceVerifier` and evaluates it only when caller-supplied verifier input is present.
- The stored `evidenceVerifier` field is a sanitized summary, not a report clone.
- `getSecurityVerificationShadowSummary()` returns `evidenceVerifierDecisionCounts` with all canonical decisions initialized to zero.
- `getSecurityVerificationShadowRecords()` supports `verifierDecision` filtering.
- `openclaw_runtime/src/gateway/server-methods/security-verification-shadow.ts` wires optional verifier input into all three `verification.run` subject paths and returns the summary beside the existing `result` and `record`.

Tests:

- `tests/unit/security-verification-shadow.test.ts` covers direct record sanitization and zero initialized verifier decision counts.
- `tests/unit/security-verification-shadow-contract.test.ts` covers the full RPC flow, verifier summary in run/list/get/intercepts/status payloads, and verifier-decision filtering.

Harness/spec changes:

- No task spec or verification script changes were required; the existing script already runs the updated focused tests.

## Verifier Contract Surface

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| `verification.run` verifier input | Optional `evidenceVerifier` / `verifier` payload evaluated by `evaluateEvidenceVerifier()` | shadow-only; no blocking | existing backend shadow surface | Gateway handler lines 160-199 |
| Stored verifier summary | `EvidenceVerifierReport` -> `EvidenceVerifierDecisionSummary` | sanitized in-memory ring buffer only | none added | sanitizer line 368; record line 816 |
| List/get/intercepts output | record summary passthrough | read-only operator RPC | none added | list mapping line 223 |
| Summary/status counts | `evidenceVerifierDecisionCounts` and finding count | observe-only health signal | none added | summary lines 887-936; status line 953 |
| Filtering | `verifierDecision` / `evidenceVerifierDecision` | read-only filter | none added | Gateway filter lines 79-80; record filter line 872 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion | Unchanged; no TaskLoop code touched. | No TaskLoop paths changed; verifier reports stay shadow/RPC summaries. | Low. |
| `tools.invoke` | Legacy execution and response shape remain authoritative. | `rtk node scripts/verify-security-shadow-mvp.mjs` passed Gateway tools.invoke regression, 1 file / 7 tests. | Low. |
| Existing `verification.run` subjects | `tool_call`, `event_log`, and `checkpoint` remain compatible. | `tests/unit/security-verification-shadow-contract.test.ts` line 261 covers event/checkpoint RPC subjects. | Low. |
| Existing security decision filter | `decision` still maps to `securityDecision`; canonical verifier uses `verifierDecision`. | Gateway filter mapping lines 60-65 and 79-80. | Low. |

## Taxonomy Audit

| Taxonomy Focus | Result | Evidence | Gap |
|---|---|---|---|
| Completed requires evidence refs | pass | Existing `evaluateEvidenceVerifier()` contract plus RPC fixture completed summary line 189. | RPC stores summary only. |
| Tool/test failures become failed | pass | RPC fixture failed verifier summary lines 128-156. | No active gate. |
| Blocked requires external dependency | pass | Direct record test line 202 uses external dependency and stores `blocked`; canonical evaluator owns the taxonomy. | No TaskLoop cutover. |
| Missing evidence becomes insufficient evidence | pass | Summary finding codes include missing file/test/tool at lines 132-135. | No active gate. |
| Cancelled remains distinct | pass | Summary counts initialize `cancelled`; canonical evaluator tests cover cancelled decision. | Not separately exercised through RPC in Lane C. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Phase 5 umbrella context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass | Required reading/routing. | None. |
| Phase 5 umbrella validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass | Task spec validity. | None. |
| Focused verifier/RPC tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/security-verification-shadow.test.ts tests/unit/security-verification-shadow-contract.test.ts tests/unit/runtime-verification-auto-sampling.test.ts` | pass, 3 files / 25 tests | Sanitization, flow, filters, status, auto-sampling compatibility. | None. |
| Required full verifier script | `rtk node scripts/verify-security-shadow-mvp.mjs` | pass | Harness context/validate, focused tests, Gateway regression, node/web typecheck, comms replay/compare. | None. |
| Required node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime/electron TypeScript surfaces. | None. |
| Renderer boundary scan | Node scan for direct IPC/Gateway patterns in `src/pages` and `src/components` | pass/no matches | No renderer bypass. | None. |
| Second-service scan | Node scan for server/listener/WebSocket/Temporal patterns in Lane C paths | pass/no matches | No second service/listener. | None. |
| Runtime LLM/external command scan | Node scan for LLM/judge/spawn/vitest/eslint/tsc/pnpm patterns in Lane C runtime paths | pass/no matches | No LLM judge or runtime external validation. | None. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on verifier gate | pass | Only optional RPC summary input; no TaskLoop/gate path touched. |
| No second runtime service | pass | Focused scan found no service/listener patterns in Lane C paths. |
| No renderer direct IPC | pass | Focused scan found no matches in `src/pages` / `src/components`. |
| No renderer direct Gateway HTTP/WS | pass | Focused scan found no localhost Gateway/WebSocket patterns in `src/pages` / `src/components`. |
| No external test/lint/typecheck execution inside verifier runtime behavior | pass | Runtime code only calls deterministic `evaluateEvidenceVerifier()` and summarizer. |
| No LLM judge | pass | Runtime scan found no LLM/judge patterns. |
| Raw data retention ban | pass | Tests inject raw/sensitive strings and assert absence from record/RPC payloads. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Existing RPC already used `decision` for security policy. | `readRecordFilters()` keeps `decision` mapped to `securityDecision`. | Add verifier-decision filtering without breaking existing callers. | Use explicit `verifierDecision` / `evidenceVerifierDecision` for canonical verifier decisions. |
| Canonical verifier report contains richer details than RPC records may safely retain. | Stored summary excludes objective, messages, metadata, and full refs. | Preserve operator usefulness while enforcing raw retention ban. | Keep compact summary; future dashboard/details require a fresh sanitized schema. |
| Health can now reflect verifier decision summaries. | `resolveSecurityVerificationShadowHealthLevel()` includes optional verifier counts. | Deterministic observe-only health, no blocking. | Treat failed as failing and blocked/cancelled/insufficient evidence as degraded; no gate behavior. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Evidence collector to RPC adapter
New code path: sanitized collector output feeding verification.run evidenceVerifier input
Legacy path wrapped: none; keep verifier RPC observe-only
Shadow / pilot boundary: shadow-only, backend RPC only
Feature flag: reuse existing runtime.evidenceVerifier.shadow/pilot once a caller is introduced
Tests: collector sanitization, verifierDecision filters, no raw objective/messages/metadata retention
Harness: fresh task spec for collector-to-RPC adapter
Rollback: stop passing evidenceVerifier input; existing records and legacy verification remain unchanged
Done when: real file/test/tool/trace evidence summaries can be supplied without raw payload persistence
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should `verifierDecision` become the only public filter name or should `evidenceVerifierDecision` stay as an alias? | Alias improves discoverability but adds one more accepted parameter. | maintainer | no |
| Should cancelled verifier summaries degrade health or remain neutral? | Current Lane C treats cancelled as degraded, but future product health semantics may choose otherwise. | maintainer/product | no |

## Handoff Notes

- Lane C integrates the decision model into existing backend RPCs only; it does not introduce an active verifier gate.
- `decision` filter compatibility was preserved for security decisions; use `verifierDecision` for canonical Evidence Verifier decisions.
- The full required verifier script passed with the updated tests included.
