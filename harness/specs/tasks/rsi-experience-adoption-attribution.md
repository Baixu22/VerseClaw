---
lifecycleStatus: active
id: rsi-experience-adoption-attribution
title: Bind observed SEKB adoption and outcomes to versioned experience and runs
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Record versioned experience exposure, explicit agent attribution and observed execution outcomes through the existing enabled SEKB runtime, with durable deduplication and verifiable experiment identities.
diffBase: 7bd784bd25a5cd76629f2eec17bf55162aea9e68
touchedAreas:
  - openclaw_runtime/src/knowledge/sekb/**
  - openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-db.generated.d.ts
  - scripts/rsi-adoption-export.mjs
  - scripts/rsi-adoption-export.d.mts
  - scripts/rsi-adoption-integration.mjs
  - tests/unit/rsi-adoption-*.ts
  - vitest.rsi-adoption.config.ts
  - harness/specs/tasks/rsi-experience-adoption-attribution.md
  - harness/specs/rules/rsi-experience-attribution-boundary.md
  - harness/specs/guides/rsi-remediation-roadmap.md
  - harness/specs/fixtures/rsi-experience-adoption/**
  - docs/dev/rsi-capability-and-boundaries.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - artifacts/comms/**
requiredProfiles:
  - fast
  - rsi
  - comms
requiredRules:
  - sekb-runtime-development-loop
  - rsi-experience-attribution-boundary
  - runtime-lineage-boundary
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - reliability-aggregation-boundary
expectedUserBehavior:
  - Enabled SEKB exposes the exact principle identity and content version with recalled advice.
  - An agent can explicitly cite advice or attribute a completed operation to it; adoption requires a matching observed tool call and result in the same run.
  - Run completion records operational success, failure or unknown separately from citation and adoption; an independent grader may record its own task outcome.
requiredTests:
  - node scripts/rsi-adoption-integration.mjs
  - node scripts/rsi-adoption-export.mjs --check --input harness/specs/fixtures/rsi-experience-adoption/closeout-20261108/export.v1.json
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/rsi-experience-adoption-attribution.md
acceptance:
  - RsiExperienceAttribution/v1 receipts bind principle id/content digest, task/run/session and explicit experiment/arm/repeat identity; missing identity remains null and is visible.
  - Exposure, citation, adoption and outcome are distinct events. Citation or retrieval alone changes neither adoption_count nor post_adoption_success.
  - Adopted events require a prior matching exposure plus an observed successful operation in the same run. Missing provenance, changed versions and conflicting duplicates are rejected and recorded.
  - Receipt insertion, deduplication and metric changes use one existing shared-state SQLite transaction; repeated events remain idempotent after reopening the database and after more than twenty events.
  - Unknown outcomes and absent experiment identities remain explicit. Agent-end success is operational evidence; independent task grading and causal benefit remain separately identified.
  - The production extension factory registers the agent attribution tool and supplies run/session identity. Integration checks use the real extension loader/runner and read actual persisted events, including disabled, rejection, duplicate and unknown paths.
  - Exported rows preserve all identities, observed evidence and rejection/duplicate diagnostics and disclose any row-limit truncation. Existing historical feedback exports remain readable.
  - Focused regressions, generated-schema verification, scoped types/lint, communication checks, Harness validation, hashes and credential scan pass for a committed source candidate.
docs:
  required: true
  note: Document agent attribution, operational versus graded outcomes, duplicate handling and the new readable export; keep the existing NO_GO measurement frozen.
readmeUpdates: required
---

TF-0855 delivers attribution data for TF-0856. Principle versions are digests of the recalled public advice, excluding counters and mutable diagnostic metadata. Experimental coordinates come from a trusted executor, never from model-supplied tool arguments or inferred task labels. Ordinary runtime runs can retain missing task/experiment coordinates as null without creating experimental cases.

The agent's explicit attribution records its declared use of a specific experience and the executor's observed operation. It does not establish that the experience caused task success. Outcomes from agent_end and an independent grader have separate sources. Feedback does not alter retrieval ranking, retention, candidate selection, SEKB confirmation or product defaults in this node.

Evidence is agent-driven and requires no human steps or paid provider calls. Runtime state remains in the existing private shared SQLite database; curated acceptance exports are named artifacts.

The focused factory gate replaces unused native source-parser imports with a fixture that throws and asserts zero parser calls. The SEKB store, extension loader/runner and edit operation use production implementations.
