---
lifecycleStatus: active
id: sekb-experience-shadow-production-confirm-wiring
title: Wire explicit SEKB experience shadow into host principle confirmation
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: e99e51e62
intent: >-
  Wire the already-implemented DistillationTool experienceShadow option into the
  production host principle-confirmation route as an explicit API opt-in. The
  runtime config leaf and every default remain unchanged; flag-off calls must
  pass the same confirm options as before, while an explicit payload request
  attaches the host workspace root and appends the shadow journal best-effort.
scenarios:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
requiredRules:
  - dcs-stage5-sekb-closure-boundary
  - active-config-guards
expectedUserBehavior:
  - A caller of knowledge.sekbConfirmPrinciple can explicitly request experienceShadow on the confirmation call.
  - The production BlockStore/journal projection remains the authoritative dcsWrite result; the shadow journal is diagnostic only and best-effort.
  - Omitting or disabling experienceShadow leaves the production confirm options unchanged.
  - The runtime.coding.sekb.experienceShadow config leaf remains observability-only and does not activate the API option.
touchedAreas:
  - shared/host-api/contract.ts
  - electron/services/knowledge-api.ts
  - shared/dcs/prod-flags-catalog.ts
  - docs/generated/catalogs/prod-flags.md
  - docs/generated/catalogs/tools.md
  - openclaw_runtime/src/knowledge/sekb/distillation-tool.ts
  - tests/unit/knowledge-api.test.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.test.ts
  - harness/specs/tasks/sekb-experience-shadow-production-confirm-wiring.md
docs:
  required: false
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/sekb-experience-shadow-production-confirm-wiring.md
  - pnpm harness validate --spec harness/specs/tasks/sekb-experience-shadow-production-confirm-wiring.md
  - pnpm exec vitest run tests/unit/knowledge-api.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/experience-block-bridge.test.ts --reporter=verbose
  - pnpm contract:check
  - pnpm run catalogs:check
  - pnpm exec eslint shared/host-api/contract.ts electron/services/knowledge-api.ts tests/unit/knowledge-api.test.ts
  - pnpm run typecheck
acceptance:
  - The production host confirm route passes an explicit experienceShadow option to DistillationTool.confirm_and_save_with_lineage when requested.
  - A focused unit test asserts the shadow receipt/journal side effect occurs on the requested workspace root and that the production dcsWrite result remains authoritative.
  - A focused regression test proves omitted/false experienceShadow passes exactly the previous confirm options (no shadow option object).
  - The change adds no new durable writer, no runtime config default change, and no real-human claim; test evidence is agent-driven.
  - Contract drift, focused tests, targeted ESLint, and the applicable typecheck projects pass, with any unrelated concurrent-lane failure recorded as out of scope.
notes:
  - The catalog entry remains kind=api / risk=api-only. This task wires an explicit API caller, not the observability-only runtime config leaf.
  - DistillationTool already implements the shadow branch and best-effort failure isolation; this task must not duplicate that behavior in the host.
---
