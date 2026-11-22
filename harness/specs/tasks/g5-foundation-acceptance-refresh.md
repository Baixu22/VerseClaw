---
lifecycleStatus: active
id: g5-foundation-acceptance-refresh
title: Bind G5 foundation acceptance to current session and UI contracts
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: a18ac30df6a7807667337a8822e3b4df33b56759
intent: Repair reproduced acceptance fixture drift while retaining the original foundation criteria and paired journey measurements.
ownedPaths: &paths
  - tests/e2e/u6-interaction-metrics.final.spec.ts
  - tests/e2e/autonomy-runtime-readiness.spec.ts
  - tests/e2e/autonomy-host-readiness.spec.ts
  - tests/e2e/durable-task-lifecycle.spec.ts
  - scripts/check-semantic-authority-adjudication.json
  - tests/fixtures/semantic-authority/structural-flag-granularity-unregistered.json
  - harness/specs/tasks/g5-foundation-acceptance-refresh.md
  - harness/specs/tasks/audit-wiring-quick-fixes.md
  - harness/specs/tasks/audit-wiring-remainder.md
  - harness/specs/tasks/committed-branch-integration-20261109.md
touchedAreas: *paths
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
  - e2e
expectedUserBehavior:
  - Task acceptance and paired journeys exercise the current controls and owner-resolved session identities.
acceptance:
  - Both paired sides use identical journey source and preserve six journeys, owner assertions, timeouts and actual action accounting.
  - The isolated Node Gateway receives a new launch generation on every boot and its observed capability generation matches the runtime acknowledgement.
  - Host readiness waits for the configured Gateway to become ready after workspace changes, within the original test deadline.
  - Task lifecycle claims use the explicitly selected runtime-created session and preserve owner verification and stale-claim rejection.
  - Semantic authority adjudication reflects the existing read-only retirement state without changing flags or defaults.
  - Real task validation and dry-run use this change set's explicit base and complete ownership check; historical task specs remain acceptance references.
requiredTests:
  - pnpm exec vitest run tests/unit/harness-spec-lifecycle.test.ts tests/unit/semantic-authority-consistency.test.ts --maxWorkers=1 --no-file-parallelism
  - node scripts/check-semantic-authority.mjs
  - pnpm run typecheck:test
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/durable-task-lifecycle.spec.ts tests/e2e/autonomy-runtime-readiness.spec.ts tests/e2e/autonomy-host-readiness.spec.ts --workers=1 --retries=0
  - pnpm harness validate --spec harness/specs/tasks/g5-foundation-acceptance-refresh.md
  - pnpm harness run --spec harness/specs/tasks/g5-foundation-acceptance-refresh.md --dry-run
docs:
  required: true
  readmeTranslations: not-required
  reason: Acceptance fixture and specification metadata repairs preserve product behavior and existing README descriptions.
  files:
    - harness/specs/tasks/g5-foundation-acceptance-refresh.md
---

TF-0665 retains the original 27 criteria and current owner evidence. TF-0867 keeps
its separate integration and paired measurements, including unsupported baseline
slots and failed runs. Baseline and candidate UI actions are counted as performed.
