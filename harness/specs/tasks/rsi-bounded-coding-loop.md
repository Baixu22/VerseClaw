---
lifecycleStatus: active
id: rsi-bounded-coding-loop
title: Execute a bounded RSI coding tool loop with independent final grading
intent: Add a prospective v4 coding collector that can read declared sources, apply bounded batches of exact edits, inspect public syntax and interfaces, then submit the final workspace to the historical independent oracle.
diffBase: 5ad905b44c2822caf6037df9278a8a260a27d3f9
touchedAreas:
  - vitest.rsi.node.config.ts
  - scripts/rsi-*.mjs
  - scripts/rsi-*.d.mts
  - scripts/lib/rsi-*.mjs
  - scripts/lib/rsi-*.d.mts
  - tests/unit/rsi-*.test.ts
  - harness/specs/tasks/rsi-public-task-inputs.md
  - harness/specs/tasks/rsi-bounded-coding-loop.md
  - harness/specs/rules/rsi-public-input-boundary.md
  - harness/specs/guides/rsi-remediation-roadmap.md
  - harness/specs/fixtures/rsi-task-inputs/**
  - harness/specs/fixtures/rsi-remediation-plan/**
  - harness/specs/fixtures/rsi-coding-tool-loop/**
  - docs/dev/rsi-capability-and-boundaries.md
requiredProfiles:
  - rsi
requiredRules:
  - rsi-public-input-boundary
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - reliability-aggregation-boundary
expectedUserBehavior:
  - A subject can read allowed historical source or public declarations, submit a batch of edits and repair errors reported by public checks.
  - Final output acknowledges completion; the executor records actual edited files rather than requiring the model to repeat full source files.
  - Hidden oracle contents remain private and final behavior is graded independently in the isolated historical task workspace.
requiredTests:
  - node node_modules/vitest/vitest.mjs run --config vitest.rsi.node.config.ts tests/unit/rsi-coding-tool-loop.test.ts tests/unit/rsi-coding-collector.test.ts tests/unit/rsi-benefit-eval.test.ts tests/unit/rsi-responses-provider.test.ts tests/unit/rsi-task-inputs.test.ts
  - node scripts/rsi-coding-tool-integration.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/rsi-bounded-coding-loop.md
acceptance:
  - V4 freezes read_file, apply_edits and check_public_contract with four provider calls, twelve executed tool calls, 12000 output characters per tool and 256000 UTF-8 edit bytes.
  - A batch can update twenty document files within these limits; ambiguous replacements, scope escapes, symlinks and private reads are rejected before effects.
  - Raw provider turns, tool call ids, arguments, outputs and before/after file digests can be replayed; submitted edits match the final workspace.
  - Public syntax and exported API checks run before the model finishes, and final historical oracle results retain their original revisions and digests.
  - Per-slot and whole-run budgets, unknown usage, request/slot/oracle timeouts, interrupted runs and model budget failures preserve explicit terminal outcomes without provider retries.
  - V1/v2/v3 request and receipt semantics remain intact, and negative controls reject forged tool effects, hidden continuation context, undeclared tools or changed evaluator inputs.
  - A clean committed candidate has focused checks and a real-filesystem integration with a scripted provider; the evidence labels provider simulation and records zero paid model calls.
docs:
  required: true
  note: Document the new protocol, batch edits and final acknowledgement; keep the old measurement frozen.
readmeUpdates: not-required
---

The v4 amendment is recorded separately from the original planning input. Batch apply_edits uses entries with path, oldText and newText. A null oldText writes a complete file; a non-null oldText must match exactly once. Every batch is validated before any write. Final acknowledgement is a strict object with finish=true; final edits come from the executor's workspace, not a second copy of model-generated files.

Public checks parse syntax and compare exported values with the already public declarations. They do not execute hidden tests or expose oracle output. Final behavioral grading uses the existing reference-bound grader. The local grader's process boundary remains a recorded research environment; tool path enforcement does not claim an operating-system sandbox.
