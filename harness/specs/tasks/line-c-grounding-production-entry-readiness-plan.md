---
id: line-c-grounding-production-entry-readiness-plan
title: Line C grounding production-entry readiness plan
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Complete production-entry readiness planning for Line C Runtime Grounding while preserving explicit/default-off, readonly, local, bounded, summary-only, diagnostics/metadata-only, and non-authoritative boundaries.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md
  - runtime-research/handoffs/line-c-grounding-production-entry-readiness-plan/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md
  - runtime-research/handoffs/line-c-grounding-production-entry-readiness-plan/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - This stage is production-entry readiness planning only.
  - Existing default behavior remains unchanged when grounding diagnostics options are absent or disabled.
  - No default-on behavior, production cutover, runtime authority, prompt/model-message insertion, provider ordering, runtime decision, memory promotion, persistence, or UI cutover is approved.
  - Existing Line C diagnostics remain explicit/default-off, readonly, local, bounded, summary-only, diagnostics/metadata-only, and non-authoritative.
  - Any planning output keeps `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - Future production-preparation phases must be implemented only through fresh accepted task specs.
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
  - default-on grounding diagnostics, production default behavior, production-ready claim, or runtime cutover claim
  - runtime authority, completion authority, provider ordering authority, prompt authority, durable fact authority, memory promotion authority, fact acceptance authority, episode write authority, memory persistence authority, patch mutation authority, symbol mutation authority, or workspace mutation authority from grounding output
  - TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, WebSocket, HTTP proxy, IPC, runtime send/receive, delivery, fallback, or communication-path behavior changes
  - provider default registration, provider ordering, provider ranking, provider selection, prompt assembly, model-message assembly, tool policy, or runtime decision changes
  - memory promotion, fact acceptance, episode write, memory store write, invalidation proposal acceptance, memory persistence mutation, or durable fact persistence
  - persistence, database, SQLite schema, JSONL sidecar, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, external service, migration, or runtime state file
  - raw retention of prompts, chat logs, trace dumps, full traces, payloads, checkpoints, tool args, tool output, stdout, stderr, env, secrets, credentials, API keys, auth headers, traceparent, tracestate, baggage, raw memory facts, raw episodes, transcripts, JSONL imports, or unbounded command output
  - untrusted refs entering emitted diagnostics, summaries, prompts, model messages, provider payloads, runtime decisions, persisted records, or public presentation
  - renderer direct `window.electron.ipcRenderer.invoke(...)`, direct Gateway HTTP calls, direct Gateway WebSocket calls, or renderer-owned transport switching
  - AST patch apply, workspace edit, rename, replaceBody, insertBefore, insertAfter, safe delete, symbol edit apply, symbol mutation, or mutating patch-planner behavior
featureFlags:
  - No config/schema feature flag, settings UI, public API flag, Gateway route, IPC route, provider registration, provider ordering, or TaskLoop gate change is authorized for this planning stage.
  - Existing diagnostics options remain explicit/default-off and internal.
  - Future opt-in expansion requires another accepted task spec before any narrower production-preparation surface is implemented.
rollback:
  - Remove this task spec, handoff directory, and runtime index entry.
  - No data migration, cleanup, cache invalidation, sidecar deletion, database migration, runtime state repair, UI rollback, provider rollback, or transport rollback is required because this stage must not add runtime behavior, persistence, services, exporters, listeners, caches, provider registration, UI, raw retained artifacts, or mutation behavior.
rejectedBoundaries:
  - default-on behavior, production default behavior, or default cutover
  - runtime authority or TaskLoop/runtime decision use
  - prompt/model-message/provider-ordering/provider-registration use
  - Gateway/Main/renderer/host-api/api-client/provider transport changes
  - persistence/database/sidecar/exporter/listener/service/cache
  - memory promotion/fact acceptance/episode write/memory persistence
  - raw prompt/raw trace/full payload/tool args/output/stdout/stderr/env/secret/api key/auth header/traceparent/tracestate/baggage retention
  - untrusted refs leakage
  - patch application/workspace edit/symbol mutation
  - UI, settings, public docs, public API, or user-visible command cutover
plannedPhaseSpecs:
  - Phase A controlled internal opt-in pilot: future task spec `line-c-grounding-controlled-internal-opt-in-pilot.md`
  - Phase B diagnostics presentation/operator readiness: future task spec `line-c-grounding-diagnostics-presentation-operator-readiness.md`
  - Phase C limited production opt-in diagnostics-only: future task spec `line-c-grounding-limited-production-opt-in-diagnostics-only.md`
  - Phase D runtime shadow replay proof: future task spec `line-c-grounding-runtime-shadow-replay-proof.md`
  - Phase E cutover readiness review: future task spec `line-c-grounding-cutover-readiness-review.md`
  - Phase F controlled production opt-in: future task spec `line-c-grounding-controlled-production-opt-in.md`
  - Phase G default-on proposal only: future task spec `line-c-grounding-default-on-proposal.md`
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|fetch\\(['\\\"]http://127\\.0\\.0\\.1:18789|new WebSocket\\(|gateway:httpProxy|hostapi:fetch" src electron shared
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|OTLP|Collector|@opentelemetry/exporter|express\\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar|createWriteStream|writeFile|appendFile" harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|rawChat|raw chat|transcript|jsonl|full tool args|full tool output|toolArgs|toolOutput|stdout|stderr|process\\.env|complete env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage" harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "runtimeAuthority|completionAuthority|providerOrderingAuthority|promptAuthority|durableFactAuthority|memoryPromotionAuthority|factAcceptanceAuthority|episodeWriteAuthority|memoryPersistenceAuthority|patchMutationAuthority|symbolMutationAuthority|authority.*grant|authority.*true|authority.*yes|authority.*allow|authority.*enabled" harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "promote|promotion|acceptFact|fact acceptance|episode write|writeEpisode|insertEpisode|memory store write|acceptInvalidation|persist|saveFact|upsertFact" harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply" harness/specs/tasks/line-c-grounding-production-entry-readiness-plan.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "Runtime Grounding|grounding|diagnostics|Line C|production-entry|default-on|runtime authority" README.md README.zh-CN.md README.ja-JP.md
acceptance:
  - Fresh production-entry readiness task spec context passes.
  - Fresh production-entry readiness task spec validation passes; if normal validation is blocked by unrelated dirty worktree files, the blocker is recorded and `--no-diff` validation is run.
  - Previous controlled-internal-opt-in readiness spec validates with `--no-diff`.
  - Previous authority-sentinel effectiveness evaluation spec validates with `--no-diff`.
  - Required seven-file grounding diagnostics unit test command passes.
  - TypeScript node project check passes or any blocker is documented as unrelated and pre-existing.
  - Handoff includes README, production roadmap, risk register, validation strategy, rollout/rollback playbook, and implementation synthesis.
  - Roadmap covers Phase A through Phase G, with allowed surface, forbidden surface, implementation prerequisites, tests, metrics, rollback, docs/i18n/E2E requirements, entry criteria, exit criteria, and stop conditions for each phase.
  - Risk register covers default-on drift, runtime authority drift, prompt/model-message injection, provider ordering drift, memory promotion/fact acceptance/episode write, persistence/database/sidecar/cache/exporter/listener/service creep, raw sensitive leakage, untrusted refs leakage, budget/token/performance regressions, transport boundary violations, UI/docs/i18n mismatch, and rollback failure.
  - Boundary scans pass or match only documented policy/spec/report text and pre-existing owner surfaces.
  - README.md, README.zh-CN.md, and README.ja-JP.md are reviewed; no update is required unless user-visible behavior, API, UI, settings, commands, or public docs changed.
  - Implementation synthesis records that comms replay/compare were not run when no Main/Gateway/host-api/api-client/provider transport/gateway events/runtime send-receive/delivery/fallback paths were touched.
  - Runtime index is updated with status, handoff, tests, rejected boundaries, and nextPhaseEntry.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - This task is internal production-entry readiness planning only and is not user-visible.
    - README files are review-required; update only if behavior, flows, interfaces, UI, settings, commands, or public docs changed.
nextPhaseEntry:
  Allowed next phase:
    - A fresh accepted task spec may implement Phase A controlled internal opt-in pilot, still explicit/default-off, diagnostics-only, summary-only, non-authoritative, and without runtime authority.
    - Each later phase must have its own accepted task spec before implementation.
  Still forbidden:
    - default-on behavior, TaskLoop/Gateway/Main/renderer/host-api/api-client/provider transport behavior, provider-ordering/default registration, prompt/model-message assembly, runtime decision/execution cutover, persistence/database/sidecar/exporter/listener/service/cache, raw retention, memory promotion, fact acceptance, episode writes, memory store writes, invalidation acceptance, renderer transport, symbol mutation, patch apply, workspace edit, rename, safe delete, UI implementation, public/user-visible settings, or production default cutover
---

# Line C Grounding Production-entry Readiness Plan

This task advances Line C only to production-entry readiness planning complete. It is not production rollout, not default-on approval, not runtime authority, not prompt/model-message insertion, not provider-ordering cutover, not memory promotion, not persistence, and not UI cutover.

All later phases require fresh accepted task specs before any implementation.
