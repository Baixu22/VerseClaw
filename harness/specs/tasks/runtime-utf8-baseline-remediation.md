---
id: runtime-utf8-baseline-remediation
title: Pruned Runtime UTF-8 baseline remediation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Recover malformed UTF-8 committed in the pruned OpenClaw Runtime from byte-level evidence, preserve retained Runtime ownership and behavior, and restore a real green Runtime build before DCS Stage 1 closure.
touchedAreas:
  - harness/specs/tasks/runtime-utf8-baseline-remediation.md
  - docs/superpowers/specs/2026-07-11-dcs-stage1-recovery-orchestration-design.md
  - docs/superpowers/plans/2026-07-11-dcs-stage1-recovery-orchestration.md
  - openclaw_runtime/scripts/runtime-utf8-inventory.mjs
  - openclaw_runtime/scripts/runtime-utf8-inventory.test.mjs
  - artifacts/runtime-utf8-recovery/inventory-summary.md
  - artifacts/runtime-utf8-recovery/inventory.json
  - artifacts/runtime-utf8-recovery/baseline-scan.log
  - artifacts/runtime-utf8-recovery/baseline-scan-git-blobs.log
  - artifacts/runtime-utf8-recovery/baseline-scan-final.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-01.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-01.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-02.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-02.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-03.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-03.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-04.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-04.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-05.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-05.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-06-enobufs.log
  - artifacts/runtime-utf8-recovery/red-green/w1-red-07-git-blob-crlf.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-07-git-blob-crlf.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-08-git-blob-buffer.log
  - artifacts/runtime-utf8-recovery/red-green/w1-green-final.log
expectedUserBehavior:
  - The user's original workspace and mixed DCS closure clone remain byte-for-byte untouched by remediation work and recoverable from verified bundles, patches, untracked-file copies, and SHA-256 inventories.
  - Every tracked textual file in the pruned Runtime is valid UTF-8 after remediation, while retained runtime, plugin, channel, provider, protocol, and build behavior remains intact.
  - The pruned Runtime build completes successfully without restoring an unowned full CLI, adding an empty compatibility shell, externalizing business dependencies, or weakening a build gate.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - comms-regression
requiredTests:
  - node --test openclaw_runtime/scripts/runtime-utf8-inventory.test.mjs
  - node openclaw_runtime/scripts/runtime-utf8-inventory.mjs --root . --pathspec openclaw_runtime --output artifacts/runtime-utf8-recovery/final-inventory.json
  - pnpm --dir openclaw_runtime build
  - pnpm run typecheck
  - pnpm run lint
  - pnpm test
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm run harness:ci
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Before any Runtime production source is edited, this task's touchedAreas is amended to list every frozen repair allowlist, every exact production source or test path, and every evidence report, then Harness context and validate both exit 0 without --no-diff.
  - The canonical inventory scans Git blob bytes, records Git object identity and SHA-256 preimages, reports deterministic malformed byte ranges and bounded context, and distinguishes clean-filter-equivalent Windows worktrees from real drift.
  - Recovery apply refuses unresolved confidence, missing evidence, changed preimages, mismatched remove bytes, overlapping ranges, and paths outside the repository before writing any file.
  - Every repaired byte range has exact or independently corroborated evidence, preimage and postimage hashes, and a nonempty evidence source list; unresolved recovery entry count is zero.
  - Upstream trees are evidence only; no file is replaced wholesale unless all bytes outside the damaged ranges are proven identical.
  - No lossy decoder, U+FFFD substitution, guessed punctuation, guessed CJK text, guessed emoji, blanket conversion, blanket skip, assertion deletion, or weakened gate is used.
  - Repair workers edit pairwise-disjoint frozen path allowlists, and integration verifies each worker's changed-file list is a subset of its allowlist.
  - Retained src/entry.ts bootstrap, plugin SDK health API, Gateway protocol schemas, status runtime entry, plugin/channel/provider behavior, and pruned build ownership are covered by focused tests.
  - Renderer, Electron Main, host API, Gateway transport policy, DCS working-memory behavior, COMPASS, task_state, knowledge, notes, and handoff are not modified by this remediation.
  - Strict final inventory reports invalidFiles 0, invalidUnits 0, worktreeMismatches 0, and unresolved repairs 0.
  - All required tests and the real pnpm --dir openclaw_runtime build exit 0, and independent review reports Critical 0 and Important 0 before this baseline is used by DCS Stage 1.
docs:
  required: true
  files:
    - docs/superpowers/specs/2026-07-11-dcs-stage1-recovery-orchestration-design.md
    - docs/superpowers/plans/2026-07-11-dcs-stage1-recovery-orchestration.md
---

# Pruned Runtime UTF-8 Baseline Remediation

This task is an operational prerequisite for DCS Stage 1, not a DCS behavior
specification. It must remain a separate commit range and acceptance report.
DCS v1.6 remains the only authority for working-memory behavior.

## Current Phase

The current touchedAreas is intentionally limited to inventory tooling and
evidence. The baseline inventory at coordinator seed `addae094a` reports:

- 11,275 tracked Runtime files;
- 11,245 classified textual files;
- 30 classified binary files;
- 370 invalid textual files;
- 1,571 malformed UTF-8 units;
- zero worktree-to-Git mismatches after Git clean filters.

No Runtime production source may be edited in this phase. W0 must merge W1-W4
evidence, freeze exact pairwise-disjoint repair allowlists, append every
production source and focused test path to touchedAreas, and rerun both Harness
commands before creating repair branches.

## Component Ownership

- Inventory tooling owns strict byte validation, Git preimage identity,
  deterministic context capture, manifest validation, and guarded apply.
- Evidence workers own candidate provenance only and cannot alter Runtime
  source.
- Runtime owner modules retain their behavior and focused tests; byte repair
  cannot move policy across plugin, channel, provider, Gateway, protocol,
  storage, or build boundaries.
- The integration worker owns cherry-pick order, conflict review, full scan,
  Runtime build-contract integration, and acceptance evidence.
- DCS Stage 1 owns no file in this remediation task and begins only from the
  accepted remediation commit.

## RED Evidence

The `artifacts/runtime-utf8-recovery/red-green` logs preserve test-first
failures for the missing scanner API, complete UTF-8 validation and file
classification, Git preimage inventory, guarded apply, and CLI gate behavior.
`baseline-scan.log` preserves the real large-index `ENOBUFS` failure.
`w1-red-07-git-blob-crlf.log` proves why raw Windows worktree offsets were
unacceptable. Matching GREEN logs record the smallest passing implementation.

## Recovery Evidence Standard

An `exact` replacement requires byte alignment against a source with identical
undamaged context. A `corroborated` replacement requires at least two
independent evidence sources and a focused behavior test when the bytes affect
runtime strings, regexes, schemas, identifiers, vocabularies, or protocol
content. Anything else remains `unresolved` and blocks source repair.
