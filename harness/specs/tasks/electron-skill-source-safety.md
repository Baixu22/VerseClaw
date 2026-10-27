---
lifecycleStatus: active
id: electron-skill-source-safety
title: Electron skill-source safety closeout
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Stop the Electron E2E/Gateway startup skill-sync path from deleting tracked QQBot skill sources and the targets of Windows directory junctions, and add a worktree guard that fails closed when a run mutates tracked source.
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - harness/specs/tasks/electron-skill-source-safety.md
  - harness/specs/tasks/product-acceptance-closeout.md
  - harness/specs/fixtures/product-acceptance-shortfalls/ledger.json
  - harness/specs/fixtures/product-acceptance-closeout/a3-source-safety/**
  - harness/specs/guides/product-acceptance-strategy.md
  - openclaw_runtime/src/skills/loading/plugin-skills.ts
  - openclaw_runtime/src/skills/loading/workspace.ts
  - tests/e2e/fixtures/electron-process-cleanup.ts
  - tests/e2e/fixtures/source-mutation-guard.ts
  - tests/unit/skill-source-safety.test.ts
  - tests/unit/source-mutation-guard.test.ts
expectedUserBehavior:
  - Launching the E2E app repeatedly leaves every tracked source file byte-identical; the four QQBot skill files under openclaw_runtime/extensions/qqbot/skills/ are never deleted.
  - A plugin-skills entry that is a real directory is never treated as a stale runner-owned link, so user/build output is not removed.
  - The synced-skills preparation refuses to clean a target that resolves onto a protected source root, instead of recursively deleting through a junction.
  - A run that modifies or deletes a tracked file fails the teardown guard, even when the tree was already dirty before the run.
requiredTests:
  - pnpm exec vitest run tests/unit/skill-source-safety.test.ts tests/unit/source-mutation-guard.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/skills-symlink-cleanup.test.ts tests/unit/skill-config-bundled-defaults.test.ts tests/unit/config-sync-source-runtime.test.ts --maxWorkers=1
  - pnpm exec playwright test tests/e2e/coding-loop-fp-p1-04.spec.ts --workers=1
  - pnpm exec playwright test tests/e2e/app-smoke.spec.ts --workers=1
  - pnpm run typecheck:test
  - pnpm harness validate --spec harness/specs/tasks/electron-skill-source-safety.md
  - git diff --check
acceptance:
  - A red-then-green focused test captures the real owner: on the unfixed source the plugin-skills regular-directory case deletes its SKILL.md, and the synced-skills case deletes through the junction; both pass after the fix.
  - Three independent Electron launches leave tracked files, the four QQBot skill files, and the worktree guard hashes unchanged.
  - The teardown guard fails closed when a temp fixture's tracked file is modified or deleted, and when an already-dirty tree is mutated further.
  - The shortfall e2e-skill-source-mutation becomes resolved only with a clean candidate, command and exit codes, parsed counts, raw artifact SHA256, curated evidence, and visible limitations.
  - No product lock (releaseApproved/productApproved/liveReady/defaultOn), default value, approval authority, or public state changes.
docs:
  required: true
  files:
    - harness/specs/guides/product-acceptance-strategy.md
---

# Electron Skill-Source Safety

TF-0576 closes shortfall `e2e-skill-source-mutation`. Two E2E launches were observed deleting four
tracked files under `openclaw_runtime/extensions/qqbot/skills/`. The deleting path is the skill sync
that runs during Gateway startup: plugin skills are published into a per-run skills directory as
junctions/symlinks, and stale entries are cleaned before each sync.

## Root cause and fix

`openclaw_runtime/src/skills/loading/plugin-skills.ts` classified any Windows directory as a
runner-owned junction:

```ts
return entry.isSymbolicLink() || (process.platform === "win32" && entry.isDirectory());
```

so a real directory under `plugin-skills/` was removed by `removeGeneratedPluginSkillEntry` with
`rmSync(..., { recursive: true, force: true })`. `prepareSyncedSkillsDirectory` in
`openclaw_runtime/src/skills/loading/workspace.ts` then recursively removed each entry under the
target skills directory, which follows a Windows directory junction and deletes the files in the
junction target (the tracked source).

The fix is intentionally narrow:

- Only an actual link (`entry.isSymbolicLink()`) is treated as a runner-owned generated entry, and
  the removal re-checks `lstat().isSymbolicLink()` before deleting.
- `prepareSyncedSkillsDirectory` resolves the target and each entry and refuses to clean anything
  that overlaps a protected source root, throwing a readable error instead of deleting it.

## Shared worktree guard

`tests/e2e/fixtures/source-mutation-guard.ts` captures tracked-file status (`git status --porcelain=v1
--untracked-files=no`), the tracked-file list hash, and the `git diff HEAD` hash. The Electron
global setup records the "before" state and the teardown asserts it is unchanged, writing
`source-state-before.json`, `source-state-after.json`, and `source-mutation-guard.json` into the
Playwright output directory. A pre-existing dirty tree is still compared against itself, so an
automatic `git restore` cannot mask a mutation that happened during the run.

## Evidence

Raw runs stay under `D:/tmp/clawx-product-acceptance/tf0576-*/`. Curated evidence is retained under
`harness/specs/fixtures/product-acceptance-closeout/a3-source-safety/` with candidate binding,
commands, exit codes, parsed counts, the guard verdicts for three launches, source hashes, and
SHA256SUMS.

The shortfall `e2e-skill-source-mutation` may move to `resolved` only after that evidence is read
back from disk. Packaged/install-state behavior stays unproven here; it is re-verified in the
packaging phase rather than written as already excluded. This node does not claim full-product GA,
packaging, real-provider, or real-human evidence.