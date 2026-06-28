# Line C Parallel Lanes

Status: accepted

These lanes are planning lanes for a future readonly/shadow grounding spine.
They must not implement runtime behavior, add gates, change provider ordering,
or introduce services/exporters/listeners.

## Lane A: Inventory

Goal: produce a current producer/consumer map for grounding refs.

Read first:

- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/README.md`
- `openclaw_runtime/src/runtime-core/evidence.ts`
- `openclaw_runtime/src/runtime-core/evidence-verifier.ts`
- `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts`
- `openclaw_runtime/src/runtime-core/trace-context.ts`
- `openclaw_runtime/src/runtime-core/trace-context-store.ts`
- `openclaw_runtime/src/context-engine/trace-context-provider.ts`
- `openclaw_runtime/src/runtime-core/event-log.ts`
- `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts`
- `openclaw_runtime/src/agents/task-loop-controller.ts`

Deliverables:

- table of all `EvidenceRef`, `TaskLoopEvidenceRef`,
  `RuntimeTraceSourceRef`, `RuntimeTraceSpan`, `RuntimeTaskEvent`,
  `Checkpoint`, memory, AgentMap, Symbol, and future patch-plan ref surfaces;
- producer/consumer direction for each surface;
- trust classification: verified, supplied, projected, untrusted, unknown;
- list of gaps where file/test/source/checkpoint refs are projected or locally
  converted instead of canonical at source.

Acceptance:

- no code implementation;
- every entry cites path/function/test evidence;
- explicitly names which producers are authoritative legacy behavior and which
  are observe-only/shadow.

## Lane B: Evidence Ref Normalization

Goal: design a readonly derived normalization envelope for evidence-like refs.

Scope:

- canonical `EvidenceRef` preservation;
- TaskLoop `filesTouched` / `testsRun` / `TaskLoopEvidenceRef` alignment;
- checkpoint/event-log/verifier refs as derived `GroundingRef` candidates;
- memory episode/fact refs as consumers only;
- trust/projection/sanitization metadata conventions.

Out of scope:

- changing `TaskLoopEvidenceRef`;
- changing verifier decisions;
- active completion gates;
- persistence or raw payload retention;
- renderer transport changes.

Deliverables:

- proposed `GroundingRef` and `GroundingRefTrust` planning shape;
- compatibility map from current refs into that shape;
- list of normalizations that must remain derived-only until a later spec.

Acceptance:

- all normalization is loss-aware and readonly;
- renderer evidence stays untrusted/projected;
- no durable facts from unverified claims;
- no runtime authority field beyond `authority: none`.

## Lane C: Trace / Source Query

Goal: design a bounded query surface that bridges trace spans, source refs,
event-log records, checkpoints, and evidence refs.

Scope:

- trace query keys already accepted in Phase 6;
- event-log search keys from `RuntimeTaskEventLogSearchQuery`;
- checkpoint id/task id/open obligation/source evidence anchors;
- source refs with file/range/symbol/commit/diffHash;
- token-budgeted summaries and no full trace dumps.

Out of scope:

- OpenTelemetry SDK/exporter/collector;
- database/service/listener;
- Main/Gateway/renderer cutover;
- provider ordering cutover;
- runtime retry/security/permission authority.

Deliverables:

- proposed `GroundingQuery` planning shape;
- mapping from query fields to current trace/event/checkpoint/verifier surfaces;
- ranking rules for error/test/verifier/evidence-linked spans and
  file/symbol/test relevance;
- raw-retention and external trace trust notes.

Acceptance:

- query is local, bounded, readonly, and token-budgeted;
- source refs link evidence but do not replace verifier evidence;
- external trace context is untrusted or rejected.

## Lane D: Validation / Docs / Synthesis

Goal: verify Line C planning evidence and prepare the next task spec decision.

Required proof:

- `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md`
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md`
- focused evidence/trace/event-log/TaskLoop unit tests;
- renderer pages/components IPC/Gateway bypass scan;
- service/exporter/listener scan over touched/planned evidence/trace surfaces;
- raw trace/payload/full checkpoint/full tool args-output retention scan;
- docs synthesis with a single `Status: accepted`, `needs_revision`, or
  `blocked`.

Acceptance:

- all validation commands and scan classifications are recorded;
- any `needs_revision` lane states exact fixes required;
- any `blocked` lane states the external blocker and why no safe planning
  progress remains;
- synthesis confirms readonly/shadow only.
