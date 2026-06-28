# AST Controlled Readonly Candidate Generation Pilot

Status: accepted_controlled_pilot_ready

## Intent

This pilot is the next allowed AST slice after accepted controlled runtime-use readiness. It is limited to explicit readonly candidate generation from caller-owned in-memory TypeScript/TSX target files.

The pilot does not require the registry pilot and does not authorize any registry behavior.

## Accepted Evidence Baseline

| Evidence | Status | Source |
|---|---|---|
| Runtime-use prerequisites | `accepted_runtime_use_prerequisites_complete` | `runtime-research/handoffs/runtime-use-prerequisites.md` |
| Controlled readiness | `accepted_controlled_runtime_use_readiness` | `runtime-research/handoffs/runtime-use-prerequisites.md` |
| AST readonly scan synthesis | `Status: accepted` | `runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/synthesis.md` |
| Runtime index AST boundary | readonly scan MVP only; no apply, workspace edit, TaskLoop/Gateway/Main/renderer/host-api/api-client/provider transport, prompt/model-message, persistence, service, or default-on behavior | `runtime-research/agent-runtime-index.md` |
| Boundary sentinel | AST exports/source stay readonly and non-authoritative | `tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts` |

## Pilot Scope

Allowed:

- Explicit caller-owned invocation of readonly AST helper APIs.
- In-memory TypeScript/TSX target files only.
- Rule validation diagnostics.
- Ordered match evidence and bounded diagnostic summaries.
- Optional preview diff diagnostics only when `runtime.astPatchPlanner.previewDiff` is explicitly enabled.
- Resume drift and overlap diagnostics that fail closed.

Forbidden:

- AST patch apply, file write, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, and safeDelete.
- TaskLoop automatic invocation or any TaskLoop decision, completion, checkpoint, or lifecycle authority.
- Gateway/Main/renderer/host-api/api-client routes.
- Provider ordering, provider transport, prompt/model-message, or default provider registration changes.
- Persistence, services, listeners, daemons, WebSocket/local HTTP servers, second Gateway/runtime, external database, or default-on behavior.
- Treating preview diffs, match counts, candidate text, or diagnostics as task completion evidence.

## Feature Flags

- `runtime.astPatchPlanner.readonlyScan`: default false by omission.
- `runtime.astPatchPlanner.previewDiff`: default false by omission.
- No flag in this pilot can enable apply, write, mutation, TaskLoop/Gateway integration, provider transport, completion authority, persistence, service/listener/daemon behavior, or default-on behavior.

## Rollback

Close the pilot by omitting AST flags, stopping explicit helper calls, and discarding in-memory candidate output. No persisted cleanup is required.

## Validation Assets

- Shared sample matrix: `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/sample-matrix.md`
- Shared scorecard: `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/scorecard.md`
- Shared veto gates: `runtime-research/handoffs/controlled-runtime-use-pilot-readiness/veto-gates.md`
- Pilot validation plan: `runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot/validation-plan.md`
