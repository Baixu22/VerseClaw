---
id: windows-alpha-closeout
title: Verify and land the current Windows alpha candidate
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: dd9ea94dc089ebfc4a457dd9e5eec8e1a0b9b12f
intent: Complete the current candidate's full Windows regression and private-main landing, preserving explicit capability and platform boundaries.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - Current Windows CLI and installer fixes retain their existing behavior through the complete desktop suite.
  - Reported capability limits agree with executable behavior and do not imply cross-platform or unrestricted product acceptance.
touchedAreas:
  - harness/specs/tasks/windows-alpha-closeout.md
  - docs/dev/windows-alpha-closeout-20261008.md
  - artifacts/windows-alpha-closeout-20261008/report.json
  - artifacts/windows-alpha-closeout-20261008/credential-scan.json
  - artifacts/windows-alpha-closeout-20261008/SHA256SUMS
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - artifacts/agent-dev-workbench/evidence.json
  - .gitignore
  - .gitattributes
docs:
  required: true
  paths:
    - docs/dev/windows-alpha-closeout-20261008.md
requiredTests:
  - pnpm test
  - pnpm run typecheck
  - pnpm exec playwright test
  - pnpm run agent-dev:deep-test
  - pnpm run harness:ci
acceptance:
  - Record clean commit/tree identities and current full root-unit and Electron discovery, results, failures, skips, and process cleanup. Targeted repeats do not replace the full result.
  - Check all root and runtime production/test type projects, readonly lint, startup budgets, communication replay/comparison, and current Agent Dev evidence.
  - Bind actual installer bytes and their source provenance to the qualification; retain earlier failed candidates and state-restoration records without rewriting them.
  - Verify existing CVK diagnostic and fixed-template PPTX boundaries and state exactly which migration/platform checks executed. Unexecuted platforms or scenarios are not passing evidence.
  - Land the verified source and curated evidence on the existing private main branch without deleting unrelated history, forcing refs, publishing, or changing product defaults.
  - Update local Task Forest and handoff from disk-backed evidence. Local task history stays out of Git.
---

This follows the owner's 2026-10-08 request to handle the remaining validation,
landing and capability-boundary points. The baseline is the clean Windows fix
candidate plus its retained report. Dependencies may be reused but source and
test identities must be recorded. New CVK enforcement, arbitrary PPTX pagination,
or another platform's execution belongs to a separately specified scope if the
owner selects it; this qualification does not silently change those contracts.
