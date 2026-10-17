---
id: versegit-validation-layer-extension
title: VerseGit Validation-Layer Extension
type: auxiliary-validation-layer
ownedPaths:
  - harness/specs/rules/versegit-validation-layer-extension-boundary.md
  - harness/specs/scenarios/versegit-validation-layer-extension.md
  - docs/dev/versegit-validation-layer/**
  - harness/src/profiles.mjs
requiredRules:
  - versegit-validation-layer-extension-boundary
---

VerseGit (VG) participates in ClawX as an **opt-in auxiliary validation layer** that is
eligible only in concurrent-development environments. It adds symbol-level conflict
facts on top of the existing path-level boundary gates. It never owns the harness
verdict.

## Trigger surface

Participation is eligible only when the repository is genuinely concurrent: more than
one git worktree, or more than one active VG session. A single-worktree repository
observes no VG behaviour at all. VG is registered through an opt-in harness profile;
it is never added to `fast` or to any profile a task spec declares by default.

## What it adds

Symbol-level precision that the existing path-level gates cannot express: a signature
change in `src/lib/host-api.ts` while `electron/gateway/**` still reads that symbol is
a `ssi/api-drift` fact, whereas the existing renderer-main gate only sees a path.

## What it does not add

Coverage is limited to the languages VG actually parses (`.ts`, `.tsx`). `.mjs` is the
harness's own language and is **not** covered, so VG results must never be presented as
harness-wide. The read set is partial, so read-dependent rules under-trigger; write×write
rules are the reliable ones.

## Failure posture

Fail open. Missing binary, uninitialised workspace, unsupported language, or parse
failure records a reason and leaves the verdict unchanged. An auxiliary layer that can
block is not an auxiliary layer.

## Evidence posture

VG facts are auxiliary evidence with their own identity. Absence of a VG conflict is
not evidence of absence: it may only be written as "no conflict observed under partial
coverage". A green VG run never upgrades a harness verdict, and `selected` VG-STS
evidence never satisfies a full `requiredTests` gate.

## Ecosystem linkage

VG may be exposed as a deny-by-default read-only capability through the existing
`verseshell-mcp` compatibility adapter or the existing `.mcp.json`. It must not become
an internal execution path, must not introduce a second executor or approval channel,
and must not be wired into any commit or landing path.
