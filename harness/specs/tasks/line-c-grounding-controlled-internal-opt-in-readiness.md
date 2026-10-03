---
id: line-c-grounding-controlled-internal-opt-in-readiness
title: Line C grounding controlled internal opt-in readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove Line C Runtime Grounding is ready only for controlled internal opt-in diagnostics use, while remaining explicit/default-off, readonly, local, bounded, summary-only, diagnostics/metadata-only, and non-authoritative.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md
  - runtime-research/handoffs/line-c-grounding-controlled-internal-opt-in-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/**
  - runtime-research/agent-runtime-index.md
  - runtime-research/handoffs/line-c-grounding-controlled-internal-opt-in-readiness/**
  - tests/unit/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/runtime-core/**
expectedUserBehavior:
  - Existing default behavior remains unchanged when grounding diagnostics options are absent or disabled.
  - Registry `groundingShadow` and Trace, Symbol, AgentMap, and Runtime Memory `groundingDiagnostics` remain explicit internal diagnostics options only.
  - This task may add only readiness specs, handoff reports, validation evidence, and focused test documentation.
  - No production runtime code change is required or authorized by default for this stage.
  - Enabled diagnostics may emit only bounded diagnostics/result metadata; they must not add or alter `contextItems`, `evidenceRefs`, provider ordering, provider registration, prompt/model-message content, or runtime execution results.
  - Any emitted grounding material keeps `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - Untrusted refs remain excluded by default.
  - Raw-like metadata, raw payloads, trace dumps, transcripts, tool args/output, env, secrets, credentials, and authority-grant sentinels must not be retained.
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
  - default-on grounding diagnostics or production cutover
  - runtime authority, completion authority, provider ordering authority, prompt authority, durable fact authority, memory promotion authority, fact acceptance authority, episode write authority, memory persistence authority, patch mutation authority, symbol mutation authority, or workspace mutation authority from grounding output
  - TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, WebSocket, HTTP proxy, IPC, runtime send/receive, delivery, fallback, or communication-path behavior changes
  - provider default registration, provider ordering, provider ranking, provider selection, prompt assembly, model-message assembly, tool policy, or runtime decision changes
  - memory promotion, fact acceptance, episode write, memory store write, invalidation proposal acceptance, memory persistence mutation, or durable fact persistence
  - persistence, database, SQLite schema, JSONL sidecar, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, external service, migration, or runtime state file
  - raw retention of prompts, chat logs, trace dumps, full traces, payloads, checkpoints, tool args, tool output, stdout, stderr, env, secrets, credentials, API keys, auth headers, traceparent, tracestate, baggage, raw memory facts, raw episodes, transcripts, JSONL imports, or unbounded command output
  - renderer direct `window.electron.ipcRenderer.invoke(...)`, direct Gateway HTTP calls, direct Gateway WebSocket calls, or renderer-owned transport switching
  - AST patch apply, workspace edit, rename, replaceBody, insertBefore, insertAfter, safe delete, symbol edit apply, symbol mutation, or mutating patch-planner behavior
featureFlags:
  - No config/schema feature flag, settings UI, public API flag, Gateway route, IPC route, or provider registration change is authorized for this readiness stage.
  - Existing diagnostics options remain explicit/default-off and internal.
  - Future opt-in expansion requires another accepted task spec before any narrower production-preparation surface is implemented.
rollback:
  - Remove this task spec, handoff directory, and runtime index entry.
  - No data migration, cleanup, cache invalidation, sidecar deletion, database migration, or runtime state repair is required because this stage must not add persistence, services, exporters, listeners, caches, runtime wiring, provider registration, UI, raw retained artifacts, or mutation behavior.
rejectedBoundaries:
  - default-on or default production behavior
  - TaskLoop/runtime decision use
  - prompt/model-message/provider-ordering use
  - Gateway/Main/renderer/host-api/api-client/provider transport changes
  - persistence/database/sidecar/exporter/listener/service/cache
  - memory promotion/fact acceptance/episode write/memory persistence
  - patch application/workspace edit/symbol mutation
  - UI, settings, public docs, or user-visible command cutover
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-controlled-internal-opt-in-readiness.md docs/dev/runtime-research-boundaries.md
  - rg -n "window\\.electron\\.ipcRenderer\\.invoke|fetch\\(['\\\"]http://127\\.0\\.0\\.1:18789|new WebSocket\\(|gateway:httpProxy|hostapi:fetch" src electron shared
  - rg -n "createServer\\(|listen\\(|WebSocketServer|OTLP|Collector|@opentelemetry/exporter|express\\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar|createWriteStream|writeFile|appendFile" <line-c-controlled-internal-opt-in-readiness-touched-files>
  - rg -n "raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|rawChat|raw chat|transcript|jsonl|full tool args|full tool output|toolArgs|toolOutput|stdout|stderr|process\\.env|complete env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage" <line-c-controlled-internal-opt-in-readiness-touched-files>
  - rg -n "runtimeAuthority|completionAuthority|providerOrderingAuthority|promptAuthority|durableFactAuthority|memoryPromotionAuthority|factAcceptanceAuthority|episodeWriteAuthority|memoryPersistenceAuthority|patchMutationAuthority|symbolMutationAuthority|authority.*grant|authority.*true|authority.*yes|authority.*allow|authority.*enabled" <line-c-controlled-internal-opt-in-readiness-touched-files>
  - rg -n "promote|promotion|acceptFact|fact acceptance|episode write|writeEpisode|insertEpisode|memory store write|acceptInvalidation|persist|saveFact|upsertFact" <line-c-controlled-internal-opt-in-readiness-touched-files>
  - rg -n "applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply" <line-c-controlled-internal-opt-in-readiness-touched-files>
acceptance:
  - Fresh task spec context and structural validation pass.
  - The previous authority-sentinel effectiveness evaluation spec validates with `--no-diff`.
  - The required seven-file grounding diagnostics unit test command passes.
  - TypeScript node project check passes or any blocker is documented as unrelated and pre-existing.
  - Deep validation covers flag-off/default-off parity, explicit opt-in, five consumers, hostile sentinels, raw retention, baseline diffs, budget/performance, and rollback.
  - Quantitative metrics satisfy these thresholds: `consumerCoverageCount = 5`, `sentinelClassCoverageCount >= 14`, `hostileInputLocationCoverageCount >= 5`, `leakCount = 0`, `rawLeakCount = 0`, `authorityGrantLeakCount = 0`, `includeRawForcedFalseRate = 1`, `includeUntrustedForcedFalseRate = 1`, `untrustedRefExclusionRate = 1`, `contextItemsDiffCount = 0`, `evidenceRefsDiffCount = 0`, `providerOrderingDiffCount = 0`, `diagnosticsMetadataOnlyScore = 1`, `noAuthorityMarkerCompletenessScore = 1`, and `regressionProofConfidenceScore = 1`.
  - Boundary scans pass or match only documented policy/test/report text and pre-existing owner surfaces.
  - README.md, README.zh-CN.md, and README.ja-JP.md are reviewed; no update is required unless user-visible behavior, API, UI, settings, or commands changed.
  - Implementation synthesis records that comms replay/compare were not run when no Main/Gateway/host-api/api-client/provider transport/gateway events/runtime send-receive/delivery/fallback paths were touched.
  - Runtime index is updated with status, code, tests, handoff, and rejected boundaries.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - This task is expected to be internal readiness/report-only and not user-visible.
    - README files are review-required; update only if behavior, flows, interfaces, UI, settings, commands, or public docs changed.
nextPhaseEntry:
  Allowed next phase:
    - A fresh accepted task spec may plan a still-internal controlled opt-in pilot with an even narrower diagnostics-only surface after this readiness proof is accepted.
    - Future work may improve test fixture maintainability or aggregate metric presentation only if a new accepted spec keeps raw data hidden and preserves non-authority.
  Still forbidden:
    - default-on behavior, TaskLoop/Gateway/Main/renderer/host-api/api-client/provider transport behavior, provider-ordering/default registration, prompt/model-message assembly, runtime decision/execution cutover, persistence/database/sidecar/exporter/listener/service/cache, raw retention, memory promotion, fact acceptance, episode writes, memory store writes, invalidation acceptance, renderer transport, symbol mutation, patch apply, workspace edit, rename, safe delete, UI implementation, or public/user-visible settings
---

# Line C Grounding Controlled Internal Opt-in Readiness

This task advances Line C only to controlled internal opt-in readiness. It is a readiness, validation, and documentation stage for already accepted explicit/default-off diagnostics paths.

The task does not authorize production default-on behavior, runtime authority, prompt/model-message insertion, provider ordering, runtime decisions, memory promotion, persistence, UI, transport, or mutation behavior.
