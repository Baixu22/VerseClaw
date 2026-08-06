---
id: rc01r-self-contained-baseline
title: RC-01R Self-Contained Baseline And Gate Truth
taskType: engineering-acceptance
intent: Close the RC-09 audit finding that the RC-01 authority baseline never entered the candidate. Make artifacts/runtime-authority-convergence/rc-01/baseline.json Git-tracked, make its generator deterministic and fail-closed on absent owner paths, and pin the tracking/determinism/ownership properties with counter-tests. No runtime behavior changes.
ownedPaths:
  - .gitignore
  - artifacts/runtime-authority-convergence/rc-01/baseline.json
  - scripts/rc01-authority-inventory.mjs
  - tests/unit/rc01-authority-inventory-baseline.test.ts
  - harness/specs/tasks/rc01r-self-contained-baseline.md
touchedAreas:
  - .gitattributes
  - .gitignore
  - artifacts/runtime-authority-convergence/rc-01/baseline.json
  - .agent-workbench/task-forest/**
  - docs/dev/Sustained-Development-Playbook.md
  - docs/dev/unified-agent-system/runtime-convergence/**
  - harness/specs/**
  - harness/src/**
  - scripts/**
  - tests/unit/**
expectedUserBehavior:
  - No runtime, renderer, Main, Gateway, provider, channel, approval, effect, memory, context, tool, telemetry, default, or readiness behavior changes.
  - A clean checkout of the candidate contains the RC-01 baseline; the acceptance validator no longer depends on an untracked working-tree file.
  - Regenerating the baseline at the same commit produces a byte-identical file.
  - A classified owner path that is absent from the candidate aborts generation instead of writing a baseline that describes a tree that does not exist.
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
  - pnpm exec vitest run tests/unit/runtime-authority-convergence-control-pack.test.ts
  - pnpm exec vitest run tests/unit/harness-specs.test.ts
  - pnpm harness validate --spec harness/specs/tasks/rc01r-self-contained-baseline.md
acceptance:
  - git ls-files contains artifacts/runtime-authority-convergence/rc-01/baseline.json, and the Git blob and the working tree agree.
  - Sibling convergence outputs such as artifacts/runtime-authority-convergence/rc-07/manifest.json remain ignored.
  - Rerunning scripts/rc01-authority-inventory.mjs at the same commit rewrites the file byte-identically; generatedAt is derived from the accepted base commit.
  - acceptedBaseSha is a 40-hex ancestor of the candidate commit.
  - Every classified owner path resolves in the candidate tree, and an injected absent path makes the generator exit non-zero without writing.
  - Product locks stay liveReady=false, productApproved=false, defaultOn=false.
docs:
  required: false
---

# RC-01R Self-Contained Baseline And Gate Truth

The RC-09 independent audit recorded that the RC-01 baseline was not part of the failed
candidate. The direct cause is mechanical: `.gitignore` ignores `artifacts/*`, so
`artifacts/runtime-authority-convergence/rc-01/baseline.json` was only ever a working-tree
file. Any clean checkout of the candidate therefore could not read the baseline that the
acceptance validator resolves, and the RC-01 tests asserted against a file that the candidate
did not contain.

This package closes that finding along four axes and pins each with a counter-test:

1. **Tracked.** A negated ignore rule scoped to the RC-01 baseline only. Other convergence
   run outputs stay ignored, so this does not turn `artifacts/` into candidate material.
2. **Deterministic.** `generatedAt` came from `new Date()`, so every regeneration produced a
   diff and the tracked file could never be verified by re-running the generator. It is now
   derived from the accepted base commit's committer timestamp.
3. **Fail-closed on ownership.** The generator verifies every classified owner path against
   `git ls-files` and throws before writing when one is absent.
4. **Behavior-verified.** The owner-path counter-test copies the generator, injects a
   non-existent path, executes it, and asserts a non-zero exit plus an untouched baseline.
   It does not assert on source text.

Scope note: this package does not close RC-00R F4, does not mark any package accepted, and
does not change the product locks or the RC-10 block.
