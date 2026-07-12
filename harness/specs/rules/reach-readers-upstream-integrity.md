---
id: reach-readers-upstream-integrity
title: Reach Readers Upstream Integrity
type: ai-coding-rule
appliesTo:
  - agent-reach-readers-integration
pathPatterns:
  - openclaw_runtime/extensions/reach-readers/**
requiredProfiles:
  - fast
---

The Agent Reach TypeScript shadow must remain recoverable byte-for-byte from
verbatim import commit `07a658faa`.

`openclaw_runtime/extensions/reach-readers/UPSTREAM.md` must retain the source
absolute path, import date, ClawX baseline, all 22 imported relative paths, and
their SHA-256 hashes.

Do not create a second production implementation of the nine reader tools.
Adapt the imported files in place and keep `src/common/**` as the OpenClaw
adapter boundary.

Every rename, move, or intentional behavior difference must be added to the
`UPSTREAM.md` adaptation ledger in the same commit. Review adaptation commits
with `git diff --word-diff`.

Do not delete imported comments, backend order, cleaners, probe
classifications, or error messages unless a failing test proves a conflict
with the supported OpenClaw runtime contract.
