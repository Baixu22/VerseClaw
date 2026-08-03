---
id: rc01-authority-inventory-baseline
title: RC-01 Rebaseline And Authority Inventory
taskType: engineering-acceptance
intent: Produce a machine-readable authority inventory covering Run, Session, Checkpoint, Workflow, Context, Memory, Tool, Approval, Effect, Receipt, Telemetry, and UI projections; classify every existing writer as reuse/adapt/converge/freeze/remove with exact owner paths; record the frozen baseline to artifacts/runtime-authority-convergence/rc-01/baseline.json with schema runtime-authority-convergence-baseline/v1, acceptedBaseSha, source/npm runtime versions, and the receipt-owner decision; select the receipt persistence owner only after schema/atomic-sequence/retention/lookup/idempotency/failure/privacy/restart proof.
ownedPaths:
  - artifacts/runtime-authority-convergence/rc-01/baseline.json
  - scripts/rc01-authority-inventory.mjs
  - harness/specs/tasks/rc01-authority-inventory-baseline.md
  - docs/dev/unified-agent-system/runtime-convergence/**
touchedAreas:
  - artifacts/runtime-authority-convergence/**
  - scripts/**
  - harness/specs/**
  - docs/dev/unified-agent-system/runtime-convergence/**
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - No runtime, renderer, Main, Gateway, provider, channel, approval, effect, memory, context, tool, telemetry, default, or readiness behavior changes.
  - Every run-domain writer has exactly one reuse/adapt/converge/freeze/remove classification and an exact owner path; no writer is unclassified.
  - runtime-family-unification-v1 is frozen and cannot authorize further expansion.
  - The receipt owner is selected only after schema, atomic-sequence, retention, lookup, idempotency, failure-propagation, privacy, and restart proof against existing durable owners.
  - baseline.json records the current source and npm runtime versions and a valid 40-hex accepted base SHA.
  - An RC-01 independent Verifier accepts the inventory using the RC-00-approved acceptance infrastructure.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - production runtime code changes in this inventory task
  - leaving any writer unclassified or inventing a classification without an owner path
  - selecting the receipt owner without schema/atomicity/retention/lookup/idempotency/failure/privacy/restart proof
  - promoting runtime-spine or RuntimeTaskEventLog replay/reducer/resume paths to lifecycle or effect authority
  - recording raw prompts, tool output, credentials, cookies, or environment values by default
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
featureFlags:
  - No feature flag is added or changed.
rollback:
  - Remove the RC-01 inventory script, the baseline.json artifact, and the RC-01 task spec.
  - No runtime, schema, data, configuration, or migration rollback is required because this task changes no product behavior.
requiredTests:
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc01-authority-inventory-baseline.md
acceptance:
  - baseline.json has schema runtime-authority-convergence-baseline/v1, a valid 40-hex acceptedBaseSha, the source (openclaw_runtime) and npm (openclaw) runtime versions, and a receipt-owner decision.
  - Every writer in the inventory is classified reuse/adapt/converge/freeze/remove with an exact owner path; no writer is unclassified.
  - TaskFlow, TaskRegistry, long-task checkpoints, RuntimeTaskEventLog, Mission, Task Loop, ClawGraph, Task Ledger, runtime-spine, memory/contextEngine slots, MCP, OTel, trajectory, Observability JSONL, and the source/npm capability split are all present.
  - runtime-family-unification-v1 is frozen.
  - The receipt owner decision is evidence-backed against schema/atomicity/retention/lookup/idempotency/failure/privacy/restart; RuntimeTaskEventLog remains a candidate unless proven otherwise.
  - An RC-01 independent Verifier accepts the inventory using the RC-00-approved infrastructure.
  - No product lock, runtime behavior, or live/readiness claim changes.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/TARGET-ARCHITECTURE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-01 Rebaseline And Authority Inventory

RC-01 is a read-only baseline package. It produces the machine-readable authority inventory and
records the frozen baseline plus the receipt-owner decision. No runtime code changes occur. The
receipt-owner decision must survive an independent Verifier pass using the RC-00-approved
acceptance infrastructure.
