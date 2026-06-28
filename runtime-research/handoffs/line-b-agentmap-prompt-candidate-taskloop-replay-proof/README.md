# AgentMap TaskLoop Phase A Replay Proof

Status: accepted

This handoff validates the already accepted AgentMap TaskLoop explicit invocation pilot against real or near-real replay samples.

This phase is not production-ready approval, not default-on AgentMap, and not default cutover. AgentMap remains default-off, explicit-invocation only, explicit valid `AgentMapResult` only, readonly, non-authoritative, non-persistent, and outside default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, tool/security/approval/retry/completion authority, and automatic discovery/build/cache/reuse.

## Task Spec

Use:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-replay-proof.md
```

## Artifacts

- `replay-corpus.md`
- `replay-proof-matrix.md`
- `deterministic-replay-proof.md`
- `leakage-sentinel-proof.md`
- `provider-ordering-proof.md`
- `rollback-proof.md`
- `quantitative-replay-scorecard.md`
- `validation-plan.md`
- `submission-template.md`
- `synthesis.md`

## Acceptance Rule

`synthesis.md` started as `Status: needs_revision` and is now `Status: accepted` after the replay corpus, validation, scorecard, and veto gates passed for this phase.
