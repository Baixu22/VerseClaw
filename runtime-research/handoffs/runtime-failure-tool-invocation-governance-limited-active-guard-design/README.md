# Runtime Failure Tool Invocation Governance Limited Active Guard Design

Status: design_readiness_only_not_active_runtime_ready.

This handoff records the next-stage design package for limited active guard evaluation. It does not implement an active guard, add a runtime consumer, connect to TaskLoop, or block tools.

## Artifact Map

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/runtime-failure-tool-invocation-governance-limited-active-guard-design.md` | Design/readiness task spec, metadata, boundaries, tests, rollback, and acceptance criteria. |
| `validation-plan.md` | Required validation commands and future boundary/evidence scan plan. |
| `synthesis.md` | Design outcome and follow-up requirements before any active guard can be proposed. |
| `runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md` | Parent governance decision record for this design-only phase. |
| `runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md` | Parent synthesis update that preserves the no-active-readiness stop line. |

## Scope

- Evaluate only the `destructive_operation_guard` candidate from the Phase 5 advisory rule set.
- Use the real Phase 5 advisory shape: `authority: 'none'`, `governanceDecisionAuthority: 'none'`, `activeBlocking: false`, and optional `futureActiveCandidate.action: "block"` with `requiresAcceptedSpec: true`.
- Record the evidence prerequisites for a later implementation spec: Phase 5 trigger metadata, replay/scorecard provenance, false-block cases, slow test and known dev-server protection, flag-disable rollback, and boundary scans.
- Define the future owner boundary as mutation-capable tool invocation preflight owned by tool execution.

## Out Of Scope

- No active guard implementation.
- No active runtime consumer.
- No TaskLoop, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, or tool-blocking behavior change.
- No import or wiring from active runtime paths to Phase 5 governance advisory code.
- No checkpoint/lifecycle authority state writes.
- No live provider reads, real tool mutation, or real workspace mutation.
- No persistence of raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content.
- No services, daemons, listeners, HTTP servers, WebSocket servers, databases, exporters, schedulers, or always-on sidecars.

## Candidate Evidence Contract

Future active design evidence must cite sanitized metadata only:

- Advisory finding: `ruleId: "destructive_operation_guard"`, recommendation, level, summary, provenance, and `futureActiveCandidate` when present.
- Replay source: replay id, scenario, terminal status, expected terminal status, budgets, and touched-path summaries.
- Scorecard source: aggregate decision plus `wrong_file_edit` and `unnecessary_edit` metric provenance.
- Safety: report authority remains none, diagnostics-only remains true, completion proof remains false, active blocking remains false.

Raw prompt/provider/tool/workspace content is not acceptable evidence.

## Status Vocabulary

- `design_readiness_only_not_active_runtime_ready`: design conditions are recorded, but runtime integration is not approved.
- `needs_future_replay_scorecard_proof`: candidate evidence is insufficient for active behavior until a later spec supplies measured proof.
- `blocked`: a hard stop line fired, such as active runtime wiring or default blocking.
