---
lifecycleStatus: active
id: rsi-usaco-source-intake
title: Prepare complete official USACO source candidates
intent: Add a bounded offline source intake for the independently researched USACO reserve, preserving complete tests and explicitly reviewed reference blocks.
diffBase: 10ce9b2f4b389dbca8b448ede66404fa5c892e6f
touchedAreas:
  - .gitignore
  - scripts/rsi-usaco-source-intake.py
  - harness/specs/fixtures/rsi-live-experience/usaco-output-contracts.json
  - scripts/rsi-usaco-source-intake-test.py
  - scripts/rsi-usaco-family-review.py
  - scripts/rsi-usaco-family-review-test.py
  - scripts/rsi-usaco-measurement.py
  - scripts/rsi-usaco-measurement-test.py
  - scripts/rsi-library-checker-calibrate.mjs
  - tests/unit/rsi-usaco-calibration.test.ts
  - harness/specs/tasks/rsi-usaco-source-intake.md
  - harness/specs/rules/rsi-semantic-training-boundary.md
  - docs/dev/rsi-usaco-source-intake.md
  - scripts/repository-artifacts.json
requiredProfiles:
  - rsi
requiredRules:
  - rsi-semantic-training-boundary
  - rsi-public-input-boundary
  - disk-temp-policy
  - repository-artifact-retention
requiredTests:
  - python -B scripts/rsi-usaco-source-intake-test.py
  - python -B scripts/rsi-usaco-family-review-test.py
  - python -B scripts/rsi-usaco-measurement-test.py
  - python -B scripts/rsi-openr1-intake-test.py
  - node --max-old-space-size=384 node_modules/vitest/vitest.mjs run --config vitest.rsi.node.config.ts tests/unit/rsi-usaco-calibration.test.ts tests/unit/rsi-supplemental-calibration.test.ts tests/unit/rsi-library-checker-calibration.test.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/rsi-usaco-source-intake.md
  - git diff --check
acceptance:
  - Intake binds official result-page problem, solution and archive links to exact local snapshots and a plan digest.
  - The acquisition URL and digest for each artifact must match an independently recorded snapshot. An embedded language-switch cpid must agree with the problem identity.
  - Public sample input/output pairs are matched in order with normalized whitespace at line endings. Every original vector retains its original bytes and its public or private visibility.
  - Python text calibration requires a reviewed unique-output contract for the bound problem, solution and tests. Pending or custom-checker sources remain available for family review.
  - The selected reference requires an explicit block index, byte digest and full-credit review basis; the first code block is never selected implicitly.
  - Every official input/output pair survives unchanged; orphan, duplicate, unsafe, oversized, underspecified and numeric-checker archives fail closed.
  - A real official sample is imported without program execution or model calls and stays pending whole-family review and native calibration.
  - Existing source queues, frozen calibration executors and measurement thresholds retain their original bytes.
  - Family review replays every candidate from its original source and joins the complete old queue and observed history by canonical source identity, public prompt and the existing reference-shape function; historical exclusion propagates across late bridges.
  - Digest-bound excluded base families contribute all member identities, prompt digests and reference shapes to the same history graph.
  - Only new Python components enter the separately versioned USACO input plan; all original vectors and the existing isolation profile survive preparation and replay.
  - The shared native calibration loader rejects existing or observed families before execution, preserves the four GiB memory gate, and retains the original supplemental and Library Checker formats.
docs:
  required: true
  files:
    - docs/dev/rsi-usaco-source-intake.md
readmeUpdates: not-required
---

TF-0904 resource continuation. This importer prepares private source candidates
from already downloaded snapshots. It has no network or execution entry point.
Formal task materialization follows the existing whole-family review, frozen
source queue and native calibration. The 6276-family target remains unchanged.

See `docs/dev/rsi-usaco-source-intake.md` for acquisition records and output review.
