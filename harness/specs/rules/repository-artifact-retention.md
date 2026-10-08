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
Output-bearing directories default to local-only, with exact retained inputs
listed in `scripts/repository-artifacts.json` and generated ignore exceptions.
Never blanket-untrack mixed directories or use broad directory exemptions that
allow new run output to enter Git without review. Tests and scripts remain source. In particular, `plans/system-maturity/` contains executable gate
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

## Enforced positive boundary

The reviewed inventory covers docs, artifacts, reports, plans and team, not just
previously identified cleanup batches. Unlisted tracked files in these roots fail,
including forced additions inside existing acceptance directories. Retained files
must exist, stay tracked and remain addable; generated ignore rules must match the
inventory. PR CI runs this check before dependency installation. New audits,
plans and throwaway scripts belong in ignored `.audit/` or `artifacts/runs/`, not
in a new top-level process namespace. Preserve active Harness contracts, but
replace their historical journal prerequisites with maintained documentation.
