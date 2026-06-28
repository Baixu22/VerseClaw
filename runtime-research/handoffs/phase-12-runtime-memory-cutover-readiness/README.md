# Phase 12 Handoff: Runtime Memory Cutover Readiness

Phase 12 starts only after Phase 11 synthesis accepted isolated default-off Runtime Memory adapter wiring and ended with exactly `Status: accepted`.

Phase 11 accepted:

- `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts` as an isolated adapter;
- disabled no-open/no-read/no-write parity for the adapter;
- sanitized adapter write and read hydration proof through existing Runtime Memory shapes;
- explicit extra-provider hydration proof only;
- config wording cleanup;
- no TaskLoop, Gateway, provider-ordering, default provider registration, default-on persistence, raw retention, service/exporter/database-service/listener work, or memory-derived runtime authority.

## Phase Goal

Plan the evidence required before any future Runtime Memory cutover could be accepted.

The recommended next step is `phase-12-runtime-memory-cutover-readiness`: planning/spec/evidence only. It should produce risk maps and proof plans for future imports, provider registration, durable fact authority, rollback/operator controls, docs/config, and validation. It must not implement runtime cutover.

## Accepted Phase 12 Boundary

Phase 12 may accept:

- the Phase 12 task spec;
- this handoff folder;
- risk maps for future TaskLoop/Gateway/runtime call-site imports;
- risk maps for future provider registration and provider ordering changes;
- a durable fact promotion authority gate proof plan;
- rollback, operator, docs, and config proof plans;
- validation, scan, and comms proof plans;
- `runtime-research/agent-runtime-index.md` updates only after the planning task is accepted.

If code changes are proposed at all, they must be explicitly isolated, default-off, and separately justified. The preferred Phase 12 shape has no runtime code changes.

## Rejected Phase 12 Boundary

Phase 12 must reject:

- TaskLoop cutover, Gateway cutover, runtime call-site imports, runtime execution cutover, or adapter invocation from runtime authority paths;
- default provider registration or provider ordering cutover;
- default-on memory recording, provider output, persistence, fact extraction, fact promotion, or prompt memory dumps;
- raw chat logs, transcripts, traces, prompts, payloads, checkpoints, tool args/output, env, secrets, raw traceparent, raw tracestate, or raw baggage retention;
- LLM/candidate facts becoming durable without verifier, human, or deterministic-rule promotion evidence;
- service, exporter, database-service, listener, daemon, HTTP/WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime work;
- memory-derived completion gates, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority.

## Required Reading

Every Phase 12 lane must read:

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md`
- `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md`
- `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md`
- `runtime-research/agent-runtime-index.md`
- `harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md`
- `harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md`
- `harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md`
- `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`
- `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`
- `openclaw_runtime/src/runtime-core/memory-context.ts`
- `openclaw_runtime/src/runtime-core/memory-store.ts`
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`
- `openclaw_runtime/src/context-engine/provider-registry.ts`
- relevant focused Runtime Memory tests

Then run:

```powershell
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md
```

## Expected Lanes

- `lane-a-taskloop-callsite-cutover-risk-map`
- `lane-b-provider-registration-order-risk-map`
- `lane-c-durable-fact-authority-gate-proof-plan`
- `lane-d-rollback-operator-docs-config-proof-plan`
- `lane-e-validation-scans-comms-proof-plan`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`. Acceptance means the readiness plan is good enough for a later cutover spec to be drafted. It does not accept the cutover itself.
