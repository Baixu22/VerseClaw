# Phase 11 Handoff: Runtime Memory Default-Off Wiring MVP

Phase 11 starts only after Phase 10 synthesis accepted default-off integration boundary/readiness.

Phase 10 accepted:

- flag-off no-open/no-read/no-write boundary evidence;
- sanitized read/write handoff plans for the Phase 9 persistence owner;
- explicit optional provider hydration boundaries;
- rollback, docs, scans, and synthesis readiness;
- no runtime cutover, no default-on persistence, no provider ordering cutover, no raw retention, no unverified durable facts, no service/exporter/database-service/listener, and no runtime authority.

## Phase Goal

Move from planning-only boundary evidence to a small isolated default-off wiring MVP.

The recommended next step is an adapter that can be tested directly but is not imported by TaskLoop, Gateway, Electron Main, renderer, shared host contracts, default provider registry, verifier, security policy, retry policy, or tool permission authority paths.

## Accepted Phase 11 Boundary

Phase 11 may accept:

- a `memory-runtime-integration` adapter under `openclaw_runtime/src/runtime-core/`;
- focused tests proving disabled parity and sanitized read/write behavior;
- explicit helper boundaries that accept only Runtime Memory record shapes or builder outputs that pass sanitizers;
- optional provider hydration helper tests only through explicit extra-provider injection;
- config help/docs wording updates that acknowledge the Phase 9 standalone persistence foundation without claiming runtime cutover;
- scans proving no forbidden runtime authority wiring.

## Rejected Phase 11 Boundary

Phase 11 must reject:

- default-on memory recording, persistence, provider output, fact extraction, fact promotion, prompt memory dumps, or provider ordering changes;
- TaskLoop cutover, Gateway cutover, Electron/Main integration, renderer integration, shared host contract integration, or runtime execution cutover;
- direct provider registry default registration or default provider ordering cutover;
- raw chat logs, transcripts, traces, prompts, payloads, checkpoints, tool args/output, env, secrets, raw traceparent, raw tracestate, or raw baggage retention;
- LLM/candidate facts becoming durable without verifier, human, or deterministic-rule promotion evidence;
- service, exporter, database-service, listener, daemon, HTTP/WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime work;
- memory-derived completion gates, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority.

## Choice Recommendation

Choose Phase 11 before any provider-ordering or TaskLoop cutover.

Reason:

1. Phase 10 proved the boundary but did not implement an integration adapter.
2. The riskiest unknown is not "can SQLite persist records" because Phase 9 proved that; it is "can a runtime-facing seam stay inert when disabled."
3. A default-off adapter lets lanes test future read/write shapes while keeping legacy runtime behavior authoritative.
4. Config help is already stale and should be fixed before operator-facing claims.

## Required Reading

Every Phase 11 lane must read:

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md` when touching runtime files
- `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md`
- `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md`
- `runtime-research/agent-runtime-index.md`
- `harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md`
- `harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md`
- `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`
- `openclaw_runtime/src/runtime-core/memory-context.ts`
- `openclaw_runtime/src/runtime-core/memory-store.ts`
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`
- relevant focused runtime memory tests

Then run:

```powershell
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
```

## Expected Lanes

- `lane-a-adapter-contract-flag-off-parity`
- `lane-b-sanitized-write-boundary`
- `lane-c-read-hydration-provider-boundary`
- `lane-d-config-docs-rollback-boundary`
- `lane-e-validation-synthesis-readiness`

## Final Integration

The synthesis owner writes:

```text
runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md
```

The synthesis must classify every lane as `accepted`, `needs_revision`, or `blocked`, and must not accept runtime cutover claims without code/test/scan evidence.
