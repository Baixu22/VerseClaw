---
id: agent-engineering-acceptance-orchestrator
title: Agent Engineering Acceptance Orchestrator
taskType: engineering-acceptance
intent: Build a reproducible, dual-agent engineering acceptance runner that proves only engineering quality and preserves every human, product, live, release, and default-off boundary.
touchedAreas:
  - scripts/agent-engineering-acceptance.mjs
  - scripts/lib/agent-engineering-acceptance.mjs
  - scripts/rc00-acceptance-bootstrap.mjs
  - tests/unit/agent-engineering-acceptance.test.ts
  - harness/specs/rules/agent-engineering-acceptance-boundary.md
  - harness/specs/tasks/agent-engineering-acceptance-orchestrator.md
  - docs/dev/agent-engineering-acceptance.md
  - package.json
expectedUserBehavior:
  - An Executor can plan and run a complete engineering suite only against a clean committed candidate in an isolated detached worktree.
  - An independently identified Verifier reruns the same manifest in a second detached worktree before engineeringAcceptedByAgent can be true.
  - A task that requires human evidence remains review_needed after agent engineering acceptance.
  - TF-0009 legacy evidence is exported only from an isolated adapter and remains non-human, non-live, and non-promoting.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
humanEvidence: not-required
requiredTests:
  - tests/unit/agent-engineering-acceptance.test.ts
acceptance:
  - The plan derives a stable, hash-addressed manifest from a Harness task spec, changed paths, rules, and lock inputs.
  - Runtime, UI, communication, maturity, and release paths add their required full gate families without replacing Harness profiles.
  - A dirty or stale source, unsafe TLS/provider environment, forbidden side-effect argument in args or commandLine, timeout, skipped gate, missing gate, or tampered log returns NO-GO.
  - Manifest requiredTests must match the candidate spec. Countable required-test gates declare parsed counts and a fixed expectedSkips budget; counts sum every Tests segment.
  - Ignored provision copy inputs lock sha256 and bytes. Required-test command lines rerun in the role detached worktree.
  - Both roles rederive the complete ordered gate contracts and source inputs from the candidate and actual comparison diff; rehashing an abbreviated or modified manifest cannot authorize it.
  - Failure-only and skip-only test segments, Playwright summaries, and Node spec/TAP summaries preserve every outcome; contradictory totals are rejected.
  - Test-runner report validation reparses the persisted stdout and stderr; counts that disagree with those logs remain NO-GO even after every evidence digest is recomputed.
  - The TF-0009 adapter revalidates its required controlled JSON artifact and derives counts from its validated runs; ordinary runners cannot select this path by changing a source label.
  - Test classification distinguishes lint/diff targets from execution and recognizes package-manager directory, filter, and workspace options.
  - The abbreviated RC-00 bootstrap is a negative regression and cannot produce an engineering acceptance report.
  - The Executor cannot self-accept and the Verifier rejects an identical Executor identity.
  - The Verifier records engineeringAcceptedByAgent only after a separate detached-worktree rerun with matching gate contracts.
  - Run artifacts are independently addressed and redact workspace paths and secret values.
  - The TF-0009 adapter writes only to its run output and preserves all human/live/product lock boundaries.
  - No operation automatically changes Task Forest, release state, product defaults, live readiness, product approval, C1, SEKB, or Browser policy.
docs:
  required: true
  files:
    - docs/dev/agent-engineering-acceptance.md
---

# Agent Engineering Acceptance Orchestrator

This task spec is the reusable Harness entry point for agent-only engineering acceptance. It does
not make an agent a human reviewer, product approver, release authority, or live-canary operator.
