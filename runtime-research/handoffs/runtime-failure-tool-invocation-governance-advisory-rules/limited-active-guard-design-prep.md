# Limited Active Guard Design Prep

Status: prep_only.

This is a handoff note for the next phase. It is not an implementation spec and does not approve active runtime behavior.

## Recommended Next Spec

`runtime-failure-tool-invocation-governance-limited-active-guard-design.md`

Recommended first candidate:

- `destructive_operation_guard`

Reason:

- Phase 5 already models `block` only as a future active-spec candidate.
- The narrowest candidate is deleted-path/destructive-operation metadata, because the advisory report can cite replay, scorecard, and touched-path provenance without relying on raw tool arguments.
- Broad shell pattern blocking remains a hard risk and should not be the first active candidate.

## Required Pre-Code Questions

1. Which single rule is being evaluated for active behavior?
2. What exact metadata shape triggers the candidate, and can it be derived from sanitized replay/scorecard output only?
3. What false-block cases are in the replay corpus, including slow tests and known dev-server-like long-running commands?
4. What feature flag disables the rule and restores legacy behavior without migration?
5. Which active runtime path would consume the decision, and why is that owner boundary better than leaving it advisory?
6. What checkpoint/lifecycle state writes remain forbidden?
7. What prompt/provider/Gateway/retry/approval/rollback/completion/tool-blocking paths remain untouched?
8. What evidence proves the candidate reduces unsafe or repeated failure behavior without increasing false blocked outcomes?

## Minimum Design Evidence

- Phase 5 advisory report fixture for the candidate trigger.
- At least one false-positive replay report where the active candidate must not fire.
- Scorecard comparison showing the candidate does not hide task failure as a false blocked outcome.
- Boundary scan proving only the proposed consumer imports the future active guard.
- Rollback plan proving flag-disable restores legacy behavior.

## Stop Lines

- Do not implement an active consumer in this prep note.
- Do not wire advisory reports into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking.
- Do not let `block` become default behavior.
- Do not write governance diagnostics into checkpoint or lifecycle authority state.
- Do not persist raw prompt, provider payload, tool args/results, secrets, env dumps, or unredacted workspace content.
