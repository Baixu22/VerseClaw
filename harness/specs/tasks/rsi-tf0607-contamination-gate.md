---
lifecycleStatus: active
id: rsi-tf0607-contamination-gate
title: Build the RSI experience and skill contamination pre-commit gate
intent: Reject candidate commits that edit their evaluator, held-out split, grader, promotion policy or evidence seals; introduce hidden instructions, permissions, defaults or approval semantics; hide skips or flakes; cross trial boundaries; or lack replayable lineage, before any RSI candidate can be evaluated or merged.
diffBase: 544c2e18a
touchedAreas:
  - harness/specs/tasks/rsi-tf0607-contamination-gate.md
  - scripts/rsi-tf0607-contamination-gate.mjs
  - scripts/rsi-tf0607-contamination-gate.d.mts
  - tests/unit/rsi-tf0607-contamination-gate.test.ts
  - harness/specs/fixtures/rsi-evidence-loop/tf0607/**
ownedPaths:
  - harness/specs/tasks/rsi-tf0607-contamination-gate.md
  - scripts/rsi-tf0607-contamination-gate.mjs
  - scripts/rsi-tf0607-contamination-gate.d.mts
  - tests/unit/rsi-tf0607-contamination-gate.test.ts
  - harness/specs/fixtures/rsi-evidence-loop/tf0607/SHA256SUMS
  - harness/specs/fixtures/rsi-evidence-loop/tf0607/gate-report.v1.json
  - harness/specs/fixtures/rsi-evidence-loop/tf0607/control-results.v1.json
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/rsi-tf0607-contamination-gate.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/rsi-tf0607-contamination-gate.md
  - pnpm run typecheck
acceptance:
  - The gate binds a candidate digest, parent lineage, exact changed paths and read-only evaluator inputs before evaluation.
  - Any candidate change to task corpus, held-out seal, grader, evaluator, promotion policy, evidence generator or product lock is rejected.
  - Prompt/AGENTS/skill/tool-policy/SEKB content is scanned for hidden or untrusted instructions, credential exfiltration, approval bypass, sandbox escape, hidden tool enablement and default-on mutations.
  - Trial evidence rejects cross-trial leakage, missing teardown, hidden skipped or flaked safety cases, incomplete cases and duplicated trial identities.
  - Scope and lineage failures are separate rejections; a valid no-op or candidate remains unevaluated unless the external TF-0599 gate has complete trials.
  - All automated artifacts name driven_by=agent and a concrete actor, preserve failure reasons and prohibit product-default, liveProvider, real-human or release claims.
docs:
  required: true
  files:
    - harness/specs/tasks/rsi-tf0607-contamination-gate.md
readmeUpdates: not-required
---

# TF-0607 contamination gate

TF-0607 runs before a candidate is handed to the evaluation gate. It consumes a
candidate manifest with the exact diff, lineage, frozen input digests and trial
evidence summary. It rejects writes outside declared surfaces and any change to
evaluation authority.

The content scan is intentionally finite: it checks explicit hidden-instruction,
credential, approval, sandbox, default-on and exfiltration markers. A clean scan
is not a general security proof. The report records that limitation and stays
not-run for behavioral effects until the external candidate gate has complete
trials.
