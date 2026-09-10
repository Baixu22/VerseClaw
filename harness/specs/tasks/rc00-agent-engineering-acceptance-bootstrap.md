---
id: rc00-agent-engineering-acceptance-bootstrap
title: RC-00 Agent Engineering Acceptance Bootstrap
taskType: engineering-acceptance
intent: Prove on a clean isolated fixture that plan, isolated Executor, independent Verifier, fixed skip budget, redacted logs, explicit --output-dir, and fail-closed verdict work; repair the acceptance runner and final validator so invalid or missing base refs, phase tampering, actor tampering, report/manifest/source/gate tampering, identity overlap, Windows command no-ops, and missing or incorrect semantic reportDigest all produce NO-GO; and produce a real green verifier-report.json and final-report.json in a disposable run directory.
ownedPaths:
  - scripts/agent-engineering-acceptance.mjs
  - scripts/lib/agent-engineering-acceptance.mjs
  - scripts/validate-runtime-authority-convergence.mjs
  - scripts/comms/replay.mjs
  - scripts/comms/compare.mjs
  - harness/src/cli.mjs
  - harness/src/git.mjs
  - harness/src/rules.mjs
  - tests/unit/agent-engineering-acceptance.test.ts
  - tests/unit/comms-scripts.test.ts
  - tests/unit/runtime-authority-convergence-control-pack.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/harness-git.test.ts
  - harness/specs/tasks/rc00-agent-engineering-acceptance-bootstrap.md
  - docs/dev/Sustained-Development-Playbook.md
  - harness/specs/tasks/runtime-authority-convergence-final-acceptance.md
  - harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md
  - harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md
  - harness/specs/tasks/rc06c-mission-lifecycle-migration.md
  - harness/specs/tasks/rc06d-task-loop-lifecycle-migration.md
  - harness/specs/tasks/rc07-memory-context-slot-convergence.md
  - harness/specs/rules/agent-engineering-acceptance-boundary.md
  - docs/dev/unified-agent-system/runtime-convergence/ACCEPTANCE.md
  - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
  - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
  - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
  - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
touchedAreas:
  - scripts/**
  - tests/unit/**
  - harness/specs/**
  - harness/src/**
  - docs/dev/unified-agent-system/runtime-convergence/**
  - .agent-workbench/task-forest/**
  - openclaw_runtime/src/agents/tool-display-config.ts
  - openclaw_runtime/apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/tool-display.json
  - electron/utils/verseshell-runtime-bundle.ts
  - artifacts/agent-dev-deep-test/**
  - artifacts/agent-dev-quality/**
  - artifacts/agent-dev-workbench/**
  - docs/agent-dev-control-plane.md
  - AGENTS.md
expectedUserBehavior:
  - No runtime, renderer, Main, Gateway, provider, channel, approval, effect, memory, context, tool, telemetry, default, or readiness behavior changes.
  - An invalid or missing --since ref fails the acceptance plan immediately instead of falling back to the HEAD file list.
  - Missing/blank/non-string actors, an actor-field mismatch, identical Executor/Verifier identities, an invalid phase, and a missing or incorrect semantic reportDigest all produce NO-GO during verification.
  - Formal acceptance binds source inputs by Git blob identity rather than checkout-specific CRLF/LF bytes, and verifies manifest, candidate, base ancestry, gate evidence, and report digests from a second checkout.
  - The Windows comms commands execute main() and write non-empty, schema-valid candidate-bound artifacts.
  - Formal acceptance runs write an explicit output directory; a clean isolated fixture produces a real green verifier-report.json and final-report.json that a second Agent reproduces.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - production runtime implementation in this engineering-bootstrap task
  - a new runtime, workflow engine, store, protocol, exporter, collector, daemon, service, port, or LLM router
  - replacing the implicit HEAD^ default with another implicit fallback base
  - letting an invalid or missing --since ref silently fall back to the HEAD file list
  - accepting an executor report whose actor is missing, blank, non-string, mismatched, or identical to the verifier identity
  - accepting an executor report whose semantic reportDigest is missing or does not recompute to the declared digest
  - accepting an unknown, missing, or phase/schema-mismatched final validator invocation
  - using --no-diff for an RC implementation or final acceptance gate
  - invoking the Harness gate without --since, which leaves changed-path diff review disabled and reproduces the --no-diff bypass
  - treating declared ownedPaths as inert metadata that no validated spec family enforces
  - swallowing an unresolvable diff base into an empty changed-file list
  - using checkout-specific file bytes as the sole formal source identity
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - No feature flag is added or changed.
rollback:
  - Revert the acceptance runner source, the unit tests, and the RC-00 task spec.
  - No runtime, schema, data, configuration, or migration rollback is required because this task changes no product behavior.
requiredTests:
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm exec vitest run tests/unit/comms-scripts.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/harness-git.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc00-agent-engineering-acceptance-bootstrap.md
  - pnpm harness validate --spec harness/specs/tasks/agent-engineering-acceptance-orchestrator.md
acceptance:
  - A plan created without --since, or with an invalid or missing base ref, exits nonzero and records NO-GO instead of silently using the HEAD file list.
  - resolveChangedPaths has no catch-all fallback: when no explicit since/changedPaths is provided, the plan fails closed.
  - validateExecutorEvidence rejects executor reports with missing, blank, or non-string actor values, an actor-field mismatch, and an identical Executor/Verifier identity.
  - validateExecutorEvidence rejects executor reports whose semantic reportDigest is missing or does not recompute to the declared digest.
  - The final validator rejects unknown, missing, and mismatched engineering/human phases; it recomputes semantic reportDigest and manifest digest using the acceptance library and validates every declared gate's command, result, counts, skip budget, and log digest.
  - Formal source input identity is Git-blob based and remains equal between CRLF and LF clean checkouts of the same candidate.
  - The final Harness gate never adds --no-diff, and the Windows comms entrypoints execute main() and regenerate non-empty artifacts.
  - The Harness gate passes an explicit --since base ref so changed-path diff review is actually enabled; a gate built with --spec alone is rejected.
  - Changed-path ownership is enforced for scenario-less task specs from the task spec's own ownedPaths and touchedAreas, so a changed path owned by no declared area fails the gate.
  - An unresolvable or blank diff base ref throws instead of degrading to an empty changed-file list.
  - A clean isolated fixture repository produces a real green executor-report.json, verifier-report.json, and final-report.json under an explicit output directory.
  - A second Agent reproduces the fixture result by rerunning the same manifest in a fresh output directory.
  - No product lock, runtime behavior, or live/readiness claim changes.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-00 Agent Engineering Acceptance Bootstrap

RC-00 reuses the existing `agent-engineering-acceptance-orchestrator` runner and proves it fail
closed on a clean fixture. This task spec is the RC-00 package scope; it does not authorize any
later RC package. Each later package must add its own narrower Harness task spec.

The runtime behavior, product locks, and provider/channel/approval/effect/memory/context/tool/
telemetry authorities are unchanged by this package.
