# Runtime Failure Tool Invocation Governance Destructive Operation Guard Evidence Proof

Status: evidence_proof_not_active_runtime_ready.

This handoff records the replay/scorecard/governance evidence proof and false-block corpus for the single Phase 5 advisory candidate `destructive_operation_guard`. The package is diagnostics/evaluation metadata only and does not implement active tool blocking.

## Artifact Map

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md` | Evidence-proof task spec, ownership, tests, rollback, and hard stop lines. |
| `openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.ts` | Pure in-memory proof helper that consumes replay reports plus scorecards and derives Phase 5 advisory metadata. |
| `tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts` | Focused trigger/false-block corpus, provenance checks, safety checks, and active-consumer boundary scan. |
| `validation-plan.md` | Required validation commands and boundary scan plan. |
| `synthesis.md` | Evidence proof outcome and follow-up requirements before any active guard can be proposed. |
| `runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md` | Parent governance decision record for this corpus-only phase. |
| `runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md` | Parent synthesis update preserving the no-active-readiness stop line. |

## Scope

- Evaluate only `destructive_operation_guard`.
- Use fixture-owned or synthetic in-memory replay reports and scorecards.
- Derive the Phase 5 advisory finding in-memory through the existing advisory core.
- Emit a bounded, JSON-serializable proof report with `diagnosticsOnly: true`, `completionProof: false`, `evaluationMetadataOnly: true`, `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.
- Preserve replay id/scenario/terminal status, scorecard aggregate decision, edit metric refs, failure refs, evidence refs, and touched-path refs.
- Record future rollback/readiness metadata: flag-disable rollback required, future owner boundary is tool invocation preflight, active-consumer boundary scan planned.

## Evidence-Qualified Trigger

The proof helper requires all of these signals before a case is counted as an evidence-qualified trigger:

- deleted touched-path metadata
- failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata
- Phase 5 `futureActiveCandidate.action: "block"` with `requiresAcceptedSpec: true`

This keeps Phase 5 future metadata advisory. A deleted path by itself is not enough for this proof to say a future default-off active guard can be proposed.

## False-Block Corpus

The focused corpus covers:

- expected edit
- expected deletion
- normal completed repair
- completed test repair
- sanitized or inconclusive touched-path metadata
- legitimate fixture mutation
- slow test command metadata
- known dev-server-like long-running metadata

The expected-deletion case intentionally observes Phase 5 future candidate metadata but passes because edit scorecard metrics are not failing. That guards against a naive future block that keys only on deleted paths.

## Stop Lines

- Do not wire the proof helper into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking.
- Do not read live providers, execute real tool mutation, or modify the real workspace.
- Do not persist raw prompt, provider payload, tool args/results, secret, env dump, or unredacted workspace content.
- Do not write replay reports, scorecards, governance reports, evidence proof reports, or evidence envelopes into checkpoint or lifecycle authority state.
- Do not add services, daemons, listeners, servers, databases, exporters, or schedulers.
- Do not treat replay reports, scorecards, governance reports, evidence proof reports, evidence, or failure events as task completion proof.
- Do not treat `block` as an active runtime decision in this phase.

## Status Vocabulary

- `evidence_proof_not_active_runtime_ready`: trigger and false-block corpus exists, but runtime integration is not approved.
- `evidence_conditions_met_not_active_runtime_ready`: the proof report has enough metadata for a later default-off implementation spec to propose active behavior, but this phase remains non-active.
- `needs_more_evidence`: trigger coverage, false-block coverage, provenance, safety, or boundary proof is incomplete.
- `blocked`: a hard stop line fired.
