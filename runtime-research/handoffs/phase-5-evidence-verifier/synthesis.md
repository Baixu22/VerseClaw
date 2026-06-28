# Phase 5 Synthesis: Evidence Verifier

Status: accepted

## Inputs Reviewed

| Input | Status | Notes |
| --- | --- | --- |
| `C:\Users\27933\.codex\RTK.md` | reviewed | Commands routed through `rtk` / `C:\Users\27933\.cherrystudio\bin\rtk.exe`. |
| `AGENTS.md` | reviewed | Renderer/Main boundary, comms replay, doc sync, and harness routing rules applied. |
| `runtime-research/agent-runtime-index.md` | reviewed | Already records Phase 5 as accepted shadow-only; this synthesis is the canonical closeout reference. |
| `runtime-research/implementation-roadmap.md`, Phase 5 | reviewed | Target is evidence-based verification with explicit failed/blocked taxonomy. |
| `runtime-research/migration-execution-plan.md`, Stage 6 | reviewed | Completion gate remains the long-term target, not accepted as default-on behavior in Phase 5. |
| `runtime-research/agent-runtime-core-spec.md`, section 6 | reviewed | `blocked` is valid only for missing external input/state; ordinary test/tool failure is `failed`. |
| `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/synthesis.md` | reviewed | Verification sampling from Phase 4 is observe-only/non-gating. |
| `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-e-evidence-verifier-shadow.md` | reviewed | Existing TaskLoop verifier report was warning-only and legacy-authoritative. |
| `harness/specs/tasks/runtime-security-verification-shadow-mvp.md` | reviewed | Backend verification shadow is sanitized, in-memory, and non-enforcing. |
| `harness/specs/tasks/runtime-event-log-verification-shadow.md` | reviewed | Event/checkpoint verification stores summaries only and does not execute external validation. |
| `harness/specs/tasks/runtime-verification-auto-sampling-mvp.md` | reviewed | Auto-sampling remains default-off and observe-only. |

## Accepted / Needs Revision Lanes

| Lane | Status | Decision Evidence |
| --- | --- | --- |
| `lane-a-contracts-and-harness` | accepted | Adds canonical `EvidenceVerifierInput`, decision/finding taxonomy, default-off shadow/pilot flag resolver, pure deterministic `evaluateEvidenceVerifier()`, focused contracts tests, harness context/validate, node typecheck, and comms replay/compare evidence. |
| `lane-b-evidence-collector-decision-engine` | accepted | Adds pure runtime-core collector/normalizer helpers and deterministic decision reuse; tests prove sanitization, renderer evidence non-authoritative, missing evidence, tool failure as `failed`, and explicit external dependency as `blocked`. |
| `lane-c-verification-shadow-rpc-integration` | accepted | Integrates canonical verifier summaries into existing backend-only `verification.run` RPC path; stores compact summaries only, preserves existing `decision` security filter semantics, and passes focused RPC tests plus `scripts/verify-security-shadow-mvp.mjs`. |
| `lane-d-taskloop-evidence-verifier-integration` | accepted | Embeds standalone verifier report inside the existing TaskLoop warning-only shadow report behind `runtime.evidenceVerifier.shadow`; tests prove flag-off parity, legacy statuses unchanged, mission completion unchanged, and no active gate. |
| `lane-e-validation-docs-synthesis-readiness` | accepted | Validates A-D status lines, harness specs, focused tests, typecheck, boundary scans, comms replay/compare, README review, and synthesis readiness. |

No planned Phase 5 lane is `needs_revision` or `blocked`.

Historical/supporting submission note: `submissions/lane-a-backend-verification-shadow-mvp.md` remains supporting evidence for the pre-existing backend security/verification shadow layer. It is not part of the current planned A-D lane classification. No `lane-a-evidence-verifier-shadow-mvp.md` file is present in the current Phase 5 submission directory.

## Verifier Surface Added

| Surface | Evidence | Accepted Boundary |
| --- | --- | --- |
| Canonical verifier contract | `openclaw_runtime/src/runtime-core/evidence-verifier.ts`; `tests/unit/runtime-evidence-verifier-contracts.test.ts` | Pure in-memory contract/evaluator only. It does not run tests, lint, typecheck, tools, network, filesystem, Gateway, or TaskLoop behavior. |
| Evidence collector helpers | `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts`; `tests/unit/runtime-evidence-verifier-collectors.test.ts` | Normalizes already-supplied TaskLoop/tool/replay/checkpoint/trace/human summaries into sanitized verifier input. No raw payload persistence and no command execution. |
| Backend RPC verifier summaries | `openclaw_runtime/src/security-verification-shadow/index.ts`; `openclaw_runtime/src/gateway/server-methods/security-verification-shadow.ts`; `tests/unit/security-verification-shadow*.test.ts` | Existing backend-only shadow RPC path accepts optional verifier input and returns/stores sanitized summaries. No renderer transport change and no blocking behavior. |
| TaskLoop shadow adapter | `openclaw_runtime/src/agents/task-loop-controller.ts`; `tests/unit/task-loop-controller.test.ts` | Adds nested standalone verifier report only to the existing warning-only report when `runtime.evidenceVerifier.shadow` is enabled. Legacy TaskLoop decisions stay authoritative. |
| Verification auto-sampling | `openclaw_runtime/src/runtime-core/verification-shadow-sampling.ts`; `tests/unit/runtime-verification-auto-sampling.test.ts` | Existing observe-only sampling remains non-gating and default-off unless explicit shadow flags/options are passed. |

## Legacy Paths Wrapped

| Legacy Path | Current Behavior | Phase 5 Wrapper | Parity Evidence |
| --- | --- | --- | --- |
| TaskLoop completion / repair / blocked / error statuses | Legacy TaskLoop status remains authoritative. | Warning-only nested verifier report behind `runtime.evidenceVerifier.shadow`. | `tests/unit/task-loop-controller.test.ts`; `tests/unit/mission-control-loop.test.ts`; `tests/unit/mission-reviewer.test.ts`. |
| `tools.invoke` execution, approval waiting, retries, errors, return payloads | Existing behavior remains authoritative. | Backend verification summaries are observe-only records/RPC data. | `rtk node scripts/verify-security-shadow-mvp.mjs` includes Gateway `tools.invoke` regression. |
| Security/verification shadow RPC | Existing `security.*` and `verification.*` surfaces remain backend-owned. | Optional canonical verifier summary added to records/responses; legacy security `decision` filter remains unchanged. | `tests/unit/security-verification-shadow-contract.test.ts`. |
| Event-log/checkpoint verification sampling | Observe-only summaries from Phase 4 remain non-gating. | Phase 5 uses them as evidence sources only, not as completion authority. | `tests/unit/runtime-verification-auto-sampling.test.ts`. |

## Behavior Change Audit

| Boundary | Result | Evidence |
| --- | --- | --- |
| No default-on verifier gate | pass | `runtime.evidenceVerifier.shadow` and `runtime.evidenceVerifier.pilot` default false; no accepted default-on or enforcement flag. |
| No renderer direct IPC or Gateway bypass | pass | Lane E renderer/Main scans found no Phase 5 direct `ipcRenderer.invoke`, Gateway HTTP, or Gateway WS bypass in renderer paths. |
| No second runtime service/listener/Gateway/Temporal | pass | Lane D and Lane E service scans found no new server/listener/service patterns in Phase 5 runtime paths. |
| No external test/lint/typecheck execution inside verifier runtime behavior | pass | Runtime verifier code is deterministic over supplied input; validation commands appear only in tests/harness/submissions. |
| No LLM judge | pass | Decisions use closed deterministic taxonomy and finding codes. |
| No raw payload persistence | pass | Records keep compact summaries/counts/codes/refs; tests inject sensitive raw strings and assert absence. |
| Flag-off legacy behavior unchanged | pass | TaskLoop flag-off tests assert no verifier report on result/lifecycle/checkpoint metadata; `tools.invoke` regression passes. |
| `failed` vs `blocked` taxonomy explicit | pass | Ordinary tool/test failures produce `failed`; `blocked` requires an explicit external dependency. |
| Verification sampling observe-only/non-gating | pass | Sampling helpers remain default-off, sanitized, sink-failure tolerant, and do not affect completion. |
| TaskLoop/Mission completion not silently changed | pass | Focused TaskLoop and mission tests passed; Lane D keeps `legacyDecisionUnaffected: true`. |

## Feature Flags

| Flag / Option | Default | Accepted Use | Rollback |
| --- | --- | --- | --- |
| `runtime.evidenceVerifier.shadow` | false / absent means false | Enables warning-only TaskLoop nested verifier report. | Disable/omit flag; no TaskLoop verifier report is attached. |
| `runtime.evidenceVerifier.pilot` | false / absent means false | Contract-reserved only in Phase 5; not an active gate. | Keep disabled; no Phase 5 behavior depends on it. |
| `security.validationShadow.enabled` / `OPENCLAW_SECURITY_VERIFICATION_SHADOW` | existing default-off backend shadow behavior | Enables existing backend shadow observability surfaces. | Disable existing validation shadow flag/env. |
| `runtime.eventLog.shadow`, `runtime.checkpointSerializer.shadow`, explicit sampling options | default-off / omitted | Can feed observe-only sanitized verification sampling. | Disable flags or omit sampling options. |

## Test Evidence Matrix

| Command / Evidence | Result | Coverage |
| --- | --- | --- |
| `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass | Phase 5 umbrella context and required reading route. |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass | Phase 5 umbrella spec validity. |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-security-verification-shadow-mvp.md` | pass | Existing backend security/verification shadow task spec. |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-event-log-verification-shadow.md` | pass | Existing event-log/checkpoint verification shadow task spec. |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-verification-auto-sampling-mvp.md` | pass | Existing auto-sampling task spec. |
| `rtk node scripts/verify-security-shadow-mvp.mjs` | pass | Harness context/validate, focused verifier/RPC tests, Gateway `tools.invoke` regression, node/web typecheck, comms replay/compare. |
| `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/security-verification-shadow.test.ts tests/unit/security-verification-shadow-contract.test.ts tests/unit/runtime-verification-auto-sampling.test.ts tests/unit/task-loop-controller.test.ts tests/unit/mission-control-loop.test.ts tests/unit/mission-reviewer.test.ts` | pass, 8 files / 98 tests | Contracts, collectors, backend RPC, auto-sampling, TaskLoop flag-off/shadow behavior, and mission completion parity. |
| `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime/electron TypeScript surfaces. |
| Renderer IPC/Gateway bypass scan | pass/reviewed | No Phase 5 renderer direct IPC/Gateway bypass introduced. |
| Second runtime service scan | pass/reviewed | No second runtime service, daemon, listener, HTTP server, WS server, Temporal service, or Gateway instance introduced. |
| Comms replay/compare | pass | Required because Lane C touched Gateway/Main RPC paths. |

## Taxonomy Evidence

| Decision | Accepted Meaning | Evidence |
| --- | --- | --- |
| `completed` | Required evidence is present and no failing/blocking/cancelled findings are present. | Lane A contract tests; Lane B collector tests; Lane C RPC summary fixtures. |
| `failed` | Ordinary tool/test failure, denied/error tool result, inconsistent replay, or verifier finding that is not an external dependency. | Lane A/B/D tests assert tool/subagent failures as `failed`. |
| `blocked` | Only explicit external dependency prevents meaningful progress. | Lane A/B/C tests cover external dependency as `blocked`; Lane D maps subagent/tool failures to `failed` in standalone verifier taxonomy. |
| `cancelled` | Cancellation remains distinct from failed/blocked. | Lane A evaluator taxonomy and tests. |
| `insufficient_evidence` | Required evidence kinds are missing or replay/evidence summaries are incomplete. | Lane A/B/C tests and summary finding codes. |

## Contract / Naming Conflicts

| Conflict | Resolution |
| --- | --- |
| Original parallel lane names drifted from actual A-D file names. | Accept the actual submissions because they satisfy the Phase 5 boundaries and evidence requirements. The synthesis records actual landed surfaces. |
| Historical backend shadow submission exists beside current A-D lanes. | Treat `lane-a-backend-verification-shadow-mvp.md` as supporting historical evidence, not as a competing planned Phase 5 lane. |
| Existing TaskLoop legacy evidence gate already affects legacy self-check. | Phase 5 does not claim this as the standalone verifier. The accepted TaskLoop integration is warning-only and records `legacyDecisionUnaffected: true`. |
| Backend RPC `decision` filter already means security decision. | Keep `decision` as security decision; canonical verifier filters use `verifierDecision` / `evidenceVerifierDecision`. |
| `runtime.evidenceVerifier.pilot` exists in contract flags. | Phase 5 accepts it as default-off/reserved only. Any active pilot/enforcement requires a fresh task spec. |

## Ready For Next Phase?

Yes. Phase 5 is accepted and the project can move to the next phase from this narrowed entry point:

- Accepted: canonical Evidence Verifier contract/taxonomy, pure collector helpers, sanitized backend shadow RPC summaries, warning-only TaskLoop nested verifier reports, and observe-only verification sampling.
- Not accepted: default-on verifier gate, active code-task completion gate, renderer-owned verifier transport, raw payload persistence, LLM judge, runtime execution of validation commands, or TaskLoop/Mission terminal-status cutover.
- Next-phase entry is intentionally tighter than the broad Stage 6 goal: a Phase 6 trace context provider can proceed from this accepted shadow boundary, while any completion-gate pilot must start from a fresh spec with rollout/rollback, default-off enforcement, and explicit flag-off parity tests.

## Required Fixes Before Next Phase

No fixes block moving to the next non-gating phase.

Before any future active completion-gate pilot, the next spec must define and validate:

- Default-off enforcement flag and rollback path.
- Code-task rollout scope and operator/user-visible behavior.
- Flag-off TaskLoop/tools.invoke/approval/retry/error/return-payload parity.
- Terminal status cutover rules, especially `failed` vs external-dependency `blocked`.
- Sanitized persistence/read model if any evidence survives process memory.
- Fresh comms replay/compare if Gateway/Main paths change.
- E2E coverage if UI or user-visible behavior changes.

## agent-runtime-index.md Updates Applied

The index now points Phase 5 readers to this synthesis first, with Lane E and task specs as supporting evidence:

```text
Evidence Verifier:
  status: accepted_phase_5_taskloop_integration_shadow_only
  handoff: runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md; runtime-research/handoffs/phase-5-evidence-verifier/submissions/lane-e-validation-docs-synthesis-readiness.md; harness/specs/tasks/phase-5-evidence-verifier.md
  next: Phase 6 trace context provider or a fresh completion-gate pilot spec with default-off enforcement, rollback, flag-off parity, and failed-vs-external-blocked terminal-status cutover.
```
