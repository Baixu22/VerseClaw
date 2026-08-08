---
id: runtime-authority-convergence-final-acceptance
title: RC-09 Final Engineering Acceptance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Run the repository acceptance protocol against a clean candidate whose diffBase equals the RC-01 acceptedBaseSha; validate every accepted RC task spec and a candidate-bound exact changed-path-to-RC ownership matrix; produce the final manifest and independent Executor/Verifier reports at the fixed acceptance paths; record the tested validate-runtime-authority-convergence.mjs validator; leave the program human_acceptance_pending (never done) until RC-10.
ownedPaths:
  - harness/specs/tasks/runtime-authority-convergence-final-acceptance.md
  - scripts/validate-runtime-authority-convergence.mjs
  - scripts/lib/agent-engineering-acceptance.mjs
  - scripts/agent-engineering-acceptance.mjs
  - docs/dev/unified-agent-system/runtime-convergence/**
  - artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/**
touchedAreas:
  - harness/specs/**
  - harness/src/**
  - scripts/**
  - scripts/lib/**
  - scripts/comms/**
  - docs/dev/unified-agent-system/runtime-convergence/**
  - docs/dev/Sustained-Development-Playbook.md
  - artifacts/agent-engineering-acceptance/**
  - artifacts/runtime-authority-convergence/**
  - .agent-workbench/task-forest/**
  - openclaw_runtime/**
  - tests/unit/**
  - tests/e2e/**
  - shared/**
  - electron/**
  - src/**
  - .gitattributes
  - .gitignore
  - pnpm-lock.yaml
  - tsconfig.node.json
expectedUserBehavior:
  - External default behavior and product locks do not drift; internal runtime authority changes are limited to the separately accepted RC-00 through RC-08B packages.
  - The acceptance manifest records baseRef equal to the RC-01 acceptedBaseSha; its changedPaths equal git diff --name-only <acceptedBaseSha>..<candidateSha>.
  - The final report is a green independent Verifier report whose runId, candidate commit, and source.manifestDigest match the manifest, whose Executor and Verifier identities differ, whose human residual fields remain true/review_needed, and whose semantic reportDigest validates.
  - The final manifest records humanEvidence=required for both task and safety.
  - The program reaches human_acceptance_pending; it must not become done.
cumulativeOwnership:
  requiredSpecs:
    - harness/specs/tasks/rc00-agent-engineering-acceptance-bootstrap.md
    - harness/specs/tasks/rc01-authority-inventory-baseline.md
    - harness/specs/tasks/rc02-full-payload-shadow-census.md
    - harness/specs/tasks/rc03-dcs-seal-dual-receipts.md
    - harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md
    - harness/specs/tasks/rc05-minimal-operator-governance-slice.md
    - harness/specs/tasks/rc06a-taskflow-capability-proof.md
    - harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md
    - harness/specs/tasks/rc06c-mission-lifecycle-migration.md
    - harness/specs/tasks/rc06d-task-loop-lifecycle-migration.md
    - harness/specs/tasks/rc07-memory-context-slot-convergence.md
    - harness/specs/tasks/rc08a-mcp-host-native-tool-convergence.md
    - harness/specs/tasks/rc08b-otel-observability-convergence.md
  evidence: artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json
requiredProfiles:
  - fast
  - comms
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
  - backend-communication-boundary
humanEvidence: required
forbiddenPatterns:
  - a literal placeholder in the manifest, final report, or validator
  - an invalid or missing base ref falling back to HEAD
  - identical Executor/Verifier identities
  - product lock or promotion drift
  - marking the program done before final user acceptance
featureFlags:
  - No feature flag is added or changed.
rollback:
  - Archive the RC-09 evidence directory before any rerun; the acceptance protocol refuses an existing final directory.
  - No runtime, schema, data, configuration, or migration rollback is required.
requiredTests:
  - pnpm acceptance:agent:plan --spec harness/specs/tasks/runtime-authority-convergence-final-acceptance.md --since 6493d5cce6fbfa558aa26eb4cfb5a4cd71504664 --output-dir artifacts/agent-engineering-acceptance/runtime-authority-convergence-final
  - pnpm acceptance:agent:run --manifest artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json --actor executor-agent --output-dir artifacts/agent-engineering-acceptance/runtime-authority-convergence-final
  - pnpm acceptance:agent:verify --manifest artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json --actor verifier-agent --output-dir artifacts/agent-engineering-acceptance/runtime-authority-convergence-final
  - pnpm acceptance:agent:status --output-dir artifacts/agent-engineering-acceptance/runtime-authority-convergence-final
  - node scripts/validate-runtime-authority-convergence.mjs --phase engineering --manifest artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json --engineering-report artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/final-report.json
  - pnpm harness validate --spec harness/specs/tasks/runtime-authority-convergence-final-acceptance.md
acceptance:
  - The manifest schema is agent-engineering-acceptance/v1, manifestVersion 1, executionMode full, baseRef equal to the acceptedBaseSha, and changedPaths equal to git diff --name-only <acceptedBaseSha>..<candidateSha>.
  - The final report is a green Verifier report whose runId, candidate commit, and source.manifestDigest match the manifest, whose Executor and Verifier identities differ, whose human residual fields remain true/review_needed, and whose semantic reportDigest validates.
  - The final manifest records humanEvidence=required for both task and safety; product locks stay false.
  - The validate-runtime-authority-convergence.mjs validator passes for the engineering phase.
  - changed-path-ownership.json is generated from the exact candidate diff, maps every changed path to exactly one RC-00 through RC-08B owner, and rejects missing, duplicate, or excluded-workstream entries.
  - The program reaches human_acceptance_pending; it must not become done.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/ACCEPTANCE.md
    - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-09 Final Engineering Acceptance

RC-09 executes the repository acceptance protocol against a clean candidate whose diffBase equals
the RC-01 acceptedBaseSha, produces the final manifest and independent Executor/Verifier reports at
the fixed acceptance paths, and records the tested validate-runtime-authority-convergence.mjs
validator. The program reaches human_acceptance_pending and must not become done; only RC-10 can
permit done.
