# Risk Register

## Hard Veto Gates

| Veto | Why it blocks |
|---|---|
| Evidence gains authority by default | Converts diagnostics into hidden runtime control. |
| Evidence is written into checkpoint/lifecycle authority state | Makes rollback and provenance unsafe. |
| Raw prompts/provider payloads/tool args/results are persisted | Creates privacy, secret, and retention risk. |
| Replay uses live providers by default | Breaks determinism and makes scoring noisy. |
| Governance blocks broad tool classes before replay proof | Can reduce agent usefulness and create false blocked outcomes. |
| Provider/Gateway/prompt assembly changes happen in a readiness slice | Expands blast radius beyond planning. |
| New service/database/listener is added for evidence or replay | Creates parallel runtime infrastructure and lifecycle risk. |

## Drift Risks

| Risk | Mitigation |
|---|---|
| The five lanes merge into a single oversized implementation. | Require one follow-up spec per vertical slice. |
| Scorecard becomes subjective. | Require score sources to trace to replay/evidence/failure/tool provenance. |
| Failure classifier overfits string patterns. | Add fixture corpus and unknown fallback tests. |
| Evidence payloads become unbounded prompt stuffing. | Enforce payload budgets and scope/TTL/confidence thresholds. |
| Tool governance mistakes normal slow tests for stuck commands. | Classify timeout subtype and allow known test/dev-server modes. |
| Dirty workspace replay accidentally reverts user work. | Use fixture/worktree isolation and explicit no-revert tests. |
| Handoff summaries overstate recovery certainty. | Include confidence and suggested action as advisory until accepted. |
| Metrics improve by hiding failures as blocked. | Score false-blocked and ask-user appropriateness explicitly. |

## Open Decisions Before Active Implementation

- Exact TypeScript module ownership under `openclaw_runtime/src/runtime-core/**`.
- Whether evidence slots are limited to TaskLoop reviewer context or also support future Mission Control summaries.
- Where replay fixtures live and how workspace mutation is isolated.
- Whether replay reports are committed golden fixtures, local artifacts, or both.
- Thresholds for low-confidence evidence rejection.
- Which governance rules can be advisory-only and which deserve active blocking.
- How to represent provider timeout without storing raw provider payloads.
- How to measure wrong-file edits without granting scorecard completion authority.

## Recommended Owner Decisions

1. Accept schema spike before runtime behavior.
2. Keep Failure Intelligence passive until replay proves action quality.
3. Keep Evidence Envelope fail-closed even if it drops useful-looking evidence.
4. Keep Replay Harness local/dev/test first.
5. Keep Scorecard as evaluation metadata.
6. Add active Tool Governance only for narrow high-risk cases with rollback.
