---
lifecycleStatus: active
id: rsi-tf0606-self-harness
title: Build the isolated Self-Harness weakness mining and candidate evaluation loop
intent: Convert failure trajectories and TF-0605 delta candidates into a minimal, replayable prompt/AGENTS/skill/tool-policy/SEKB candidate lineage, evaluate it only through the sealed TF-0599 candidate gate and frozen held-out split, and preserve No-Go or insufficient-evidence outcomes without merging or changing product defaults.
diffBase: 61520ba82
touchedAreas:
  - harness/specs/tasks/rsi-tf0606-self-harness.md
  - scripts/rsi-tf0606-self-harness.mjs
  - scripts/rsi-tf0606-self-harness.d.mts
  - tests/unit/rsi-tf0606-self-harness.test.ts
  - harness/specs/fixtures/rsi-evidence-loop/tf0606/**
  - harness/specs/tasks/rsi-tf*.md
  - harness/specs/fixtures/rsi-evidence-loop/**
  - harness/specs/fixtures/agent-first-task-corpus/**
  - scripts/lib/agent-first-graders.mjs
  - scripts/lib/agent-first-graders.d.mts
  - scripts/lib/agent-first-trials.mjs
  - scripts/lib/agent-first-trials.d.mts
  - scripts/lib/rsi-historical-task-corpus.mjs
  - scripts/lib/rsi-historical-task-corpus.d.mts
  - scripts/lib/rsi-tf0604-system-run.mjs
  - scripts/lib/rsi-tf0604-system-run.d.mts
  - scripts/rsi-tf0604-historical-runner.mjs
  - scripts/rsi-tf0604-historical-runner.d.mts
  - scripts/rsi-tf0604-system-run.mjs
  - tests/unit/rsi-tf0604-historical-runner.test.ts
  - tests/unit/rsi-tf0604-system-run.test.ts
  - harness/specs/tasks/rsi-*.md
  - scripts/rsi-tf*.mjs
  - scripts/rsi-tf*.d.mts
  - scripts/lib/rsi-tf*.mjs
  - scripts/lib/rsi-tf*.d.mts
  - tests/unit/rsi-*.test.ts
  - docs/dev/rsi-capability-and-boundaries.md
  - scripts/lib/rsi-oracle-bindings.mjs
  - scripts/lib/rsi-oracle-bindings.d.mts
  - tests/unit/rsi-oracle-bindings.test.ts
  - harness/specs/fixtures/agent-first-framework/SHA256SUMS
  - harness/specs/fixtures/agent-first-framework/loop-validation-report.json
ownedPaths:
  - harness/specs/tasks/rsi-tf0606-self-harness.md
  - scripts/rsi-tf0606-self-harness.mjs
  - scripts/rsi-tf0606-self-harness.d.mts
  - tests/unit/rsi-tf0606-self-harness.test.ts
  - harness/specs/fixtures/rsi-evidence-loop/tf0606/SHA256SUMS
  - harness/specs/fixtures/rsi-evidence-loop/tf0606/candidate.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0606/report.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0606/control-results.v1.json
residualPaths:
  - .gitignore
requiredProfiles:
  - fast
requiredRules:
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - agent-engineering-acceptance-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/rsi-tf0606-self-harness.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/rsi-tf0606-self-harness.md
  - pnpm run typecheck
acceptance:
  - Weakness mining consumes at least 20 distinct frozen TF-0604 task signals and preserves source task, failure signature and evidence link for each selected weakness.
  - A candidate may change only prompt, AGENTS, skill, tool-policy or SEKB playbook surfaces, must be content-addressed, carry lineage, budget, rollback path and a nonempty target task list, and is generated in an isolated worktree.
  - Candidate evaluation delegates case/trial/CI/held-out/resource verification to TF-0599 and cannot write the evaluator, task corpus, held-out split, grader or promotion policy.
  - The gate rejects fewer than 20 complete cases, missing trials, self-verification, cost overrun over 10 percent, safety or negative-control regressions, stale suite/held-out/candidate digests, unknown failure classes and fabricated pass^k or CI claims.
  - Current artifacts remain No-Go/insufficient-evidence because the sealed reservation has zero completed trials; failed candidates and the reason are retained.
  - Report generation records driven_by=agent with a concrete actor, no real-human or live-provider claim, no automatic merge and no product default or release change.
docs:
  required: true
  files:
    - harness/specs/tasks/rsi-tf0606-self-harness.md
readmeUpdates: not-required
---

# TF-0606 Self-Harness research loop

TF-0606 is an isolated candidate-research workflow. It mines weaknesses from
the sealed TF-0604 corpus and TF-0605 candidate evidence, produces the smallest
ownable change, and hands the candidate to the TF-0599 gate. It does not
execute the candidate on the held-out split itself and cannot promote it.

The initial candidate is intentionally a proposal only: a SEKB playbook link
that directs the agent to compare a successful and failed path before acting.
It changes no product prompt, default or lock and is not merged. Because the
sealed reservation currently has zero completed trials, the candidate remains
insufficient-evidence with promotionReady=false.

A future runner may replace only raw trials and the evaluation report through a
separately reviewed descendant. The task corpus, held-out split, gate,
promotion policy and candidate scope are read-only to the candidate.