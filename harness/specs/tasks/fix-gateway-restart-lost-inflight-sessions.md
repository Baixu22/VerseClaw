---
id: fix-gateway-restart-lost-inflight-sessions
title: Resume in-flight main sessions after Gateway restart
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve and resume main-agent work interrupted by a Gateway restart instead of marking an active session permanently failed when its transcript tail is an incomplete assistant turn.
touchedAreas:
  - harness/specs/tasks/fix-gateway-restart-lost-inflight-sessions.md
  - openclaw_runtime/src/agents/main-session-restart-recovery.ts
  - openclaw_runtime/src/agents/main-session-restart-recovery-boundary.ts
  - openclaw_runtime/src/agents/main-session-restart-recovery.test.ts
  - openclaw_runtime/src/agents/main-session-restart-recovery.flow.test.ts
  - tests/e2e/restart-recovery-fp-p1-05.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A running main session interrupted by Gateway restart is resumed when its transcript ends in an incomplete assistant/tool turn.
  - A completed assistant turn is not replayed after restart.
  - Approval-pending and terminal error turns retain their existing non-resumable handling.
  - Recovery retry keeps the session marked for a later attempt when the Gateway agent call fails.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - backend-communication-boundary
  - comms-regression
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/main-session-restart-recovery.test.ts src/agents/main-session-restart-recovery.flow.test.ts
  - pnpm run build:vite
  - pnpm run build:runtime
  - pnpm run test:e2e:run tests/e2e/restart-recovery-fp-p1-05.spec.ts
  - pnpm run typecheck
acceptance:
  - Restart recovery distinguishes incomplete assistant turns from terminal assistant turns.
  - In-flight assistant turns with stopReason toolUse or aborted are eligible for resume.
  - Terminal assistant turns with stopReason stop, length, or error remain blocked from automatic replay.
  - Recovery sends at most one resume request per session per recovery pass and preserves abortedLastRun when the request fails.
  - Electron E2E proves that a persisted running session with an aborted assistant tail resumes once through the real Gateway startup recovery path.
  - Renderer/Main API boundaries are unchanged.
docs:
  required: true
---
