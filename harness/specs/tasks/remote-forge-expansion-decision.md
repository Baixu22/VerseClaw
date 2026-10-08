---
id: remote-forge-expansion-decision
title: Remote Forge expansion decision
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Decide whether GitLab, Gitee, stacked pull-request dependencies, and merge queue or train status deserve future ClawX work without implementing another adapter or granting remote mutation authority.
touchedAreas:
  - harness/specs/tasks/remote-forge-expansion-decision.md
  - harness/specs/rules/remote-forge-expansion-boundary.md
  - artifacts/first-product-preview/FP-P4-08/**
  - tests/unit/remote-forge-expansion-decision.test.ts
  - docs/dev/first-product-controlled-preview/STATUS.md
  - docs/dev/first-product-controlled-preview/tasks/FP-P4-08.md
  - docs/dev/first-product-controlled-preview/tasks/README.md
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - End users see no new forge provider, dependency graph, merge queue, or merge train behavior from this task.
  - Each candidate surface receives one evidence-linked continue, shrink, or stop verdict.
  - Shrink and stop verdicts include objective review triggers instead of remaining as indefinite backlog.
  - Any later adapter implementation starts only from a separately confirmed Task Forest proposal.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - remote-forge-expansion-boundary
requiredTests:
  - tests/unit/remote-forge-expansion-decision.test.ts
acceptance:
  - The machine-readable evidence contains exactly GitLab, Gitee, stacked PR dependency DAG, and merge queue or train decisions.
  - Every decision records demand, API fit, permission model, maintenance cost, security boundary, rationale, and objective review triggers.
  - No implementation-level continue verdict is issued without real user demand and platform evidence.
  - A retained DAG candidate preserves repository identity, cycle, truncation, and blocking-parent semantics.
  - Gitee query tokens are forbidden from generic URLs, logs, traces, errors, and support bundles.
  - Queue and train work remains read-only and cannot enqueue, dequeue, reorder, or merge.
  - No adapter, Host API, Renderer, MCP, local Git, approval, or remote mutation implementation changes are made.
  - liveReady, productApproved, defaultOn, and Agent merge remain false or off.
docs:
  required: true
  files:
    - docs/dev/first-product-controlled-preview/tasks/FP-P4-08.md
    - docs/dev/first-product-controlled-preview/STATUS.md
    - docs/dev/Sustained-Development-Playbook.md
---

# Remote Forge expansion decision

Use this task spec for `FP-P4-08`. It is a documentation and evidence gate only.
It consumes the existing GitHub engineering baseline and the frozen MergeBeacon
source snapshot, but it does not authorize implementation or remote effects.

## Validation

- `pnpm harness context --spec harness/specs/tasks/remote-forge-expansion-decision.md`
- `pnpm exec vitest run tests/unit/remote-forge-expansion-decision.test.ts`
- `pnpm harness validate --spec harness/specs/tasks/remote-forge-expansion-decision.md --since HEAD`
- `git diff --check`
