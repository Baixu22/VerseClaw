# lane-a-contracts-and-harness: Evidence Verifier Contract And Harness

## Scope Confirmation

- Lane: `lane-a-contracts-and-harness`
- Output file: `runtime-research/handoffs/phase-5-evidence-verifier/submissions/lane-a-contracts-and-harness.md`
- Lane-owned file only: yes
- Implementation paths touched:
  - `runtime-research/handoffs/phase-5-evidence-verifier/README.md`
  - `runtime-research/handoffs/phase-5-evidence-verifier/parallel-lanes.md`
  - `runtime-research/handoffs/phase-5-evidence-verifier/submission-template.md`
  - `runtime-research/handoffs/phase-5-evidence-verifier/synthesis-template.md`
  - `harness/specs/tasks/phase-5-evidence-verifier.md`
  - `openclaw_runtime/src/runtime-core/evidence-verifier.ts`
  - `openclaw_runtime/src/runtime-core/index.ts`
- Test paths touched:
  - `tests/unit/runtime-evidence-verifier-contracts.test.ts`
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-5-evidence-verifier.md`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-evidence-verifier-contracts.test.ts`
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - renderer/Gateway boundary scans and second-runtime-service scan listed below
  - `rtk node scripts/comms/replay.mjs`
  - `rtk node scripts/comms/compare.mjs`
- Required reading completed: RTK.md, root `AGENTS.md`, `openclaw_runtime/AGENTS.md`, Phase 5 roadmap, Stage 6 migration plan, core spec section 6, Phase 4 synthesis, Phase 2 warning-only verifier shadow handoff, and selected harness context.

## Executive Summary

- Added the Phase 5 Evidence Verifier handoff scaffold with README, lane plan, submission template, and synthesis template.
- Added `harness/specs/tasks/phase-5-evidence-verifier.md` with explicit no-gate, no-TaskLoop-integration, no-service, no-LLM-judge, and no-runtime-external-command constraints.
- Added `openclaw_runtime/src/runtime-core/evidence-verifier.ts` as a contract-only runtime-core module.
- Exported the verifier contract from `openclaw_runtime/src/runtime-core/index.ts`.
- The contract covers file/test/tool/trace/human evidence kinds, verifier input shape, decisions, finding severity/category/code taxonomy, and default-off shadow/pilot flags.
- `evaluateEvidenceVerifier()` is deterministic and pure over provided input; it does not run tests, lint, typecheck, tools, network, filesystem, Gateway, or TaskLoop behavior.
- Blocked is emitted only for obligations marked as external dependencies; ordinary blocked-without-external-dependency is `failed`.
- Missing required file/test/tool evidence is `insufficient_evidence`.
- Lane A did not touch TaskLoop integration.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Canonical evidence kinds include file/test/tool/trace/human. | file/test | `openclaw_runtime/src/runtime-core/evidence-verifier.ts`; `tests/unit/runtime-evidence-verifier-contracts.test.ts` | `EVIDENCE_VERIFIER_EVIDENCE_KINDS`, line 18; test line 25 | Exact ordered vocabulary asserted. |
| Decision taxonomy includes completed/failed/blocked/cancelled/insufficient_evidence. | file/test | same | `EVIDENCE_VERIFIER_DECISIONS`, line 29; test line 32 | Exact ordered vocabulary asserted. |
| Finding severity/category/code taxonomy exists and is validated. | file/test | same | severity/category/code constants lines 40-86; tests lines 39-64 | Includes evidence, tool, event replay, external dependency, and cancellation categories. |
| Verifier input covers objective/task id, obligations, evidence refs, tool results, and event replay summary. | file/test | same | `EvidenceVerifierInput`, lines 145-153; `isEvidenceVerifierInput`, line 335; tests lines 90-104 | Invalid missing `taskId` or `eventReplay` is rejected. |
| Feature flags are default-off shadow/pilot only. | file/test/config | same; `harness/specs/tasks/phase-5-evidence-verifier.md` | `EVIDENCE_VERIFIER_FLAG_PATHS`, line 104; defaults line 117; tests lines 68-84; spec lines 38-39 | Resolver ignores a hypothetical `gate` key. |
| Deterministic evaluator emits the required decisions. | file/test | same | `evaluateEvidenceVerifier`, line 414; tests lines 115-166 | Covers completed, failed, cancelled, replay not-run, and replay inconsistent. |
| Blocked requires explicit external dependency. | test | `tests/unit/runtime-evidence-verifier-contracts.test.ts` | tests lines 170-209 | External dependency -> `blocked`; ordinary blocked -> `failed`. |
| Missing file/test/tool evidence is insufficient evidence. | test | same | tests lines 211-226 | Parameterized coverage for required evidence kinds. |
| Verifier does not mutate input or retain live evidence refs. | test | same | test lines 228-242 | Deep-frozen input remains unchanged; report refs are cloned. |
| Runtime-core index exports the contract. | file | `openclaw_runtime/src/runtime-core/index.ts` | export line 10 | Export-only change. |
| Phase 5 handoff scaffold and task spec exist. | file | `runtime-research/handoffs/phase-5-evidence-verifier/**`; `harness/specs/tasks/phase-5-evidence-verifier.md` | README, lane plan, templates, task spec | Defines lane output and validation expectations. |

## Implementation Summary

Current code:

- `evidence-verifier.ts` defines closed vocabularies, runtime type guards, default-off feature flag resolution, a fixture builder, and `evaluateEvidenceVerifier()`.
- `evaluateEvidenceVerifier()` derives decisions from findings only; it does not perform I/O or call any runtime integration.
- `index.ts` exports the module for future runtime-core consumers.

Tests:

- `runtime-evidence-verifier-contracts.test.ts` covers contract validation, taxonomy, failed/blocked distinction, missing evidence, and input immutability.

Feature flags:

- `runtime.evidenceVerifier.shadow`: default false.
- `runtime.evidenceVerifier.pilot`: default false.
- No gate/default-on flag is defined or accepted in Lane A.

Harness/spec changes:

- `phase-5-evidence-verifier.md` validates under the existing gateway-backend scenario rules and explicitly forbids TaskLoop integration in Lane A.

## Verifier Contract Surface

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Evidence kinds | `EvidenceVerifierEvidenceKind` | contract-only | none | `EVIDENCE_VERIFIER_EVIDENCE_KINDS`; test line 25 |
| Verifier input | `EvidenceVerifierInput` | contract-only | none | `isEvidenceVerifierInput`; tests lines 90-104 |
| Decision taxonomy | `EvidenceVerifierDecision` | contract-only | none | tests lines 115-166 |
| Finding taxonomy | `EvidenceVerifierFinding` | contract-only | none | constants lines 40-86; report validator |
| Flags | `resolveEvidenceVerifierFeatureFlags()` | default-off shadow/pilot only | `runtime.evidenceVerifier.shadow`, `runtime.evidenceVerifier.pilot` | tests lines 68-84 |
| Evaluator | `evaluateEvidenceVerifier()` | pure deterministic report; no active gate | future callers must opt in | tests lines 115-242 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion | Unchanged; Lane A does not import or edit TaskLoop. | Focused forbidden scan found TaskLoop only in harness text, not runtime/test implementation. | Future lanes must prove flag-off parity before wiring. |
| `tools.invoke` | Unchanged; no Gateway/Main/tool invocation path touched. | Touched implementation is runtime-core contract/export plus docs/spec/test only. | None for Lane A. |
| Approval waiting/retry/error mapping | Unchanged. | No TaskLoop, MCP, Gateway, or approval files touched by this lane. | Future adapters must rerun legacy parity tests. |

## Taxonomy Audit

| Taxonomy Focus | Result | Evidence | Gap |
|---|---|---|---|
| Completed requires evidence refs | pass | Default fixture has file/test/tool refs and evaluates `completed`. | Trace/human are contract kinds but not default-required. |
| Tool/test failures become failed | pass | Tool `error` test returns `failed`; blocked-without-external-dependency returns `failed`. | Test evidence command execution is future collector work. |
| Blocked requires external dependency | pass | `external_dependency_blocked` vs `blocked_without_external_dependency` tests. | None. |
| Missing evidence becomes insufficient_evidence | pass | Parameterized file/test/tool missing evidence tests. | None. |
| Cancelled remains distinct | pass | Cancelled tool result returns `cancelled`. | None. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass | Selected scenario/rule/layer reading list. | None. |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass | Spec shape and required scenario profile. | None. |
| Focused verifier contracts | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-evidence-verifier-contracts.test.ts` | pass, 1 file / 8 tests | Contract validation, decisions, blocked/external dependency, missing evidence, no mutation. | None. |
| Node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Runtime-core TypeScript surface. | Web typecheck not required by Lane A and currently affected by unrelated dirty update-removal work. |
| Comms replay | `rtk node scripts/comms/replay.mjs` | pass | Scenario comms profile confidence. | No Main/Gateway path changed. |
| Comms compare | `rtk node scripts/comms/compare.mjs` | pass | Scenario comms profile confidence. | No Main/Gateway path changed. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on verifier gate | pass | Only default-off `shadow`/`pilot` flags exist; tests assert defaults false and ignore `gate`. |
| No second runtime service | pass | Focused scan over `evidence-verifier.ts` and contract tests for `createServer`, `listen`, WebSocket server, HTTP/net server, and Gateway endpoints returned no matches. |
| No renderer direct IPC | pass | Focused `src/pages src/components` scan returned no matches. Broad scan matches were existing tests/rule text/preload-owned IPC. |
| No renderer direct Gateway HTTP/WS | pass | Focused `src/pages src/components` scan returned no matches. Broad scan matches were existing tests/rule text/Main/Gateway-owned code/comments. |
| No external test/lint/typecheck execution inside verifier runtime behavior | pass | Forbidden scan over Lane A runtime/test files found no runtime command execution; harness spec mentions validation commands only. |
| No LLM judge | pass | Verifier decisions are closed-code deterministic taxonomy; no model/judge code is present. |
| Raw data retention ban | pass | Contract stores evidence refs/tool result summaries supplied by caller; tests assert cloned refs and no mutation. No persistence path exists. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Existing Phase 2 TaskLoop verifier report is warning-only and separate. | Phase 2 submission; Lane A did not touch TaskLoop. | Standalone runtime-core verifier contract first. | Future adapter lane must wrap legacy report only behind default-off shadow flags and prove parity. |
| Existing backend security/verification shadow files already use `insufficient_evidence`. | Existing `security-verification-shadow` tests and prior Phase 5 submission files. | Canonical runtime-core contract should be reusable without forcing a gate. | Future synthesis should reconcile naming and decide whether backend shadow adopts this contract directly. |
| Worktree contains unrelated update-removal and prior Phase 4/5 handoff edits. | `git status --short` showed many pre-existing modified/deleted/untracked files. | Lane A evidence should be scoped. | This submission claims only the paths listed above. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Evidence collector shadow adapters
New code path: openclaw_runtime/src/runtime-core evidence collector helpers or security-verification-shadow adapter
Legacy path wrapped: already available file/test/tool/trace/human refs only
Shadow / pilot boundary: observe-only, default-off
Feature flag: runtime.evidenceVerifier.shadow
Tests: sanitized collector fixtures and no raw payload retention
Harness: phase-5-evidence-verifier
Rollback: disable runtime.evidenceVerifier.shadow and stop importing collector adapter
Done when: collector feeds EvidenceVerifierInput without running commands, judging with LLMs, persisting raw payloads, or changing completion behavior
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should trace/human evidence become default-required for any task class? | Lane A defaults only file/test/tool so narrow code-change tasks can be evaluated without forcing human signoff. | maintainer | no |
| Which future owner maps real test command summaries into `test` evidence refs? | Runtime verifier must not run tests itself; a collector owner must supply sanitized summaries. | maintainer | no |

## Handoff Notes

- Lane A is contract-only and does not authorize a completion gate.
- `blocked` is reserved for explicit external dependencies; ordinary tool/test failures remain `failed`.
- The next lane should avoid raw payload persistence and should not execute validation commands inside runtime verifier behavior.
