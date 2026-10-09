# P2 issue batch 1: portable spec commands, snapshot/lock/doc-entry hygiene

Date: 2026-10-10 (agent-driven)
Base: private `main` = `20f616220` ("docs(policy): make SECURITY.md and the GPU default match the shipped product")
Issues closed by this change: **#145, #83, #73, #110** (all `[P2]`).

This batch fixes repository hygiene defects only. No product code, feature flag,
product lock, packaged artifact, or release state changed, and no claim of human
execution is made anywhere in it.

## #145 - machine-local absolute paths in task specs

**Reported scope:** 11 task specs hardcoded `C:\Users\27933\.cherrystudio\bin\rtk.exe`.

**Verified scope:** the machine-local wrapper appeared in **106 spec files** in two
forms - the full absolute path (67 files) and a bare `rtk` / `rtk.exe` prefix
(a further 36 files) - plus four specs whose prose carried other operator-local
paths (a desktop Agent Reach checkout, a desktop ClawX checkout, an absolute
`pnpm.cmd`, and an absolute Task Forest CLI). `rtk` (`rtk.exe`) is an
operator-local command wrapper: it is not a repository dependency, not in
`package.json`, and not present in a clean checkout or CI runner, so every
`requiredTests` line that used it was unrunnable outside that one machine.

**Fix**

- Removed the wrapper prefix everywhere in `harness/specs/**`, leaving the real
  command (`node harness/src/cli.mjs ...`, `node node_modules/vitest/vitest.mjs ...`,
  `node node_modules/typescript/bin/tsc ...`, `pnpm ...`).
- Replaced the undeclared `rg -n '<pattern>' <paths>` scans with a tracked,
  dependency-free scanner: `scripts/scan-pattern.mjs` (+ `.d.mts`). It supports
  `--pattern`, `--include`, repeatable `--glob` (with `!` negation, matching the
  `--glob '!**/*.md'` filters the specs already declared), `--max`, and
  `--fail-on-match`. Verified on real targets:
  `node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(' src/pages src/components --glob '!**/*.md'`
  -> `0 match(es) in 244 scanned file(s)`, exit 0.
- Rewrote the remaining prose paths: an operator-provided Agent Reach checkout is
  now described as such, the operator-inspection prompt is checkout-relative, the
  `pnpm.cmd` absolute path is plain `pnpm`, and the Task Forest CLI is referenced
  with `%USERPROFILE%`.

**Fail-closed guards**

- `validateSpecPortability` in `harness/src/rules.mjs`, wired into
  `harness/src/cli.mjs` `validate()` for **every** spec family and even
  `--no-diff` structural runs. Windows/macOS/Linux user-home paths are rejected;
  `~/.openclaw/...`, `%USERPROFILE%/...` and illustrative shapes such as
  `C:\Users\...\workspace` stay allowed.
- `tests/unit/harness-spec-portability.test.ts` scans the whole checked-in spec
  library (so a new spec cannot reintroduce the pattern) and proves the CLI fails
  closed on a machine-local path.
- `harness/specs/rules/portable-spec-commands.md` records the rule;
  `tests/unit/scan-pattern.test.ts` (10 cases) covers the replacement scanner.

## #83 - orphan Playwright snapshot directory

`tests/e2e/chat-work-context-bar.spec.ts-snapshots/` lost its spec in
`4f44f7232`; the three baselines stayed on disk. Removed the directory and added
`tests/unit/e2e-snapshot-ownership.test.ts`: every `tests/e2e/*.spec.ts-snapshots`
directory must have a matching spec, and that spec must capture a screenshot.

## #73 - orphaned `skills-lock.json`

The lock pointed at `packages/agent/plugin/skills/tool-ui/SKILL.md` (a path that
never existed in this repository) with a `computedHash` matching no file. The
tracked skill is `.agents/skills/tool-ui/SKILL.md`. The lock is now truthful
(correct path, recomputed sha256) and `tests/unit/skills-lock-integrity.test.ts`
keeps it true: every entry must resolve inside the repository and hash to
`computedHash`.

Deletion was the alternative in the issue. We kept the lock because the file
predates this repository's own tooling and may be read by an external
skill-lock consumer; a repaired, verified lock is reversible, whereas deleting an
external convention file is not. No in-repo consumer reads it either way.

## #110 - orchestration README pointed at a deleted plan

`docs/multi-agent-orchestration/README.md` required
`docs/multi-agent-orchestration-development-plan.md`, removed from `main` by the
retention policy (`9d84273d3`). Four references were dead, not one: the plan, a
superpowers plan, the agency role-promotion start prompt, and the P0-P4 completion
audit. The required reading order and the responsibility table now point at
tracked files (`docs/runtime-design/area-2-multi-agent-orchestration.md`,
`docs/multi-agent-orchestration/acceptance-and-test-matrix.md`,
`runtime-v2-p3-p5-allocation.md`), the local-only session handoff is labelled as
local and allowlisted, and the Task Forest sentence now matches the `AGENTS.md`
auto-close override instead of requiring a second confirmation.
`tests/unit/docs-entry-references.test.ts` reuses the policy-doc link checker
(`extractRepoReferences` / `findMissingReferences`) so the entry order cannot rot
silently again.

## Gates executed on the candidate (agent-driven)

| Gate | Command | Result |
| --- | --- | --- |
| Unit (8 files incl. all new guards) | `node node_modules/vitest/vitest.mjs run ...` | 89 passed / 0 failed, exit 0 |
| Structural spec validation | `node harness/src/cli.mjs validate --spec <each of 552 specs> --no-diff` | 551 pass; 1 pre-existing failure (below) |
| Candidate task spec | `node harness/src/cli.mjs validate --spec harness/specs/tasks/p2-issue-fixes-batch1-20261010.md` | `Spec is valid`, exit 0 |
| Test typecheck | `tsgo --noEmit -p tsconfig.test.json --composite false` | exit 0 |
| Scoped lint | `eslint <changed files> --max-warnings 0` | exit 0 |
| Policy docs | `node scripts/validate-policy-docs.mjs` | 10 checks PASS, exit 0 |
| Artifact retention | `node scripts/check-repository-artifacts.mjs` | passed |
| Declared scan smoke | `node scripts/scan-pattern.mjs ...` | 0/244, exit 0 |

### Pre-existing failure, not fixed here

`harness/specs/rules/dcs-stage5-sekb-closure-boundary.md` fails structural
validation at the base commit already (`acceptance` missing, `docs.required` not
explicit, scenario-required profiles missing). The file is untouched by this
batch; it is recorded here so the failure is not attributed to this change.

## Boundaries

- Not run: full repository unit suite, full typecheck of every project, Electron
  E2E, build/packaging, Agent Dev deep-test/audit, comms replay/compare.
  Nothing here changes communication paths, so the comms gates were not selected.
- `pnpm harness validate` could not be used directly in the junction-based
  candidate worktree: pnpm's pre-run dependency verification tried to reinstall
  and aborted without a TTY. The same harness CLI and node scripts were invoked
  directly (`node harness/src/cli.mjs ...`, `node scripts/...`), which is the
  command each `pnpm run` script wraps.
- Evidence is `driven_by: agent`. No human action, verdict, or data is claimed.
- Raw receipts and the evidence driver are kept local (regenerable), matching the
  earlier P1/P3 issue batches; the durable artifacts are the source changes,
  the two specs, the five tests, and this record.
