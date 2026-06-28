# Lane B: Evidence Ref Normalization

Status: accepted

## Scope

This submission designs a readonly derived normalization envelope for
evidence-like references. It does not implement code, change runtime behavior,
change `TaskLoopEvidenceRef`, add an Evidence Verifier completion gate, add
persistence, retain raw payloads, or introduce runtime/security/retry/tool
permission authority.

## Inputs Read

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/README.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/parallel-lanes.md`
- `runtime-research/handoffs/phase-5-evidence-verifier/synthesis.md`
- `harness/specs/tasks/phase-5-evidence-verifier.md`

Focused implementation/test evidence inspected:

- `openclaw_runtime/src/runtime-core/evidence.ts`
- `openclaw_runtime/src/runtime-core/evidence-verifier.ts`
- `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts`
- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `openclaw_runtime/src/agents/task-loop-context.ts`
- `openclaw_runtime/src/agents/long-task-control/store.ts`
- `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts`
- `openclaw_runtime/src/runtime-core/event-log.ts`
- `openclaw_runtime/src/runtime-core/events.ts`
- `openclaw_runtime/src/runtime-core/trace-context.ts`
- `openclaw_runtime/src/runtime-core/memory-context.ts`
- `tests/unit/runtime-evidence-verifier-contracts.test.ts`
- `tests/unit/runtime-evidence-verifier-collectors.test.ts`
- `tests/unit/task-loop-controller.test.ts`
- `tests/unit/runtime-memory-context-contracts.test.ts`

## Readonly Derived GroundingRef Planning Shape

`GroundingRef` is a planning shape only. It is a derived view over existing
runtime refs and summaries, not a new producer contract.

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
  | "memory";

type GroundingRefTrust =
  | "verified"
  | "supplied"
  | "projected"
  | "untrusted";

type GroundingRef = {
  kind: GroundingRefKind;
  id: string;
  canonicalKey: string;

  evidenceRef?: EvidenceRef;
  sourceRef?: RuntimeTraceSourceRef;

  taskId?: string;
  loopRunId?: string;
  eventId?: string;
  checkpointId?: string;
  traceId?: string;
  spanId?: string;

  trust: GroundingRefTrust;
  authority: "none";

  projection: {
    derived: true;
    sourceSurface: string;
    sourceField: string;
    transform:
      | "identity"
      | "task_loop_ref_to_evidence_ref"
      | "file_string_to_evidence_ref"
      | "test_string_to_evidence_ref"
      | "checkpoint_ref_to_evidence_ref"
      | "event_to_grounding_ref"
      | "verifier_report_to_grounding_ref"
      | "memory_ref_to_grounding_ref";
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

Trust is scoped to the derived record, not to the truth of a broad claim:

- `verified`: the immediate derived record is backed by an accepted deterministic
  verifier report, accepted memory promotion evidence, human approval, or an
  accepted deterministic rule. It still has `authority: "none"`.
- `supplied`: the source was already a valid runtime shape such as canonical
  `EvidenceRef`, `RuntimeTaskEvent.evidenceRefs`, tool result evidence, checkpoint
  evidence refs, or TaskLoop evidence refs converted through existing helpers.
- `projected`: the source was not an `EvidenceRef` and was synthesized from
  another field such as `filesTouched`, `testsRun`, checkpoint id, event id, or
  report/finding identity.
- `untrusted`: the source is renderer-collected evidence, external trace context,
  or model/subagent text content that has not been corroborated.

## Current Mapping To GroundingRef

| Current surface | Current evidence | Derived GroundingRef mapping |
| --- | --- | --- |
| `EvidenceRef` | `evidence.ts` defines canonical types: `file`, `test`, `trace`, `tool`, `human`, `session`, `subagent`, `memory`, `task_loop`, `clawgraph`, `task_ledger`, `checkpoint`, `manual`, `other`. | `kind: "evidence"` plus a more specific view kind when useful. `canonicalKey = evidence:<type>:<ref>`. `trust` defaults to `supplied` unless metadata or source boundary marks it renderer/external/projected. Preserve `type`, `ref`, bounded `label`, bounded `summary`, and sanitized metadata only. |
| `TaskLoopEvidenceRef` | `task-loop-context.ts` allows only `trace`, `subagent`, `tool`, `manual`, `other` with optional label/summary. | Use the existing `taskLoopEvidenceRefToRuntime()` projection as the model: same type when allowed, else `other`. `canonicalKey = task_loop:<type>:<ref>`. `trust: "supplied"`, `projection.lossy: true` because `TaskLoopEvidenceRef` has no metadata and narrower type coverage. Do not add file/test/checkpoint variants to this source type. |
| `filesTouched` | TaskLoop gate/subagent/checkpoint fields are string lists. `evidenceRefForFile()` and `collectTaskLoopEvidence()` already project file strings into `EvidenceRef(type: "file")`. | `kind: "file"` and `evidenceRef.type: "file"`. `trust: "projected"`, `sourceField: "filesTouched"`, `transform: "file_string_to_evidence_ref"`, `lossy: true`. Keep the string as a sanitized ref only; no file hash/read/stat is implied. |
| `testsRun` | TaskLoop gate/subagent/checkpoint fields are command strings. `evidenceRefForTest()` and `collectTaskLoopEvidence()` already project test strings into `EvidenceRef(type: "test")`. | `kind: "test"` and `evidenceRef.type: "test"`. `trust: "projected"`, `sourceField: "testsRun"`, `transform: "test_string_to_evidence_ref"`, `lossy: true`. A claimed test command is evidence of a reported run, not proof that the test passed unless verified elsewhere. |
| Tool results | `EvidenceVerifierInput.toolResults` and `ToolCallResult.evidence` carry canonical evidence refs; verifier findings cite failed/denied/cancelled results. | `kind: "tool"` for tool call identity and `kind: "evidence"` for each result evidence ref. Successful tool evidence remains `supplied`; failed/denied/cancelled findings may derive `verifier_finding` refs with `trust: "verified"` for the finding only. |
| Runtime checkpoint | `RuntimeResumeCheckpoint` stores `filesTouched`, `testsRun`, and narrow `{ type, ref, label }` evidence refs. `runtimeEvidenceRefsFromResumeCheckpoint()` normalizes those refs and prepends a checkpoint ref when missing. `buildRuntimeCoreCheckpointFromResumeCheckpoint()` derives canonical `Checkpoint`. | Derive one `kind: "checkpoint"` ref for `checkpointId`, plus evidence/file/test refs from the checkpoint fields. Checkpoint evidence refs are `supplied`; checkpoint id/file/test projections are `projected`. Store only ids, state, counts, diagnostic codes, and sanitized summaries. Do not retain full checkpoint payloads. |
| Checkpoint serializer | `serializeRuntimeCheckpoint()` and `deserializeRuntimeCheckpoint()` return snapshot/checkpoint plus diagnostics such as `invalid_checkpoint`, `missing_checkpoint_payload`, and `schema_marker_mismatch`. | Derive `checkpoint` and `event_log` diagnostic grounding refs from codes and ids. Diagnostics can mark related verifier event replay as `failed`, but the grounding ref itself has `authority: "none"` and no raw JSON retention. |
| Runtime event-log | `RuntimeTaskEventLogRecord` wraps `RuntimeTaskEvent`; event carries `eventId`, `taskId`, `kind`, `timestamp`, optional `traceContext`, and `evidenceRefs`. Search is bounded by task/kind/time/page/limit. | Derive `kind: "event"` for `eventId`, `kind: "event_log"` for append/search diagnostics, `kind: "trace"` from trace context ids, and evidence refs from `event.evidenceRefs`. Event payloads are summarized by kind/status/counts only; no full payload retention. |
| Runtime trace/source | `RuntimeTraceSpan` has `traceId`, `spanId`, `sourceRefs`, events with evidence refs, and span evidence refs. `sanitizeExternalRuntimeTraceContext()` marks external context untrusted. | Derive `kind: "trace"` for trace/span ids, `kind: "source"` for sanitized file/range/symbol/commit/diffHash refs, and linked evidence refs. Internal sanitized spans are `supplied`; external trace context is always `untrusted` and cannot verify a claim. |
| Evidence verifier report | `EvidenceVerifierReport` contains `taskId`, `objective`, `decision`, `findings`, `requiredEvidenceKinds`, `evidenceRefs`, and `legacyDecisionUnaffected: true`. TaskLoop embeds it only as warning-only shadow. | Derive `kind: "verifier_report"` for the report and `kind: "verifier_finding"` for each finding. Report/finding derivations can use `trust: "verified"` for deterministic evaluation of the supplied input, but never runtime completion authority. Linked report evidence refs keep their own source trust unless explicitly scoped as "verified by report X". |
| Local control-plane evidence reports | TaskLoop can emit observe-only evidence reports with report evidence refs and compact payload summaries. | Treat as `kind: "event"` or `kind: "verifier_report"` summaries with `trust: "projected"` unless they reference an accepted verifier report. The payload is a summary source, not raw evidence. |
| Runtime Memory episode/fact refs | Memory contracts require source episode refs and evidence refs; accepted facts require accepted verification status, finite `acceptedAt`, and promotion evidence. | Memory is a consumer. Grounding refs may support candidate facts, accepted facts, and invalidations, but durable facts are eligible only when promotion evidence is verifier-backed, human-approved, or deterministic-rule backed. |

## Trust, Projection, And Sanitization Metadata

Every derived ref should carry these conventions:

- `authority: "none"` is fixed. Grounding refs cannot decide completion,
  blocked status, retry, security, tool permission, provider ordering, or runtime
  state.
- `projection.derived` is always `true`; this is a view over current refs.
- `projection.rawRetained` and `sanitization.rawRetained` are always `false`.
- `projection.lossy` must be `true` when deriving from plain strings,
  TaskLoop's narrower ref type, checkpoint narrow refs, event payload summaries,
  or verifier report summaries.
- `sanitization.sanitized` is always `true`; refs, labels, summaries, source
  refs, attributes, and metadata must use the existing bounded sanitization
  conventions before entering the derived view.
- Metadata may include source ids, counts, diagnostic codes, verifier decision,
  finding code, `legacyDecisionUnaffected`, `shadowOnly`, and source field names.
  It must not include raw prompts, raw trace dumps, full event payloads, full
  checkpoints, full tool args/output, environment data, or secrets.
- Trust upgrades are local and scoped. For example, a verifier finding can be
  `verified` as a deterministic finding, while the linked file/test/tool refs
  remain `supplied` or `projected`.

## Renderer Evidence Rule

Renderer-collected evidence can only become untrusted projected grounding:

- If collector input has `source: "renderer"`, `splitByAuthority()` leaves
  `authoritativeEvidenceRefs` empty and records `untrusted_renderer_evidence`.
- Derived refs from renderer `filesTouched`, `testsRun`, or supplied
  `EvidenceRef[]` must use `trust: "untrusted"` and `projection.derived: true`.
- Renderer refs must not satisfy verifier-required evidence kinds unless a
  non-renderer source supplies or verifies the same claim.
- Renderer refs must not promote memory facts, justify checkpoint recovery
  truth, or become runtime/security/retry/tool-permission authority.
- Renderer metadata should retain only sanitized projection facts such as
  `source: "renderer"`, `sourceProjected: true`, and `trusted: false`.

## Memory Durable Facts Rule

Runtime Memory may consume grounding refs, but it must not accept unverified
durable claims:

- Candidate facts may cite grounding refs as source material, but remain
  candidates/proposals.
- Durable `RuntimeMemoryTemporalFact` requires accepted verification status,
  finite `acceptedAt`, source episode refs, evidence refs, and promotion evidence.
- Valid promotion evidence is verifier-backed, human-approved, or accepted
  deterministic-rule backed. Renderer, external trace, raw trace, raw chat,
  subagent text, and projected file/test strings are not enough by themselves.
- Current-valid memory queries must continue excluding candidate, rejected,
  invalidated, expired, and unpromoted facts by default.
- Grounding normalization must not add memory persistence, automatic extraction,
  automatic promotion, provider ordering cutover, or memory-derived runtime
  authority.

## Derived-Only Fields

These fields and interpretations must remain derived-only in a future
implementation spec:

- `GroundingRef`, `GroundingRefTrust`, `projection`, `sanitization`, and
  `authority: "none"`.
- `canonicalKey`, derived `id`, source surface/field names, and dedupe keys.
- File/test evidence refs projected from `filesTouched` and `testsRun`.
- Checkpoint grounding refs projected from checkpoint id, checkpoint narrow refs,
  checkpoint diagnostics, and checkpoint file/test string lists.
- Event/event-log grounding refs projected from `RuntimeTaskEventLogRecord`,
  `RuntimeTaskEvent.eventId`, event kind, trace context, evidence refs, and
  diagnostics.
- Verifier report/finding grounding refs, including scoped trust annotations
  such as `verifiedBy: "evidence_verifier"`.
- Renderer untrusted/projected annotations.
- Memory durable-fact eligibility annotations and promotion requirements.
- Sanitization notes, redaction notes, lossy flags, and raw-retention flags.

These source shapes must not be changed by Lane B:

- `EvidenceRef`
- `TaskLoopEvidenceRef`
- `TaskLoopSubagentEvidence`
- `TaskLoopEvidenceGateResult`
- `RuntimeResumeCheckpoint`
- `Checkpoint`
- `RuntimeTaskEvent`
- `RuntimeTaskEventLogRecord`
- `RuntimeTraceSpan`
- `RuntimeTraceSourceRef`
- `EvidenceVerifierInput`
- `EvidenceVerifierReport`
- Runtime Memory episode/fact/candidate/promotion contracts

## Explicit Non-Goals

- No `TaskLoopEvidenceRef` expansion.
- No Evidence Verifier blocking completion gate.
- No active TaskLoop/Mission terminal-status cutover.
- No persistence, database, sidecar, raw payload retention, raw trace retention,
  or full checkpoint/tool payload retention.
- No renderer transport changes.
- No runtime/security/retry/tool-permission authority.
- No external service, exporter, collector, daemon, listener, Gateway, or
  Temporal surface.

## Acceptance Notes

- The existing collector already separates authoritative refs from projected
  refs and keeps renderer evidence non-authoritative.
- TaskLoop already projects file/test strings and narrow TaskLoop refs into
  canonical runtime evidence refs for shadow reports.
- Checkpoint and event-log paths already expose enough ids, evidence refs, and
  diagnostics to derive grounding refs without retaining raw payloads.
- Evidence Verifier reports can be represented as deterministic readonly
  grounding, but Phase 5 keeps them warning-only with
  `legacyDecisionUnaffected: true`.
- Runtime Memory remains a consumer only; no unverified durable facts are
  accepted.

Status: accepted
