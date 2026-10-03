---
id: line-c-grounding-diagnostics-core-quantitative-tuning
title: Line C grounding diagnostics core quantitative tuning
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Quantitatively evaluate and minimally tune the existing diagnostics-only Line C grounding core after the single explicit diagnostics consumer implementation, without approving formal runtime use or crossing runtime authority boundaries.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md
  - openclaw_runtime/src/runtime-core/grounding.ts
  - openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-grounding-*.test.ts
  - runtime-research/handoffs/line-c-grounding-diagnostics-core-quantitative-tuning/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md
  - openclaw_runtime/src/runtime-core/grounding.ts
  - openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-grounding-*.test.ts
  - runtime-research/handoffs/line-c-grounding-diagnostics-core-quantitative-tuning/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - The phase evaluates internal quality and minimal tuning only; it is not formal runtime use.
  - Existing grounding output remains diagnostics-only, metadata-only, summary-only, read-only, local, bounded, and non-authoritative.
  - Authority markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - Quantitative tests report accepted sanitized summary counts, rejected invalid or wrong-consumer summary counts, fail-closed rate, leakage count, forced-false rates, authority marker completeness, boundedness, metadata drop, untrusted exclusion, rollback parity, deterministic stability, and performance/noise observations.
  - Any optimization that requires prompt/model-message/provider/Gateway/TaskLoop/runtime decision, UI/API/transport, persistence, memory write, mutation, or production rollout must be rejected with a `needs_revision` verdict and must not be implemented.
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
allowedSurface:
  - Runtime-core local test fixtures.
  - Deterministic corpus data inside focused unit tests.
  - Fuzz-like hostile metadata cases.
  - Boundary and leakage metrics.
  - Boundedness and token-budget metrics.
  - Fail-closed metrics.
  - Duplicate and omission metrics.
  - Sanitizer effectiveness metrics.
  - Performance and noise scorecard.
  - Minimal runtime-core local tightening that reduces retained metadata, tightens report shape, clarifies disabled reasons, stabilizes bounded item/token behavior, removes unused or duplicate output fields, or strengthens type guards without changing external boundaries.
  - README, handoff synthesis, task spec, and runtime index updates.
forbiddenPatterns:
  - prompt insertion, model-message insertion, provider request changes, Gateway request insertion, TaskLoop integration, runtime decision integration, provider ordering changes, provider selection changes, or broad formal runtime use
  - new UI, public API, transport, host-api, api-client, renderer IPC, Gateway route, public setting, or production rollout
  - persistence, cache, service, listener, exporter, database, sidecar, daemon, server, or second runtime process
  - memory promotion, fact acceptance, episode write, memory store write, fact store write, or durable fact authority
  - patch apply, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete, or any code/workspace mutation surface
  - raw prompt, raw trace, full payload, full event payload, tool args, tool output, stdout, stderr, env, secrets, API keys, auth headers, traceparent, tracestate, baggage, transcripts, JSONL imports, raw retention, untrusted refs, includeRaw true, or includeUntrusted true
featureFlags:
  - No new config flag, public setting, API switch, UI switch, transport switch, or production rollout flag is authorized.
  - Helper-local `enabled` and `killSwitch` options remain allowed only as rollback controls.
metrics:
  required:
    - corpus size
    - pass/fail counts
    - accepted sanitized summaries count
    - rejected invalid, missing, and wrong-consumer summaries count
    - fail_closed_rate
    - leakage_count
    - includeRaw_false_rate
    - includeUntrusted_false_rate
    - authority_marker_completeness_score
    - metadata_drop_rate
    - bounded item count
    - bounded estimated token count
    - boundedness_pass_rate
    - source metadata drop rate
    - untrusted exclusion rate
    - rollback_parity_rate
    - deterministic_stability_rate
    - performance/noise observations
    - optimization recommendations: keep, tighten, remove, defer
rollback:
  - `enabled: false` returns disabled/default-off parity with zero items, zero accepted input, zero token budget, and zero estimated tokens.
  - `killSwitch: true` returns disabled/default-off parity with zero items, zero accepted input, zero token budget, and zero estimated tokens.
  - Missing input, invalid summary, missing consumer id, wrong consumer id, invalid config, exhausted budget, raw inclusion attempts, or untrusted inclusion attempts fail closed.
rejectedBoundaries:
  - broad formal runtime use, runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration, provider ordering/selection influence, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion/fact acceptance/episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, production rollout, and hidden default-on expansion
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts tests/unit/runtime-grounding-default-on-diagnostics.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-diagnostics-core-quantitative-tuning.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - git diff --check -- harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md openclaw_runtime/src/runtime-core/grounding.ts openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts openclaw_runtime/src/runtime-core/index.ts tests/unit/runtime-grounding-diagnostics-core-quantitative-tuning.test.ts docs/dev/runtime-research-boundaries.md
  - rg boundary scan for prompt/model-message/provider ordering/provider selection/Gateway request/TaskLoop/runtime decision/completion/tool/security/approval/retry/raw retention/includeRaw/includeUntrusted/untrusted refs/persistence/cache/service/listener/exporter/database/sidecar/memory promotion/fact acceptance/episode write/patch apply/workspace edit/symbol mutation/UI/API/transport/production rollout over touched files
acceptance:
  - Fresh task spec exists and validates before implementation review.
  - Quantitative tests use a deterministic local corpus and hostile metadata cases.
  - Tests compute and assert all required rates and counts.
  - Tests prove zero leakage for raw/prompt/model-message/provider/Gateway/TaskLoop/runtime-decision/persistence/memory/mutation sentinels.
  - Tests prove `includeRaw` and `includeUntrusted` are forced false.
  - Tests prove every report remains `authority: "none"` and includes the required no-authority markers.
  - Tests prove bounded item count and estimated tokens stay within configured bounds.
  - Tests prove source metadata and caller option metadata are dropped from explicit reports.
  - Tests prove untrusted inputs are excluded and invalid input fails closed.
  - Tests prove `enabled: false` and `killSwitch: true` have rollback parity.
  - Tests prove deterministic output stability across repeated runs.
  - Final synthesis includes quantitative metrics and optimization recommendations marked keep, tighten, remove, or defer.
  - Final verdict is `needs_revision` if any desired optimization requires a forbidden boundary.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
nextPhaseEntry:
  Allowed after acceptance:
    - Continue to use the existing diagnostics-only grounding core and the single explicit diagnostics-only consumer only inside runtime-core local, bounded, summary-only, metadata-only, read-only, non-authoritative contexts.
  Still forbidden:
    - broad formal runtime use, runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion/fact acceptance/episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, production rollout, and hidden default-on expansion
---

# Line C Grounding Diagnostics Core Quantitative Tuning

This task authorizes internal quality measurement and minimal runtime-core local tightening for the already accepted diagnostics-only grounding core. It does not authorize formal runtime use.
