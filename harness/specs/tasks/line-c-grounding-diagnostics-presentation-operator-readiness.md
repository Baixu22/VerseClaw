---
lifecycleStatus: archived
id: line-c-grounding-diagnostics-presentation-operator-readiness
title: Line C grounding diagnostics presentation operator readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define Phase B operator readiness for aggregate diagnostics presentation and runbook coverage without raw data, runtime authority, or UI unless a later narrower implementation spec accepts it.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-diagnostics-presentation-operator-readiness.md
  - runtime-research/handoffs/line-c-grounding-diagnostics-presentation-operator-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-diagnostics-presentation-operator-readiness.md
  - runtime-research/handoffs/line-c-grounding-diagnostics-presentation-operator-readiness/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Operators see only aggregate or summary diagnostics metadata in approved runbooks or future accepted presentation surfaces.
  - All presentation outputs remain non-authoritative with `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - No raw prompt, trace, payload, tool args, output, stdout, stderr, env, secret, API key, auth header, traceparent, tracestate, baggage, or untrusted ref is displayed.
  - Presentation language never implies runtime authority, completion authority, provider authority, prompt authority, durable fact authority, or rollback authority beyond diagnostics.
  - User-visible UI, settings, locale strings, and E2E coverage remain forbidden unless a later implementation spec accepts them.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - raw or secret-like display, raw trace/prompt/payload retention, untrusted refs, or full tool args/output
  - authority wording that suggests runtime, completion, provider ordering, prompt, memory, persistence, patch, symbol, or workspace mutation authority
  - renderer direct IPC, direct Gateway HTTP/WebSocket, renderer-owned transport switching, Gateway/Main/host-api/api-client contract changes, or provider transport changes
  - UI/settings implementation, public docs, hardcoded user-facing strings, missing en/zh/ja/ru locale coverage, or missing Electron E2E when UI is later accepted
  - default-on, prompt/model-message injection, provider ordering drift, memory promotion, fact acceptance, episode writes, persistence, services, listeners, exporters, caches, patch apply, workspace edit, or symbol mutation
featureFlags:
  - No feature flag, UI setting, public API, Gateway route, IPC route, provider registration, provider ordering, or TaskLoop gate is authorized by this operator-readiness spec.
rollback:
  - Remove or hide the presentation/runbook artifact and return to internal diagnostics-only operation.
  - Verify no raw display cache, persisted presentation data, or stale authority wording remains.
rejectedBoundaries:
  - raw presentation, authority claims, user-visible UI without i18n/E2E, transport changes, runtime decision coupling, provider ordering changes, persistence, memory writes, default-on, and mutation surfaces
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-diagnostics-presentation-operator-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-presentation-operator-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-presentation-operator-readiness.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-pilot.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-diagnostics-presentation-operator-readiness.md docs/dev/runtime-research-boundaries.md
acceptance:
  - Aggregate-only presentation and operator runbook requirements are documented.
  - Raw display count, authority display count, and untrusted ref display count remain 0.
  - UI/i18n/E2E requirements are explicit for any later user-visible surface.
  - README review and comms decision are recorded.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
nextPhaseEntry:
  Allowed next phase:
    - Phase C limited production opt-in diagnostics-only may proceed only after this synthesis is accepted.
  Still forbidden:
    - default-on, runtime authority, prompt/model-message/provider-ordering use, persistence, raw display, untrusted refs, memory promotion, fact acceptance, episode write, UI without i18n/E2E, patch apply, workspace edit, and symbol mutation
---

# Line C Grounding Diagnostics Presentation Operator Readiness

Phase B defines operator readiness and aggregate-only presentation constraints. It does not implement UI or change runtime behavior.
