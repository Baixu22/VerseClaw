# 4. Decision Quality Assessment

## Exploration Log

> FAILURE NOTE: The mandatory `codegraph_decide` and `codegraph_context_plan` calls could not be executed because CodeGraph tools/resources are not exposed in this session. I used the plan's named files, local searches, and focused source reads instead.

- CodeGraph plans executed: unavailable. Local fallback reading list covered shared/runtime observability types, trace recorder, scorecard, evidence verifier, Local Control Plane, and design overview observability/LCP sections.
- Files read:
  - `shared/types/observability.ts`: rich UI-facing observability contract includes spans, events, scorecards, graph nodes/edges, trace coverage, issues, correlations, query/index entries, and dashboard snapshots.
  - `openclaw_runtime/src/observability/types.ts`: runtime-side types are narrower but aligned for traces, spans, token usage, scorecards, metrics, and runtime events.
  - `openclaw_runtime/src/observability/scorecard.ts`: current scorecard grades reliability (0.30), verification (0.25), context discipline (0.20), cost (0.15), and latency (0.10).
  - `openclaw_runtime/src/observability/trace-recorder.ts`: span/event lifecycle supports attributes and metrics, so decision assessments can be attached without changing execution flow.
  - `openclaw_runtime/src/runtime-core/evidence-verifier.ts`: verifier has finding categories `contract`, `obligation`, `evidence`, `tool`, `event_replay`, `external_dependency`, and `cancellation`; reports are explicitly `legacyDecisionUnaffected: true`.
  - `openclaw_runtime/src/local-control-plane/index.ts`: LCP is bounded, sanitized, in-memory, `mode: "observe"`, `legacyUnaffected: true`, with current report kinds `context`, `model_router`, `capability`, `evidence`, and `mission`.
  - `docs/clawx-design-overview.md`: sections 8.4/8.4.1 document Observability and Local Runtime Control Plane observe-only boundaries and promotion rule.
- Existing modules found:
  - Production: `trace-recorder.ts`, `scorecard.ts`, `metrics.ts`, `role-first-observer.ts`, runtime trace buffer, host/Gateway observability RPCs.
  - Production/shadow diagnostic: `evidence-verifier.ts` has shadow/pilot flags but report semantics are legacy-unaffected.
  - Observe-only: `local-control-plane/index.ts` default-off report layer.
  - Planned/promotion rule: any LCP move to active behavior needs separate flag, flag-off parity proof, and rollback plan.
- Non-goals and constraints identified:
  - Observability explains how a run executed; it is not durable task truth or proof that a long-term goal is complete.
  - LCP does not change prompt text, selected model, Skill/MCP enablement, evidence gates, lifecycle decisions, durable task state, or UI behavior.
  - Decision quality assessment must be diagnostic, not an active gate.

## 1. Gap Analysis

- Existing system can trace operations as spans/events and grade trace-level outcome quality.
- Existing scorecard can answer whether a trace errored, had verification, used context packs, controlled cost, and finished quickly.
- Existing evidence verifier can classify missing evidence, tool failures, event replay inconsistency, open obligations, and external blockers.
- The system cannot evaluate whether a specific agent step was a good decision: correct tool, correct timing, appropriate inputs, appropriate escalation, or avoided unnecessary work.
- `ObservabilityTraceCoverage` describes whether sources exist, not whether decisions were justified.
- This gap matters because a run can be perfectly traced and still make poor choices. For a personal learning platform, the learning value is seeing why a decision was weak without turning that diagnosis into hidden automation.
- Existing non-goals respected: decision quality does not complete tasks, block tools, rewrite prompts, or mutate Task Ledger/Mission state.

## 2. Architecture Overview

```text
[EXISTING] trace-recorder.ts
        |
        v
[EXISTING] ObservabilityTrace spans/events
        |
        +---------------------> [NEW] DecisionPointExtractor
                                |
[EXISTING] evidence-verifier.ts |
        |                       v
        +---------------------> [NEW] DecisionQualityEvaluator
                                |
                                v
                       [NEW] DecisionQualityReport
                                |
           +--------------------+--------------------+
           v                                         v
[EXISTING] scorecard.ts -> [NEW] scorecard item      [EXISTING] local-control-plane/index.ts
                                                     -> [NEW] decision_quality report kind
```

## 3. Component Specifications

### DecisionPointExtractor

Responsibility: Converts trace spans and events into normalized decision points. A decision point is a model/tool/orchestration/context step where the agent selected an action, input, target, or escalation path.

Interfaces:

```ts
export type DecisionPointKind =
  | "tool_choice"
  | "tool_input"
  | "context_selection"
  | "model_routing"
  | "role_routing"
  | "verification_choice"
  | "escalation_choice";

export interface DecisionPoint {
  id: string;
  traceId: string;
  spanId?: string;
  kind: DecisionPointKind;
  sequence: number;
  actor?: string;
  roleName?: string;
  inputPreview?: string;
  outputPreview?: string;
  attributes: Record<string, unknown>;
  evidenceRefs: EvidenceRef[];
}
```

Internal state: Stateless. It reads `ObservabilityTrace.spans`, `events`, span kind, metrics, and attributes.

Lifecycle: Runs after trace completion or on demand for dashboard/report generation.

Error handling strategy: If a span cannot be interpreted, it is skipped with an `unclassified_decision_point` diagnostic rather than failing the trace.

### DecisionQualityEvaluator

Responsibility: Scores each decision point across step-level dimensions and maps evidence verifier findings into decision-quality signals. It distinguishes a trace being complete from the choices being appropriate.

Interfaces:

```ts
export type DecisionQualityDimension =
  | "appropriateness"
  | "input_quality"
  | "timing"
  | "evidence_awareness"
  | "scope_control"
  | "recovery_choice";

export interface DecisionQualityAssessment {
  decisionPointId: string;
  spanId?: string;
  scores: Record<DecisionQualityDimension, number>;
  overall: number;
  verdict: "good" | "acceptable" | "weak" | "poor" | "unknown";
  findings: Array<{
    code: string;
    severity: "info" | "warning" | "error";
    category: EvidenceVerifierFindingCategory | "decision";
    message: string;
    evidenceRefs: EvidenceRef[];
  }>;
}
```

Internal state: Stateless evaluation rules plus optional calibration thresholds.

> REVIEW NOTE: The evaluator's scoring mechanism is intentionally unspecified here — it could start as deterministic heuristics over span attributes (cheap, explainable, testable with golden fixtures) and later add an LLM-judge mode. For a personal learning platform, the recommendation is heuristics-first: rules like "tool retried N times with identical input", "context pack absent on a role-first trace", "verifier span missing after mutating tool" are derivable from existing span kinds without model cost. Confirm this sequencing before implementation.

Lifecycle: Runs after `DecisionPointExtractor`. It may consume `EvidenceVerifierReport` when available.

Error handling strategy: Missing evidence produces `unknown` or warning findings; it does not infer failure.

### DecisionQualityReport

Responsibility: Aggregates step-level assessments into a trace-level diagnostic report that can be projected to scorecards, node diagnostics, and LCP.

Interfaces:

```ts
export interface DecisionQualityReport {
  schema: "openclaw.decision-quality.report.v1";
  mode: "observe";
  legacyUnaffected: true;
  traceId: string;
  runId?: string;
  sessionKey?: string;
  taskId?: string;
  assessedDecisionCount: number;
  unknownDecisionCount: number;
  overall: number;
  verdict: "good" | "acceptable" | "weak" | "poor" | "unknown";
  assessments: DecisionQualityAssessment[];
  summaryFindings: DecisionQualityAssessment["findings"];
}
```

Internal state: None.

Lifecycle: Created per trace, stored only in trace attributes/index or LCP bounded report buffer unless a future explicit persistence design is added.

Error handling strategy: Report generation failure records an observability issue and leaves the original trace/scorecard unchanged.

### ScorecardDecisionQualityAdapter

Responsibility: Adds a decision-quality score item to the existing scorecard system and rebalances weights for display.

Interfaces:

```ts
export interface DecisionQualityScoreInput {
  trace: ObservabilityTrace;
  report?: DecisionQualityReport;
}
```

Internal state: Stateless.

Lifecycle: Called by `buildTraceScorecard` only when a report is available or shadow evaluation is enabled.

Error handling strategy: No report means current five-dimension scorecard remains unchanged in flag-off mode.

### LocalControlPlaneDecisionQualityReporter

Responsibility: Emits sanitized, observe-only `decision_quality` reports through the LCP buffer.

Interfaces:

```ts
export interface DecisionQualityLcpPayload {
  traceId: string;
  overall: number;
  verdict: DecisionQualityReport["verdict"];
  dimensions: Record<DecisionQualityDimension, number>;
  weakDecisionCount: number;
  evidenceFindingCategories: string[];
}
```

Internal state: Uses existing LCP ring buffer and sanitization.

Lifecycle: Runs after report generation when `decisionQualityReport` flag is enabled.

Error handling strategy: LCP reporting remains best-effort and cannot affect runtime behavior.

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `shared/types/observability.ts` | Add optional `decisionQuality` fields to coverage/scorecard/node diagnostics types. | UI needs typed diagnostics without overloading generic attributes. |
| `openclaw_runtime/src/observability/types.ts` | Add runtime `DecisionQualityReport` and optional score item types, or export from a new module. | Keeps runtime report shape aligned with shared projections. |
| `openclaw_runtime/src/observability/trace-recorder.ts` | No required behavior change; optionally add helper `recordDecisionAssessment` as attribute/event sugar. | Spans/events already support attributes and custom events. |
| `openclaw_runtime/src/observability/scorecard.ts` | Add optional decision-quality item behind shadow flag/report availability; retain existing five-item behavior when absent. | Avoid flag-off score drift. |
| `openclaw_runtime/src/runtime-core/evidence-verifier.ts` | No authority change; expose finding categories to evaluator. | Findings are useful signals but remain `legacyDecisionUnaffected`. |
| `openclaw_runtime/src/local-control-plane/index.ts` | Add `decision_quality` to `LOCAL_CONTROL_PLANE_REPORT_KINDS` (currently `context`, `model_router`, `capability`, `evidence`, `mission`), a `decisionQualityReport` flag, counts, and an entry in the `KIND_TO_FLAG` mapping. | LCP report kind must be typed and independently gated; the kind list, per-kind counts, and kind-to-flag table are all `satisfies`-checked, so adding a kind without its flag fails at compile time — which is the desired safety property. |
| `docs/clawx-design-overview.md` | Update only when implemented to document observe-only decision quality. | Prevent confusion with active gating. |
| `src/pages/Observability/*` | Later UI-only addition to show decision diagnostics. | Not part of this markdown deliverable, but typed report supports it. |
| `shared/types/task-ledger.ts` | No change. | Decision quality is not task state. |
| `openclaw_runtime/src/agents/mission-control/controller.ts` | No change for assessment phase. | Active behavior would require a separate promotion path. |

## 5. Data Flow

Scenario: a trace contains role routing, context pack, model, tool, and verifier spans.

1. `ObservabilityTraceRecorder` records spans/events as it does today.
2. On completion, `buildTraceScorecard` computes the existing trace-level score.
3. `DecisionPointExtractor` scans spans: role-router becomes `role_routing`, context-pack becomes `context_selection`, tool spans become `tool_choice`/`tool_input`, verifier spans become `verification_choice`.
4. `DecisionQualityEvaluator` scores each point. If `EvidenceVerifierReport` has `missing_tool_evidence`, the affected tool/verification decision receives an evidence-awareness finding. If a tool result was denied, the tool decision receives a tool/evidence finding.
5. `DecisionQualityReport` aggregates per-step results and computes trace-level `overall`.
6. `ScorecardDecisionQualityAdapter` adds a decision-quality score item when enabled.
7. `LocalControlPlaneDecisionQualityReporter` records an observe-only LCP report with sanitized findings and evidence refs.
8. Observability UI can display the report beside trace diagnostics. No tool, model, Mission, Task Ledger, or evidence gate behavior changes.

## 6. Migration Path

- Shadow phase:
  - Generate reports for completed traces but do not change scorecard totals by default.
  - Record LCP `decision_quality` reports only when the new flag is on.
  - Compare evaluator findings against human review/code-review outcomes where available.
- Scorecard display pilot:
  - Add decision-quality item to scorecard behind a display flag.
  - Keep old five-dimension score available as `legacyScore`.
  - Do not use decision score for gating.
- Any future active behavior:
  - Requires separate feature flag, flag-off parity proof, rollback plan, and explicit operator gate, matching LCP promotion rule.
  - Must define which action is active, such as requiring review, and prove it does not mutate task truth unexpectedly.
- Rollback:
  - Disable decision-quality flag.
  - Ignore optional report fields.
  - Existing traces and scorecards continue with current five dimensions.
- Telemetry:
  - Assessed/unknown decision count, weak/poor count, finding categories, score distribution, correlation with verifier/evidence outcomes, and false-positive notes from review.

## 7. Design Decisions

- Decision: Decision quality is separate from trace coverage. Why: coverage says data exists; quality says whether choices were appropriate.
- Alternative rejected: Fold decision quality into `ObservabilityTraceCoverage` only. That would blur source availability with evaluation.
- Decision: Use evidence verifier findings as signals, not verdicts. Why: verifier reports are legacy-unaffected and evidence-focused, while decision quality needs step context.
- Alternative rejected: Let evidence verifier directly score decisions. It owns evidence sufficiency, not tool-choice timing or context-selection quality.
- Decision: Add `decision_quality` as a new LCP report kind. Why: LCP is the existing observe-only diagnostic envelope.
- Alternative rejected: Store decision-quality results in Task Ledger. Task Ledger is work state, not execution evaluation.
- Decision: Rebalance scorecard weights only when decision quality is available. Current weights in `buildTraceScorecard` (`openclaw_runtime/src/observability/scorecard.ts:24`) are reliability 0.30, verification 0.25, context 0.20, cost 0.15, latency 0.10. Proposed six-dimension weights: reliability 0.25, verification 0.20, context 0.15, decision quality 0.20, cost 0.10, latency 0.10 (sums to 1.00). Why: decision quality should be important but not drown out actual failures and verification.
- Future extension points: human review labels, model/tool-specific calibration, role-specific decision rubrics, and ClawGraph node-level decision reports.

## 8. Validation Approach

- Unit tests for extracting decision points from representative traces.
- Evaluator tests mapping evidence verifier findings to decision-quality findings.
- Scorecard tests proving flag-off score parity and flag-on weight totals.
- LCP tests adding `decision_quality` to kind/flag/count/correlation paths with sanitized payloads.
- Golden trace fixtures with known good/weak decisions reviewed manually.
- Metrics for success: zero runtime behavior change, stable score parity when disabled, useful weak-decision recall on fixtures, low false-positive rate in human review, and no sensitive data leakage in LCP payloads.
