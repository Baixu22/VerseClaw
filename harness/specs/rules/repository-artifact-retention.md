---
id: repository-artifact-retention
title: Source inputs and local development artifacts
type: ai-coding-rule
severity: error
---

# Repository artifact retention

## Source and evidence boundaries

Track product code, regression tests, fixtures, build and compliance inputs, active
Harness contracts, durable architecture decisions, and curated acceptance results.
Do not ignore all of `artifacts/`, `docs/dev/`, `plans/`, `tests/`, or `scripts/` as a
cleanup shortcut. In particular, `plans/system-maturity/` contains executable gate
configuration, not just planning notes.

Task Forest state, proposals, snapshots, exports, and session handoffs are local
continuity data. Keep them available locally, but do not require them in the source
index or in default build/test/CI discovery. A fresh checkout reads the playbook and
active specifications; restore a private Task Forest archive only when resuming
that task history. Missing local state does not authorize inventing historical
completion or changing a product lock.

Tests of Task Forest tooling must create their own fixtures. Tests of historical
acceptance can use small, provenance-labelled immutable fixtures; they must not
assert that the developer's current local task graph still has an old status.
Explicit historical replay tools must identify their external inputs and fail with
a useful error when those inputs are absent, rather than silently skip validation.

## Complete index coverage

Every tracked top-level batch under `artifacts/` must have an explicit
`artifactBatches` status in `scripts/repository-artifacts.json`: `retained` for
curated inputs/results, `mixed` for reviewed inputs/results alongside local run
output, or `local-only` for archived development output. An undeclared tracked
batch or a tracked file in a local-only batch is an error. A status is not an
ignore exemption: `git ls-files -i -c --exclude-standard` must return no files.

Keep the separate `git check-ignore --no-index` check for required inputs; it
answers a different question and must not be removed to make the index pass.
Both check.yml and harness.yml run `node scripts/check-repository-artifacts.mjs` before dependency
installation and broader checks. Keep batch declarations and .gitignore consistent; new
local runs do not authorize expanding a retained source/evidence boundary.

## Safe retirement

Before removing a path from the index, inspect its callers and preserve both its
working bytes and staged versions outside the repository. For unmerged paths,
preserve the base, ours, and theirs. Use an exact path manifest; never clear the
whole index and add it back, reset an unrelated staged change, or pick a conflict
side just to make status green. Ignoring a path does not untrack it.

Generated output stays local. Reusable drivers belong in `scripts/` or `tests/`;
fixed replay inputs and curated final results remain tracked at documented paths.
Retired tests must leave default discovery on existing workspaces as well as fresh
checkouts. Preserve behavioural, security, provenance, and integrity coverage;
retiring a historical wording assertion must not weaken a product boundary.

Historical hash manifests and accepted verdicts continue to identify their original
candidate. Do not update their hashes or candidate IDs to imply that cleanup was
accepted by an old run. New validation produces new, explicitly agent-driven
results. Archive indices record how to recover the old bytes without duplicating
large evidence trees in Git.

## Verification

Validate from an isolated source projection that contains only retained tracked
files and the intended source edits, not ignored local artifacts. Reusing installed
dependencies is allowed and must be disclosed; it is not a fresh install test.
Record tests added/retired, exact untracking counts, and any pre-existing merge or
validation failures. A passing local run with ignored inputs present is insufficient.

Normal untracking does not erase Git history, other branches, tags, or remote
objects. Branch deletion, history rewriting, force pushes, and public publication
require their own authorization and are not part of routine artifact cleanup.
