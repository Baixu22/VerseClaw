---
id: runtime-authority-convergence-final-acceptance
title: RC-09 Final Engineering Acceptance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Run the repository acceptance protocol against a clean candidate whose diffBase equals the RC-01 acceptedBaseSha; validate every accepted RC task spec and a candidate-bound ownership matrix that partitions the exact cumulative diff into the RC-owned set (each path owned by exactly one required RC package) and the excluded set (each path attributed to the non-RC commit that introduced it); produce the final manifest and independent Executor/Verifier reports at the fixed acceptance paths; record the tested validate-runtime-authority-convergence.mjs validator; leave the program human_acceptance_pending (never done) until RC-10.
diffBase: 1cddcb1ba5e23ebe445afca11174c2575c75f735
ownedPaths:
  - harness/specs/tasks/runtime-authority-convergence-final-acceptance.md
  - scripts/validate-runtime-authority-convergence.mjs
  - scripts/lib/agent-engineering-acceptance.mjs
  - scripts/agent-engineering-acceptance.mjs
  - docs/dev/unified-agent-system/runtime-convergence/**
  - artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/**
touchedAreas:
  - harness/specs/**
  - harness/src/**
  - scripts/**
  - scripts/lib/**
  - scripts/comms/**
  - docs/dev/unified-agent-system/runtime-convergence/**
  - docs/dev/Sustained-Development-Playbook.md
  - docs/dev/handoffs/**
  - artifacts/agent-engineering-acceptance/**
  - artifacts/runtime-authority-convergence/**
  - .agent-workbench/task-forest/**
  - openclaw_runtime/**
  - tests/unit/**
  - tests/e2e/**
  # RC-10's channel-startup integration test is the first tests/integration/**
  # path inside the accepted window. Declaring the area states that the change
  # is expected; ownership is still derived from ownedPaths alone, so this does
  # not make the path RC-owned.
  - tests/integration/**
  - shared/**
  - electron/**
  - src/**
  - .gitattributes
  - .gitignore
  - pnpm-lock.yaml
  - package.json
  - tsconfig.node.json
  - eslint.config.mjs
  # The owner-policy change that removes the human-operator requirement
  # (AGENTS.md §Human-in-the-loop policy, 2026-09-27) lands in the same change
  # set as the RC-09 close-out, so the top-level agent policy file is expected
  # here. Declaring it in touchedAreas only states that the change is expected;
  # it does not widen the ownership set, which is derived from ownedPaths alone.
  - AGENTS.md
  # RC-09's own doc-sync and evidence-refresh surfaces. The AGENTS.md doc-sync
  # rule requires the READMEs to move with behavior, and the RC packages refresh
  # the Agent Dev evidence; both land inside the accepted window.
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - artifacts/agent-dev-deep-test/**
  - artifacts/agent-dev-quality/**
  - artifacts/agent-dev-workbench/**
expectedUserBehavior:
  - External default behavior and product locks do not drift; internal runtime authority changes are limited to the separately accepted RC-00 through RC-08B packages.
  - The acceptance manifest records baseRef equal to the RC-01 acceptedBaseSha; its changedPaths equal git diff --name-only <acceptedBaseSha>..<candidateSha>.
  - Every path of that cumulative diff is accounted for exactly once: an RC-owned path carries one owner from the required package set, and every other path carries the commit SHA, subject and workstream of the non-RC commit that introduced it. No path is silently dropped and no ownership glob is widened to absorb another workstream.
  - The final report is a green independent Verifier report whose runId, candidate commit, and source.manifestDigest match the manifest, whose Executor and Verifier identities differ, whose human residual fields remain true/review_needed, and whose semantic reportDigest validates.
  - The final manifest records humanEvidence=required for both task and safety.
  - The program reaches human_acceptance_pending; it must not become done.
cumulativeOwnership:
  # The required owner set is DERIVED from this list — the generator and the
  # validator both resolve each spec name to its RC package id. RC-10 and the
  # RC-01R variant specs are deliberately absent: they are outside the accepted
  # RC-00..RC-08B set and may never own a changed path.
  requiredSpecs:
    - harness/specs/tasks/rc00-agent-engineering-acceptance-bootstrap.md
    - harness/specs/tasks/rc01-authority-inventory-baseline.md
    - harness/specs/tasks/rc02-full-payload-shadow-census.md
    - harness/specs/tasks/rc03-dcs-seal-dual-receipts.md
    - harness/specs/tasks/rc04-durable-approval-effect-reconciliation.md
    - harness/specs/tasks/rc05-minimal-operator-governance-slice.md
    - harness/specs/tasks/rc06a-taskflow-capability-proof.md
    - harness/specs/tasks/rc06b-clawgraph-lifecycle-migration.md
    - harness/specs/tasks/rc06c-mission-lifecycle-migration.md
    - harness/specs/tasks/rc06d-task-loop-lifecycle-migration.md
    - harness/specs/tasks/rc07-memory-context-slot-convergence.md
    - harness/specs/tasks/rc08a-mcp-host-native-tool-convergence.md
    - harness/specs/tasks/rc08b-otel-observability-convergence.md
  excludedWorkstreams:
    policy: first-touch-commit
    rcOwned: >-
      A path is RC-owned when a commit whose subject carries a required package
      id first touched it inside the range, or when no RC commit touched it and a
      required package spec declares it in ownedPaths. Only ownedPaths — the
      explicit per-package declarations — may reclassify a path; broad
      touchedAreas globs are never consulted, so ownership globs cannot be
      widened to absorb another workstream.
    excluded: >-
      Every remaining path of the cumulative diff is excluded and must record the
      exact commit that first introduced it in the range: SHA, subject, and a
      workstream id derived from the conventional-commit subject. The excluded
      set is evidence, not a wildcard — the RC-owned and excluded sets must be
      disjoint and must together equal git diff --name-only <acceptedBaseSha>..<candidateSha>,
      and a path that can be attributed to neither set fails the generator closed.
  evidence: artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json
closureAdvance:
  # Paths a closure commit may touch after the candidate. The validator reads
  # this list from the CANDIDATE's copy of this spec, never from HEAD, so a
  # closure commit cannot widen it. Exact paths or <dir>/** only. Frozen inputs
  # (manifest source files, provision copies including the ownership matrix,
  # the RC-01 baseline, the validator and its library) and code files are
  # rejected even when an entry would cover them.
  allowedPaths:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/handoffs/LATEST.md
    - .agent-workbench/task-forest/**
    - artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json
    - artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/final-report.json
    - artifacts/runtime-authority-convergence/rc-09/**
    - artifacts/runtime-authority-convergence/rc-10/acceptance/**
requiredProfiles:
  - fast
  - comms
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
  - backend-communication-boundary
humanEvidence: required
forbiddenPatterns:
  - a literal placeholder in the manifest, final report, or validator
  - an invalid or missing base ref falling back to HEAD
  - identical Executor/Verifier identities
  - product lock or promotion drift
  - marking the program done before final user acceptance
  - regenerating changed-path-ownership.json after the candidate
  - widening closureAdvance.allowedPaths after the candidate
featureFlags:
  - No feature flag is added or changed.
rollback:
  - Archive the RC-09 evidence directory before any rerun; the acceptance protocol refuses an existing final directory.
  - No runtime, schema, data, configuration, or migration rollback is required.
requiredTests:
  # The nested acceptance run/verify/validator gates were removed: the run gate
  # executed the primary manifest, which re-materializes its own required-test
  # gates and recurses forever, and the validator gate reads final-report.json,
  # which only exists after the independent verifier step. Those flows are
  # exercised once, at the top level, by the executor plan and by the
  # engineering validator step that follows the verifier (acceptance criteria).
  - pnpm acceptance:agent:plan --spec harness/specs/tasks/runtime-authority-convergence-final-acceptance.md --since 1cddcb1ba5e23ebe445afca11174c2575c75f735 --output-dir artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/required-test-runs
  - pnpm acceptance:agent:status --output-dir artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/required-test-runs
  - pnpm harness validate --spec harness/specs/tasks/runtime-authority-convergence-final-acceptance.md
acceptance:
  - The manifest schema is agent-engineering-acceptance/v1, manifestVersion 1, executionMode full, baseRef equal to the acceptedBaseSha, and changedPaths equal to git diff --name-only <acceptedBaseSha>..<candidateSha>.
  - The final report is a green Verifier report whose runId, candidate commit, and source.manifestDigest match the manifest, whose Executor and Verifier identities differ, whose human residual fields remain true/review_needed, and whose semantic reportDigest validates.
  - The final manifest records humanEvidence=required for both task and safety; product locks stay false.
  - The validate-runtime-authority-convergence.mjs validator passes for the engineering phase.
  - changed-path-ownership.json is generated from the exact candidate diff and partitions it totally and disjointly: every path is either RC-owned by exactly one package in the required owner set derived from cumulativeOwnership.requiredSpecs, or excluded with the recorded first-touch commit SHA, subject and workstream id; missing, duplicate, out-of-set-owner, unattributed-exclusion, or count-mismatched entries fail closed.
  - The program reaches human_acceptance_pending; it must not become done.
  - The engineering and human validators pass both at the candidate and at any descendant whose candidate→worktree diff touches only closureAdvance.allowedPaths; a frozen input, a code file, or any other path changed after the candidate fails closed.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
    - docs/dev/unified-agent-system/runtime-convergence/WORK-PACKAGES.md
    - docs/dev/unified-agent-system/runtime-convergence/ACCEPTANCE.md
    - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-09 Final Engineering Acceptance

RC-09 executes the repository acceptance protocol against a clean candidate whose diffBase equals
the RC-01 acceptedBaseSha, produces the final manifest and independent Executor/Verifier reports at
the fixed acceptance paths, and records the tested validate-runtime-authority-convergence.mjs
validator. The program reaches human_acceptance_pending and must not become done; only RC-10 can
permit done.

## Cumulative-diff ownership

RC-09's `diffBase` is the RC-01 `acceptedBaseSha` recorded in
`artifacts/runtime-authority-convergence/rc-01/baseline.json`. It is pinned to
`1cddcb1ba` — the 2026-09-22 seal that is also the upstream of
`feat/runtime-lifecycle-governance` — because that is where the RC serial
re-verification (RC-00R..RC-08B) starts on this branch. The RC chain was
re-verified on the shared integration branch, not on an isolated RC-only branch,
so the cumulative diff still contains commits from other workstreams; RC-09
partitions it instead of pretending it is RC-only:

- **RC-owned** — a commit whose subject carries a required package id first touched the path inside
  the range, or a required package spec declares the path in its `ownedPaths`. Each such path maps to
  exactly one owner inside the required owner set derived from
  `cumulativeOwnership.requiredSpecs`. Only `ownedPaths` may reclassify a path; broad `touchedAreas`
  globs are never consulted, so globs cannot be widened to absorb another workstream.
- **Excluded** — every other path, recorded with the SHA, subject and derived workstream of the
  exact commit that first introduced it. Exclusions are evidence, not a wildcard.

The two sets must be disjoint and must together equal the cumulative diff; a path attributable to
neither set fails the generator closed, and a matrix that is not bound to the manifest's base and
candidate commits fails the validator closed.

### Regenerating the matrix

```text
node scripts/generate-rc09-ownership-matrix.mjs --base <acceptedBaseSha> --head HEAD \
  --output artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json
```

The matrix is generated from `git diff <base>..<headSha>` and is itself tracked, so it is always
committed *inside* the candidate it describes. That makes `headSha` a generation point rather than
the candidate SHA: a matrix generated against the candidate cannot be committed in that same
candidate, because rewriting the matrix changes the commit it names (a hash fixed point). The
validator therefore requires base equality plus `headSha` ancestry, and separately requires the
matrix to account for every manifest changed path — so a matrix generated too early cannot pass by
covering too little. Run the generator at the candidate, commit the result, and let the acceptance
plan provision it into the detached worktrees.

## Closure advance

Closing a round must commit STATUS, the archived evidence, the canonical manifest/final-report pair
and task-forest state, so HEAD always moves past the candidate. The validator therefore judges the
candidate in a detached worktree of the candidate and, when HEAD has advanced, requires every path
changed between the candidate and the invoking worktree to be covered by `closureAdvance.allowedPaths`
as declared by the candidate's copy of this spec. Frozen inputs, code files, and every other path
fail closed, so any product, test, script or spec change after the candidate still voids it. The
ownership matrix is not regenerated after the candidate. From cutting the candidate until the round
closes, the branch accepts only closure-path commits; other work lands elsewhere.
