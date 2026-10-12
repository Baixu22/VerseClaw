---
id: prompt-cache-observability-default-on-20261012
title: Prompt-cache break attribution runs by default (issue #163)
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Make prompt-cache break attribution run without a trace file so the runtime can name which input broke a warm prefix, while keeping trace *file* output opt-in and adding an explicit kill switch.
expectedUserBehavior:
  - In a default install with no OPENCLAW_CACHE_TRACE and no debug logging, a warm session still records prompt-cache state and can attribute a cache-read drop to a specific input (model, cacheRetention, transport, streamStrategy, systemPrompt, tools).
  - Setting OPENCLAW_PROMPT_CACHE_OBSERVABILITY=0 disables attribution; trace file output remains controlled solely by cacheTrace / OPENCLAW_CACHE_TRACE.
  - No new I/O, network call, or persistent write is introduced by turning attribution on.
touchedAreas:
  - openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-observability.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - tests/unit/prompt-cache-observability.test.ts
  - harness/specs/tasks/prompt-cache-observability-default-on-20261012.md
  - docs/dev/prompt-cache-observability-20261012.md
requiredRules:
  - runtime-efficiency-observability-boundary
  - active-config-guards
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/prompt-cache-observability.test.ts tests/unit/prompt-cache-status.test.ts tests/unit/deepseek-prompt-cache-runtime.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:test
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/prompt-cache-observability-default-on-20261012.md
acceptance:
  - Attribution runs by default (no trace file, no debug) and is disabled only by OPENCLAW_PROMPT_CACHE_OBSERVABILITY=0/off/false/no.
  - Ambiguous env values fall back to the default (on) rather than silently disabling attribution.
  - A warm-prefix drop is attributed to the changed input (tools vs systemPrompt vs model etc.); a drop below the existing thresholds is not reported as a break.
  - Trace file output is unchanged and stays opt-in; enabling attribution does not write cache-trace.jsonl.
  - No keepalive request, TTL refresh, or automatic tool-schema rewrite is introduced; no frozen default is changed.
docs:
  required: true
  paths:
    - docs/dev/prompt-cache-observability-20261012.md
---

# Prompt-cache break attribution runs by default

`prompt-cache-observability.ts` already implemented the tracker, but
`attempt.ts` gated it behind `Boolean(cacheTrace) || log.isEnabled("debug")`.
In a default install both are false, so attribution never ran and the runtime
could not say *which* input broke a warm prefix — cache hit-rate could not
become a scheduling input.

This change decouples the in-memory tracker from trace-file output:

- `isPromptCacheObservabilityEnabled(env)` defaults to `true` and reads the
  explicit kill switch `OPENCLAW_PROMPT_CACHE_OBSERVABILITY`.
- `attempt.ts` sets `cacheObservabilityEnabled = isPromptCacheObservabilityEnabled()
  || Boolean(cacheTrace) || log.isEnabled("debug")`, so trace/debug still force
  it on, and operators can turn it off.

The tracker is pure in-memory bookkeeping bounded to `MAX_TRACKERS = 512`, so
running it by default adds no I/O and cannot become a measurement tax. This
deliberately does not add a keepalive, refresh a TTL, or rewrite tool schemas.