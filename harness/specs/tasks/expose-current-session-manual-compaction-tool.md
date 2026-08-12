---
id: expose-current-session-manual-compaction-tool
title: Expose safe current-session manual compaction to agents
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let an agent request manual compaction of its own active session without interrupting the tool call or gaining arbitrary session mutation authority.
touchedAreas:
  - harness/specs/tasks/expose-current-session-manual-compaction-tool.md
  - openclaw_runtime/apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/tool-display.json
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt-tool-construction-plan.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/types.ts
  - openclaw_runtime/src/agents/manual-compaction-request.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/prompt-surface.ts
  - openclaw_runtime/src/agents/sandbox/constants.ts
  - openclaw_runtime/src/agents/system-prompt.ts
  - openclaw_runtime/src/agents/tool-catalog.ts
  - openclaw_runtime/src/agents/tool-display-config.ts
  - openclaw_runtime/src/agents/tool-mutation.ts
  - openclaw_runtime/src/agents/tools/sessions-compact-tool.ts
  - openclaw_runtime/src/agents/tools/sessions-compact-tool.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/manual-compaction.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/manual-compaction.test.ts
expectedUserBehavior:
  - The active agent can call sessions_compact to request compaction of its current session.
  - The request is executed only after the active attempt releases its transcript lock, so the tool does not interrupt or deadlock its own run.
  - The tool accepts optional compaction instructions but no session key or target identifier.
  - Repeated calls in one attempt collapse to one pending compaction request.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - capability-owner-resolution
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/expose-current-session-manual-compaction-tool.md
  - pnpm harness validate --spec harness/specs/tasks/expose-current-session-manual-compaction-tool.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-tools.config.ts src/agents/tools/sessions-compact-tool.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-embedded-agent.config.ts src/agents/embedded-agent-runner/run/manual-compaction.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - sessions_compact is part of the shipped core session tool inventory and standard tool policies.
  - Tool input cannot select another session, session id, transcript, provider, model, or gateway method.
  - Calling the tool records at most one request per embedded attempt and does not call sessions.compact or abort the active run.
  - Deferred execution uses the already-resolved ContextEngine with trigger manual, forced threshold compaction, existing lifecycle hooks, maintenance, and post-compaction side effects.
  - Successful compaction updates the active session id/file and the run compaction metadata; failed or no-op compaction remains bounded and does not retry the model turn.
docs:
  required: false
  note: The shipped tool schema is the agent-facing interface; no renderer workflow or public README flow changes.
---
