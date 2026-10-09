---
id: phase-8-ast-editplan-narrow-rule-replay-proof
title: Phase 8 AST EditPlan Narrow-Rule Replay Proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Validate the corrected AST route's narrowed P6 as a fixed narrow-rule replay proof over ten explicit caller-owned samples, without expanding AST runtime use, product surfaces, workspace mutation, or task-completion authority.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-editplan-narrow-rule-replay-proof.md
  - tests/unit/runtime-ast-edit-plan-narrow-rule-replay-proof.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-narrow-rule-replay-proof/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/phase-8-ast-editplan-narrow-rule-replay-proof.md
  - tests/unit/runtime-ast-edit-plan-narrow-rule-replay-proof.test.ts
  - tests/unit/runtime-ast-edit-plan-controlled-apply-pilot.test.ts
  - tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts
  - tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts
  - tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts
  - runtime-research/handoffs/phase-8-ast-editplan-narrow-rule-replay-proof/**
  - runtime-research/handoffs/controlled-runtime-use-pilot-deep-validation/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - P6 only replays ten fixed narrow-rule samples across existing explicit helper stages.
  - Real apply proof writes only test-owned temporary target files created by the unit test.
  - The proof may decide keep_readonly_only, allow_more_narrow_evaluation, or pause_ast_investment.
  - The proof must not decide runtime-ready, production-ready, TaskLoop-ready, Gateway-ready, or completion-authority-ready.
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
  - repository-wide AST scan, workspace scan, file discovery, broad workspace edit, file creation outside test-owned temporary targets, file deletion, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete, or mutating planner behavior beyond the existing controlled apply pilot helper
  - TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default provider registration, direct renderer IPC/Gateway integration, reviewer prompt insertion, model-message insertion, or runtime route integration
  - default-on AST behavior, automatic apply invocation, production/runtime readiness claims, persistence, database, cache, service, listener, daemon, WebSocket server, local HTTP server, second Gateway, second runtime, external database, or new transport
  - executing formatter, lint, typecheck, tests, shell commands, diagnostics, workspace scans, ast-grep apply, or verifier runtime behavior from helper runtime behavior
  - treating preview diff, match count, candidate text, readonly scan result, ast-grep result, EditPlan output, Evidence Verifier report, ApplyGateReadinessReport output, ControlledApplyPilotReport output, dry_run_ready, or applied as task-completion evidence
featureFlags:
  - No new runtime flag is required because this phase adds no runtime consumer.
  - Existing AST helpers remain explicit-call only.
  - Any later TaskLoop/Gateway/Main/renderer/host-api/api-client route, provider transport, prompt/model-message insertion, persistence, service/listener/daemon behavior, default-on behavior, or broader apply requires a fresh accepted task spec.
rollback:
  - Remove the narrow-rule replay proof spec, handoff docs, focused unit test, and index update.
  - Existing AST helper behavior remains unchanged because this phase adds no production runtime code.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-narrow-rule-replay-proof.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-editplan-narrow-rule-replay-proof.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-narrow-rule-replay-proof.test.ts
  - git diff --check
  - node scripts/scan-pattern.mjs --pattern "TaskLoop|task-loop|Gateway|host-api|api-client|window\\.electron|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|runtime-ready|production-ready|TaskLoop-ready" tests/unit/runtime-ast-edit-plan-narrow-rule-replay-proof.test.ts openclaw_runtime/src/runtime-core/ast-edit-plan-controlled-apply-pilot.ts openclaw_runtime/src/runtime-core/ast-grep-edit-plan-adapter.ts
acceptance:
  - Harness context and validation pass, or validation without --no-diff is blocked only by unrelated dirty tree state and --no-diff structural validation passes.
  - The proof covers exactly ten fixed narrow-rule samples: React prop rename, API call migration, import rewrite, IPC route rename, and deprecated option removal, with two samples per category.
  - Every sample runs ast-grep readonly candidate generation, EditPlan verifier readiness, explicit apply gate readiness, controlled apply dry-run, and controlled temp-file apply.
  - Dry-run planned hashes, real apply content hashes, preview diff hashes, source hashes, and match range fingerprints stay consistent across replay.
  - Drift, overlap, unsupported operation, missing approval, and missing temp target cases fail closed.
  - The final P6 decision is one of keep_readonly_only, allow_more_narrow_evaluation, or pause_ast_investment.
  - No production runtime code, UI, Gateway, Main, renderer, host-api, api-client, provider transport, prompt/model-message, persistence, service, listener, daemon, or default-on behavior is added.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 8 AST EditPlan Narrow-Rule Replay Proof

This phase narrows AST P6 to proof only:

```text
ten fixed narrow rules
  -> readonly ast-grep EditPlan
  -> verifier readiness
  -> explicit apply gate readiness
  -> controlled dry-run
  -> controlled test-owned temporary apply
```

It does not approve runtime use, production use, TaskLoop/Gateway/Main/renderer/host-api/api-client integration, provider transport changes, prompt/model-message insertion, persistence, services, default-on behavior, workspace apply, symbol mutation, or task-completion evidence.
