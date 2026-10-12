---
id: prompt-cache-compaction-ttl-20261012
title: Defer non-urgent compaction while prompt cache is hot (issue #164)
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Reuse the existing cache-TTL marker and context-pruning TTL settings to defer only non-urgent budget compaction while the provider prompt cache is still warm, behind an explicit opt-in rollback switch.
expectedUserBehavior:
  - With agents.defaults.compaction.deferWhileCacheHot=true and contextPruning.mode=cache-ttl, a budget-triggered compaction inside the TTL window is deferred; the transcript is not rewritten.
  - A budget-triggered compaction after the TTL expires proceeds normally.
  - Manual, overflow and timeout recovery compaction proceed immediately regardless of cache age.
  - When the opt-in is off or the provider is not cache-TTL eligible, compaction triggers exactly as before.
touchedAreas:
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compaction-cache-ttl.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact-reasons.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner-memory.ts
  - openclaw_runtime/src/auto-reply/reply/commands-compact.ts
  - openclaw_runtime/src/config/types.agent-defaults.ts
  - openclaw_runtime/src/config/zod-schema.agent-defaults.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - tests/unit/compaction-cache-ttl.test.ts
  - harness/specs/tasks/prompt-cache-compaction-ttl-20261012.md
  - harness/specs/rules/prompt-cache-observation-boundary.md
  - docs/dev/prompt-cache-compaction-ttl-20261012.md
requiredRules:
  - prompt-cache-observation-boundary
  - backend-communication-boundary
  - active-config-guards
  - comms-regression
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/compaction-cache-ttl.test.ts tests/unit/config-schema-parity.test.ts
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm exec eslint openclaw_runtime/src/agents/embedded-agent-runner/compact.ts openclaw_runtime/src/agents/embedded-agent-runner/compact-reasons.ts openclaw_runtime/src/agents/embedded-agent-runner/compaction-cache-ttl.ts openclaw_runtime/src/auto-reply/reply/agent-runner-memory.ts openclaw_runtime/src/auto-reply/reply/commands-compact.ts openclaw_runtime/src/config/types.agent-defaults.ts openclaw_runtime/src/config/zod-schema.agent-defaults.ts openclaw_runtime/src/config/schema.help.ts openclaw_runtime/src/config/schema.labels.ts tests/unit/compaction-cache-ttl.test.ts --max-warnings 0
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/prompt-cache-compaction-ttl-20261012.md
acceptance:
  - Hot cache plus budget trigger returns a stable deferred result and does not touch the transcript.
  - Cold cache, opt-in off, non-eligible provider and non-budget triggers preserve existing compaction behavior.
  - The deferral diagnostics expose trigger, deferred, ageMs and ttlMs without prompt/tool content, credentials or provider secrets.
  - The new config is optional, defaults to disabled, and a disabled config is byte-for-byte behavior-neutral.
  - No keepalive, TTL refresh, provider cache-control mutation or frozen-default change is introduced.
docs:
  required: true
  paths:
    - docs/dev/prompt-cache-compaction-ttl-20261012.md
---

# Scope

This is a bounded repair of issue #164. It consumes the already persisted
`openclaw.cache-ttl` marker and the existing `contextPruning` cache-TTL
settings. It does not invent a scheduler or claim a hit-rate/cost improvement.

The opt-in switch is `agents.defaults.compaction.deferWhileCacheHot`. A deferral
is only valid for `budget` compaction; manual, overflow and timeout recovery
remain immediate. A deferral is a successful no-op that callers may treat as a
skip, not a failed compaction.

Observation metadata is limited to the trigger, boolean deferred state, cache
age and configured TTL. No prompt text, tool contents, raw session path or
credentials are recorded.
