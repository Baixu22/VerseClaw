---
lifecycleStatus: active
id: repository-ci-g8-prerequisites
title: Repair repository CI prerequisites for the G8 integration
taskType: repository-maintenance
diffBase: 42ad5e0b223d935e57630eb20c3501640721bf2e
intent: Restore lifecycle metadata, remove repeated contract and compiler work, and regenerate Agent Dev evidence before accepting the G8 candidate.
memberTasks:
  - harness/specs/tasks/architecture-review-and-integration.md
  - harness/specs/tasks/agent-dev-ecosystem-regularization.md
touchedAreas:
  - harness/specs/tasks/audit-wiring-quick-fixes.md
  - harness/specs/tasks/audit-wiring-remainder.md
  - harness/specs/tasks/committed-branch-integration-20261109.md
  - harness/specs/tasks/repository-ci-g8-prerequisites.md
  - harness/specs/rules/contract-first-boundary.md
  - harness/specs/rules/agent-dev-conformance-evidence.md
  - scripts/contract-check.mjs
  - scripts/typecheck-agent-dev.mjs
  - scripts/agent-dev-deep-test.mjs
  - tests/unit/contract-check.test.ts
  - tests/unit/typecheck-gate.test.ts
  - package.json
  - artifacts/agent-dev-workbench/evidence.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-quality/report.json
requiredRules:
  - repository-artifact-retention
  - disk-temp-policy
  - contract-first-boundary
  - agent-dev-conformance-evidence
requiredProfiles:
  - fast
requiredTests:
  - pnpm exec vitest run tests/unit/harness-spec-lifecycle.test.ts
  - pnpm harness:specs:lifecycle
  - pnpm run harness:ci
  - pnpm agent-dev:unit
  - pnpm exec vitest run tests/unit/typecheck-gate.test.ts
  - pnpm agent-dev:deep-test
  - pnpm agent-dev:audit
acceptance:
  - Every checked-in task spec declares a valid lifecycle status.
  - Preserve the three task contracts and acceptance criteria while declaring them active.
  - Record the maintenance delta separately from the G8 UI ownership report and run the complete repository Harness CI on the integrated clean candidate.
  - Every contract fixture retains its independent verdict through the real entrypoint; standalone parity, virtual-file isolation and malformed-fixture isolation pass.
  - Uncached node, web and test typechecking all execute; real test errors still fail, and cached runs invalidate when tests or imported runtime sources change.
  - Agent Dev unit, build, Electron and evidence checks pass without increasing the existing performance limits. Preserve failed attempts with their observed timings.
---

The three lifecycle fields retain their original task owners and acceptance
criteria. Contract scanner changes belong to architecture review; compiler,
command dispatch and generated reports belong to Agent Dev. The maintenance
record lists these exact paths separately, with its complete changed-path gate.
The G8 comparison starts from the accepted prerequisite, and the union of both
reports must equal the entire delta from the recorded main baseline.
