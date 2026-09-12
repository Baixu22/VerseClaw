# KE-P0-1 + KE-P0-3 LearningEnvelope/v1 and attribution contract

## 任务号与版本

- Task: `KE-P0-1 + KE-P0-3`
- Version: `v1`, 2026-08-13
- Status: paper design only. This document does not authorize a schema migration, runtime write, prompt injection, or production flag change.

## 输入材料清单

- `pasted-text.txt`（外部输入，未随仓库保存）, §0-§5: P0 delivery charter and acceptance conditions.
- `01-深度设计与现状审计.md`（外部输入，未随仓库保存）, §2-§5: prior proposal for a shared experience contract and outcome loop.
- `01-dcs-architecture-assessment.md`（外部输入，未随仓库保存）, §2-§4: DCS receipt/budget audit and the documented ContextReceipt/WireReceipt limits.
- `CONTEXT-CAPABILITY-AUDIT.md`（外部输入，未随仓库保存）, §7-§9: closed-loop definition, evidence limits, and A/B requirements.
- Source anchors listed below. The declared parent `team/claude/ke-program/KE-PROGRAM.md`, R-series prompt, and DSH design document are absent in this worktree (verified 2026-08-13); this design therefore does not assert their contents.

## 现状核实结论

1. Existing authoritative storage is sufficient for the first implementation. `context_blocks` stores a block identity, type, source, scope, bounded summary/content, lifecycle times, and JSON extension columns [block.ts](../../../openclaw_runtime/src/context-engine/block.ts), [openclaw-state-db.generated.d.ts](../../../openclaw_runtime/src/state/openclaw-state-db.generated.d.ts). It already has a narrow invalidation operation [block-store.ts](../../../openclaw_runtime/src/context-engine/block-store.ts).
2. Runtime-memory fact candidates already have `schemaVersion`, candidate verification status, source episode references, evidence references, temporal fields, and sensitivity; all runtime-memory flags default false [memory-context.ts](../../../openclaw_runtime/src/runtime-core/memory-context.ts), [memory-context.ts](../../../openclaw_runtime/src/runtime-core/memory-context.ts). The proposal shadow refuses accepted facts as input and remains read-only [memory-proposal-shadow.ts](../../../openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts).
3. SEKB persists trajectories and principles in existing `openclaw-state` tables [knowledge-store.ts](../../../openclaw_runtime/src/knowledge/sekb/knowledge-store.ts), [openclaw-state-db.generated.d.ts](../../../openclaw_runtime/src/state/openclaw-state-db.generated.d.ts). A confirmed principle has source trajectories and aggregate retrieval/adoption/post-adoption-success counters [types.ts](../../../openclaw_runtime/src/knowledge/sekb/types.ts); its only durable bridge to an experience block is the human `confirm_and_save` path [distillation-tool.ts](../../../openclaw_runtime/src/knowledge/sekb/distillation-tool.ts), [experience-block-bridge.ts](../../../openclaw_runtime/src/knowledge/sekb/experience-block-bridge.ts).
4. The Knowledge Hub has separately governed inbox, draft, proposal, provenance, and error-card structures. Inbox and drafts already provide source references, timestamps, warnings, metadata, and review state [contract.ts](../../../shared/host-api/contract.ts), [contract.ts](../../../shared/host-api/contract.ts). Error cards additionally hold explicit source references, last verification time, and effectiveness aggregates [contract.ts](../../../shared/host-api/contract.ts).
5. ContextReceipt records run/session/provider identity, selected and omitted refs, a character or token budget summary, and policy digest, but no actual adoption or task outcome [receipt-store.ts](../../../openclaw_runtime/src/agents/receipt-store.ts), [receipt-store.ts](../../../openclaw_runtime/src/agents/receipt-store.ts), [dcs-receipts.ts](../../../openclaw_runtime/src/context-engine/dcs-receipts.ts). DCS lineage records duration and character application [context-orchestrator.ts](../../../openclaw_runtime/src/context-engine/context-orchestrator.ts).
6. SEKB currently increments a per-principle retrieval aggregate on retrieval and accepts a caller-supplied Boolean when recording adoption/success [knowledge-store.ts](../../../openclaw_runtime/src/knowledge/sekb/knowledge-store.ts). These fields are not a per-use evidence chain and cannot prove causality.
7. An append-only, typed `runtime_task_event_log_records` surface already exists, but its current `RuntimeTaskEventKind` union does not include knowledge-attribution events [event-log.ts](../../../openclaw_runtime/src/runtime-core/event-log.ts), [events.ts](../../../openclaw_runtime/src/runtime-core/events.ts). It is the P4 extension point, not grounds to create a parallel ledger.

### 现状勘误

The research audit describes an `ExperienceUseEvent` as if a unified event structure were already the natural next layer. Source confirms receipt and aggregate counters, but not that event structure. This contract marks it as `KE-P4` work. Likewise, “verified” and “active” must remain separate: runtime fact candidates are explicitly `candidate`, while a confirmed SEKB principle is immediately stored as `active` [memory-proposal-shadow.ts](../../../openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts), [distillation-tool.ts](../../../openclaw_runtime/src/knowledge/sekb/distillation-tool.ts).

## 设计正文

### 1. Scope and invariants

`LearningEnvelope/v1` is a logical, content-light contract. It identifies a candidate or durable knowledge object and binds it to already-authoritative content, provenance, verification, activation, sensitivity, and attribution references. It is not a new table, a new database, a prompt format, or a write authority.

- Every producer is opt-in and attached to the existing production-flag control plane. When off: no candidate creation, no Envelope persistence, no attribution event, and no prompt injection.
- Content is referenced, never duplicated as a large inline body. The authoritative object remains a Runtime Memory fact, SEKB principle, Knowledge Inbox/Draft/Error Card, or ContextBlock.
- `verificationStatus` answers whether evidence supports the object. `activationStatus` answers whether an already-governed object may be consumed. Neither implies the other.
- Consumption promotion is ordered: advisory -> tool-mediated -> bounded-context. Bounded-context needs separate product approval and is capped at 3 items and 5% of the applicable input budget. No Envelope field authorizes a jump.
- L4 objects (system prompt, tool routing, permissions, approval rules, retry policy) have `activationStatus: proposal_only`; their envelopes cannot authorize automatic application.

### 2. LearningEnvelope/v1 field contract

| Field | Type and requiredness | Semantics | Producer | Consumer |
| --- | --- | --- | --- | --- |
| `envelopeId` | canonical string, required | Stable logical identity. Does not replace the backing object ID. | extractor/review adapter | all joins and audit |
| `kind` | `fact | sekb_principle | error_card`, required | Selects the backing authority and admissible lifecycle. | extractor/review adapter | review queue, broker |
| `authority` | `{ family, id, versionRef? }`, required | `family` is `runtime_memory | sekb | knowledge_inbox | knowledge_draft | context_block`; `id` points to the authoritative record. | adapter after backing record exists | read/resolve only |
| `contentRef` | bounded reference, required | Digest + locator of the backing content; never the full text. | adapter | retrieval display, tool-mediated read |
| `sourceRefs` | non-empty reference array, required | Session/task/trajectory/receipt/error/evidence origins. Ref values use existing reference IDs, not raw transcripts. | extractor and confirmation path | review, deletion propagation, attribution |
| `evidenceDigest` | SHA-256 + evidence-ref count, required | Integrity identifier for sanitized external evidence. It is not a model-written confidence statement. | deterministic evidence adapter | verifier/reviewer |
| `verificationStatus` | `candidate | evidence_verified | human_verified | rejected | superseded`, required | Evidence state only. `candidate` is not durable truth. | verifier/human review | admission and broker gates |
| `activationStatus` | `disabled | advisory | tool_mediated | bounded_context | proposal_only | retired`, required | Independent consumption state. Must respect promotion order. | reviewer/product gate | UI, broker, DCS gate |
| `sensitivity` | `normal | secret_adjacent | secret`, required | The stricter of source sensitivity and content scan. Secret/secret-adjacent content is redacted or excluded from prompt consumption. | sanitizer/redaction adapter | review and retrieval gate |
| `scope` | `{ workspaceId?, agentId?, sessionId?, roleTags? }`, required | Existing scope coordinates, ranking only unless a source family enforces access. | source adapter | retrieval filter |
| `validity` | `{ validAt, invalidAt?, expiresAt? }`, required | Temporal validity. `invalidAt`/`expiresAt` prevent consumption. | source/reviewer | retrieval filter |
| `schemaVersion` | literal `1`, required | Envelope interpretation version. | all producers | deserializer |
| `contentVersion` | canonical digest or authoritative update timestamp, required | Changes when backing content changes, independently of schema. | authority adapter | stale detection, attribution |
| `attributionRefs` | `{ retrievalEventIds?, presentedEventIds?, adoptedEventIds?, outcomeEventIds? }`, optional empty by default | References existing receipt/event-log records. No inline outcomes. | KE-P4 appenders | analytics/holdout evaluator |
| `metadata` | bounded allowlisted JSON, optional | Family-specific non-sensitive extension only; prohibited for raw content or free-form model rationale. | source adapter | family adapter |

#### Verification and activation matrix

| `verificationStatus` | Allowed activation ceiling | Rule |
| --- | --- | --- |
| `candidate` | `disabled` | Candidate is queue-visible only. |
| `evidence_verified` | `advisory` | Independent evidence is present; product has not approved model-facing use. |
| `human_verified` | `tool_mediated` | Explicit confirmation allows read-on-demand. |
| `human_verified` plus product gate | `bounded_context` | Maximum 3 items and 5% budget. |
| `rejected` / `superseded` | `retired` | Must not be retrieved or reactivated by default. |

### 3. Mapping matrix: reuse before storage

| Envelope field | BlockStore `context_blocks` | Runtime Memory fact | SEKB principle | Knowledge object | Receipt/event log | Implementation classification |
| --- | --- | --- | --- | --- | --- | --- |
| `envelopeId` | `block_id` | `factId` | `principle_id` | `id` | event/receipt ID | Direct reuse as family-local ID; cross-family prefix convention required. |
| `kind` | `block_type` | temporal fact | principle | inbox/draft/error-card type | event kind | Direct reuse, with envelope mapping convention. |
| `authority` | block ID/source | fact ID | principle ID | inbox/draft ID | refs only | Convention field; no new store. |
| `contentRef` | summary/full-content locator | subject/predicate/object summary | `full_content` | body/card fields | never raw content | Convention field derived as locator+digest. |
| `sourceRefs` | no dedicated typed column | `sourceEpisodeRefs` + `evidenceRefs` | `source_trajectories` + metadata | `sourceRefs` | selected/omitted/evidence refs | Direct reuse for Memory/Knowledge; JSON metadata convention for Block/SEKB normalization. |
| `evidenceDigest` | absent | evidence refs available | metadata only | source refs/metadata | digest-native | Receipt digest is directly reusable; others need a derived convention, not a new column. |
| `verificationStatus` | admission input only, not row | direct | confirmation provenance metadata, not typed status | review/proposal status | absent | Direct for Memory; convention for others. Must not conflate with active. |
| `activationStatus` | `presence_json` / validity | feature flags/provider gate | principle `status` | draft/proposal status | absent | Convention adapter across families; no shared state table. |
| `sensitivity` | absent | direct | metadata only | no typed field | content-free by design | Direct for Memory; allowlisted metadata extension for other families. |
| `scope` | session/role scope | task/context metadata | task types/tags plus provenance session | workspace/agent/role tags | identity session/run | Direct reuse; workspace coordinate is family-specific. |
| `validity` | `valid_at`/`invalid_at` | temporal fields | trajectory expiry; principle lacks typed expiry | timestamps only | creation time | Direct Block/Memory; expiry policy convention for SEKB/Knowledge. |
| `schemaVersion` / `contentVersion` | no typed schema version | direct schema version | metadata + updated timestamp | timestamps; card schema version | receipt version | Reuse existing version/timestamp where present; convention otherwise. |
| `attributionRefs` | absent | absent | aggregate counters only | aggregate effectiveness/references | direct event/receipt IDs | KE-P4 event payload extension; no new database. |

### 4. Candidate examples

All values below are illustrative references/digests, not live data.

```json
{
  "envelopeId": "runtime_memory:fact:fact_42",
  "kind": "fact",
  "authority": { "family": "runtime_memory", "id": "fact_42", "versionRef": "sha256:91ab" },
  "contentRef": "ref:memory:fact_42#sha256:91ab",
  "sourceRefs": ["episode:task_77:tool_result", "evidence:test:run_88"],
  "evidenceDigest": "sha256:3c5d",
  "verificationStatus": "evidence_verified",
  "activationStatus": "advisory",
  "sensitivity": "normal",
  "scope": { "workspaceId": "ws_1" },
  "validity": { "validAt": 1786600000000 },
  "schemaVersion": 1,
  "contentVersion": "sha256:91ab",
  "attributionRefs": {}
}
```

```json
{
  "envelopeId": "sekb:principle:pr_12",
  "kind": "sekb_principle",
  "authority": { "family": "sekb", "id": "pr_12", "versionRef": "2026-08-13T12:00:00Z" },
  "contentRef": "ref:context:experience:sekb:session_9:pr_12",
  "sourceRefs": ["trajectory:tr_2", "trajectory:tr_3"],
  "evidenceDigest": "sha256:0c84",
  "verificationStatus": "human_verified",
  "activationStatus": "tool_mediated",
  "sensitivity": "normal",
  "scope": { "sessionId": "session_9", "roleTags": ["coder"] },
  "validity": { "validAt": 1786600000000, "expiresAt": 1794376000000 },
  "schemaVersion": 1,
  "contentVersion": "2026-08-13T12:00:00Z",
  "attributionRefs": {}
}
```

```json
{
  "envelopeId": "knowledge:error-card:ec_5",
  "kind": "error_card",
  "authority": { "family": "knowledge_draft", "id": "kd_5", "versionRef": "2026-08-13T12:05:00Z" },
  "contentRef": "ref:context:file:knowledge/drafts/kd_5#card:ec_5",
  "sourceRefs": ["evidence:test:run_301", "evidence:command:build_18"],
  "evidenceDigest": "sha256:a399",
  "verificationStatus": "human_verified",
  "activationStatus": "advisory",
  "sensitivity": "secret_adjacent",
  "scope": { "workspaceId": "ws_1", "roleTags": ["maintainer"] },
  "validity": { "validAt": 1786600000000 },
  "schemaVersion": 1,
  "contentVersion": "2026-08-13T12:05:00Z",
  "attributionRefs": {}
}
```

### 5. New-storage argument

No new database, table, or service is justified in P0.

- Authoritative content remains in the existing Runtime Memory, SEKB, Knowledge, or BlockStore family.
- Cross-family Envelope fields are resolved by deterministic adapters and stored only in family metadata where the field is not already typed.
- Per-use attribution records belong to existing `runtime_receipts` and `runtime_task_event_log_records`. P4 must extend the versioned event payload and add only indexes proven necessary by query volume; it must not create an “ExperienceUseEvent” store.
- A future request for a new table must demonstrate that bounded event-log payload metadata cannot support the required query, preservation, and deletion semantics. That proof is deliberately absent here.

### 6. Attribution chain contract

All four events share this required correlation payload:

```ts
type LearningAttributionCommon = {
  schemaVersion: 1;
  attributionId: string;
  envelopeId: string;
  authority: { family: string; id: string; contentVersion: string };
  taskId: string;
  runId?: string;
  sessionKey?: string;
  traceId?: string;
  model: { providerId?: string; modelId?: string; version?: string };
  configDigest: string;
  taskType: string;
  arm: "baseline" | "treatment" | "shadow";
  toolCallCount: number;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  retryCount: number;
  evidenceRefs: string[];
};
```

`model.version` and token fields are required when the provider reports them; otherwise the event carries an explicit `unavailable` evidence ref rather than fabricated zero. The only allowed evidence refs point to structured receipt IDs, tool results, test runs, file-diff receipts, command exit records, or explicit user actions.

| Event | Trigger and external collection point | Event-specific fields | Current coverage and P4 placement |
| --- | --- | --- | --- |
| `retrieved_at` | Broker returns an eligible candidate for a concrete task/query. Collection point is retrieval-engine/broker return, not assistant text. | `queryDigest`, `rank`, `score`, `retrievalReason`, `candidateSetDigest`, `selectedForPresentation` | SEKB increments `retrieval_count` upon retrieval [retrieval-engine.ts](../../../openclaw_runtime/src/knowledge/sekb/retrieval-engine.ts); ContextReceipt can later record selected/omitted. P4 appends a `knowledge_retrieved/v1` task event. |
| `presented_at` | UI renders an advisory, or the tool result is returned to the model. Collection point is render acknowledgement/tool response creation. | `presentationMode: advisory | tool_result | bounded_context`, `presentationDigest`, `receiptId?`, `userVisible: boolean` | ContextReceipt covers bounded-context selection only, not UI render or tool response. P4 appends `knowledge_presented/v1`; a bounded-context event also references ContextReceipt. |
| `adopted_at` | A specific external action matches a presented recommendation within a bounded correlation window. | `adoptionKind`, `actionEvidenceRef`, `matchRuleVersion`, `falsePositiveRisk` | Existing SEKB `record_adoption` takes a Boolean and stores only aggregates [knowledge-store.ts](../../../openclaw_runtime/src/knowledge/sekb/knowledge-store.ts); Knowledge error-card effectiveness is aggregate. P4 appends `knowledge_adopted/v1`. |
| `outcome_at` | A task ends with an externally observable result. | `outcome: success | failure | neutral | unknown`, `outcomeEvidenceRef`, `verificationMethod`, `counterfactualEligible` | Trajectories have success/failure/partial and cost [types.ts](../../../openclaw_runtime/src/knowledge/sekb/types.ts), but not a per-envelope join. P4 appends `knowledge_outcome/v1` and joins by attribution ID. |

#### Adopted classification: two implementable signals

1. **Command/tool action match.** After an advisory names a normalized command, tool action, or safe procedure ID, record adoption only when the matching tool-call request or command receipt occurs in the same task after `presented_at`. Error: the action could have been independently planned. Mitigation: record `matchRuleVersion`, require a strict command/procedure-ID match, label observational rather than causal.
2. **User diff acceptance.** When the UI presents a proposed patch with a stable diff digest, record adoption when the user explicitly accepts it or the corresponding file-change receipt has that digest/patch ID. Error: acceptance can include unrelated edits or later reversion. Mitigation: bind the accepted patch ID, record subsequent revert separately, and never infer adoption merely from assistant wording.

Explicit “dismiss/no longer relevant” is a third negative signal but is not evidence of task failure. It must be recorded as a user action, never guessed from silence.

#### Outcome classification

| Outcome | Acceptable evidence | Forbidden substitute |
| --- | --- | --- |
| `success` | Required verification command exits 0, approved test result passes, expected file/artifact digest exists, or explicit user confirmation tied to task ID. | Model declares success. |
| `failure` | Command/test non-zero result, structured tool error, rejected approval, or explicit user correction tied to task ID. | Negative wording in assistant output. |
| `neutral` | Task ended without a predeclared verification target, or recorded user “not applicable” feedback. | Missing event treated as success/failure. |
| `unknown` | Collection unavailable or correlation incomplete. | Backfilled Boolean inferred from counters. |

Attribution is observational until an independently held-out, randomized A/B analysis confirms a treatment effect. Do not tune retrieval weights, acceptance thresholds, or activation gates against the same holdout.

### 7. Lifecycle and deletion

- A rejected/superseded envelope causes an invalidation/retirement event and suppresses future retrieval. The backing family retains its own legal deletion policy.
- Sensitivity redaction must remove raw content from Envelope metadata and replace `contentRef` with an unavailable/redacted reference. The existing runtime memory redaction model is the closest typed precedent [memory-context.ts](../../../openclaw_runtime/src/runtime-core/memory-context.ts).
- Attribution records retain only identifiers/digests/evidence references. They never retain source transcript, secret, raw command argument, or generated recommendation text.
- When a backing object is deleted, P4 emits a terminal invalidation marker and leaves an auditable, content-free reference tombstone; it must not silently remap old events to a new object.

### 8. Feature flags and zero-behavior promise

P1-P4 must add allowlisted opt-in controls under the existing DCS/runtime production flag system, patterned after the default-off writable catalog [prod-flags-control.ts](../../../shared/dcs/prod-flags-control.ts) and runtime-memory defaults [memory-context.ts](../../../openclaw_runtime/src/runtime-core/memory-context.ts).

| Capability | Proposed flag path | Off behavior |
| --- | --- | --- |
| Envelope adapter/shadow | `runtime.knowledgeEnvelope.shadow` | No envelopes, no writes, no new events. |
| Attribution collection | `runtime.knowledgeAttribution.shadow` | No collection, no receipts/events, no counter changes. |
| Advisory presentation | `runtime.knowledgeEnvelope.advisory` | No UI advice and no prompt change. |
| Tool-mediated lookup | `runtime.knowledgeEnvelope.toolMediated` | Tool is unavailable; no implicit retrieval. |
| Bounded-context pilot | `runtime.knowledgeEnvelope.boundedContext` | No injection; ContextReceipt remains unchanged by this feature. |

The exact configuration schema and UI toggle names are downstream implementation work. They must be allowlisted and default false; unknown config keys must fail closed.

### 9. 对下游的接口

- **KE-P1:** implement family adapters that produce/resolve `LearningEnvelope/v1` without copying content. Enforce the verification/activation matrix and sensitivity sanitization.
- **KE-P2:** use `kind`, `sourceRefs`, `contentVersion`, and `verificationStatus` for queue merge/review. Preserve all merged sources; it must not activate a candidate.
- **KE-P3:** broker accepts only `human_verified` or lower-risk `evidence_verified` envelopes according to the activation ceiling; it must return `envelopeId`, score rationale, and `contentVersion` for P4 correlation.
- **KE-P4:** extend the existing `RuntimeTaskEventKind` and versioned payload validator with the four `knowledge_*` events. Write correlation IDs to the existing task event log and receipt references; add no separate event service.
- **KE-P5:** evaluate independently held-out tasks using external outcome evidence. Report unknown/unmatched rates and confidence intervals; never use the model’s self-evaluation or emit t/p for zero-variance data.

#### 派单附注: R3-2

The referenced R-series source is missing locally, so this is a compatibility requirement rather than a claim about current R3-2 behavior. Any future `proposeFacts` output must be this strict Envelope subset:

```ts
type ProposedFactEnvelopeSubset = Pick<LearningEnvelope,
  "envelopeId" | "kind" | "contentRef" | "sourceRefs" | "evidenceDigest" |
  "verificationStatus" | "sensitivity" | "validity" | "schemaVersion" | "contentVersion"
> & { kind: "fact"; verificationStatus: "candidate"; activationStatus?: never };
```

It must not emit `activationStatus`, write a BlockStore row, or produce bounded-context content. The current runtime-memory proposal shadow already mirrors this safety intent by producing candidates only and `acceptedFacts: []` [memory-proposal-shadow.ts](../../../openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts).

#### 派单附注: R5

The referenced R5 source is also missing locally. Its future join contract should accept the shared `LearningAttributionCommon` payload plus `retrievalEventId`, `presentedEventId`, `adoptedEventId`, `outcomeEventId`, `receiptId`, `outcomeEvidenceRef`, and `arm`. It must preserve unmatched events as `unknown`, rather than coercing them into adoption or success.

### 10. 有意不做

- No new knowledge/experience database, event service, or duplicated content store.
- No automatic activation based on confidence, retrieval count, adoption count, or model self-report.
- No direct prompt injection from a candidate; bounded-context is a separately approved future stage only.
- No semantic embedding requirement, online learning, learned ranker, or weight tuning in this contract.
- No raw transcript, source-code body, secret, tool argument, or free-form model rationale in receipts or attribution events.
- No statistical claim of causal impact from observational adoption; randomized treatment and independent holdout remain mandatory.
