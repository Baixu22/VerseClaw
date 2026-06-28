# Lane C: Trace / Source Query Planning

Line C designs a readonly query spine over already accepted trace, event-log,
checkpoint, verifier, evidence, and source-ref surfaces. It is a planning
handoff only. It does not implement runtime code, add a service, add
persistence, change provider ordering, or make trace/source refs authoritative.

## Read / Inspect Basis

Required docs were read, including the root and runtime `AGENTS.md` files,
RTK instructions, Line C README and lanes, Phase 6 synthesis and task spec,
OpenTelemetry trace/query/test notes, Temporal workflow semantics, and
OpenHands runtime-events notes.

Focused implementation/test anchors inspected:

- `openclaw_runtime/src/runtime-core/trace-context.ts`
  - trace/source/query shapes: lines 65-124
  - external trace context trust handling: lines 454-487
  - query/summary/ranking/sanitization: lines 489-570 and 636-905
- `openclaw_runtime/src/runtime-core/trace-context-store.ts`
  - in-memory bounds and query API: lines 14-145
  - store ranking and budgeted summary: lines 238-335
- `openclaw_runtime/src/context-engine/trace-context-provider.ts`
  - default-off shadow-only provider manifest: lines 45-77
  - provider query derivation: lines 210-249
  - budgeted context items and no-authority metadata: lines 276-343
  - provider ranking: lines 375-395
- `openclaw_runtime/src/runtime-core/event-log.ts`
  - `RuntimeTaskEventLogSearchQuery`: lines 109-117
  - local search/page behavior: lines 331-360 and 573-623
- `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts`
  - checkpoint snapshot/continue-as-new fields: lines 50-87 and 155-197
- `openclaw_runtime/src/runtime-core/evidence.ts`
  - `EvidenceRef` and `Checkpoint` fields: lines 14-51
- `openclaw_runtime/src/runtime-core/evidence-verifier.ts`
  - verifier input/report/findings: lines 146-179 and 420-455
- `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts`
  - TaskLoop, trace, renderer trust/projection collection: lines 168-270 and 340-410
- `openclaw_runtime/src/agents/task-loop-controller.ts`
  - TaskLoop evidence/verifier shadow surfaces: lines 134-218 and 1310-1460
  - shadow-only trace/event/checkpoint emission: lines 1816-2098
- Focused tests listed in the request, especially ranking, token budget,
  external trace context, event-log filtering, no raw retention, and source refs
  as evidence links.

Harness note: `pnpm harness context --spec harness/specs/tasks/phase-6-trace-context-provider.md`
was blocked by pnpm ignored-build-script policy in this checkout. Direct
`node harness/src/cli.mjs context --spec ...` and `node harness/src/cli.mjs validate --spec ...`
both succeeded. `rtk` was not on PATH in this PowerShell session.

## Readonly GroundingQuery Planning Shape

`GroundingQuery` is a derived local query envelope. It should adapt to existing
stores and records without changing their producers.

```ts
type GroundingQuery = {
  readonly: true;

  // Core identity anchors.
  taskId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  linkedSpanId?: string;
  eventId?: string;
  checkpointId?: string;
  toolCallId?: string;

  // Type and status filters.
  spanName?: string;
  spanKind?: "task" | "tool" | "test" | "verifier" | "checkpoint" | "resume" | "runtime" | "other";
  spanStatus?: "unset" | "ok" | "error";
  eventKind?: RuntimeTaskEventKind | RuntimeTaskEventKind[];
  checkpointState?: RuntimeTaskStatus;
  verifierDecision?: EvidenceVerifierDecision;
  verifierFindingCode?: EvidenceVerifierFindingCode;
  evidenceType?: EvidenceRefType;
  evidenceRef?: string;

  // Source and relevance anchors.
  toolName?: string;
  file?: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  commit?: string;
  diffHash?: string;
  testCommand?: string;

  // Windowing and bounded output.
  timeRange?: { start?: number; end?: number };
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
  maxTraceIds?: number;
  tokenBudget?: number;

  // Trust and retention controls.
  includeUntrusted?: false;
  includeRaw?: false;
};
```

Required behavior:

- The default result is summary/ref-only, not payload/raw-data output.
- `includeRaw` is always rejected or ignored as false.
- `includeUntrusted` defaults to false; if a future diagnostic view needs
  projected/untrusted entries, they must stay labeled as untrusted and
  non-authoritative.
- The query must return cloned/sanitized records or summaries only.
- It must not mutate TaskLoop, event-log, checkpoint, verifier, trace store, or
  provider state.

## Query Mapping

### RuntimeTraceQuery

Direct mapping:

| GroundingQuery | RuntimeTraceQuery |
|---|---|
| `traceId` | `traceId` |
| `spanId` | `spanId` |
| `parentSpanId` | `parentSpanId` |
| `linkedSpanId` | `linkedSpanId` |
| `taskId` | `taskId` through span attribute `task.id` |
| `toolName` | `toolName` through span attribute `tool.name` |
| `file` | `file` through `RuntimeTraceSourceRef.file` |
| `symbol` | `symbol` through `RuntimeTraceSourceRef.symbol` |
| `spanName` | `name` |
| `spanKind` | `kind` |
| `spanStatus` | `status` |
| `timeRange` | `timeRange` |

Derived filtering after `RuntimeTraceQuery`:

- `checkpointId`: filter checkpoint spans whose attributes contain
  `checkpointId`, or spans linked to a checkpoint event/ref.
- `evidenceType` / `evidenceRef`: filter span `evidenceRefs` and event
  `evidenceRefs`; do not treat existence as verifier approval.
- `testCommand`: prefer `span.kind === "test"`, test evidence refs, or source
  refs under test files; no raw test output.
- `startLine` / `endLine` / `commit` / `diffHash`: filter within
  `RuntimeTraceSourceRef` after the native file/symbol query.
- `verifierDecision` / `verifierFindingCode`: join only through verifier refs
  or TaskLoop verifier shadow summaries; no verifier decision is recomputed.

Use `RuntimeTraceSpanStore.query`, `findTrace`, `findSpan`, `findChildren`,
`findLinkedSpans`, and `summarizeTrace` as local helpers. The store is bounded
in memory (`maxSpans`, `maxSpansPerTrace`) and returns cloned snapshots.

### RuntimeTaskEventLogSearchQuery

Direct mapping:

| GroundingQuery | RuntimeTaskEventLogSearchQuery |
|---|---|
| `taskId` | `taskId` |
| `eventKind` | `kind` |
| `timeRange.start` | `timestampGte` |
| `timeRange.end` | `timestampLt` |
| `sortOrder` | `sortOrder` |
| `page` | `page` |
| `limit` | `limit` |

Lookup or derived filtering:

- `eventId`: use `getByEventId` / `batchGet`, not `search`.
- `traceId`, `spanId`, `parentSpanId`: filter `record.event.traceContext`.
- `checkpointId`: filter `event.kind === "checkpoint"` and
  `event.payload.checkpoint.checkpointId`, plus `traceContext.attributes.checkpointId`.
- `toolCallId`: filter `tool_call_request` / `tool_call_result` payload
  `callId`, and verifier findings that cite `toolCallId`.
- `evidenceType` / `evidenceRef`: filter `event.evidenceRefs`,
  evidence-event payload refs, tool result evidence, runtime error evidence refs,
  and checkpoint payload evidence refs.
- `file`, `symbol`, `testCommand`: event-log has no native source index; derive
  only from evidence refs, checkpoint file hashes, or trace refs linked from the
  event.

Pagination must be applied after filtering, matching existing event-log tests.
The grounding spine must not introduce an event listener, callback, daemon,
exporter, or service.

### Checkpoint Fields

Map checkpoint anchors from `Checkpoint` and `RuntimeCheckpointSnapshot`:

| GroundingQuery | Checkpoint source |
|---|---|
| `checkpointId` | `checkpoint.checkpointId`; TaskLoop resume checkpoint `id` |
| `taskId` | `checkpoint.taskId`; continue-as-new `parentTaskId` / `nextTaskId` |
| `checkpointState` | `checkpoint.state` |
| `toolCallId` | `checkpoint.toolResults[].callId`; snapshot `toolResultRefs[]` |
| `file` | `Object.keys(checkpoint.fileHashes)` and projected file evidence |
| `evidenceType` / `evidenceRef` | `checkpoint.evidenceRefs`, tool result evidence, error evidence |
| `timeRange` | event-log checkpoint event timestamp or TaskLoop checkpoint metadata timestamp |

Checkpoint fields may contribute compact summaries:

- checkpoint id, task id, state;
- open obligation count and bounded labels;
- file hash keys, not full file contents;
- tool result call ids and statuses, not full tool outputs or structured data;
- evidence refs and schema/version markers;
- continue-as-new parent/next task ids, reason, and evidence refs.

Do not retain or return full checkpoint JSON, full `contextSummary`, full tool
args/output, full structured data, env, or secrets.

### Verifier Refs

Map verifier anchors from `EvidenceVerifierInput`, `EvidenceVerifierReport`,
TaskLoop verifier shadow reports, and collector metadata:

| GroundingQuery | Verifier source |
|---|---|
| `taskId` | verifier input/report `taskId` |
| `verifierDecision` | report `decision` |
| `verifierFindingCode` | finding `code` |
| `evidenceType` / `evidenceRef` | report/input/finding/obligation `evidenceRefs` |
| `toolCallId` | finding `toolCallId`, tool result `callId` |
| `testCommand` | evidence refs of type `test`; missing-test findings |
| `checkpointId` | checkpoint diagnostics/evidence refs and replay diagnostics |
| `traceId` / `spanId` | trace evidence refs with metadata from collectors |

Trust mapping:

- Runtime, TaskLoop, tool result, event replay, checkpoint, trace, and human
  evidence refs are supplied evidence, not automatic proof.
- Renderer evidence is projected/untrusted and must not become authoritative.
- Verifier evidence remains the proof source. Trace/source refs can explain why
  a context item is relevant, but they cannot replace verifier findings,
  required evidence kinds, or human-approved evidence.

### Source Refs

Map source refs from `RuntimeTraceSourceRef`:

| GroundingQuery | RuntimeTraceSourceRef |
|---|---|
| `file` | `file` |
| `startLine` | `startLine` |
| `endLine` | `endLine` |
| `symbol` | `symbol` |
| `commit` | `commit` |
| `diffHash` | `diffHash` |

Source refs are evidence links only. They can support file/symbol/test
relevance and context selection, but a source ref does not prove that a file was
changed, a test passed, or a verifier obligation was satisfied.

## Ranking Proposal

Ranking should combine existing trace/store/provider ordering with event,
checkpoint, verifier, source, and test relevance. The result is explanatory
ordering only, never policy.

Suggested score tiers:

| Signal | Score | Notes |
|---|---:|---|
| Error span, runtime error event, failed tool result, verifier error finding, inconsistent replay | +1,000,000 | First diagnostic priority. |
| Exact current tool/file/symbol/test match | +850,000 | Prefer exact source/test/tool relevance over generic task matches. |
| Test span/ref or verifier span/ref/report | +600,000 | Mirrors existing test/verifier priority. |
| Evidence-linked span/ref or resume/checkpoint link | +400,000 | Includes trace links with `relationship: "evidence"` or `"resume"` and checkpoint refs. |
| Checkpoint with open obligations/review-needed items | +300,000 | Useful for resume/source grounding, but not verifier proof. |
| Same task/run/session | +100,000 | Broad relevance only. |
| Same trace sibling or nearby event time window | +10,000 | Last-resort context. |

Tie-breakers:

1. Exact file plus symbol/range match.
2. Exact test command or test evidence ref.
3. Same checkpoint id or tool call id.
4. Existing deterministic order: trace `startedAt`, event timestamp, event
   sequence, then original insertion order.
5. Prefer trusted/supplied refs over projected/untrusted refs; never use
   projected/untrusted refs to satisfy verifier evidence requirements.

File relevance:

- exact normalized file path in source refs;
- file evidence refs;
- checkpoint `fileHashes` key;
- TaskLoop `filesTouched` projection;
- nearby symbol/range match;
- same trace/task fallback.

Symbol relevance:

- exact `RuntimeTraceSourceRef.symbol`;
- matching source range in same file;
- verifier or evidence summary that cites the symbol, only as weak text
  relevance and only after sanitization.

Test relevance:

- exact `EvidenceRef(type: "test", ref: testCommand)`;
- `span.kind === "test"` or `name === "test.run"`;
- verifier missing-test findings;
- checkpoint or TaskLoop `testsRun` projection;
- test file source refs.

## Token Budget And No-Full-Dump Rules

Budget defaults and caps should follow the Phase 6 pattern:

- default public query/context budget: 256 tokens unless caller supplies a
  smaller or larger bounded value;
- provider trace id discovery cap: default 3 trace ids;
- trace store bounds: bounded in-memory span counts, not unbounded retention;
- internal summarization can use a larger temporary budget, but output must obey
  `GroundingQuery.tokenBudget`.

No-full-dump rules:

- No raw trace dump.
- No raw prompt or raw message payload.
- No full event payload.
- No full checkpoint JSON.
- No full tool args, full tool output, stdout, stderr, or structured data.
- No env, credential, token, API key, authorization header, private key, or
  baggage/tracestate values.
- No unbounded command output or test output.
- No source file content dump from this query spine.

Allowed output:

- ids and refs;
- bounded/redacted summaries;
- counts;
- statuses and timestamps;
- source file/range/symbol anchors;
- evidence refs with sanitized metadata;
- verifier decision/finding codes and bounded messages;
- checkpoint state/open-obligation counts and bounded labels.

The first high-priority item may be truncated to fit a tiny budget, matching
current trace summary/provider behavior. Lower-ranked items are omitted with an
omitted count.

## External Trace Context Trust Handling

External `traceparent`, `tracestate`, and `baggage` are hostile input.

Required handling:

- Missing traceparent: reject as `missing`.
- Malformed traceparent: reject as `malformed`.
- Invalid W3C values such as version `ff`, all-zero trace id, or all-zero parent
  span id: reject as `invalid`.
- Valid external traceparent: mark as `trusted: false` and `source: "external"`.
- Store or return only trace id, parent span id, trace flags, and bounded
  `tracestateKeys` / `baggageKeys`; never store values.
- Do not merge external trace ids into local runtime authority. Local trace ids
  should be re-rooted or linked only as untrusted context when an explicit
  propagation flag is enabled.
- Do not use external baggage/tracestate to rank source/test relevance, grant
  permissions, choose providers, retry tools, or satisfy verifier evidence.

TaskLoop already records external trace context only as an optional shadow span
event when propagation and shadow flags are enabled; that boundary should stay.

## Explicit Rejections

This lane rejects:

- OpenTelemetry SDK wiring, exporter, collector, OTLP upload, daemon, or
  observability platform.
- Any service, listener, HTTP server, WebSocket server, webhook, callback
  processor, second Gateway, or second runtime process.
- Any external database, SQLite schema, JSONL sidecar, indexer service, or
  persistence layer for grounding query state.
- Any default-on trace provider or provider ordering cutover.
- Any Main/Gateway/renderer transport cutover or direct renderer Gateway/IPC
  path.
- Any completion gate, verifier authority, security policy, retry policy,
  permission policy, or runtime execution policy based on trace/source query
  output.
- Any raw trace dump, full payload, full checkpoint, full tool args/output,
  env, or secret retention.

## Acceptance Notes

The plan can be accepted because it is fully derived from existing bounded,
sanitized, readonly/shadow surfaces:

- `RuntimeTraceQuery` and `RuntimeTraceSpanStore` already support trace, span,
  parent, linked, task, tool, file, symbol, status, and time filters.
- `RuntimeTaskEventLogSearchQuery` already supports task, kind, timestamp,
  sorting, and pagination; trace/source/evidence filters remain derived.
- Checkpoint and continue-as-new fields provide ids, task links, state,
  obligation, tool-result refs, file-hash keys, schema markers, and evidence
  refs without needing full checkpoint dumps.
- Evidence verifier collectors already separate authoritative supplied refs
  from projected/untrusted renderer refs.
- Trace context provider output already marks source refs as evidence links only
  and no verifier/runtime authority.
- Focused tests cover ranking, budget truncation, raw redaction, source refs as
  evidence links only, default-off provider behavior, external traceparent
  trust handling, and event-log filtering/pagination.

Trace/source refs link evidence. They do not replace verifier evidence.

Status: accepted
