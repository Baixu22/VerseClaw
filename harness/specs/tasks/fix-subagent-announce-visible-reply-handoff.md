---
id: fix-subagent-announce-visible-reply-handoff
title: Treat injected subagent completion internal events as delivered on tool-only announce turns
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Stop losing multi-agent results when the requester announce turn finishes without visible output, by treating an injected subagent completion internal event as delivered evidence for internal subagent handoffs.
touchedAreas:
  - harness/specs/tasks/fix-subagent-announce-visible-reply-handoff.md
  - openclaw_runtime/src/agents/subagent-announce-delivery.ts
  - openclaw_runtime/src/agents/subagent-announce-delivery.visible-reply.test.ts
expectedUserBehavior:
  - When an orchestrator/lead session receives a subagent completion whose announce turn runs tool-only (no visible text), the completion is still recorded as delivered because the child result was already injected into the requester session as an internal event; the lead can act on it in a later turn.
  - Announcements that never injected a subagent completion internal event, and non-subagent announce sources (cron/image/music/video), still report `visible_reply_missing` when no visible reply is produced.
  - External message-tool delivery paths and their `message_tool_delivery_missing` semantics are unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/fix-subagent-announce-visible-reply-handoff.md
  - pnpm harness validate --spec harness/specs/tasks/fix-subagent-announce-visible-reply-handoff.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/subagent-announce-delivery.visible-reply.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - A tool-only announce turn with an injected subagent completion internal event returns delivered=true with path "direct".
  - The same turn without any injected completion internal event returns delivered=false with reason "visible_reply_missing".
  - An injected event from a non-subagent source (e.g. cron) does not relax the visible-reply requirement.
  - A non-subagent announce source (e.g. image_generate) still fails with visible_reply_missing on a tool-only turn.
docs:
  required: false
  note: This is an internal runtime delivery-semantics change; public README variants do not document subagent announcement delivery behavior.
---
