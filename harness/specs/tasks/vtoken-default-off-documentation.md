---
lifecycleStatus: archived
id: vtoken-default-off-documentation
title: VToken default-off documentation correction
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove active VToken default-on claims while preserving historical records with explicit correction notes and keeping runtime defaults unchanged.
touchedAreas:
  - harness/specs/tasks/vtoken-default-off-documentation.md
  - harness/specs/tasks/vtoken-foundation-bridge.md
  - harness/specs/rules/vtoken-foundation-boundary.md
  - docs/dev/dcs-visible-production/tasks/TASK-P1-04.md
  - docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md
  - docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md
  - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
  - shared/vtoken/types.ts
  - electron/services/vtoken-bridge.ts
  - packages/vtoken/README.HOST.md
  - tests/unit/vtoken-default-off-documentation.test.ts
  - docs/dev/first-product-controlled-preview/STATUS.md
  - docs/dev/first-product-controlled-preview/tasks/FP-P4-06.md
  - docs/dev/first-product-controlled-preview/tasks/README.md
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - Current documentation consistently describes VToken assembly and its diagnostics bridge as default-off opt-in capabilities.
  - Historical default-on records remain visible but carry an adjacent correction that points to the current authority.
  - Documentation correction does not enable VToken or change runtime behavior.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - vtoken-foundation-boundary
  - docs-sync
requiredTests:
  - tests/unit/vtoken-default-off-documentation.test.ts
  - tests/unit/default-config-matrix.test.ts
acceptance:
  - The active VToken Harness task and rule agree on default-off behavior.
  - Historical TASK-P1-04 default-on lines remain present with an explicit FP-P4-06 correction.
  - Known stale developer comments no longer claim a default-on product path.
  - Repository markdown scan findings are classified in the FP-P4-06 task record.
  - A regression test rejects renewed active default-on claims.
docs:
  required: true
---

Use this task spec for `FP-P4-06`. It corrects documentation authority only;
runtime defaults, launch environment, config precedence, and kill behavior must
remain unchanged.
