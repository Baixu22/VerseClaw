---
lifecycleStatus: archived
id: line-c-grounding-default-on-diagnostics-only-implementation
title: Line C grounding default-on diagnostics-only implementation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement default-on Runtime Grounding diagnostics metadata after the accepted Phase G proposal, while retaining explicit disable/kill-switch rollback to disabled parity and forbidding runtime authority or prompt/provider/runtime-decision influence.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-default-on-diagnostics-only-implementation.md
  - openclaw_runtime/src/runtime-core/grounding.ts
  - openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts
  - tests/unit/runtime-grounding-default-on-diagnostics.test.ts
  - runtime-research/handoffs/line-c-grounding-default-on-diagnostics-only-implementation/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-default-on-diagnostics-only-implementation.md
  - openclaw_runtime/src/runtime-core/grounding.ts
  - openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts
  - tests/unit/runtime-grounding-default-on-diagnostics.test.ts
  - runtime-research/handoffs/line-c-grounding-default-on-diagnostics-only-implementation/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Runtime Grounding default-on output is diagnostics-only metadata from local sanitized refs and never prompt/model-message/provider/Gateway transport input.
  - The default-on helper emits bounded summary metadata by default with `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - Explicit `enabled: false`, `killSwitch: true`, invalid refs, invalid options, missing inputs, or exhausted budget fail closed to disabled diagnostics with no items and disabled/default-off parity.
  - Provider ordering, provider selection, model messages, TaskLoop/runtime decisions, context items, evidence refs, completion/tool/security/approval/retry authority, and registry defaults remain unchanged.
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
  - runtime authority, completion authority, tool authority, security authority, approval authority, retry authority, provider ordering authority, provider selection authority, prompt authority, model-message authority, memory promotion authority, fact acceptance authority, episode write authority, persistence authority, patch authority, symbol authority, or workspace mutation authority
  - prompt/model-message/provider payload insertion, Gateway request payload insertion, provider ordering drift, provider selection drift, runtime decision drift, TaskLoop cutover, registry default provider registration, Gateway/provider transport mutation, or comms path changes without comms replay/compare
  - raw prompt/trace/full payload/tool args/output/stdout/stderr/env/secret/API key/auth header/traceparent/tracestate/baggage retention, untrusted refs, transcripts, JSONL imports, persistence, database, sidecar, cache, exporter, listener, service, daemon, server, memory promotion, fact acceptance, episode write, patch apply, workspace edit, or symbol mutation
  - UI/settings/public API changes without en/zh/ja/ru i18n, Electron E2E coverage, README tri-language updates, and host-api/api-client boundary validation
featureFlags:
  - Default behavior is enabled only inside the metadata-only diagnostics summarizer surface.
  - `enabled: false` is the explicit rollback gate for disabled/default-off parity.
  - `killSwitch: true` is the emergency rollback gate and must override every other default-on input.
  - No UI setting, public API, Gateway route, IPC route, host-api contract, api-client contract, provider registration, provider ordering, TaskLoop gate, prompt/model-message gate, persistence gate, or runtime decision gate is authorized.
rollback:
  - Set `enabled: false` or `killSwitch: true`; the helper must return disabled diagnostics with zero items, `skipped: true`, and no accepted refs.
  - Revert this spec, helper code, unit test, and handoff documentation if validation finds any prompt/provider/runtime-decision drift or raw/untrusted leakage.
rejectedBoundaries:
  - runtime authority, prompt/model-message/provider-ordering/runtime-decision authority, raw/untrusted retention, persistence/database/service/listener/exporter/cache, memory promotion, fact acceptance, episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, and hidden production rollout
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-default-on-diagnostics-only-implementation.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-default-on-diagnostics-only-implementation.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-default-on-diagnostics-only-implementation.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-default-on-diagnostics.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-authority-effectiveness.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-default-on-diagnostics-only-implementation.md openclaw_runtime/src/runtime-core/grounding.ts openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts tests/unit/runtime-grounding-default-on-diagnostics.test.ts docs/dev/runtime-research-boundaries.md
  - rg boundary scan for default-on/runtime authority/prompt/model-message/provider ordering/memory promotion/fact acceptance/episode write/persistence/database/sidecar/cache/exporter/listener/service/raw prompt/raw trace/full payload/tool args/stdout/stderr/env/secret/api key/auth header/traceparent/tracestate/baggage/includeRaw/includeUntrusted/patch apply/workspace edit/symbol mutation
acceptance:
  - The new implementation spec is accepted and is distinct from the Phase G proposal-only spec.
  - Default-on diagnostics-only metadata is implemented and unit-tested with bounded sanitized summary output.
  - Explicit disable and kill-switch rollback restore disabled/default-off parity.
  - All output markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - Tests prove no prompt/model-message/provider-ordering/provider-selection/runtime-decision/context-item/evidence-ref drift and no raw retention, untrusted refs, persistence, memory promotion, fact acceptance, episode write, patch apply, workspace edit, or symbol mutation.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
nextPhaseEntry:
  Allowed next phase:
    - Wider product/runtime integration may be proposed only after this metadata-only implementation has accepted synthesis and evidence.
  Still forbidden:
    - runtime authority, prompt/model-message/provider-ordering/provider-selection/runtime-decision authority, raw/untrusted retention, persistence, memory promotion, fact acceptance, episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, and any unbounded production rollout
---

# Line C Grounding Default-on Diagnostics-only Implementation

This spec authorizes only a narrow runtime-core diagnostics metadata implementation. It does not authorize prompt, provider, Gateway, TaskLoop, persistence, UI, API, transport, or mutation changes.
