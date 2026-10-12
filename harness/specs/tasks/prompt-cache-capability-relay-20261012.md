---
lifecycleStatus: active
id: prompt-cache-capability-relay-20261012
title: Relay prompt-cache capability reconciliation into the OpenResponses gateway
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Integrate the reviewed prompt-cache capability work from the arena branch while carrying the local OpenResponses protocol fixes into the same clean candidate. The relay must keep one protocol capability decision per route, expose cache/reasoning usage breakdowns on the compatibility endpoint, and preserve replayed function-call history without regressing the existing gateway communication contracts.
touchedAreas:
  - .gitignore
  - docs/dev/**
  - harness/specs/**
  - openclaw_runtime/scripts/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/gateway/**
  - scripts/**
  - shared/i18n/**
  - src/**
  - tests/**
expectedUserBehavior:
  - A managed-transport model uses the same prompt-cache decision as its direct route, and a provider that refuses cache fields never receives them.
  - OpenAI Responses clients can observe cached prompt tokens and reasoning-token breakdowns through optional usage details.
  - Replayed Responses history keeps a function call paired with its following function_call_output.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - outbound-protocol-payload-consistency
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/openresponses-usage-and-tool-history.test.ts tests/unit/cache-read-write-visibility.test.ts tests/unit/token-usage-badge.test.tsx
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents-core.config.ts src/agents/upstream-protocol-capabilities.test.ts src/agents/upstream-protocol-cache-probe.test.ts
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents-embedded-agent.config.ts src/agents/embedded-agent-runner/history-projection-probe.test.ts
acceptance:
  - The integration candidate preserves the reviewed prompt-cache capability implementation and its payload-level probes without reintroducing duplicate protocol-id sets.
  - The OpenResponses usage schema accepts optional input_tokens_details and output_tokens_details while remaining backward compatible with legacy three-field usage payloads.
  - OpenResponses usage maps cached prompt tokens into input_tokens_details.cached_tokens and reasoning tokens into output_tokens_details.reasoning_tokens; absent details remain omitted.
  - Replayed function_call items are represented before their function_call_output so call id, name, and arguments stay paired.
  - Focused gateway and renderer tests pass from the integrated candidate; the relay does not claim live-provider or human evidence.
docs:
  required: true
---

## Background

This task records the agent-driven relay from the reviewed `arena/ce7fc0fb-verseclaw`
prompt-cache capability branch into the current private main line, followed by the local
OpenResponses compatibility changes that could not be landed directly in the dirty root
worktree.

The upstream capability branch already consolidated endpoint/api classification and added
payload-level cache probes. The local relay extends the same gateway surface with optional
Responses usage breakdowns and a replay fix for function-call history.

## Scope

- Merge and retain the reviewed prompt-cache capability changes and their focused probes.
- Carry the three OpenResponses gateway changes plus the focused usage/history test.
- Fix the Windows-only source-guard path in the upstream descriptor probe so the declared
  test is runnable from a clean checkout on all supported hosts.
- Record the integration and run the focused offline gates; do not treat offline probe
  output as live-provider acceptance.

## Out of scope

- Live provider calls, credential use, or paid requests.
- Rewriting or force-pushing the stale Knowledge UX branch; its intended presentation work
  is already superseded by the current main implementation.
- Product locks, release publication, or pushed tags beyond the existing private branch
  integration.
