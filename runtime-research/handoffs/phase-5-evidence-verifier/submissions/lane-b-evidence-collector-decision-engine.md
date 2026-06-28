# lane-b-evidence-collector-decision-engine: Evidence Collector / Decision Helpers

## Scope Confirmation

- Lane: `lane-b-evidence-collector-decision-engine`
- Output file: `runtime-research/handoffs/phase-5-evidence-verifier/submissions/lane-b-evidence-collector-decision-engine.md`
- Code added: `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts`
- Tests added: `tests/unit/runtime-evidence-verifier-collectors.test.ts`
- Existing decision engine reused: `openclaw_runtime/src/runtime-core/evidence-verifier.ts`
- Barrel export updated: `openclaw_runtime/src/runtime-core/index.ts`

## Executive Summary

Lane B is implemented as pure runtime-core helpers that normalize existing evidence shapes into the Lane A `EvidenceVerifierInput` contract, then reuse `evaluateEvidenceVerifier` for deterministic decisions. The helpers do not call fs/git/doctor/Gateway, do not execute shell commands, and do not persist raw evidence payloads.

Renderer-collected evidence is not treated as authoritative. The collector keeps it only in `projectedEvidenceRefs` with untrusted/source-projected metadata, so it cannot satisfy completion evidence requirements.

## Code Evidence

| Claim | Evidence |
|---|---|
| Main collector builds `EvidenceVerifierInput` from TaskLoop, tool, replay, checkpoint, trace, human, open obligation, and external dependency inputs. | `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts:105` `collectEvidenceVerifierInput` |
| Decision helper reuses the deterministic Lane A engine instead of adding another taxonomy. | `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts:161` `evaluateCollectedEvidenceVerifier` |
| TaskLoop `filesTouched` / `testsRun` / `evidenceRefs` normalize to file/test/evidence refs. | `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts:168` `collectTaskLoopEvidence` |
| Runtime replay and checkpoint serializer diagnostics map into an event replay summary that prevents completion when diagnostics exist. | `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts:273` `collectReplaySummary` |
| Renderer evidence is projected and non-authoritative. | `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts:340` `splitByAuthority` |
| Raw metadata is stripped; refs keep only bounded ref/label/summary plus collector provenance. | `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts:394` `sanitizeEvidenceRef` |
| Runtime-core public export includes the new helper module. | `openclaw_runtime/src/runtime-core/index.ts` exports `./evidence-verifier-collectors.js`. |

## Test Evidence

| Required Case | Evidence |
|---|---|
| file/test/tool/trace/human evidence normalization | `tests/unit/runtime-evidence-verifier-collectors.test.ts:41` |
| missing test evidence -> `insufficient_evidence` | `tests/unit/runtime-evidence-verifier-collectors.test.ts:68` |
| tool error -> `failed` | `tests/unit/runtime-evidence-verifier-collectors.test.ts:81` |
| explicit external dependency -> `blocked` | `tests/unit/runtime-evidence-verifier-collectors.test.ts:98` |
| open obligations prevent completed | `tests/unit/runtime-evidence-verifier-collectors.test.ts:120` |
| event replay diagnostics prevent completed | `tests/unit/runtime-evidence-verifier-collectors.test.ts:136` |
| checkpoint serializer diagnostics prevent completed | `tests/unit/runtime-evidence-verifier-collectors.test.ts:164` |
| renderer-collected evidence is projected/non-authoritative | `tests/unit/runtime-evidence-verifier-collectors.test.ts:186` |

## Validation Evidence

| Command | Result |
|---|---|
| `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts` | pass, 2 files / 16 tests |
| `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-security-verification-shadow-mvp.md` | pass |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-security-verification-shadow-mvp.md` | pass |
| `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-event-log-verification-shadow.md` | pass |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-event-log-verification-shadow.md` | pass |
| `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/runtime-verification-auto-sampling-mvp.md` | pass |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-verification-auto-sampling-mvp.md` | pass |
| `rtk node scripts/verify-security-shadow-mvp.mjs` | pass; includes verifier tests 3 files / 25 tests, Gateway tools.invoke regression 1 file / 7 tests, node/web typecheck, comms replay, comms compare |
| Renderer IPC/Gateway bypass scan | pass; broad matches are existing i18n/rule text and preload IPC bridge only |
| New-file service/listener/shell scan | pass/no matches |

## Boundary Audit

| Boundary | Result |
|---|---|
| Pure functions only | pass. New module only transforms provided in-memory values and calls `evaluateEvidenceVerifier`. |
| No fs/git/doctor/Gateway calls | pass. No imports or calls to those surfaces. |
| No shell command execution | pass. New-file scan found no `exec`, `spawn`, server, listener, or Gateway startup patterns. |
| No raw evidence retention | pass. Original evidence metadata is not copied; normalized refs retain bounded `ref`, `label`, `summary`, and collector provenance only. |
| Renderer evidence not authoritative | pass. Renderer-sourced refs are returned under `projectedEvidenceRefs` and omitted from authoritative `input.evidenceRefs`. |
| No default-on verifier gate | pass. Lane B adds library helpers only; no TaskLoop/Gateway/renderer behavior cutover. |

## Status

```text
Status: accepted
```

## Notes

The worktree contains many pre-existing dirty files and untracked Phase 5 artifacts outside this lane. This lane only requires the collector module, its test file, the runtime-core barrel export, and this submission.
