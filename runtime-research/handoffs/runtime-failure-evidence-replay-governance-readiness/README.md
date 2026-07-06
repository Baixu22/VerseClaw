# Runtime Failure/Evidence/Replay Governance Readiness

Status: preparation_only.

This handoff persists the pre-implementation research and constraints for five runtime lanes:

1. Runtime Failure Intelligence
2. Runtime Evidence Envelope
3. Deterministic Replay Harness
4. Task Outcome Scorecard
5. Tool Invocation Governance

The package prevents later development from drifting into active runtime changes without a narrower accepted task spec. It does not implement runtime behavior, approve provider or Gateway changes, add UI, change prompt assembly, persist runtime evidence, or grant evidence/governance authority.

## Artifact Map

| Artifact | Purpose |
|---|---|
| constraint-brief.md | Durable constraint wording future agents must preserve. |
| development-plan.md | Staged implementation plan, dependency order, and parallel work streams. |
| contracts-and-boundaries.md | Draft schemas, authority boundaries, fail-closed rules, and persistence limits. |
| validation-plan.md | Replay/evaluation/test/scanning plan for future implementation slices. |
| risk-register.md | Drift risks, veto gates, mitigations, and required owner decisions. |
| implementation-spec-template.md | Copyable follow-up task spec template and required pre-code questions. |
| milestone-checklist.md | Phase-by-phase done criteria and promotion status vocabulary. |
| parallel-workstreams.md | Three-stream ownership, integration cadence, and handoff contracts. |
| schema-decision-log.md | Durable record of accepted/rejected contract decisions. |
| synthesis.md | Current decision record for this readiness package. |

## Required Reading Order

1. `constraint-brief.md`
2. `contracts-and-boundaries.md`
3. `development-plan.md`
4. `validation-plan.md`
5. `risk-register.md`
6. `implementation-spec-template.md`
7. `milestone-checklist.md`
8. `parallel-workstreams.md`
9. `schema-decision-log.md`
10. `synthesis.md`

Future implementation work should start by running:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-evidence-replay-governance-readiness.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-evidence-replay-governance-readiness.md
```

## Non-Goals

- No active runtime behavior change.
- No prompt/model-message/provider/Gateway payload change.
- No TaskLoop decision, retry, approval, rollback, completion, or tool-blocking change.
- No second runtime service, daemon, listener, local server, database, or exporter.
- No raw persistent evidence store.
- No claim that scorecards or replay results prove task completion until a future accepted evaluator gate says so.

## Required Status Vocabulary

- `preparation_only`: constraints and plan are persisted, but no implementation readiness is claimed.
- `ready_for_schema_spike`: a future follow-up spec may implement only schemas and passive validators.
- `ready_for_failure_intelligence_passive_shadow`: schema and validator proof is enough to classify failures passively.
- `ready_for_replay_core`: failure/evidence contracts are stable enough for fixture-backed replay.
- `ready_for_governance_advisory_rules`: replay and scorecard are stable enough to measure advisory tool rules.
- `needs_follow_up`: constraints are incomplete or validation gaps remain.
- `blocked`: a hard veto fired.

Current status: `preparation_only`.
