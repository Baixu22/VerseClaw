---
id: capability-registry-v3-controlled-rollout
title: Capability Registry V3 evaluation and controlled rollout
scenario: capability-registry-v3
taskType: runtime-opt-in
diffBase: 8306466d175016a938703c41125dc3a3dca68390
intent: Implement V3-08 as a default-disabled, caller-owned in-memory rollout and evaluation control plane with exact provider/model/workflow targeting, deterministic canary cohorts, bounded receipts, and no automatic graduation.
ownedPaths:
  - docs/dev/capability-registry-v3-*-acceptance.md
  - docs/architecture-overview.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-*.md
  - openclaw_runtime/src/capabilities/v3/**
  - openclaw_runtime/src/agents/tool-search.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.test.ts
  - openclaw_runtime/src/agents/tool-search-code-mode-v3.test.ts
  - openclaw_runtime/src/infra/circuit-breaker.ts
  - openclaw_runtime/src/infra/circuit-breaker.test.ts
residualPaths:
  - .agent-workbench/task-forest/exports/task-forest.graph.json
  - .agent-workbench/task-forest/exports/task-forest.html
  - .agent-workbench/task-forest/graph/forest.json
touchedAreas:
  - harness/src/cli.mjs
  - harness/src/report.mjs
  - harness/src/rules.mjs
  - tests/unit/harness-specs.test.ts
  - docs/dev/capability-registry-v3-controlled-rollout-acceptance.md
  - docs/architecture-overview.md
  - harness/specs/scenarios/capability-registry-v3.md
  - harness/specs/rules/capability-registry-v3-boundary.md
  - harness/specs/tasks/capability-registry-v3-controlled-rollout.md
  - openclaw_runtime/src/capabilities/v3/rollout-control-v3.ts
  - openclaw_runtime/src/capabilities/v3/rollout-control-v3.test.ts
  - openclaw_runtime/src/capabilities/v3/rollout-evaluation-v3.ts
  - openclaw_runtime/src/capabilities/v3/rollout-evaluation-v3.test.ts
  - openclaw_runtime/src/agents/tool-search.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.ts
  - openclaw_runtime/src/agents/tool-search-capability-v3.test.ts
  - openclaw_runtime/src/agents/tool-search-code-mode-v3.test.ts
  - openclaw_runtime/src/infra/circuit-breaker.ts
  - openclaw_runtime/src/infra/circuit-breaker.test.ts
expectedUserBehavior:
  - With the controller omitted, disabled, off, or killed, no existing Tool Search, Code Mode, provider, prompt, storage, transcript, Host API, or UI path changes.
  - Shadow decisions collect only caller-supplied metadata and never authorize V3 execution. Opt-in and canary activation require an exact provider/model/workflow allowlist match.
  - Canary assignment is deterministic for a stable request/target/policy, receipts are bounded and raw results are not retained, and evaluation reports never change product locks or auto-graduate V3.
requiredProfiles:
  - fast
requiredRules:
  - capability-registry-v3-boundary
forbiddenPatterns:
  - application config, environment flag, default caller, prompt mutation, provider transport, Gateway, Host API, Electron, Renderer, persistence, or a second telemetry exporter
  - wildcard allowlists, random cohort assignment, raw tool/provider result storage, credentials, unbounded receipts, or high-cardinality request ids in metric attributes
  - automatic default-on, live-ready, product-approved, release, or GA decisions
featureFlags:
  - Construction policy requires enabled=true. Modes are off, shadow, opt-in, and canary; killSwitch=true always prevents activation.
rollback:
  - Stop constructing the in-memory controller and collector. Existing V3 opt-in adapters and all legacy paths remain unchanged; no migration or cleanup is required.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/capability-registry-v3-controlled-rollout.md
  - pnpm harness validate --spec harness/specs/tasks/capability-registry-v3-controlled-rollout.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/capabilities/v3/capability-descriptor.test.ts src/capabilities/v3/evaluation-baseline.test.ts src/capabilities/v3/shadow-catalog.test.ts src/capabilities/v3/skill-resolver.test.ts src/capabilities/v3/trusted-catalog.test.ts src/capabilities/v3/unified-resolver.test.ts src/capabilities/v3/dcs-projection.test.ts src/capabilities/v3/result-pointer.test.ts src/capabilities/v3/provider-native-capability-v3.test.ts src/capabilities/v3/rollout-control-v3.test.ts src/capabilities/v3/rollout-evaluation-v3.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/tool-search-capability-v3.test.ts src/agents/tool-search-code-mode-v3.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.infra.config.ts src/infra/circuit-breaker.test.ts
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm --dir openclaw_runtime tsgo:core:test
  - pnpm run lint:check
  - pnpm run typecheck
  - git diff --check
acceptance:
  - Disabled, off, kill-switch, invalid-target, and allowlist-miss decisions never activate V3. Shadow observes but never activates; opt-in requires an explicit request; canary assignment is stable and bounded by its configured percentage.
  - Provider, model, and workflow matches are exact and wildcard-free. Policy validation rejects malformed bounds, duplicate targets, empty salts, and unsafe entries.
  - The collector retains at most its configured receipt count, treats request replay idempotently, rejects request-id conflicts, stores a closed metadata projection with no raw result, and tolerates metric-sink failure.
  - The A/B report includes category/namespace/capability Recall@k, first-call success, schema retry, fallback, policy denial, input/cache tokens, cache miss by catalog epoch, pointer token savings, and per-topology success/latency.
  - Recall regression beyond five percentage points produces a hold decision. Missing real control/treatment samples produces insufficient-evidence. Even reviewable fixture evidence keeps defaultOn, liveReady, and productApproved false.
  - No UI is added because V3 has no user-visible setting in this package; therefore i18n, build, and Electron E2E are not triggered.
docs:
  required: true
  files:
    - docs/architecture-overview.md
    - docs/dev/capability-registry-v3-controlled-rollout-acceptance.md
---

# Capability Registry V3-08: Evaluation and controlled rollout

V3-08 is a caller-owned control plane, not a new runtime owner. Its receipts and
metric points are in-memory inputs for an existing observability owner. Static
fixtures can prove calculations and safety contracts but cannot prove live
rollout readiness or authorize default-on behavior.
