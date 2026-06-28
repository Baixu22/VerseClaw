# lane-design-entry-tightening: Phase 6 Entry Tightening Design

## Status

```text
Status: accepted
```

Accepted because the scaffold now has an explicit accepted/rejected Phase 6 boundary, a required evidence matrix, a synthesis-time Phase 7 gate, updated harness criteria, an index pointer to this entry contract, and passing harness validation.

## Exact Files Reviewed

- `C:\Users\27933\.codex\RTK.md`
- `AGENTS.md`
- `runtime-research/agent-runtime-index.md`
- `runtime-research/implementation-roadmap.md`
- `runtime-research/migration-execution-plan.md`
- `runtime-research/agent-runtime-core-spec.md`
- `runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/README.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/parallel-lanes.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/submission-template.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/synthesis-template.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-a-contracts-and-harness.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-b-local-span-store-query.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-c-propagation-recording-shadow.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-d-context-provider-summary.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-e-validation-docs-synthesis-readiness.md`
- `runtime-research/opentelemetry/trace-model.md`
- `runtime-research/opentelemetry/query-and-source-mapping.md`
- `runtime-research/opentelemetry/clawx-mapping.md`
- `runtime-research/opentelemetry/useful-tests.md`
- `harness/specs/tasks/phase-6-trace-context-provider.md`
- `harness/specs/scenarios/gateway-backend-communication.md`
- `harness/specs/rules/renderer-main-boundary.md`
- `harness/specs/rules/backend-communication-boundary.md`
- `harness/specs/rules/api-client-transport-policy.md`
- `harness/specs/rules/host-api-fallback-policy.md`
- `harness/specs/rules/host-events-fallback-policy.md`
- `harness/specs/rules/gateway-readiness-policy.md`
- `harness/specs/rules/comms-regression.md`
- `harness/specs/rules/docs-sync.md`
- `harness/specs/rules/active-config-guards.md`
- `harness/specs/rules/capability-owner-resolution.md`
- `harness/specs/rules/channel-plugin-migration-guards.md`
- `harness/specs/guides/agent-harness-routing.md`
- `harness/specs/guides/spec-update.md`

## Exact Files Changed

- `runtime-research/handoffs/phase-6-trace-context-provider/README.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/parallel-lanes.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/submission-template.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/synthesis-template.md`
- `harness/specs/tasks/phase-6-trace-context-provider.md`
- `runtime-research/agent-runtime-index.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-design-entry-tightening.md`

No runtime implementation files were edited for this design task.

## Phase 6 Accepted Boundary

Phase 6 may accept only:

- canonical span contracts for task/tool/test/verifier behavior with bounded attributes, events, links, source refs, evidence refs, status, timestamps, trace id, span id, and parent span id;
- bounded local span store/query behavior that is local-only, explicitly constructed, sanitized on append, and queryable by trace/span/parent/task/tool/file/symbol/status/time/link;
- default-off propagation/recording shadow that proves flag-off parity for touched TaskLoop, `tools.invoke`, approval, retry, error mapping, return payload, event-log/checkpoint/resume, Evidence Verifier, and provider-ordering paths;
- readonly `RuntimeTraceContextProvider` summaries that return token-budgeted context items rather than raw dumps;
- validation/docs/synthesis evidence that proves the boundary and blocks Phase 7 until the memory spec is fresh and evidence-backed.

Path evidence:

- `runtime-research/handoffs/phase-6-trace-context-provider/README.md` now has `Accepted Entry Boundary`, `Rejected Entry Boundary`, `Required Lane Evidence`, and `Phase 7 Entry Gate`.
- `runtime-research/handoffs/phase-6-trace-context-provider/parallel-lanes.md` now has `Shared Acceptance Rules` and lane-specific evidence requirements.
- `harness/specs/tasks/phase-6-trace-context-provider.md` now requires lane evidence and Phase 7 entry criteria.
- `runtime-research/handoffs/phase-6-trace-context-provider/synthesis-template.md` now has accepted/rejected boundary audits and a Phase 7 entry table.

## Phase 6 Rejected Boundary

Phase 6 must reject:

- default-on trace recording, provider injection, provider ordering cutover, trace export, telemetry upload, or prompt/UI full-trace dumps;
- an observability platform, OpenTelemetry collector, OTLP exporter, database, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway, or second runtime service;
- retention of raw prompts, full event payloads, full checkpoints, full tool args/output, complete env, secrets, unbounded command output, or raw external `traceparent` / `tracestate` / baggage values;
- trace-derived completion gates, verifier authority, security policy, retry policy, runtime policy, or side-effect authority;
- renderer-owned IPC, renderer direct Gateway HTTP/WS, renderer-owned transport switching, or trusted renderer/user-provided trace headers.

## Required Evidence Matrix For Lanes A-E

| Lane | Required Evidence |
|---|---|
| A: contracts and harness | Default-off flags; bounded span/event/source/evidence contracts; sanitizer/redaction helpers; external trace context rejected or marked untrusted; source refs separate from evidence refs; no TaskLoop/Gateway/renderer/provider/exporter wiring; focused contract tests and boundary scans. |
| B: local span store/query | Local-only bounded retention; sanitized append; clone/read isolation; query by trace/span/parent/task/tool/file/symbol/status/time/link; linked spans not causal parentage; token-budgeted summary ranking; touched-file raw-retention and service/exporter scans. |
| C: propagation recording shadow | Flag-off parity for every touched legacy path; default-off recording/propagation flags; external trace context sanitized/re-rooted/rejected/marked untrusted; no raw header/tracestate/baggage retention; observe-only sink behavior; comms replay/compare when Main/Gateway paths change. |
| D: context provider summary | Provider disabled when `runtime.traceContext.provider` is false; readonly budgeted `ContextItem` output; no full trace dump; redacted metadata only; source/evidence links preserved without verifier authority; default provider ordering unchanged; provider tests and boundary scans. |
| E: validation/docs/synthesis readiness | A-D status audit; harness context/validate; focused tests; typecheck when applicable; renderer boundary scan; broad and touched-file service/exporter scans with match classification; raw-retention scan classification; docs-sync decision; required files exist and are referenced; Phase 7 entry criteria recorded. |

All lanes must include path/function/test/command evidence, flag-off parity evidence, sanitization/redaction evidence, external trace context handling evidence, token-budget summary evidence or a scoped not-applicable reason, boundary scans, and comms replay/compare when Main/Gateway paths changed.

## Phase 7 Entry Criteria

Phase 7 Runtime Memory Provider may start only if Phase 6 synthesis proves:

- trace spans are local, sanitized, bounded, and queryable;
- trace summaries are budgeted context items, not raw dumps;
- source refs link to evidence refs without replacing Evidence Verifier evidence;
- external trace context is rejected, sanitized, re-rooted, or marked untrusted before local runtime use;
- trace facts are not treated as durable memory facts unless independently verified;
- a fresh Phase 7 task spec exists or is required before work starts, forbidding raw chat-log memory and requiring evidence-backed temporal facts with `valid_at` / `invalid_at` semantics.

## Required Fixes Before Lane Implementation

Fixed in this design pass:

- Missing explicit accepted/rejected Phase 6 entry boundary: added to `README.md`.
- Missing shared lane evidence matrix: added to `parallel-lanes.md` and `submission-template.md`.
- Missing synthesis rejected-boundary audit: added to `synthesis-template.md`.
- Missing next-phase entry criteria: added to `README.md`, `parallel-lanes.md`, `synthesis-template.md`, and the harness task.
- Index inconsistency: `runtime_code_implementation` and Trace Context Provider status now use `phase_6_entry_contract_ready`, and the index links this submission.
- Required-file reference gap for the new design submission: `harness/specs/tasks/phase-6-trace-context-provider.md` and `agent-runtime-index.md` now reference `lane-design-entry-tightening.md`.

Remaining before any further Phase 6 lane/synthesis acceptance:

- Future lane owners must rerun the required tests/scans on their actual touched files.
- Phase 6 synthesis must still classify lane evidence; this design submission is an entry contract, not a synthesis acceptance of runtime behavior.
- Phase 7 still needs a fresh Runtime Memory Provider task spec before implementation.

## Commands Run And Results

| Command | Result | Notes |
|---|---|---|
| `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | failed initially | Plain `rtk` was not on PATH in PowerShell. Switched to the requested fallback executable. |
| `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | failed initially | Same PATH issue as above. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Returned the Phase 6 task context and required read order. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | `Spec is valid`. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n "runtime.traceContext\|traceparent\|full-trace\|full trace\|telemetry\|OTLP\|collector\|export\|readonly\|phase_6" runtime-research/handoffs/phase-6-trace-context-provider harness/specs/tasks/phase-6-trace-context-provider.md runtime-research/agent-runtime-index.md` | pass/reviewed | Shows the tightened readonly/default-off/export/traceparent/Phase 6 boundary text and existing lane evidence references. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node -e "<required Phase 6 file/reference verifier>"` | pass | Required Phase 6 docs exist; `README.md`, `parallel-lanes.md`, `submission-template.md`, `synthesis-template.md`, and `lane-design-entry-tightening.md` are referenced from the harness/index set. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n "runtime_code_implementation\|phase_6_entry_contract_ready\|phase_6_trace_context_provider_draft_ready\|lane-design-entry-tightening\|Phase 7\|Runtime Memory Provider\|raw chat-log\|Required Evidence Matrix\|Accepted Entry Boundary\|Rejected Entry Boundary" runtime-research/handoffs/phase-6-trace-context-provider harness/specs/tasks/phase-6-trace-context-provider.md runtime-research/agent-runtime-index.md` | pass/reviewed | Confirms the new entry-contract status, Phase 7 gate, evidence matrix, and no remaining top-level draft-ready status. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe "C:\Program Files\Git\cmd\git.exe" status --short` | reviewed | Worktree was already dirty with many unrelated changes and untracked Phase 5/6/runtime files; this pass changed only allowed Phase 6 docs/spec/index/submission paths. |

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should the already-present A-E lane submissions be synthesized now or treated as prior evidence for a separate synthesis pass? | This design task tightens entry criteria and does not itself accept runtime behavior. | maintainer / synthesis owner | no |
| Should Phase 7 memory spec live under a new `harness/specs/tasks/phase-7-runtime-memory-provider.md` path? | The Phase 7 gate requires a fresh spec, but this task should not start it. | maintainer / agent | no |

