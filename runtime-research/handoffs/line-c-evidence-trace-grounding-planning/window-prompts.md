# Line C Window Prompts

Status: accepted

Use these prompts for parallel planning windows. This is concurrency-first:
run lanes A-C at the same time, then run lane D after A-C submit their notes.
No lane should implement runtime code.

## Recommended Run Order

```text
Wave 0: coordinator prep
  -> read README.md and parallel-lanes.md
  -> create empty submissions folder if desired

Wave 1: concurrent planning
  -> Lane A inventory
  -> Lane B evidence ref normalization
  -> Lane C trace/source query

Wave 2: convergence
  -> Lane D validation/docs/synthesis

Wave 3: optional follow-up
  -> next task spec draft only if Lane D accepts the plan
```

Concurrency guidance:

- Run Lane A, Lane B, and Lane C in parallel. They read overlapping code, but
  their deliverables are separate and should not edit shared source files.
- Give each lane its own output file under
  `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/`.
- Lane D should start only after A-C have produced submissions, because it is
  the synthesis/validation lane.
- If a lane finds a hard contradiction, it should write `Status: needs_revision`
  in its own submission instead of editing the central README.
- Keep all lanes readonly/shadow only. No TaskLoop/Gateway/runtime cutover, no
  provider-ordering cutover, no completion gate, and no service/exporter work.

## Wave 0: Coordinator Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are the Line C coordinator for Evidence / Trace Grounding spine planning.
Do not implement code.

Read:
- AGENTS.md
- C:\Users\27933\.codex\RTK.md
- openclaw_runtime/AGENTS.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/README.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/parallel-lanes.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/window-prompts.md

Task:
1. Confirm the submissions directory exists:
   runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/
2. Start Lane A, Lane B, and Lane C in parallel windows using the prompts below.
3. Do not edit runtime code or harness specs in this coordinator pass.
4. After A-C are done, start Lane D synthesis.

Boundary:
- readonly / shadow only.
- No Evidence Verifier completion blocking gate.
- No TaskLoop/Gateway/runtime cutover.
- No provider ordering default cutover.
- No OpenTelemetry exporter, collector, daemon, listener, database, or service.
- No evidence/trace runtime authority.
```

## Wave 1 Lane A: Inventory Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line C Lane A: inventory for Evidence / Trace Grounding spine.
Do not implement code.

Read first:
- AGENTS.md
- C:\Users\27933\.codex\RTK.md
- openclaw_runtime/AGENTS.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/README.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/parallel-lanes.md
- runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md
- runtime-research/handoffs/phase-6-trace-context-provider/synthesis.md

Inspect:
- openclaw_runtime/src/runtime-core/evidence.ts
- openclaw_runtime/src/runtime-core/evidence-verifier.ts
- openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts
- openclaw_runtime/src/runtime-core/trace-context.ts
- openclaw_runtime/src/runtime-core/trace-context-store.ts
- openclaw_runtime/src/context-engine/trace-context-provider.ts
- openclaw_runtime/src/runtime-core/event-log.ts
- openclaw_runtime/src/runtime-core/checkpoint-serializer.ts
- openclaw_runtime/src/agents/task-loop-controller.ts
- memory / AgentMap / Symbol files if present under openclaw_runtime/src/runtime-core and openclaw_runtime/src/context-engine

Task:
Create:
runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-a-inventory.md

Include:
1. Producer/consumer table for EvidenceRef, TaskLoopEvidenceRef, RuntimeTraceSourceRef, RuntimeTraceSpan, RuntimeTaskEvent, Checkpoint, memory refs, AgentMap refs, Symbol refs, and future patch refs.
2. Relationship map of evidence/trace/event-log/checkpoint/verifier surfaces.
3. Trust classification for each source: verified, supplied, projected, untrusted, or unknown.
4. List of refs already unified and refs still dispersed.
5. Specific file/function/test citations.
6. Status: accepted / needs_revision / blocked.

Boundary:
- readonly / shadow only.
- Do not change runtime code.
- Do not claim evidence/trace authority over completion, security, retry, permission, provider ordering, or runtime behavior.
```

## Wave 1 Lane B: Normalization Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line C Lane B: evidence ref normalization planning.
Do not implement code.

Read first:
- AGENTS.md
- C:\Users\27933\.codex\RTK.md
- openclaw_runtime/AGENTS.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/README.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/parallel-lanes.md
- runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md
- harness/specs/tasks/phase-5-evidence-verifier.md

Inspect:
- openclaw_runtime/src/runtime-core/evidence.ts
- openclaw_runtime/src/runtime-core/evidence-verifier.ts
- openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts
- openclaw_runtime/src/agents/task-loop-controller.ts
- openclaw_runtime/src/runtime-core/checkpoint-serializer.ts
- openclaw_runtime/src/runtime-core/event-log.ts
- tests/unit/runtime-evidence-verifier-contracts.test.ts
- tests/unit/runtime-evidence-verifier-collectors.test.ts
- tests/unit/task-loop-controller.test.ts

Task:
Create:
runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-b-evidence-ref-normalization.md

Include:
1. Proposed readonly derived GroundingRef planning shape.
2. Mapping from current EvidenceRef / TaskLoopEvidenceRef / filesTouched / testsRun / checkpoint / event-log / verifier report data into GroundingRef.
3. Trust/projection/sanitization metadata conventions.
4. Rules for renderer evidence as untrusted/projected only.
5. Rules for memory durable facts: no unverified durable claims.
6. Compatibility risks and fields that must remain derived-only.
7. Status: accepted / needs_revision / blocked.

Boundary:
- Do not change TaskLoopEvidenceRef.
- Do not add an Evidence Verifier blocking completion gate.
- Do not add persistence or raw payload retention.
- Do not create runtime/security/retry/tool-permission authority.
```

## Wave 1 Lane C: Trace / Source Query Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line C Lane C: trace/source query planning.
Do not implement code.

Read first:
- AGENTS.md
- C:\Users\27933\.codex\RTK.md
- openclaw_runtime/AGENTS.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/README.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/parallel-lanes.md
- runtime-research/handoffs/phase-6-trace-context-provider/synthesis.md
- harness/specs/tasks/phase-6-trace-context-provider.md
- runtime-research/opentelemetry/trace-model.md
- runtime-research/opentelemetry/query-and-source-mapping.md
- runtime-research/opentelemetry/useful-tests.md
- runtime-research/temporal/workflow-semantics.md
- runtime-research/openhands/runtime-events.md

Inspect:
- openclaw_runtime/src/runtime-core/trace-context.ts
- openclaw_runtime/src/runtime-core/trace-context-store.ts
- openclaw_runtime/src/context-engine/trace-context-provider.ts
- openclaw_runtime/src/runtime-core/event-log.ts
- openclaw_runtime/src/runtime-core/checkpoint-serializer.ts
- openclaw_runtime/src/agents/task-loop-controller.ts
- tests/unit/runtime-trace-context-contracts.test.ts
- tests/unit/runtime-trace-context-store.test.ts
- tests/unit/runtime-trace-context-provider.test.ts
- tests/unit/runtime-event-log-store.test.ts

Task:
Create:
runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-c-trace-source-query.md

Include:
1. Proposed readonly GroundingQuery planning shape.
2. Mapping from query fields to RuntimeTraceQuery, RuntimeTaskEventLogSearchQuery, checkpoint fields, verifier refs, and source refs.
3. Ranking proposal for error/test/verifier/evidence-linked spans and file/symbol/test relevance.
4. Token budget and no-full-dump rules.
5. External traceparent/tracestate/baggage trust handling.
6. Service/exporter/listener/database boundaries to reject.
7. Status: accepted / needs_revision / blocked.

Boundary:
- No OpenTelemetry exporter/collector/daemon/listener.
- No external database or service.
- No default-on trace provider or provider ordering cutover.
- No raw trace dump, full payload, full checkpoint, full tool args/output, env, or secret retention.
- Trace/source refs link evidence; they do not replace verifier evidence.
```

## Wave 2 Lane D: Validation / Synthesis Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line C Lane D: validation, docs, and synthesis.
Do not implement runtime code.

Read first:
- AGENTS.md
- C:\Users\27933\.codex\RTK.md
- openclaw_runtime/AGENTS.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/README.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/parallel-lanes.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-a-inventory.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-b-evidence-ref-normalization.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-c-trace-source-query.md
- runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md
- runtime-research/handoffs/phase-6-trace-context-provider/synthesis.md

Task:
Create:
runtime-research/handoffs/line-c-evidence-trace-grounding-planning/synthesis.md

Run or record:
- node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md
- node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md
- node node_modules/vitest/vitest.mjs run tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/task-loop-controller.test.ts
- renderer pages/components boundary scan for direct ipcRenderer.invoke, Gateway HTTP, localhost:18789, and new WebSocket
- service/exporter/listener scan over touched evidence/trace planning surfaces
- raw trace/payload/full checkpoint/full tool args-output retention scan

Include:
1. Accepted / needs_revision / blocked table for Lanes A-C.
2. Final relationship diagram or table.
3. Final list of unified refs vs dispersed refs.
4. Final GroundingRef and GroundingQuery planning recommendation.
5. Validation command results and scan classifications.
6. Explicit rejected-boundary audit.
7. Next-step recommendation: whether to draft a fresh harness task spec.
8. Exactly one final status line:
   Status: accepted
   or
   Status: needs_revision
   or
   Status: blocked

Boundary:
- readonly / shadow only.
- Do not edit runtime source.
- Do not add a completion gate.
- Do not touch TaskLoop/Gateway/runtime/provider ordering defaults.
- Do not introduce services/exporters/listeners/databases.
```

## Wave 3 Optional: Next Task Spec Prompt

Use this only if Lane D synthesis is accepted.

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are drafting the next harness task spec for Line C Evidence / Trace
Grounding spine. This is spec-only unless explicitly asked otherwise.

Read:
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/synthesis.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/README.md
- runtime-research/handoffs/line-c-evidence-trace-grounding-planning/parallel-lanes.md
- harness/specs/tasks/phase-5-evidence-verifier.md
- harness/specs/tasks/phase-6-trace-context-provider.md

Task:
Draft a fresh harness task spec for a readonly/shadow grounding spine MVP.
The spec must require:
- derived normalization only;
- no default behavior changes;
- no completion gate;
- no TaskLoop/Gateway/runtime cutover;
- no provider ordering cutover;
- no service/exporter/listener/database;
- no raw payload/full trace retention;
- verified/human-approved evidence before durable fact promotion;
- focused tests and scans.

Do not implement runtime code.
```
