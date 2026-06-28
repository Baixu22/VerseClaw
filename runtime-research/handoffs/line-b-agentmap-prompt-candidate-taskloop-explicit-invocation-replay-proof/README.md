# AgentMap TaskLoop Explicit Invocation Phase A Replay Proof

Phase A Replay Proof validates the already accepted TaskLoop explicit invocation pilot with a broader, auditable replay corpus.

This phase is not production-ready approval, not default-on AgentMap, and not default cutover. AgentMap remains default-off, explicit-invocation only, explicit valid `AgentMapResult` only, readonly, non-authoritative, non-persistent, and outside default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, tool/security/approval/retry/completion authority, and automatic discovery/build/cache/reuse.

## Artifacts

- `replay-proof-plan.md`
- `replay-corpus.md`
- `replay-results.md`
- `boundary-proof.md`
- `leakage-proof.md`
- `provider-ordering-proof.md`
- `rollback-proof.md`
- `quantitative-scorecard.md`
- `validation-plan.md`
- `submission-template.md`
- `synthesis.md`

## Status

Initial synthesis status is `needs_revision`. It can become `accepted` only after required validation passes, replay corpus evidence is complete, the scorecard reaches the acceptance threshold, and no veto fires.
