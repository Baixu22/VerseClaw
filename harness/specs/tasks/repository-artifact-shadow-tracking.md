---
id: repository-artifact-shadow-tracking
title: Prevent process artifacts from entering the source index
diffBase: 9a48096f94a5df7cd0c9b127c929e57f597d6c50
intent: Resolve repository hygiene issues 63, 68 and 74 without changing product behavior, local Task Forest state, historical verdicts or unrelated working changes.
touchedAreas:
  - .gitignore
  - .github/workflows/harness.yml
  - .github/workflows/check.yml
  - .design-staging/**
  - artifacts/**
  - team/claude/**
  - scripts/check-repository-artifacts.*
  - scripts/repository-artifacts.json
  - tests/unit/repository-artifact-retention.test.ts
  - harness/specs/tasks/repository-artifact-shadow-tracking.md
  - harness/specs/rules/repository-artifact-retention.md
  - docs/dev/repository-artifact-retention.md
  - docs/dev/qa-synthesis-roadmap-20260922.md
  - docs/dev/tf0013-*.md
  - docs/dev/verseconf-clawx-adoption-decision.md
expectedUserBehavior:
  - Repeated validation output and local design or planning drafts no longer travel with source checkouts.
  - Required fixtures, build inputs and canonical acceptance evidence remain loadable without local run artifacts.
  - An ignored tracked file or an undeclared tracked artifact batch fails the existing CI path.
requiredProfiles:
  - fast
requiredRules:
  - repository-artifact-retention
  - docs-sync
humanEvidence: not-required
requiredTests:
  - pnpm repo:artifacts:check
  - pnpm exec vitest run tests/unit/repository-artifact-retention.test.ts tests/unit/rc10-driver-entrypoint.test.ts --maxWorkers=1
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/repository-artifact-shadow-tracking.md
acceptance:
  - Every localized file has an external byte-verified working copy and recoverable index bytes before exact untracking.
  - All 63 initially tracked artifact batches have a declared retained, mixed or local-only status; undeclared tracked batches fail closed.
  - git ls-files -i -c --exclude-standard returns no tracked paths, with no exception for a retained batch.
  - The requiredInputs ignore and existence checks remain active, and CI invokes the retention gate before other Harness gates.
  - Validation uses only retained source files in an isolated projection, disclosing reused dependencies and pre-existing failures.
  - Local Task Forest files, original unrelated changes and historical acceptance hashes remain unchanged.
docs:
  required: true
  files:
    - docs/dev/repository-artifact-retention.md
---

This is source-index hygiene, not a product bug-fix or release acceptance. Preserve
local files and an external recovery manifest; do not delete branches, rewrite
history, reseal old evidence or update the Task Forest.

README translation review: no product behavior, feature, command or user flow is
changed. The existing source-retention links remain valid; no README text update
is required. Process logs and recovery inventories remain outside the repository.
