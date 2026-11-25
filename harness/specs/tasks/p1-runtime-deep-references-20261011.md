---
id: p1-runtime-deep-references-20261011
title: Gate every parent-to-vendored runtime deep reference with existence checks and reasoned exemptions
lifecycleStatus: active
taskType: repo-governance
intent: Close issue #93 by adding a fail-closed guard that enumerates the references parent code makes into the vendored openclaw_runtime tree (imports, strings and root package.json scripts), requires each one to resolve or to be exempted with a reason, and records the measured inventory and the remaining coupling debt.
residualPaths:
  - AGENTS.md
  - artifacts/stepfun-basic-live-evidence-20261008/INTEGRITY.json
  - artifacts/windows-alpha-closeout-20261008/INTEGRITY.json
touchedAreas:
  - scripts/check-runtime-deep-refs.mjs
  - scripts/check-runtime-deep-refs.d.mts
  - scripts/runtime-deep-refs-baseline.json
  - tests/unit/runtime-deep-refs.test.ts
  - package.json
  - .github/workflows/check.yml
  - harness/specs/**
  - docs/**
  - scripts/repository-artifacts.json
  - .gitignore
expectedUserBehavior:
  - A re-vendor that renames or moves an upstream runtime file can no longer break a parent-code reference silently: CI fails and names the file, line and path.
  - Every deliberate exception is visible as a reasoned ledger entry instead of an unexplained green check, and the coupled surface can be counted (imports vs strings vs package scripts).
requiredProfiles:
  - fast
requiredTests:
  - node scripts/check-runtime-deep-refs.mjs
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-deep-refs.test.ts
  - node scripts/check-repository-artifacts.mjs
  - node scripts/check-no-bom.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-runtime-deep-references-20261011.md
acceptance:
  - Module-relative new URL literals using import.meta.url resolve from their source file, are reported once, and still fail when the target is missing; other bases retain bare-string checks.
  - Issue #93 - every reference from electron/, src/, shared/, scripts/ and root package.json scripts into openclaw_runtime/** is existence-checked, or listed in scripts/runtime-deep-refs-baseline.json with a non-empty reason; a dangling reference that is neither resolves nor exempt fails closed.
  - Issue #93 - the guard reports the measured inventory (imports / strings / package scripts) and its exemptions, and the exemption ledger contains no reasonless entry.
  - Issue #93 - the version dual-track acceptance item is satisfied by the closed #67 and its recorded upstream policy, not re-opened here; the remaining coupling (deep imports not migrated behind a supported entry point) is recorded as bounded debt rather than claimed resolved.
docs:
  required: true
---

# Gate parent-to-vendored deep references

Issue #93 reported 77 deep references from parent code into the vendored
`openclaw_runtime` tree. Its string-assertion half was worked on a branch that
never merged, and nothing on `main` validated the reference surface at all — so a
re-vendor rename would break tooling and capability evidence silently.

This change adds the missing guard. It is deliberately textual and cheap (node
builtins plus `git ls-files`), so CI can run it before dependency installation.
It records, rather than hides, the parts it cannot see: concatenated paths,
comment matches, and semantics that survive an existence check.

Module-relative `new URL(path, import.meta.url)` literals use the same file-relative resolution as imports. URLs with other bases and bare strings keep their existing resolution rule; a removed target still fails.
