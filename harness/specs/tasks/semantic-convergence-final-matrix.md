---
lifecycleStatus: active
id: semantic-convergence-final-matrix
title: Same-candidate semantic convergence regression matrix
scenario: gateway-backend-communication
task_forest:
  - TF-0746
taskType: runtime-bridge
diffBase: cc9799bc7
intent: Verify the complete semantic repair chain with explicit positive, negative, boundary, integration and Electron evidence on one clean source candidate.
touchedAreas:
  - vite.config.ts
  - tests/unit/semantic-convergence-*
  - tests/integration/semantic-convergence-*
  - tests/e2e/semantic-convergence-*
  - harness/specs/tasks/semantic-convergence-final-matrix.md
  - docs/dev/evidence/semantic-convergence-20261104/tf-0746/**
  - scripts/repository-artifacts.json
  - .gitignore
requiredProfiles:
  - fast
  - comms
requiredRules:
  - provider-error-retry-boundaries
  - prompt-contribution-authority
  - prompt-injection-accounting
  - rc03-seal-coverage
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - Retry recovery, provider validation, network policy, prompt governance and retired Memory boundaries remain consistent together.
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/integration/semantic-convergence-provider-recovery.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run tests/unit/semantic-convergence-retry-identity.test.ts tests/unit/semantic-convergence-provider-validation-matrix.test.ts tests/unit/semantic-convergence-provider-network-parity.test.ts tests/unit/knowledge-embedding-deadline.test.ts tests/unit/semantic-convergence-prompt-authority.test.ts tests/unit/semantic-convergence-prompt-budget.test.ts tests/unit/rc03-seal-coverage.test.ts tests/unit/memory-self-edit-provenance.test.ts tests/unit/memory-atomic-update.test.ts tests/unit/memory-read-consistency.test.ts tests/unit/memory-facade-disposition.test.ts --maxWorkers=1
acceptance:
  - Every matrix row records requirement, journey, command, oracle, negative case, artifact and verdict; none is replaced by skip.
  - Real local HTTP provider failures 503/503/200 recover through the existing provider transport and shared attempt budget without duplicate charging; auth and exhausted-budget negatives stop.
  - Electron Setup executes the real Main validation path for 429 and non-auth 400, with no verified label or enabled continuation; Settings structured feedback is covered on the same candidate.
  - Runtime authority/seal, embedded entry, budget/accounting and Memory recovery-precondition tests all pass on the same clean source candidate.
  - Full uncached types, relevant lint, contract/i18n, build, Harness and comms gates have recorded exits; artifacts bind source hashes and disclose dependency reuse.
  - Product defaults/locks remain unchanged, persist stays retired and all evidence is agent-driven.
humanEvidence: not-required
docs:
  required: false
  readmeTranslations: not-required
---

The matrix uses the approved program's ten finding groups: retry identity;
retry charging; validation readiness; network/deadline (including embedding);
prompt authority; prompt accounting/seal; memory provenance; memory atomicity;
memory read consistency; and facade disposition. Sub-requirements remain separate
rows so grouping cannot drop an acceptance criterion. This is program development
acceptance, not a full joint-system or release/GA gate.

The first Electron run exposed a missing Main bundle source alias for the
existing Runtime net-policy package. Add that existing package to the same
source-alias boundary as the other inlined runtime packages; no policy/default
or dependency version changes. Retain the failed run and dependency-resolution
provenance, then rebuild and repeat the same UI checks.
