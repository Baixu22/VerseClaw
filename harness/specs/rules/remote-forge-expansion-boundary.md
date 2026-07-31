---
id: remote-forge-expansion-boundary
title: Remote Forge Expansion Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
severity: error
---

# Rule: Remote Forge expansion remains evidence-gated

## R1: Decide surfaces independently

GitLab, Gitee, stacked pull-request dependency DAG, and merge queue or train
status must each receive one `continue`, `shrink`, or `stop` verdict. A provider
or read surface verdict cannot implicitly authorize another surface.

## R2: No implementation authority

`FP-P4-08` must not add or change forge adapters, Host API routes, Renderer
flows, MCP tools, local Git authority, approvals, credentials, branches, pull
requests, queues, trains, or remote mutations. Any future implementation needs
a separate Task Forest proposal and explicit confirmation before apply.

## R3: Evidence limits the verdict

Fixture and engineering evidence may establish contract reuse and known risk,
but cannot establish real demand, platform permissions, live-provider value,
product approval, default-on readiness, or GA. Missing real demand forbids an
implementation-level `continue` verdict.

## R4: Provider security remains Main-owned

Credentials must remain inside the Main secure-storage or authenticated CLI
boundary. Gitee query tokens are forbidden in generic URLs, logs, traces,
errors, and support bundles. Private-host redaction and bounded safe errors
remain mandatory for every future provider candidate.

## R5: Dependency evidence fails closed

A retained dependency-DAG candidate must preserve repository identity, cycle,
truncation, and blocking-parent semantics. Incomplete or cyclic graphs cannot
be presented as a safe merge order and must not create or mutate branches.

## R6: Queue and train status is read-only

A retained queue or train candidate may observe bounded status only. It must
not enqueue, dequeue, reorder, retry, approve, or merge, and unknown or stale
status must remain unknown rather than ready.

## R7: Product locks remain unchanged

The decision must leave `liveReady=false`, `productApproved=false`,
`defaultOn=false`, and Agent merge OFF. It must also record objective review
triggers for every shrink or stop verdict.

## Validation

- `pnpm exec vitest run tests/unit/remote-forge-expansion-decision.test.ts`
- `pnpm harness validate --spec harness/specs/tasks/remote-forge-expansion-decision.md --since HEAD`
- `git diff --check`
