---
id: clean-release-baseline-reproducibility
title: Clean Release Baseline and Reproducibility
type: ai-coding-rule
appliesTo:
  - windows-release-trust
requiredProfiles:
  - fast
---

Public release jobs must start from a clean checkout whose resolved commit is
bound to the requested tag or explicitly dispatched ref. A dirty tree, an
unresolved commit, a tag/HEAD mismatch, or missing full-gate evidence fails
before platform packaging or publication begins.

Release evidence must record every required full gate from
`plans/system-maturity/gates.json`. Cached, smoke, reuse, or fast-loop results
cannot satisfy a release gate. Every required command must have a zero exit
code and a captured output digest.

Before Electron-dependent release gates run, the collector must rebuild the
OpenClaw runtime and record a zero-exit, hash-addressed preflight. Release
stdout and stderr must replace workspace and user-home absolute paths before
the captured bytes are persisted or hashed.

The release source manifest must be deterministic. It records the resolved
commit, release version/ref, and sorted SHA256 inventory of tracked source
files. Regenerating it from the same commit and inputs must produce identical
bytes; any untracked, modified, deleted, or staged-but-uncommitted source state
is denied.

Changes require focused tests for dirty-tree denial, tag/commit binding,
missing or failed runtime preflight/full-gate evidence, local-path redaction,
and byte-for-byte manifest reproducibility.
