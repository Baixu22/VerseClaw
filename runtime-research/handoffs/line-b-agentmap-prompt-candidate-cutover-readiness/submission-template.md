# AgentMap Prompt Candidate Cutover Readiness Submission Template

```text
Status: needs_revision | accepted | blocked
Lane: <lane id and title>
Owner: <agent/thread>
```

## Scope

Describe the exact readiness surface reviewed. State that this is spec-only/readiness-only and does not implement prompt cutover.

## Accepted Inputs

List the prior accepted evidence, files, tests, and diagnostics the lane may rely on. Include Phase 8/9 synthesis status proof when relevant.

## Forbidden Outputs

List every behavior this lane rejects, including prompt/model/Gateway/provider insertion, default-on behavior, runtime authority, provider ordering changes, persistence, mutation/apply/edit surfaces, services/listeners/databases, and renderer boundary bypasses.

## Required Proof

Name the exact files, tests, scans, and evidence records inspected. Claims must be backed by paths or commands, not by summary alone.

## Rollback Condition

State how a future cutover proposal must roll back. At minimum: disable AgentMap prompt flags, omit explicit AgentMap input/provider registration, and restore legacy prompt/provider/Gateway/model behavior.

## Validation Commands And Scans

Paste the exact commands run or required. If a command was skipped, provide the reason and why the skip is valid for a docs-only readiness phase.

## Findings

Classify scan hits and risks:

- accepted:
- needs_revision:
- blocked:

## Decision

State whether the lane is accepted, needs revision, or blocked. Acceptance is readiness-plan acceptance only and is not prompt cutover approval.
