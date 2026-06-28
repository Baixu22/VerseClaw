# Phase 13 Handoff: Runtime Memory TaskLoop Shadow Persistence Pilot

Phase 13 starts only after Phase 12 synthesis accepted cutover-readiness planning/spec/evidence and ended with exactly `Status: accepted`.

Phase 12 accepted:

- risk maps for future TaskLoop/Gateway/runtime call-site imports;
- provider registration/order cutover risk mapping;
- durable fact promotion authority gate proof planning;
- rollback/operator/docs/config proof planning;
- validation, scan, and comms proof planning;
- no TaskLoop, Gateway, provider-ordering, default provider registration, default-on persistence, raw retention, service/exporter/database-service/listener work, or memory-derived runtime authority.

## Phase Goal

Orchestrate the first narrow runtime call-site pilot: default-off TaskLoop shadow persistence of sanitized Runtime Memory episode records.

The pilot must require both `runtime.memory.shadow` and `runtime.memory.persist` to be explicitly true before any adapter write can run. `runtime.memory.persist` alone must not enable TaskLoop writes, provider output, provider ordering changes, fact extraction, fact promotion, completion gates, tool policy, retry policy, security policy, verifier authority, or runtime authority.

## Accepted Phase 13 Boundary

Phase 13 may accept:

- the Phase 13 task spec;
- this handoff folder;
- a narrowly guarded TaskLoop call-site pilot for sanitized episode writes only;
- no-open/no-read/no-write proof when either required flag is false;
- TaskLoop lifecycle, terminal status, retry, approval, verifier/security, event-log/checkpoint/resume, and return payload parity when disabled;
- sanitized episode mapping from already-safe TaskLoop metadata;
- idempotency and bounded retention proof through the existing Phase 9 persistence owner;
- shadow-only error isolation proof;
- config/help/docs wording if code makes the pilot operator-visible;
- validation, scan, comms, and synthesis evidence.

If code changes are proposed, they must be isolated, default-off, rollback-safe, and backed by focused tests and scans before synthesis can accept them.

## Rejected Phase 13 Boundary

Phase 13 must reject:

- Gateway, Electron Main, renderer, shared host contract, provider-ordering, default provider registration, runtime execution authority, verifier authority, security policy, retry policy, or tool permission policy cutover;
- TaskLoop memory reads, provider hydration, default provider output, or prompt memory injection;
- `runtime.memory.persist` alone enabling TaskLoop writes;
- default-on memory recording, persistence, provider output, fact extraction, fact promotion, or prompt memory dumps;
- raw chat logs, transcripts, traces, prompts, payloads, checkpoints, tool args/output, env, secrets, raw traceparent, raw tracestate, or raw baggage retention;
- LLM/candidate facts becoming durable without verifier, human, or deterministic-rule promotion evidence;
- service, exporter, database-service, listener, daemon, HTTP/WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime work;
- memory-derived completion gates, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority.

## Required Reading

Every Phase 13 lane must read:

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/synthesis.md`
- `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md`
- `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md`
- `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md`
- `runtime-research/agent-runtime-index.md`
- `harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md`
- `harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md`
- `harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md`
- `harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md`
- `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`
- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`
- `openclaw_runtime/src/runtime-core/memory-context.ts`
- `openclaw_runtime/src/runtime-core/memory-store.ts`
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`
- `openclaw_runtime/src/context-engine/provider-registry.ts`
- relevant focused Runtime Memory and TaskLoop tests

Then run:

```powershell
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md
```

## Expected Lanes

- `lane-a-taskloop-callsite-gate-disabled-parity`
- `lane-b-sanitized-episode-write-mapping`
- `lane-c-idempotency-error-isolation-rollback`
- `lane-d-provider-gateway-docs-no-authority-boundary`
- `lane-e-validation-scans-comms-synthesis-readiness`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`. Acceptance means the default-off TaskLoop shadow episode pilot is proven narrowly enough to land or remain accepted. It does not accept provider, Gateway, durable fact, default-on, or runtime-authority cutover.
