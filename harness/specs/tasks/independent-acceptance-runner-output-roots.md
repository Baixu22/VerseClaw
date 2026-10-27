---
lifecycleStatus: active
id: independent-acceptance-runner-output-roots
title: Independent acceptance runner output-root closeout
type: task
taskType: harness
intent: Correct the independent acceptance runner's plan output-root validation so it follows the explicit source root, and replace host-temp-dependent CLI fixtures with explicit positive and negative roots without weakening the path boundary.
requiredRules:
  - agent-engineering-acceptance-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
requiredProfiles:
  - fast
touchedAreas:
  - harness/specs/tasks/independent-acceptance-runner-output-roots.md
  - harness/specs/tasks/product-acceptance-closeout.md
  - harness/specs/guides/product-acceptance-strategy.md
  - harness/specs/fixtures/product-acceptance-shortfalls/ledger.json
  - harness/specs/fixtures/product-acceptance-closeout/a2-runner-path/**
  - harness/specs/rules/agent-engineering-acceptance-boundary.md
  - docs/dev/agent-engineering-acceptance.md
  - scripts/agent-engineering-acceptance.mjs
  - scripts/lib/agent-engineering-acceptance.mjs
  - scripts/lib/agent-engineering-acceptance.d.mts
  - tests/unit/agent-engineering-acceptance.test.ts
expectedUserBehavior:
  - An operator can plan into an explicit root outside the selected source tree.
  - An operator can plan into the dedicated in-tree acceptance evidence root.
  - An invalid in-tree root or traversal path fails before a manifest is written.
  - Fixture results do not change merely because the host temporary directory is inside the source tree.
requiredTests:
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/tmp/clawx-product-acceptance/<run-id>/a2-runner-path/focused.json
  - pnpm run typecheck:test
  - pnpm harness validate --spec harness/specs/tasks/independent-acceptance-runner-output-roots.md
  - pnpm harness run --spec harness/specs/tasks/independent-acceptance-runner-output-roots.md --dry-run
  - git diff --check
acceptance:
  - The original 74 focused cases remain present and pass; at least one new negative path case is added without removing or relaxing existing assertions.
  - In-tree dedicated and arbitrary out-of-tree roots produce manifest evidence; in-tree non-dedicated, repo-root, and traversal roots fail closed without evidence writes.
  - The CLI plan validates against the explicit --root rather than a process-global repository root.
  - The shortfall becomes resolved only with a clean candidate, command and exit code, parsed counts, raw artifact SHA256, curated evidence, and visible limitations.
  - No product lock, default value, approval authority, public state, or release verdict changes.
docs:
  required: true
  files:
    - docs/dev/agent-engineering-acceptance.md
    - harness/specs/guides/product-acceptance-strategy.md
---

# Independent Acceptance Runner Output-Root Closeout

TF-0575 fixes the acceptance runner's plan-stage root handling. The runner already allowed an
output root outside the selected source root and rejected in-tree paths except under
`artifacts/agent-engineering-acceptance/`; `writePlan` nevertheless hard-coded the process
repository root, so an explicit `--root` fixture could be rejected or accepted against the wrong
tree. The CLI now passes the selected root through to plan validation.

## Root contract

- Allowed: any explicit root outside the selected source tree.
- Allowed: a root inside the selected source tree below `artifacts/agent-engineering-acceptance/`.
- Rejected: the source root itself, an unrelated in-tree directory such as `.tmp/`, and a path that
  normalizes through `..` outside the dedicated acceptance root.
- Rejection happens before `manifest.json` or `plan.json` is written.

The tests construct these roots explicitly. They must not rely on `os.tmpdir()` being located outside
a checkout merely because a developer's machine happens to use `D:/tmp`. A host whose temp directory
is inside the source tree is an important negative condition, not a reason to weaken the contract.

## Evidence

Raw runs stay under `D:/tmp/clawx-product-acceptance/<run-id>/a2-runner-path/`. Curated evidence is
retained under `harness/specs/fixtures/product-acceptance-closeout/a2-runner-path/` with candidate
binding, commands, exit codes, parsed counts, skip records, source hashes, and SHA256SUMS.

The shortfall `agent-acceptance-harness-unconfigured-test-dirs` may move to `resolved` only after
that evidence is read back from disk. This node does not claim full-product GA, packaging,
real-provider, or real-human evidence.
