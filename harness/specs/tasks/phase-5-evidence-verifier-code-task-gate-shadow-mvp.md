---
id: phase-5-evidence-verifier-code-task-gate-shadow-mvp
title: Phase 5 Evidence Verifier Code Task Gate Shadow MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a pure bounded shadow evaluator for a future low-authority Evidence Verifier code-task completion sanity gate, then use offline results to decide whether evidence quality is good enough before any runtime sampler or active enforcement.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-mvp.md
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-mvp.md
  - openclaw_runtime/src/runtime-core/evidence-verifier.ts
  - openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts
  - tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
  - tests/unit/runtime-evidence-verifier-contracts.test.ts
  - runtime-research/handoffs/phase-5-evidence-verifier/**
  - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged because the MVP is an explicit pure helper only.
  - The helper accepts caller-supplied task metadata and an optional existing EvidenceVerifierReport, then returns a non-authoritative shadow decision.
  - The helper classifies only legacy-completed code-edit tasks as gate candidates.
  - Missing, failed, blocked, cancelled, or insufficient verifier reports produce would_block shadow output only; they do not block completion.
  - Non-code tasks and non-completed legacy terminal states are reported as not_applicable.
  - Shadow outputs include stable counters/reasons for later risk/benefit analysis.
  - Labeled offline samples can be evaluated into useful_block, false_block, false_allow, true_allow, inconclusive, and not_evaluated counts before any runtime integration, with category buckets for evidence-quality analysis.
  - False blocks are split into shadow-only evidence-capture issues so missing local tests, uncaptured validation, external validation, true missing validation, and report-shape problems are not collapsed into one generic insufficient-evidence bucket.
  - Completed verifier reports can be tagged as risky_allow when bounded metadata exposes semantic-risk signals, but that tag is diagnostic only and must not become proof of code correctness.
  - Readiness helpers evaluate the three next gates: offline_corpus, default-off shadow_sampler, and active_pilot, with active_pilot requiring explicit runtime shadow evidence.
  - Current route guidance is evidence-quality-first: the expanded offline corpus can justify a fresh default-off runtime shadow sampler design, but runtime wiring still requires a separate accepted spec.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - default-on verifier completion gate, active code-task completion gate, TaskLoop completion authority, Mission completion authority, checkpoint authority, lifecycle authority, reviewer prompt insertion, or model-message insertion
  - Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, or direct renderer IPC/Gateway integration
  - executing lint, typecheck, tests, shell commands, diagnostics, workspace scans, or verifier runtime behavior from the helper
  - patch apply, file write, workspace edit, symbol mutation, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport
  - treating shadow report, shadow summary, EvidenceVerifierReport, missing evidence, or would_allow as task-completion evidence
featureFlags:
  - No new runtime flag is required because the MVP is an explicit pure in-memory helper only.
  - Existing Evidence Verifier shadow and pilot flags remain unchanged and are not consumed as active gates.
  - Any later TaskLoop/Gateway/Main/renderer consumer, active enforcement flag, persistence, UI, provider transport, prompt/model-message insertion, service/listener/daemon behavior, or default-on behavior requires a fresh accepted task spec.
rollback:
  - Stop calling the helper and discard any in-memory shadow output.
  - Remove the helper, export, focused tests, task spec, and handoff/index update without touching TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, AgentMap, Symbol, AST, or Evidence Verifier runtime behavior.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-mvp.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-mvp.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts
  - git diff --check -- openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts harness/specs/tasks/phase-5-evidence-verifier-code-task-gate-shadow-mvp.md runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md
  - rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|spawn|exec\\(|vitest|eslint|tsc|pnpm" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts
  - rg -n "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts tests/unit/runtime-evidence-verifier-code-task-gate-shadow.test.ts tests/unit/runtime-evidence-verifier-code-task-gate-offline-corpus.test.ts
acceptance:
  - Harness context and validation pass, or validation without --no-diff is blocked only by unrelated dirty tree state and --no-diff structural validation passes.
  - A runtime-core helper produces a code-task gate shadow report without executing commands, mutating workspace state, or changing runtime completion behavior.
  - Legacy-completed code-edit tasks with completed verifier reports produce would_allow.
  - Legacy-completed code-edit tasks with missing, failed, blocked, cancelled, or insufficient verifier reports produce would_block shadow output with stable reasons.
  - Non-code tasks and non-completed legacy states produce not_applicable.
  - Invalid input fails closed as invalid_input.
  - A summary helper produces deterministic sample counts, block counts, allow counts, and reason counts for later risk/benefit analysis.
  - A labeled offline evaluation helper produces deterministic useful-block, false-block, false-allow, true-allow, precision, and recall metrics.
  - The offline corpus quantifies the first three offline iterations and keeps offline_corpus ready while allowing only a default-off shadow_sampler decision when thresholds are met.
  - Route documentation records that the current 120-sample result supports a future default-off runtime shadow sampler design, not active-gate progression.
  - Route documentation records runtime sampler thresholds: labeled sample count at least 100, block precision at least 80%, false-block rate at most 20%, false-allow rate at most 25% or most false allows tagged risky, useful-block to false-block ratio at least 4:1, and separated false-block causes.
  - Route documentation records future thresholds for active pilot consideration: runtime shadow evidence, useful-block to false-block ratio at least 5:1, block precision at least 85-90%, and false-block rate at most 10-15%.
  - Readiness evaluation blocks progression when sample coverage, useful-block precision/recall, false-block/false-allow rates, missing verifier report share, or runtime shadow evidence are insufficient.
  - Focused tests cover allow, block, missing report, non-applicable, invalid input, evidence-capture diagnostics, semantic-risk allow tagging, aggregate summary, labeled evaluation paths, and the three readiness stages.
  - Runtime index records this as shadow-only MVP work without widening authority.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-5-evidence-verifier-code-task-gate-shadow-mvp/README.md
    - runtime-research/agent-runtime-index.md
---

# Phase 5 Evidence Verifier Code Task Gate Shadow MVP

This phase implements only a measurement base for a possible future low-authority verifier completion sanity gate:

```text
EvidenceVerifierReport + code-task terminal metadata
  -> code-task gate shadow report
  -> aggregate risk/benefit counters
  -> labeled offline capability metrics
  -> three-stage readiness checks
```

It does not implement active completion enforcement, TaskLoop integration, command execution, workspace mutation, persistence, UI, transport changes, services, or default-on behavior. Shadow output is diagnostics-only and cannot prove task completion. After the first offline corpus result, the route target is evidence-quality improvement and threshold retesting before any runtime sampler or active pilot.
