---
id: rc10-human-acceptance-runbook
title: RC-10 Final Human Acceptance Runbook
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Execute one real round of the RC-10 human acceptance scenarios (H-01..H-06) against the engineering-accepted candidate using the real Electron app, real gateway, a local scripted OpenAI-compatible LLM endpoint (no real provider credentials), and executable channel fixtures; record per-scenario run IDs, receipt IDs, results, recovery observations, and notes as pre-verdict evidence so the user can ratify the verdict.
ownedPaths:
  - harness/specs/tasks/rc10-human-acceptance-runbook.md
  - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
  - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
touchedAreas:
  - harness/specs/**
  - docs/dev/unified-agent-system/runtime-convergence/**
  - artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/**
  - tests/e2e/**
  - openclaw_runtime/extensions/channels/rc05-operator-fixture/**
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - The human verdict record stays user-authored; an agent round may only prepare evidence, never write the verdict.
  - No real provider or channel credential is used; fixture/mock evidence cannot waive H-03's real-channel prerequisite.
  - Product locks stay false; the program stays human_acceptance_pending until the user records accepted.
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
  - backend-communication-boundary
humanEvidence: required
forbiddenPatterns:
  - a verdict file written or edited by an agent
  - real provider or channel credential use
  - product lock or promotion drift
  - marking the program done
acceptance:
  - One real round is executed: real Electron app, real gateway, local scripted LLM endpoint; every scenario records run ID, receipt IDs, result, recovery observation, and a note.
  - H-03 records the real-channel prerequisite gap when no real channel is configured; the round does not waive it.
  - The verdict file is user-authored only; the round leaves human-verdict.yaml unwritten.
  - Product locks stay false and the program stays human_acceptance_pending.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
---

# RC-10 Final Human Acceptance Runbook

RC-10 executes the six human acceptance scenarios against the engineering-accepted
candidate. This runbook defines one real execution round: the real Electron app,
the real OpenClaw gateway, a local scripted OpenAI-compatible LLM endpoint (mock
provider, zero cost, no credentials), and the executable rc05-operator channel
fixture. Every scenario records run ID, receipt IDs, result, recovery observation,
and a short note. H-03 additionally requires one real channel; without it the
round records the prerequisite gap and the verdict stays `blocked` until the
user supplies a real channel.

The verdict is user-authored only. An agent round prepares evidence; it never
writes `human-verdict.yaml`.
