# Phase 6 Handoff: Trace Context Provider

Phase 6 starts after Phase 5 accepted the Evidence Verifier as shadow-only and warning-only. The goal is to add the smallest local Trace Context Provider foundation so agents can read runtime/tool/test behavior evidence without relying on uncorrelated logs or full transcript dumps.

## Phase Goal

Build a default-off, local-only trace context foundation for:

- span-like task/tool/test/verifier events with trace id, span id, parent id, links, status, timestamps, and bounded attributes;
- parent/child and linked-span queries by task, tool, file, symbol, status, and time range;
- budgeted trace summaries that prioritize errors, tests, verifier spans, and linked evidence;
- source refs that connect runtime behavior to file/symbol/evidence refs without replacing verifier evidence;
- sanitized trace context propagation across Main-owned transport, Gateway proxy paths, runtime, and tools when a lane explicitly wires it.

## Accepted Entry Boundary

Phase 6 may accept only these surfaces:

- a canonical span contract for task/tool/test/verifier behavior with bounded attributes, events, links, source refs, evidence refs, status, timestamps, trace id, span id, and parent span id;
- a bounded local span store/query model that is in-memory or otherwise local-only, explicitly constructed, sanitized on append, and queryable by trace/span/parent/task/tool/file/symbol/status/time/link;
- default-off propagation and recording shadow paths that preserve flag-off TaskLoop, `tools.invoke`, approval, retry, error mapping, return payload, event-log/checkpoint/resume, Evidence Verifier, and provider-ordering behavior;
- a readonly `RuntimeTraceContextProvider` that returns token-budgeted context items and never a raw trace dump;
- validation, docs, and synthesis evidence proving the accepted boundary and the next-phase gate.

## Rejected Entry Boundary

Phase 6 must reject any lane that introduces:

- default-on trace recording, provider injection, provider ordering cutover, trace export, telemetry upload, or prompt/UI full-trace dumps;
- an observability platform, OpenTelemetry collector, OTLP exporter, database, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway, or second runtime service;
- retention of raw prompts, full event payloads, full checkpoints, full tool args/output, complete env, secrets, unbounded command output, or raw external `traceparent`/`tracestate`/baggage values;
- trace-derived completion gates, verifier authority, security policy, retry policy, runtime policy, or any behavior that can execute side effects;
- renderer-owned IPC, Gateway HTTP/WS, transport selection, or trust in renderer/user-provided trace headers.

## Required Lane Evidence

Every accepted lane must provide path/function/test/command evidence for its claims, plus explicit rows for:

- flag-off parity for every touched legacy path;
- sanitization/redaction and raw-retention scans;
- external `traceparent`/`tracestate`/baggage handling, even when the lane is not a propagation lane;
- token-budgeted summary behavior or a not-applicable explanation tied to the lane scope;
- source refs linking to evidence refs without replacing Evidence Verifier evidence;
- forbidden-pattern boundary scans, including touched-file service/exporter scans;
- comms replay/compare whenever Main/Gateway communication paths changed.

## Phase 7 Entry Gate

Runtime Memory Provider work may start only after Phase 6 synthesis proves all of the following:

- trace spans are local, sanitized, bounded, and queryable;
- trace summaries are budgeted context items, not raw dumps;
- source refs link to evidence refs without replacing verifier evidence;
- external trace context is rejected, sanitized, re-rooted, or marked untrusted before local use;
- trace facts are not treated as durable memory facts unless independently verified;
- Phase 7 has a fresh task spec that forbids raw chat-log memory and requires evidence-backed temporal facts with `valid_at` / `invalid_at` semantics.

## Non-Negotiable Constraints

1. Do **not** enable default-on trace recording, trace provider injection, trace export, or prompt trace dumps.
2. Do **not** add an observability platform, OpenTelemetry collector, OTLP exporter, external telemetry upload, database, daemon, listener, HTTP server, WebSocket server, Temporal service, or second Gateway/runtime service.
3. Do **not** add renderer direct `window.electron.ipcRenderer.invoke(...)` calls.
4. Do **not** add renderer direct Gateway HTTP/WebSocket calls to `127.0.0.1:18789` or `localhost:18789`.
5. Do **not** trust external `traceparent`, `tracestate`, or baggage. External trace context must be rejected, sanitized, marked untrusted, or re-rooted before local runtime use.
6. Do **not** persist raw prompts, full event payloads, full checkpoints, full tool args, full tool output, complete env, secrets, or unbounded command output in spans, attributes, events, links, summaries, or source refs.
7. Keep existing TaskLoop, `tools.invoke`, approval waiting, retry, error mapping, return payloads, event-log/checkpoint behavior, and Evidence Verifier behavior unchanged with flags off.
8. Treat the Trace Context Provider as readonly context. It must not become a verifier/completion gate, retry policy, security policy, or runtime authority in Phase 6.
9. Trace summaries must be token-budgeted and redacted; no lane may expose full trace dumps to prompts or UI by default.
10. If Main/Gateway communication paths change, run comms replay/compare and preserve renderer/Main transport ownership.

## Required Reading

Every implementation window must read:

- `C:\Users\27933\.codex\RTK.md`
- `AGENTS.md`
- `openclaw_runtime/AGENTS.md` when touching runtime files
- `runtime-research/agent-runtime-index.md`
- `runtime-research/implementation-roadmap.md`, Phase 6
- `runtime-research/migration-execution-plan.md`, Stage 7
- `runtime-research/agent-runtime-core-spec.md`, Runtime Context Provider references and first implementation order
- `runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md`
- `runtime-research/opentelemetry/trace-model.md`
- `runtime-research/opentelemetry/query-and-source-mapping.md`
- `runtime-research/opentelemetry/clawx-mapping.md`
- `runtime-research/opentelemetry/useful-tests.md`
- `harness/specs/tasks/phase-6-trace-context-provider.md`

Then run:

```powershell
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md
```

## Output Rules

Each lane writes exactly one submission:

```text
runtime-research/handoffs/phase-6-trace-context-provider/submissions/<lane-id>.md
```

Lane owners may edit only their declared implementation/test paths and their own submission file. Cross-lane conflicts are recorded in `Design Conflicts` / `Handoff Notes`; the synthesis owner reconciles them.

## Expected Lanes

- `lane-a-contracts-and-harness`
- `lane-b-local-span-store-query`
- `lane-c-propagation-recording-shadow`
- `lane-d-context-provider-summary`
- `lane-e-validation-docs-synthesis-readiness`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-6-trace-context-provider/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`, and must not treat under-evidenced implementation claims as accepted facts.
