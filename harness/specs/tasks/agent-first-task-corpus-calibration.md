---
lifecycleStatus: active
id: agent-first-task-corpus-calibration
title: Freeze real engineering tasks, references and executable grader calibration
intent: Complete TF-0590 by turning the sealed historical cohort into explicit executable Agent-first tasks with source/test digests, reference oracles, preserved negative outcomes, and calibrated deterministic, trace and qualitative graders before any system baseline or RSI candidate run.
diffBase: 1b05846affe9134708c4cc1d920f3f0aa399dc3b
touchedAreas:
  - harness/specs/tasks/agent-first-task-corpus-calibration.md
  - harness/specs/tasks/agent-first-evaluation-framework.md
  - harness/specs/tasks/agent-first-evaluation-loop.md
  - harness/specs/guides/agent-first-acceptance.md
  - harness/specs/fixtures/agent-first-framework/**
  - harness/specs/fixtures/agent-first-task-corpus/**
  - scripts/lib/agent-first-evaluation-framework.mjs
  - scripts/lib/agent-first-evaluation-framework.d.mts
  - scripts/lib/agent-first-evaluation-loop.mjs
  - scripts/lib/agent-first-evaluation-loop.d.mts
  - scripts/agent-first-framework-check.mjs
  - scripts/agent-first-framework-check.d.mts
  - scripts/agent-first-loop-check.mjs
  - scripts/agent-first-loop-check.d.mts
  - scripts/lib/agent-first-task-corpus.mjs
  - scripts/lib/agent-first-task-corpus.d.mts
  - scripts/lib/agent-first-graders.mjs
  - scripts/lib/agent-first-graders.d.mts
  - scripts/agent-first-task-corpus.mjs
  - scripts/agent-first-task-corpus.d.mts
  - tests/unit/agent-first-evaluation-framework.test.ts
  - tests/unit/agent-first-evaluation-loop.test.ts
  - tests/unit/agent-first-task-corpus.test.ts
  - tests/unit/agent-first-graders.test.ts
  - package.json
  - docs/README.md
  - docs/dev/rsi-capability-and-boundaries.md
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/**
ownedPaths:
  - harness/specs/tasks/agent-first-task-corpus-calibration.md
  - harness/specs/tasks/agent-first-evaluation-framework.md
  - harness/specs/tasks/agent-first-evaluation-loop.md
  - harness/specs/guides/agent-first-acceptance.md
  - harness/specs/fixtures/agent-first-framework/**
  - harness/specs/fixtures/agent-first-task-corpus/**
  - scripts/lib/agent-first-evaluation-framework.mjs
  - scripts/lib/agent-first-evaluation-framework.d.mts
  - scripts/lib/agent-first-evaluation-loop.mjs
  - scripts/lib/agent-first-evaluation-loop.d.mts
  - scripts/agent-first-framework-check.mjs
  - scripts/agent-first-framework-check.d.mts
  - scripts/agent-first-loop-check.mjs
  - scripts/agent-first-loop-check.d.mts
  - scripts/lib/agent-first-task-corpus.mjs
  - scripts/lib/agent-first-task-corpus.d.mts
  - scripts/lib/agent-first-graders.mjs
  - scripts/lib/agent-first-graders.d.mts
  - scripts/agent-first-task-corpus.mjs
  - scripts/agent-first-task-corpus.d.mts
  - tests/unit/agent-first-evaluation-framework.test.ts
  - tests/unit/agent-first-evaluation-loop.test.ts
  - tests/unit/agent-first-task-corpus.test.ts
  - tests/unit/agent-first-graders.test.ts
  - package.json
  - docs/README.md
  - docs/dev/rsi-capability-and-boundaries.md
  - harness/specs/fixtures/rsi-evidence-loop/tf0592/**
requiredProfiles:
  - fast
requiredRules:
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - agent-engineering-acceptance-boundary
  - reliability-aggregation-boundary
humanEvidence: not-required
requiredTests:
  - pnpm agent-first:corpus:check
  - pnpm exec vitest run tests/unit/agent-first-task-corpus.test.ts tests/unit/agent-first-graders.test.ts tests/unit/agent-first-evaluation-framework.test.ts tests/unit/agent-first-evaluation-loop.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/agent-first-task-corpus-calibration.md
  - pnpm run typecheck
  - git diff --check
acceptance:
  - At least 20 and at most 50 distinct tasks retain real repository provenance, explicit task inputs, target scope, current executable oracle/test digests and a reference solution or revision-bound feasibility proof.
  - The public/held-out split is sealed before candidate generation; all task IDs and the corpus digest are registered through the existing Agent-first suite registry without modifying framework core semantics.
  - Historical NO-GO outcomes, nonzero gates and unexecuted dimensions remain visible; none are rewritten as passing reference evidence.
  - Deterministic grading reads independently produced test/final-state evidence; subject success text, unknown evidence, tampered inputs, skipped required tests and fabricated totals never produce pass.
  - Every critical grader has versioned known-good, known-bad and unknown samples; qualitative model calibration fixes prompt/model/votes/temperature and records actual provider receipts separately from offline engineering checks.
  - Qualitative or heuristic pass cannot override deterministic fail or unknown; zero-pass trial sets first produce a task/grader defect investigation until reference and calibration evidence establish feasibility.
  - Capability, regression, negative, adversarial, recovery and efficiency counts and coverage rationale are reported from the frozen task population.
  - The pack includes raw calibration observations, replayed results, current candidate/input hashes, credential scan and complete SHA256SUMS; independent verification rederives it from disk.
  - All artifacts name a concrete agent actor; no real-human claim, actual-system baseline result, RSI candidate, product lock/default change or publication is implied by task/grader calibration.
docs:
  required: true
  files:
    - docs/README.md
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: not-required
---

# TF-0590 task corpus and calibration

The change set includes the five already committed TF-0620/0621 framework
commits needed by this worktree. Their original scope and static-only evidence
are retained. No uncommitted work from another checkout is copied.

The initial cohort is TF-0604's 24 historical engineering tasks. Each is expanded
from its original task spec and executable reference tests rather than from a
title or a historical PASS flag. A04 is a valid negative verdict task; historical
nonzero gates remain residual evidence. Current oracles and reference revisions
are declared separately so a prior accepted record cannot become a new pass.

Code, structured trace and qualitative graders are inserted through the existing
registry. Code grading owns the execution/evidence readback path; it does not
accept a subject's self-report as final state. Known-good/bad/unknown calibration
inputs are labelled fixtures, and actual model review receipts are labelled
agent-driven provider calibration. None of them replaces actual system trials.

Model review uses only synthetic qualitative examples and an existing configured
provider. Secrets remain in memory; request/response bodies exclude authorization
material and are hashed. Formal offline tests replay sealed receipts without
provider credentials. Any missing or failed provider calibration remains explicit
and cannot count as a calibrated grader. No human action or human data is needed.
