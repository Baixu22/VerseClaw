# Line C Synthesis: Evidence / Trace Grounding Planning

This is the Lane D validation/docs/synthesis closeout for the Line C grounding
spine planning pass. It is readonly/shadow only. It does not implement runtime
code, change TaskLoop/Gateway/runtime/provider ordering defaults, add a
completion gate, retain raw payloads, or introduce services/exporters/listeners
or databases.

## Inputs Reviewed

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/README.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/parallel-lanes.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-a-inventory.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-b-evidence-ref-normalization.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/lane-c-trace-source-query.md`
- `runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md`
- `runtime-research/handoffs/phase-6-trace-context-provider/synthesis.md`

Lane D started only after the Lane A/B/C submission files were present and read.

## Lane Decisions

| Lane | accepted | needs_revision | blocked | Decision |
| --- | --- | --- | --- | --- |
| Lane A: Inventory | yes | no | no | Accepted. It maps producers/consumers for EvidenceRef, TaskLoopEvidenceRef, trace/source spans, events, checkpoints, memory, AgentMap, Symbol, and future patch refs with trust and authority boundaries. |
| Lane B: Evidence Ref Normalization | yes | no | no | Accepted. It proposes a derived-only GroundingRef envelope with fixed `authority: "none"`, explicit trust/projection/sanitization metadata, renderer evidence as untrusted/projected, and memory as consumer-only. |
| Lane C: Trace / Source Query | yes | no | no | Accepted. It proposes a bounded local GroundingQuery over existing trace, event-log, checkpoint, verifier, evidence, and source-ref surfaces, with `includeRaw` rejected/false and source refs as evidence links only. |

Notes:

- Lane B contains two `Status: accepted` markers; both agree and this is not a
  blocking issue for planning.
- No lane is `needs_revision` or `blocked`.

## Final Relationship Table

| Source / producer | Derived grounding view | Consumer / query path | Trust and authority |
| --- | --- | --- | --- |
| TaskLoop legacy run records | `TaskLoopEvidenceRef`, projected file/test refs, checkpoint refs | Evidence verifier collectors, event-log/checkpoint shadow records, future GroundingRef view | Legacy TaskLoop outcomes stay authoritative. Grounding is supplied/projected, `authority: none`. |
| Canonical runtime evidence | `EvidenceRef` | Context items, verifier input/report, events, checkpoints, traces, memory/AgentMap/Symbol outputs | Supplied evidence material unless a verifier/human/promotion rule scopes a finding as verified. |
| Evidence Verifier | verifier report/finding refs | TaskLoop warning-only report, future grounding diagnostics | Verifier findings may be verified as deterministic findings, but do not become completion/runtime authority. |
| Runtime trace spans | trace refs plus `RuntimeTraceSourceRef[]` and `EvidenceRef[]` | `RuntimeTraceSpanStore`, `RuntimeTraceContextProvider`, future GroundingQuery | Local, sanitized, bounded, readonly. Source refs explain relevance but do not replace verifier evidence. |
| Runtime task events | event refs, trace context, evidence refs | event-log search/export summaries, verification sampling, future GroundingQuery | Supplied observability records only; sink failures do not affect TaskLoop. |
| Checkpoints | checkpoint id/state/open obligations/evidence refs/file hash keys/tool result ids | checkpoint serializer, resume diagnostics, verifier collectors, future GroundingQuery | Recovery material only. No full checkpoint payload retention in grounding view. |
| Runtime Memory | episode/fact/proposal source/evidence refs | memory provider and future grounding consumer | Consumer-only for this spine. Durable facts require verifier/human/deterministic promotion evidence. |
| AgentMap / Symbol | file/symbol/source/evidence anchors | readonly code context and future patch planning input | Projected/supplied readonly context; no prompt/provider/runtime authority. |
| Future patch planning | patch/source/test/evidence plan refs | future AST Patch Planner spec only | Planning-only. Apply behavior requires a separate accepted spec and operator rules. |

## Refs Unified vs Still Dispersed

Already unified:

- `EvidenceRef` is the canonical runtime evidence envelope and is shared through
  context items, tool results, runtime errors, events, checkpoints, traces,
  memory, AgentMap, and Symbol surfaces.
- `RuntimeTraceSpan` already binds trace identity, source refs, event refs, and
  evidence refs in one readonly span shape.
- Event-log and checkpoint serializer surfaces already wrap canonical runtime
  records with validation, ids, diagnostics, and evidence refs.
- Evidence verifier collectors already separate authoritative supplied refs from
  projected/untrusted renderer refs.
- Trace provider output is already budgeted readonly `ContextItem(kind: "trace")`
  material, not a trace dump or runtime command.

Still dispersed:

- `TaskLoopEvidenceRef` remains narrower than `EvidenceRef`; file/test refs are
  projected from `filesTouched` and `testsRun`.
- Trace source refs, memory source refs, AgentMap file/symbol fields, and Symbol
  checkpoint/range fields do not yet share one source-ref envelope.
- Trace query, event-log search, checkpoint lookup, verifier filters, memory
  queries, and future patch lookup overlap conceptually but are not one
  GroundingQuery contract.
- Trust/projection/sanitization metadata is local to each producer; there is no
  shared derived convention for `trust`, `projection`, `sanitized`,
  `rawRetained`, `origin`, or fixed `authority: "none"`.
- Future patch refs remain planning-only and have no implemented runtime
  contract.

## GroundingRef Recommendation

Draft the next spec around a derived view only:

```ts
type GroundingRefKind =
  | "evidence"
  | "file"
  | "test"
  | "tool"
  | "trace"
  | "source"
  | "checkpoint"
  | "event"
  | "event_log"
  | "verifier_report"
  | "verifier_finding"
  | "memory"
  | "symbol"
  | "patch";

type GroundingRefTrust = "verified" | "supplied" | "projected" | "untrusted";

type GroundingRef = {
  kind: GroundingRefKind;
  id: string;
  canonicalKey: string;
  evidenceRef?: EvidenceRef;
  sourceRef?: RuntimeTraceSourceRef;
  taskId?: string;
  traceId?: string;
  spanId?: string;
  eventId?: string;
  checkpointId?: string;
  toolCallId?: string;
  trust: GroundingRefTrust;
  authority: "none";
  projection: {
    derived: true;
    sourceSurface: string;
    sourceField: string;
    transform: string;
    lossy: boolean;
    rawRetained: false;
  };
  sanitization: {
    sanitized: true;
    rawRetained: false;
    labelLimit?: number;
    summaryLimit?: number;
    refLimit?: number;
    redacted?: string[];
    rejectedReason?: string;
  };
  metadata?: RuntimeCoreJsonObject;
};
```

Required recommendations:

- Keep `GroundingRef` derived-only. Do not mutate `EvidenceRef`,
  `TaskLoopEvidenceRef`, `RuntimeTraceSpan`, `RuntimeTaskEvent`, `Checkpoint`,
  memory, AgentMap, or Symbol source producers in the first implementation.
- Fix `authority: "none"` on every record. Grounding refs cannot decide
  completion, blocked/failed status, retry, security, tool permission, provider
  ordering, or runtime state.
- Treat trust as scoped to the derived record. A verifier finding can be
  `verified` as a deterministic finding while its linked file/test/tool refs
  remain supplied/projected.
- Renderer, external trace context, subagent text, raw chat/log/trace/tool I/O,
  and unsourced metadata stay untrusted or rejected.
- Memory consumes grounding refs but durable facts require verifier-backed,
  human-approved, or deterministic-rule promotion evidence.

## GroundingQuery Recommendation

Use one local, bounded, summary-only query envelope:

```ts
type GroundingQuery = {
  readonly: true;
  taskId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  linkedSpanId?: string;
  eventId?: string;
  checkpointId?: string;
  toolCallId?: string;
  spanName?: string;
  spanKind?: string;
  spanStatus?: "unset" | "ok" | "error";
  eventKind?: RuntimeTaskEventKind | RuntimeTaskEventKind[];
  checkpointState?: RuntimeTaskStatus;
  verifierDecision?: EvidenceVerifierDecision;
  verifierFindingCode?: EvidenceVerifierFindingCode;
  evidenceType?: EvidenceRefType;
  evidenceRef?: string;
  toolName?: string;
  file?: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  commit?: string;
  diffHash?: string;
  testCommand?: string;
  timeRange?: { start?: number; end?: number };
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
  maxTraceIds?: number;
  tokenBudget?: number;
  includeUntrusted?: false;
  includeRaw?: false;
};
```

Required recommendations:

- Adapt to existing `RuntimeTraceQuery`, `RuntimeTaskEventLogSearchQuery`,
  checkpoint fields, verifier report fields, and source refs.
- Default to sanitized summaries, ids, refs, bounded labels, counts, status,
  timestamps, and source anchors.
- Reject or ignore `includeRaw`; it must remain false.
- Keep pagination, trace ids, span counts, summaries, and output bounded by
  existing store/provider patterns and `tokenBudget`.
- Ranking is explanatory only: error/verifier/test/file/source/checkpoint
  relevance can order results, but cannot satisfy verifier evidence or change
  runtime policy.

## Validation Commands

| Command | Result | Classification |
| --- | --- | --- |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass: spec is valid | Required Phase 5 harness proof. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass: spec is valid | Required Phase 6 harness proof. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/task-loop-controller.test.ts` | pass: 7 files, 92 tests | Focused evidence/trace/event-log/TaskLoop proof. |

Environment notes:

- Plain `rtk` was not on PATH, but `C:\Users\27933\.cherrystudio\bin\rtk.exe`
  existed and was used for validation/tests/scans.
- The `bash_command` MCP tool mentioned in `AGENTS.md` was not exposed in this
  session, so available PowerShell tooling was used.
- `git` was not on this PowerShell PATH; no git operation was required for this
  readonly planning task.

## Scan Classifications

| Scan | Command shape | Result | Classification |
| --- | --- | --- | --- |
| Renderer pages/components boundary scan | `rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components --glob '!**/*.md'` | no matches | Pass. No renderer direct IPC, Gateway HTTP bypass, or direct WebSocket path found in pages/components. |
| Service/exporter/listener scan | `rg -n "\b(server|listener|WebSocketServer|OTLP|collector|exporter|Temporal|express|daemon|service|database|sqlite)\b|\.listen\(|http\.createServer|net\.createServer" <focused evidence/trace files>` | no matches | Pass. No service, exporter, listener, collector, database, daemon, HTTP/WS server, or Temporal surface in focused files. |
| Initial broad service string scan | broad pattern including `server` without word boundary | one false-positive match on `role-first-observer` import | Reviewed. False positive from `observer`; tighter scan was clean. |
| Raw trace/payload/full retention scan | raw trace/payload/checkpoint/tool args-output/secret keywords over focused source and tests | reviewed matches | Pass with classification below. No accepted grounding plan retains raw trace dumps, full payloads, full checkpoints, full tool args/output, env, credentials, or secrets. |

Raw retention match classification:

- `openclaw_runtime/src/runtime-core/trace-context.ts` matches are sanitizer
  denylist regexes, external `tracestate`/`baggage` parameter names, and bounded
  key-count/key-list handling. Values are redacted or not retained.
- `openclaw_runtime/src/runtime-core/evidence.ts` has the existing
  `contextSummary` checkpoint contract/fixture. This is pre-existing checkpoint
  summary material, not a new full checkpoint retention plan.
- `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts` mentions invalid
  serialized checkpoint JSON only in diagnostics; Line C rejects retaining or
  returning full checkpoint JSON.
- `openclaw_runtime/src/runtime-core/event-log.ts` matches are envelope
  validation/schema diagnostics, not new payload retention.
- `openclaw_runtime/src/agents/task-loop-controller.ts` matches are existing
  TaskLoop `contextSummary`, sensitive-task detection, sanitized external trace
  key counts, and compact structured summary paths. They remain legacy/shadow
  material and do not become GroundingRef raw retention.
- Test matches are redaction fixtures and assertions proving raw prompt/tool
  args/stdout/stderr/env/baggage/tracestate/secrets are redacted or bounded.

## Rejected-Boundary Audit

| Rejected boundary | Audit result |
| --- | --- |
| Runtime source implementation in this lane | Pass. Only this synthesis document is created. |
| Completion gate or verifier enforcement | Pass. Recommendation keeps verifier and grounding as warning/diagnostic/readonly only. |
| TaskLoop/Gateway/runtime/provider ordering default changes | Pass. No code changes and no planning acceptance for ordering defaults. |
| Renderer direct IPC/Gateway bypass | Pass. Renderer scan found no matches. |
| Service/exporter/listener/collector/daemon/database | Pass. Focused service/exporter/listener scan was clean. |
| Raw trace dumps/full payloads/full checkpoints/full tool args-output/env/secrets | Pass with classification. Matches are sanitizer code, bounded key handling, summaries, diagnostics, or tests. |
| External trace context as trusted authority | Pass. Lane C keeps it rejected or untrusted and non-authoritative. |
| Source refs replacing verifier evidence | Pass. Source refs are relevance/evidence links only. |
| Memory durable facts from unverified claims | Pass. Recommendation requires verifier/human/deterministic promotion evidence. |
| Future patch apply behavior | Pass. Patch refs remain planning-only and require a separate future spec. |

## Next Step Recommendation

Yes: draft a fresh harness task spec before any implementation. The next spec
should be a narrow `Grounding Spine` or `Evidence Trace Grounding Ref/Query`
task under `harness/specs/tasks/`.

That spec should require:

- readonly/shadow-only implementation;
- no completion gate, runtime authority, provider ordering cutover, or
  TaskLoop/Gateway/renderer transport change;
- no services/exporters/listeners/databases/sidecars;
- no raw trace/payload/checkpoint/tool args-output retention;
- derived-only `GroundingRef` / `GroundingQuery` helpers over existing producers;
- trust/projection/sanitization metadata with fixed `authority: "none"`;
- focused tests for derivation, dedupe, trust classification, query bounds,
  renderer/external untrusted handling, source refs as non-authoritative links,
  and no raw retention;
- repeated renderer boundary, service/exporter/listener, and raw-retention
  scans before synthesis.

Status: accepted
