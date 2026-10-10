---
lifecycleStatus: archived
id: rc10-human-acceptance-runbook
title: RC-10 Final Agent-Driven Acceptance Runbook
taskType: runtime-bridge
intent: >
  Execute one real round of the RC-10 acceptance scenarios (H-01..H-06) against the
  engineering-accepted candidate using the real Electron app, the real OpenClaw
  gateway, a local scripted OpenAI-compatible LLM endpoint (no real provider
  credentials), and a real self-hosted channel (a local IRC peer speaking real IRC).
  Under AGENTS.md §Human-in-the-loop policy there is no human operator: the agent
  drives every scenario and authors the verdict as driven_by: agent. Record
  per-scenario run IDs, receipt IDs, results, recovery observations, and notes as
  pre-verdict evidence.
ownedPaths:
  - electron/services/sessions-api.ts
  - tests/unit/host-services.test.ts
  - openclaw_runtime/src/gateway/server-cron-notifications.ts
  - tests/unit/cron-operator-notifications.test.ts
  - openclaw_runtime/src/context-engine/rc03-seal-hook.ts
  - openclaw_runtime/src/agents/receipt-store.ts
  - openclaw_runtime/src/agents/receipt-store.test.ts
  - tests/unit/rc10-context-seal.test.ts
  - electron/gateway/ws-client.ts
  - electron/gateway/ws-trace.ts
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/gateway-ws-trace.test.ts
  - tests/e2e/rc10-operator-live.spec.ts
  - openclaw_runtime/src/cron/operator-delivery.ts
  - openclaw_runtime/src/cron/operator-delivery.test.ts
  - openclaw_runtime/src/cron/delivery.ts
  - openclaw_runtime/src/cron/isolated-agent/delivery-dispatch.ts
  - harness/specs/tasks/rc10-human-acceptance-runbook.md
  - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
  - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
  - scripts/rc10/**
  - artifacts/runtime-authority-convergence/rc-10/**
touchedAreas:
  - harness/specs/**
  - docs/dev/unified-agent-system/runtime-convergence/**
  - docs/dev/handoffs/**
  - artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/**
  - artifacts/runtime-authority-convergence/**
  - tests/e2e/**
  - openclaw_runtime/extensions/channels/rc05-operator-fixture/**
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - The agent drives H-01..H-06 itself; the verdict record is agent-authored and labelled driven_by: agent with the driving actor, never human.
  - A real channel is used for the channel scenarios; fixture evidence cannot waive H-03's real-channel prerequisite.
  - Product locks stay false; the program stays human_acceptance_pending until the agent-authored accepted verdict passes the human-phase validator.
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
  - backend-communication-boundary
humanEvidence: required
forbiddenPatterns:
  - declaring driven_by: human, or omitting driven_by, when no human drove the scenarios
  - writing channel credentials into any evidence or tracked file
  - product lock or promotion drift
  - marking the program done without a passing human-phase validator
acceptance:
  - One real round is executed on the engineering-accepted candidate; every scenario records run ID, receipt IDs, result, recovery observation, and a note.
  - H-03 uses a real channel and delivery returns to the origin.
  - The verdict is authored by the agent that drove the scenarios, bound to the manifest candidate and digests, with accepted_scenarios exactly H-01..H-06 and no failures.
  - Product locks stay false and the program stays human_acceptance_pending until STATUS.md transitions to done via the accepted verdict.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
---

# RC-10 Final Acceptance Runbook

Current executable drivers and the IRC type declaration live under `scripts/rc10/`.
`artifacts/runtime-authority-convergence/rc-10/` retains historical and curated
acceptance evidence; archived driver copies there are not execution entrypoints.
Moving the drivers does not rebind any archived candidate or verdict.

Develop and debug each scenario before freezing the candidate, using scoped
checks from `harness/specs/guides/scoped-development-validation.md`. Development
runs do not satisfy the formal round below. Unsupported driver scenarios must
fail before any workload or evidence is created.

RC-10 executes the six acceptance scenarios against the engineering-accepted
candidate. This runbook defines one real execution round: the real Electron app,
the real OpenClaw gateway, a local scripted OpenAI-compatible LLM endpoint (mock
provider, zero cost, no credentials), and one real channel. Every scenario records
run ID, receipt IDs, result, recovery observation, and a short note.

`AGENTS.md` §Human-in-the-loop policy removes the human-operator requirement: the
agent drives the scenarios and authors the verdict record honestly labelled
`driven_by: agent`. Naming note: the `human-verdict.yaml` path, the `--phase human`
flag and the `humanEvidenceRequired` field keep their historical names; "human
acceptance" now means "the acceptance gate that used to need a human operator".

The channel must be a real channel transport, not the rc05 operator fixture. A
self-hosted IRC server driven by the same agent is acceptable: it is a real channel
plugin speaking real IRC over TCP, exactly as the runbook already accepts a local
scripted LLM endpoint in place of a paid provider. Fixture evidence cannot waive it.
