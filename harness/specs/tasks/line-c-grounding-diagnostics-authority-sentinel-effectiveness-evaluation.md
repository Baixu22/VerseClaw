---
id: line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation
title: Line C grounding diagnostics authority sentinel effectiveness evaluation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Quantitatively evaluate the accepted grounding diagnostics authority-sentinel hardening proof across Registry, Trace, Symbol, AgentMap, and Runtime Memory consumers without adding runtime authority, transport behavior, persistence, UI, prompt cutover, provider ordering, memory promotion, or mutation behavior.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation.md
  - runtime-research/handoffs/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation/**
  - tests/unit/runtime-grounding-authority-effectiveness.test.ts
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation/**
  - tests/unit/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/runtime-core/**
expectedUserBehavior:
  - Existing TaskLoop execution, Gateway behavior, Main/renderer/host-api/api-client/provider transport, provider ordering, default provider registration, prompt assembly, model-message assembly, persistence, memory promotion, symbol mutation, patch application, workspace mutation, and runtime execution decisions remain unchanged.
  - This task performs diagnostics-only quantitative evaluation of the accepted authority-sentinel hardening proof.
  - Focused unit tests, evaluation helpers, and handoff reports may be added.
  - Registry `groundingShadow` metadata and Trace, Symbol, AgentMap, and Runtime Memory `groundingDiagnostics` metadata may be compared quantitatively.
  - Enabled diagnostics may add only diagnostics/result metadata; `contextItems`, `evidenceRefs`, provider ordering, prompt/model-message content, provider registration, and runtime execution results remain unchanged.
  - Query attempts to set `includeRaw` or `includeUntrusted` are forced to `false`.
  - Untrusted refs are excluded by default.
  - Raw-like metadata and authority-grant sentinels are not retained.
  - Every grounding marker keeps `authority: "none"` and `rawRetained: false`.
  - Future optimization and presentation work is documented as proposal only.
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
  - TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, WebSocket, HTTP proxy, or IPC behavior changes
  - provider default registration, provider ordering, provider ranking, provider selection, prompt assembly, model-message assembly, tool policy, or runtime execution cutover
  - completion, blocked, failed, retry, approval, security, verifier enforcement, runtime state, memory promotion, fact acceptance, episode write, memory store write, invalidation proposal acceptance, durable fact authority, prompt authority, or provider ordering authority from grounding output
  - persistence, database, SQLite schema, JSONL sidecar, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, external service, or memory persistence API mutation
  - raw retention of prompts, chat logs, trace dumps, full traces, payloads, checkpoints, tool args, tool output, stdout, stderr, env, secrets, credentials, API keys, auth headers, traceparent, tracestate, baggage, raw memory facts, raw episodes, transcripts, JSONL imports, or unbounded command output
  - renderer direct window.electron.ipcRenderer.invoke calls, direct Gateway HTTP calls, direct Gateway WebSocket calls, or renderer-owned transport switching
  - AST patch apply, workspace edit, rename, replaceBody, insertBefore, insertAfter, safe delete, symbol edit apply, symbol mutation, or mutating patch-planner behavior
featureFlags:
  - No config/schema feature flag is required or authorized for this quantitative evaluation.
  - Existing diagnostics options must remain explicit/default-off and diagnostics-only.
  - No flag or option may enable runtime authority, persistence, raw retention, default provider registration, provider ordering changes, renderer transport changes, prompt assembly, memory fact promotion, fact acceptance, episode writes, memory store writes, invalidation proposal acceptance, symbol mutation, patch application, or workspace mutation.
rollback:
  - Remove the effectiveness evaluation spec, handoff reports, and focused quantitative unit test.
  - No data migration or cleanup is required because this task must not add persistence, stores, sidecars, exporters, listeners, services, raw retained artifacts, runtime wiring, provider registration, UI, or mutation behavior.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-hardening.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-diagnostics-authority-sentinel-effectiveness-evaluation.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-grounding-authority-effectiveness.test.ts
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components electron shared --glob '!**/*.md'
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components --glob '!**/*.md'
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar' <line-c-effectiveness-evaluation-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|rawChat|raw chat|transcript import|jsonl import|full tool args|full tool output|toolArgs|toolOutput|stdout|stderr|process\.env|complete env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|includeRaw|rawRetained|raw memory|raw episode|raw fact' <line-c-effectiveness-evaluation-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'runtimeAuthority|completionAuthority|providerOrderingAuthority|promptAuthority|durableFactAuthority|memoryPromotionAuthority|factAcceptanceAuthority|episodeWriteAuthority|memoryPersistenceAuthority|patchMutationAuthority|symbolMutationAuthority|authority.*grant|authority.*true|authority.*yes|authority.*allow|authority.*enabled' <line-c-effectiveness-evaluation-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'writeFile|appendFile|createWriteStream|mkdir|\.jsonl|\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store|sidecar' <line-c-effectiveness-evaluation-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'promote|promotion|acceptFact|fact acceptance|episode write|writeEpisode|insertEpisode|memory store write|invalidation proposal acceptance|acceptInvalidation|persist|saveFact|upsertFact' <line-c-effectiveness-evaluation-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply' <line-c-effectiveness-evaluation-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'createContextProviderRegistryPilot|runContextProviderRegistryPilot|LEGACY_CONTEXT_ENGINE_PROVIDER_ID|LOOP_CONTEXT_PACK_PROVIDER_ID|RUNTIME_TRACE_CONTEXT_PROVIDER_ID|SYMBOL_CONTEXT_PROVIDER_ID|AGENT_MAP_CONTEXT_PROVIDER_ID|RUNTIME_MEMORY_CONTEXT_PROVIDER_ID|groundingDiagnostics|groundingShadow|enabledByDefault|order|priority' openclaw_runtime/src/context-engine/*.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-authority-effectiveness.test.ts
acceptance:
  - Fresh task spec structural validation passes before implementation proceeds.
  - Design research is accepted before focused quantitative test implementation proceeds.
  - Implementation is limited to focused unit tests, evaluation helpers, handoff reports, and metadata-only sanitizer/marker drift fixes only if discovered.
  - Quantitative metrics include `consumerCoverageCount`, `sentinelClassCoverageCount`, `hostileInputLocationCoverageCount`, `leakCount`, `leakRate`, `rawLeakCount`, `authorityGrantLeakCount`, `includeRawForcedFalseRate`, `includeUntrustedForcedFalseRate`, `untrustedRefExclusionRate`, `contextItemsDiffCount`, `evidenceRefsDiffCount`, `providerOrderingDiffCount`, `diagnosticsMetadataOnlyScore`, `noAuthorityMarkerCompletenessScore`, `boundaryScanPassRate`, and `regressionProofConfidenceScore`.
  - Five consumers are covered: Registry groundingShadow, Trace groundingDiagnostics, Symbol groundingDiagnostics, AgentMap groundingDiagnostics, and Runtime Memory groundingDiagnostics.
  - Sentinel classes are covered: runtime authority, completion authority, provider ordering authority, prompt authority, durable fact authority, memory promotion authority, fact acceptance authority, episode write authority, memory persistence authority, patch mutation authority, symbol mutation authority, raw-like metadata, includeRaw/includeUntrusted, and untrusted refs.
  - Hostile input locations are covered: options metadata, query metadata/query flags, trusted ref metadata, untrusted ref metadata, and summary item metadata.
  - `leakCount`, `authorityGrantLeakCount`, `rawLeakCount`, `contextItemsDiffCount`, `evidenceRefsDiffCount`, and `providerOrderingDiffCount` are `0`.
  - `includeRawForcedFalseRate`, `includeUntrustedForcedFalseRate`, and `untrustedRefExclusionRate` are `1`.
  - `authority` remains exactly `"none"` and `rawRetained` remains exactly `false`.
  - No-authority marker completeness reaches the accepted threshold.
  - Runtime optimization proposals are documented but not implemented.
  - Future presentation proposals are documented but no UI, transport, exporter, listener, service, cache, or persistence is added.
  - README review is completed and documents whether no update is required.
  - Required validation commands and boundary scans pass or have documented benign policy/test-string-only matches.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - README files are review-required after functional or architecture changes; update them only if user-visible behavior, flows, interfaces, or public docs changed.
    - This task is expected to be runtime-internal, explicit/default-off, diagnostics-only, metadata-only, and not user-visible.
nextPhaseEntry:
  Allowed next phase:
    - a future accepted task spec may implement presentation of aggregate metrics only, never raw hostile payloads
    - future optimization may reduce duplicated test metadata assertions or centralize fixtures only after another accepted spec authorizes it
  Still forbidden:
    - TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider-ordering, default provider registration, prompt assembly, model-message, runtime execution, persistence, exporter/listener/service/cache, raw retention, memory promotion, fact acceptance, episode writes, memory store writes, invalidation acceptance, renderer transport, symbol mutation, patch apply, workspace edit, rename, safe delete, or UI implementation
---

# Line C Grounding Diagnostics Authority Sentinel Effectiveness Evaluation

This task quantifies the effectiveness of the accepted authority-sentinel hardening proof. It measures the diagnostics-only output of Registry `groundingShadow` and Trace, Symbol, AgentMap, and Runtime Memory `groundingDiagnostics` under hostile sentinel input.

The task does not authorize new runtime authority or production runtime optimization. It may add a focused quantitative unit test, evaluation helpers inside that test, and handoff reports that document optimization and future presentation proposals.
