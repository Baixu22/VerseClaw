---
lifecycleStatus: active
id: runtime-memory-retirement-closeout
title: Align Runtime Memory retirement tests with production semantics
type: task
scenario: context-runtime-kit
taskType: runtime-bridge
intent: Remove the last test-contract drift around retired Runtime Memory shadow, provider, proposeFacts, and persist flags without changing production behavior or weakening TaskLoop terminal and negative-path coverage.
requiredRules:
  - context-runtime-kit-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
requiredProfiles:
  - fast
touchedAreas:
  - harness/specs/tasks/runtime-memory-retirement-closeout.md
  - harness/specs/guides/product-acceptance-strategy.md
  - harness/specs/fixtures/product-acceptance-shortfalls/ledger.json
  - harness/specs/fixtures/product-acceptance-closeout/a1-memory/**
  - tests/unit/task-loop-controller.test.ts
  - tests/unit/runtime-memory-context-contracts.test.ts
  - tests/unit/product-acceptance-shortfalls.test.ts
expectedUserBehavior:
  - Runtime Memory legacy shadow, provider, proposeFacts, and persist flags cannot be enabled from configuration.
  - A retired flag request produces no episode write, no SQLite open, no persisted row, and no replay.
  - Runtime Memory retirement does not alter TaskLoop completion, evidence, checkpoint, tool, cancellation, or blocked behavior.
  - The GA shortfall ledger records the repair only after current-candidate evidence exists.
requiredTests:
  - pnpm exec vitest run tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/tmp/clawx-product-acceptance/<run-id>/a1-memory/focused.json
  - pnpm exec vitest run tests/unit/product-acceptance-shortfalls.test.ts --maxWorkers=1
  - pnpm run typecheck:test
  - pnpm harness validate --spec harness/specs/tasks/runtime-memory-retirement-closeout.md
  - pnpm harness run --spec harness/specs/tasks/runtime-memory-retirement-closeout.md --dry-run
  - git diff --check
acceptance:
  - The original 67-task-loop-controller cases are preserved or replaced one-for-one by retirement assertions; the final file has zero failures and no new skips.
  - Explicit true, string true, omitted, false, and all-legacy-true inputs all resolve the four retired flags to false while candidateGeneration keeps its independent contract.
  - Retired reads and writes produce zero episode, fact, invalidation, replay, and database-file side effects; a scripted writer failure cannot perturb TaskLoop completion.
  - The corresponding shortfall becomes resolved only with a clean candidate, command/exit/counts, negative controls, artifact path, source reference, and SHA256 evidence.
  - No product default, lock, approval authority, public state, or release verdict changes.
docs:
  required: true
  files:
    - harness/specs/guides/product-acceptance-strategy.md
    - harness/specs/fixtures/product-acceptance-shortfalls/ledger.json
---

# Runtime Memory Retirement Closeout

## Scope

TF-0574 corrects the tests that still describe the retired parallel Runtime Memory path.
Production `resolveRuntimeMemoryFeatureFlags` already forces `shadow`, `provider`,
`proposeFacts`, and `persist` to false. `candidateGeneration` remains independently configurable
because it feeds the approval-gated candidate Review Queue rather than accepted memory.

No production source change is required for this node.

## Retirement mapping

| Previous assertion | Replacement |
| --- | --- |
| Shadow + persist true writes one sanitized episode | Three table cases cover true, string true, and all legacy flags true; each requires zero writer calls and zero SQLite opens |
| A persisted episode can be loaded back | Retired persistence returns `skipped / flag_disabled`, exposes an empty store, and leaves no database file |
| A writer failure leaves terminal behavior unchanged | Terminal/checkpoint behavior remains asserted, but the retired path must not call the scripted failing writer |

The `it.each` expansion increases the task-loop file from 67 to 69 reported cases while preserving
the original 67 semantic slots through the table. No test is skipped.

## Negative controls

- An episode or fact writer call fails the test.
- A SQLite open during retired TaskLoop execution fails the test.
- A database path created by retired persistence fails the file readback.
- String `"true"` is treated as non-enabled input, not truthy.
- `candidateGeneration` remains true only for strict boolean input when explicitly enabled.

## Evidence

The raw run stays under `D:/tmp/clawx-product-acceptance/<run-id>/a1-memory/`. Curated evidence is
retained under `harness/specs/fixtures/product-acceptance-closeout/a1-memory/` with a manifest,
command output, source hashes, candidate binding, skip inventory, and limitations.

The ledger entry `runtime-memory-retired-test-contract` may move to `resolved` only when that
evidence is read back on disk. This node does not claim full-product GA, packaging readiness, a
real-provider result, or real-human evidence.