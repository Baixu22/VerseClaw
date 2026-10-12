---
id: prompt-cache-observation-ledger-20261012
title: Complete prompt-cache observations through the existing Main ledger (issue 163)
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Deliver bounded cache-break observations through the existing agent event channel into the existing Main ledger, without inventing user decisions or changing model inputs.
expectedUserBehavior:
  - Default attribution emits safe state/result metadata without enabling a trace file; explicit opt-out wins over debug and trace settings.
  - Meaningful observed breaks are readable through the existing usage.promptCacheStatus host API, separately from confirmed risk decisions.
  - Diagnostic frames are consumed in Main and never treated as chat text or forwarded as generic renderer notifications.
touchedAreas:
  - openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-observability.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - electron/services/usage-api.ts
  - electron/utils/prompt-cache-status.ts
  - electron/utils/store.ts
  - electron/gateway/event-dispatch.ts
  - electron/gateway/manager.ts
  - electron/main/index.ts
  - shared/types/workspace.ts
  - tests/unit/prompt-cache-observability.test.ts
  - tests/unit/prompt-cache-observation-ledger.test.ts
  - tests/unit/prompt-cache-status.test.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - harness/specs/tasks/prompt-cache-observation-ledger-20261012.md
  - harness/specs/tasks/prompt-cache-observability-default-on-20261012.md
  - harness/specs/rules/prompt-cache-observation-boundary.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - docs/dev/prompt-cache-observability-20261012.md
  - docs/dev/prompt-cache-observation-ledger-20261012/**
  - scripts/repository-artifacts.json
  - openclaw_runtime/scripts/ts-max-loc-baseline.json
  - .gitignore
requiredRules:
  - prompt-cache-observation-boundary
  - backend-communication-boundary
  - active-config-guards
  - comms-regression
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/prompt-cache-observability.test.ts tests/unit/prompt-cache-observation-ledger.test.ts tests/unit/prompt-cache-status.test.ts tests/unit/gateway-event-dispatch.test.ts tests/unit/deepseek-prompt-cache-runtime.test.ts
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/prompt-cache-observation-ledger-20261012.md
acceptance:
  - Default state/result events are delivered by the actual runtime agent event bus and Main dispatch path; no prompt text, tool contents, raw detail strings or credentials are retained.
  - Tool-only and system-only changes retain distinct reason codes; insignificant drops and missing or invalid usage do not create a break.
  - Runtime observations use source observed, not a synthetic action/decision; newly recorded UI decisions use source confirmed and legacy decision records remain readable.
  - The shared ledger retains at most 200 entries, deduplicates replayed event identities, and does not lose concurrent observed or confirmed writes.
  - Existing promptCacheStatus returns the exact session's latest observed break separately from UI risk decisions; unrelated sessions and old session generations do not contaminate it.
  - Explicit opt-out leaves no observation event or tracker mutation at the attempt call sites, even with trace/debug enabled; trace-file configuration and model inputs stay unchanged.
  - Raw agent diagnostic frames never enter renderer chat-event or generic notification paths; the existing typed host API is the read path.
  - Source, red/green regressions, clean-candidate gates and scoped limitations are retained; no hit-rate, throughput, scheduling or release-improvement claim is made.
docs:
  required: true
  paths:
    - docs/dev/prompt-cache-observability-20261012.md
---

One repair of #163, not a new scheduler, metrics service, storage backend or UI.
Use the existing sequenced agent event bus and electron-store risk ledger. A
runtime observation is evidence of a cache-read drop, not proof that a user
approved an action or that the tracked input change causally explains the drop.
Keep existing UI risk decisions and warning counts semantically unchanged.
