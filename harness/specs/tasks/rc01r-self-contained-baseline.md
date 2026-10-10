---
lifecycleStatus: archived
id: rc01r-self-contained-baseline
title: RC-01R Self-Contained Baseline And Gate Truth
taskType: engineering-acceptance
intent: Keep the RC-01 baseline self-contained and reproducible from an explicitly selected ancestor commit, reject missing or untracked owner inputs, and validate its metadata and approved receipt-owner contract with executed counter-tests. No runtime behavior changes.
ownedPaths:
  - .gitignore
  - artifacts/runtime-authority-convergence/rc-01/baseline.json
  - scripts/rc01-authority-inventory.mjs
  - scripts/rc01-baseline-validate.mjs
  - scripts/lib/rc01-receipt-contract.mjs
  - tests/unit/rc01-authority-inventory-baseline.test.ts
  - tests/unit/rc01-baseline-cli.test.ts
  - harness/specs/tasks/rc01r-self-contained-baseline.md
  - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
touchedAreas:
  - .gitignore
  - artifacts/runtime-authority-convergence/rc-01/baseline.json
  - scripts/rc01-authority-inventory.mjs
  - scripts/rc01-baseline-validate.mjs
  - scripts/lib/rc01-receipt-contract.mjs
  - tests/unit/rc01-authority-inventory-baseline.test.ts
  - tests/unit/rc01-baseline-cli.test.ts
  - harness/specs/tasks/rc01r-self-contained-baseline.md
  - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
expectedUserBehavior:
  - No runtime, renderer, Main, Gateway, provider, channel, approval, effect, memory, context, tool, telemetry, default, or readiness behavior changes.
  - A clean checkout of the candidate contains the RC-01 baseline; the acceptance validator no longer depends on an untracked working-tree file.
  - Regenerating the baseline with the same explicit accepted base produces a byte-identical file, even without an origin remote.
  - Missing, unknown, non-commit, or non-ancestor accepted bases and unknown CLI arguments fail before replacing the baseline.
  - A classified owner path that is absent from the candidate aborts generation instead of writing a baseline that describes a tree that does not exist.
  - Both commands work from a checkout whose path contains spaces, non-ASCII characters, or URL-reserved characters.
  - Validation rejects untracked owner paths, incorrect timestamps, and runtime versions that differ from the candidate package manifests.
  - Every classified writer has an owner path and one of the existing reuse/adapt/converge/freeze/remove classifications.
  - Both receipt-owner declarations match the approved owner, interface, database and table; all seven approved hard constraints remain intact.
  - Convergence run outputs other than the RC-01 baseline stay ignored.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - production runtime code changes in this baseline task
  - un-ignoring convergence artifacts beyond the RC-01 baseline
  - wall-clock or environment-derived values in the tracked baseline
  - silently ignoring accepted-base arguments or selecting a base from a moving remote ref
  - accepting contradictory receipt-owner declarations or waived, duplicate, or keyword-only receipt constraints
  - source-code regex or constant assertions standing in for executed behavior
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
  - marking RC-00R F4, RC-01R, or any package accepted from this task
featureFlags:
  - No feature flag is added or changed.
rollback:
  - Revert the .gitignore negation, the generator determinism and owner-path check, the RC-01R counter-tests, and this spec.
  - No runtime, schema, data, configuration, or migration rollback is required because this task changes no product behavior.
requiredTests:
  - pnpm exec vitest run tests/unit/rc01-authority-inventory-baseline.test.ts
  - pnpm exec vitest run tests/unit/rc01-baseline-cli.test.ts
  - node scripts/rc01-baseline-validate.mjs
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm exec vitest run tests/unit/harness-specs.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc01r-self-contained-baseline.md
acceptance:
  - git ls-files contains artifacts/runtime-authority-convergence/rc-01/baseline.json, and the Git blob and the working tree agree.
  - Sibling convergence outputs such as artifacts/runtime-authority-convergence/rc-07/manifest.json remain ignored.
  - Rerunning scripts/rc01-authority-inventory.mjs with the same explicit --accepted-base rewrites the file byte-identically; generatedAt is derived from that commit and no remote ref is required.
  - acceptedBaseSha is a 40-hex ancestor of the candidate commit.
  - Every classified owner path resolves in the candidate tree, and an injected absent path makes the generator exit non-zero without writing.
  - A real temporary Git repository proves base rejection, metadata validation, tracked ownership, and encoded checkout path handling without modifying the shared baseline.
  - Executed negative tests reject each altered receipt-owner field and each weakened hard constraint, including duplicated and negated constraints.
  - Product locks stay liveReady=false, productApproved=false, defaultOn=false.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
    - docs/dev/Sustained-Development-Playbook.md
---

# RC-01R Self-Contained Baseline And Gate Truth

The RC-09 independent audit recorded that the RC-01 baseline was not part of the failed
candidate. The direct cause is mechanical: `.gitignore` ignores `artifacts/*`, so
`artifacts/runtime-authority-convergence/rc-01/baseline.json` was only ever a working-tree
file. Any clean checkout of the candidate therefore could not read the baseline that the
acceptance validator resolves, and the RC-01 tests asserted against a file that the candidate
did not contain.

This package closes that finding along six axes and pins each with a counter-test:

1. **Tracked.** A negated ignore rule scoped to the RC-01 baseline only. Other convergence
   run outputs stay ignored, so this does not turn `artifacts/` into candidate material.
2. **Deterministic.** `generatedAt` comes from the explicitly selected ancestor commit's
   committer timestamp. The generator requires `--accepted-base <commit>`; it must not ignore
   this input or substitute the current merge-base with `origin/main`.
3. **Fail-closed on ownership.** The generator verifies every classified owner path against
   `git ls-files` and throws before writing when one is absent.
4. **Behavior-verified.** Temporary Git repositories exercise the real generator and validator.
   Removing an owner's index entry or file must fail without replacing the fixture baseline.
   These tests neither assert on source text nor write to the shared baseline.
5. **Candidate-bound validation.** Timestamp and source/npm versions must match the declared
   base and package manifests. Owner paths must be tracked and present. Temporary Git fixtures
   exercise both CLIs under ordinary and URL-encoded checkout paths.
6. **Receipt decision integrity.** Generation and validation share the approved receipt-owner
   contract. Both declarations must match it, and the seven numbered hard constraints must
   remain exact: a count or keyword match cannot prove that a requirement was preserved.

Scope note: this package does not close RC-00R F4, does not mark any package accepted, and
does not change the product locks or the RC-10 block.
