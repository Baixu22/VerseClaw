# Unprioritized issue batch 1 (#75 #96 #97) and tracking-index audit (#103 #125 #147 #158)

Date: 2026-10-10 (agent-driven)
Base: private `main` = `ca093b5fb` ("fix(repo): drop a stale reviewed-ignore entry from the batch 7 change set")
Branch: `codex/nop-issues-batch1-20261010` (candidate worktree `D:\ClawX-candidates\nop-issues-batch1-20261010`)
Issues closed by this change set: **#75, #96, #97**.
Tracking indexes reviewed (not closable yet): **#103, #125, #147, #158**.

This batch works only the open issues whose titles carry **no `[P*]` prefix**. It
does not touch priority-prefixed issues, product defaults, feature flags,
permission defaults, frozen locks or release state. No human action, human data
or paid provider call is claimed; everything is `driven_by: agent`.

## Scope decision

At the start of the batch the repository had 60 open issues. Seven of them carry
no priority prefix in the title: `#75`, `#96`, `#97` (documentation /
characterization) and `#103`, `#125`, `#147`, `#158` (tracking indexes whose
checklist children are all priority-prefixed). The three non-index issues are
actionable on their own; the four indexes can only close when their children
close, so this batch synchronises them with reality instead of forcing them.

## #97 — vtoken distribution premise, `.vt` contract, tracked tokenizer cache

Durable record: `docs/dev/vtoken-distribution-and-format-contract.md`.

- **AC1** (distribution premise, answered): the installer ships the **uv binary**
  (`electron-builder.yml:92-93`, `:140-141`, `:168-169` copying
  `resources/bin/<platform>-<arch>/`, produced by `scripts/download-bundled-uv.mjs`
  at pinned uv `0.10.0` with sha256 verification) and the vtoken **Python source**
  only (`:59-65`). Neither `uv` nor `python3.12` must pre-exist, but first use
  needs the network because the sidecar runs `uv run --python 3.12`
  (`electron/services/vtoken-bridge.ts:198`) and falls back to
  `uv python install 3.12` (`electron/utils/uv-setup.ts:96`, `:122`). The whole
  bridge is product-default OFF (`vtoken-bridge.ts:63-79`), so the default path
  never spawns Python. When uv is genuinely absent the error is thrown at
  `electron/services/vtoken-bridge.ts:182` and surfaces through
  `VtokenStatusResult.error` to the Settings > Developer panel.
- **AC2** (`vt.pack` path, re-verified): the two-path topology in the issue
  comment holds; three citations were corrected — the package-root injection is at
  `electron/gateway/config-sync.ts:1151-1164` / `:1185-1187`, the TS split is
  exactly 9 forwarded + 3 Main-local, and Python `dispatch()` implements **10**
  `vt.*` branches (`host_rpc.py:170`…`:286`), the extra one being the stateless
  Path-B-only `vt.pack` (`:177`). The asymmetry is a design split, not a missing
  implementation.
- **AC3** (`.vt` contract, answered): there is **no versioned public contract** —
  a code-enforced stable subset (`parser.py:19`, `:21`, `:38-39`, `:60-61`;
  `schema.py:11-20`, `:26-34`, `:37`, `:88-98`; `compiler.py:19`, `:25`, `:53-59`)
  with no compatibility promise, deprecation policy or version negotiation. The
  only explicit `/v1` contract is the JSON-RPC wire shape
  (`host_rpc.py:32-34` ↔ `openclaw_runtime/src/context-engine/vtoken-rpc-client.ts:12-14`).
  D31 (`DECISIONS.md:40`) actively demotes `.vt` to an optional debug format.
  Issue-body corrections: `packages/vtoken/README.md` is 608 B (not 36 KB), and
  the uv-missing error line is `:182` (not `:198`).
- **Fix**: `packages/vtoken/.gitignore`'s `.tiktoken_cache/` pattern had been
  appended to the tail of a `#` comment line with no newline, so it never
  matched and a 1,681,126-byte machine-local tokenizer cache was tracked. One
  `\n` was inserted (474 → 475 bytes, valid UTF-8 before and after), the cache
  was untracked with `git rm --cached` while the on-disk file stayed
  byte-identical, and `packages/vtoken/.tiktoken_cache` was added to
  `localOnlyDirectories` in `scripts/repository-artifacts.json` as a second,
  policy-level layer. `tests/unit/repository-artifact-retention.test.ts` gained a
  two-layer guard (no tracked path under the cache directory; the real ignore
  file must match inside a temporary repo), falsified by restoring HEAD's broken
  `.gitignore` (1 failed | 11 passed) and re-verified after the fix (12 passed).

## #96 — capability wiring map: Q1/Q2/Q3 and the leaf-consumer guard

Durable record: `docs/dev/runtime-feature-control-surface.md`;
rule: `harness/specs/rules/runtime-feature-leaf-consumers.md`;
checker: `scripts/check-feature-leaf-consumers.mjs` (+ `.d.mts`), test
`tests/unit/feature-leaf-consumers.test.ts` (10 passed).

- **Q1** (`coding.uftk` positioning): the whole subtree is declared-only. `uftk`
  appears in exactly four files, all declaration surface
  (`types.openclaw.ts:207`, `zod-schema.ts:390`, `runtime-feature-leaves.ts:81`,
  `runtime-coding-uftk.test.ts`); the only generic coding-leaf reader
  `readCodingLeaf()` (`context-engine/coding-runtime-flags.ts:71-80`) has three
  call sites and never passes an `uftk` key. So **12/12** gates are unwired
  (the issue said 9/12 — an undercount). The detached implementations
  (`infra/exec-approvals-allowlist.ts`, `agents/checkpoint-rollback-executor.ts`,
  `agents/tools/write-journal.ts`) read injected options or nothing, and two
  same-name decoys (`sqlite-wal.ts autoCheckpointPages`,
  `approval-bridge.ts commandApprovalDecision`) were ruled out. Direction for
  issue #95: **remove** the leaves from type/schema/labels/UI, in sync with
  `config-schema-parity.test.ts`.
- **Premise correction that affects several conclusions**:
  `runtime-feature-leaves.ts` is a `DeepRequired` **parity sample**, not a
  defaults table (`:1-16`). The issue's "vtoken defaults ON" is false: the real
  default is `false` (`chat-turn-vtoken-injection.ts:50-51`, `:149`, `:152`;
  `types.openclaw.ts:402`, `:412`; `docs/dev/default-config-matrix.md`). The same
  trap applies to rc05, whose sample says `true` while
  `cron/operator-delivery.ts:7` requires `=== true`.
- **Q2** (DCS prod-flag control surface): the 21-flag catalog distributions all
  match the issue; two corrections land — host-api exposes **5** methods
  (`contract.ts:5105-5111`) not 6, and **4 of 27** config groups are flag-covered
  (`memory` is 3 by prefix, not 5). `vtoken.assembly.enabled` should stay
  config/env controlled (real consumers, three-level kill, labels/help already
  complete); `contextRuntimeKit` needs no UI switch because
  `types.openclaw.ts:243` documents rollback "without UI changes"; rc05's thin
  wiring is confirmed (2 production readers, no labels/help) but "legacy" is not
  provable, so it is left to product. The missing "how to add a flag" doc is
  §2.4 of the durable record.
- **Q3** (UI exposure): the absence of dedicated panels for
  memory/orchestration/mission is an intentional exposure choice, not a defect —
  real non-UI surfaces exist (agent tools + config labels), the built-in slash
  commands are session-management only
  (`agents/sessions/slash-commands.ts:25-45`), and `vtoken` has a panel because it
  alone owns an operable sidecar lifecycle. Recommendation only (not
  implemented): a read-only wiring-overview page.
- **AC(b)** guard: leaves are enumerated from the real
  `RUNTIME_FEATURE_EXHAUSTIVE` literal (no hand-copied list; 129 leaves today).
  Exactly one condition is fatal — an **unpinned** leaf with no visible consumer.
  The 19 known zero-consumer leaves are pinned with issue #95 as owner; a pinned
  leaf that gains a consumer **or** disappears from the schema is informational
  only, so either #95 direction stays green. The heuristic is textual/structural,
  fails open on ambiguity, and is documented as such in the script, rule and doc.
  `--self-test` builds a synthetic tree in `os.tmpdir()` and verifies both the red
  and green paths. CI coverage rides on `pnpm run test` (no workflow edit),
  matching the `check-capability-claims.mjs` pattern.

## #75 — exact-path reference analysis and the archive conclusion

Durable record: `docs/dev/repository-reference-analysis-20261010.md`;
tool: `scripts/analyze-reference-graph.mjs` (+ `.d.mts`), test
`tests/unit/reference-graph-analysis.test.ts` (11 passed).

- The tool decides references by **exact full relative path containment**, with
  code / issue-method (code + json/yml/yaml) / any-source columns, `openclaw_runtime`
  and lockfiles excluded by default, and `--ignore-source` to drop administrative
  registries that otherwise make every retained file look referenced.
- Corrected numbers (issue-method column, registries excluded) versus the issue's
  table: `docs/` 297 files → 43 zero-reference (14.5%) vs 56/458 (12.2%);
  `reports/` 32 → 0 (matches); `plans/` 118 → 0 (matches); `team/` 3 → 0 vs 8/55;
  `harness/specs/tasks/` 455 → 35 vs 28/441; `artifacts/` 1,130 → 184 vs 506/1,823;
  `.design-staging/` untracked entirely. The drift is explained by the same-day
  retention commit `9d84273d3` (removed 187 docs, 85 reports, 52 team, 705
  artifacts paths), and three areas reconcile exactly as audit-count minus
  removed-count.
- **Archive conclusion: not archived, kept in place.** The two directories hold
  25 tracked files (6 + 19), and the evidence contradicts the issue's premise:
  18 archived harness task specs reference them, 8 of those declare 6 of the paths
  in `docs.files` (which `scripts/check-repository-artifacts.mjs:101-105` enforces
  fail-closed), and two `openclaw_runtime/scripts/*.mts` files hardcode exact
  paths (`source-set-ks07-quality.mts:23`, `knowledge-surface-reports.mts:33`).
  Rewriting the archived specs' input lists would falsify historical acceptance
  records. Provenance (size + sha256 + reference list) is recorded, and **no file
  was moved**.
- The stale-claim sweep found no tracked text or script relying on the inflated
  figures (and the untracked triage document does not exist in this worktree), so
  the durable record replaces it.

## Tracking indexes #103 / #125 / #147 / #158

None of the four tracking issues can close: each still has open
priority-prefixed children, which is the index's purpose rather than a defect.

| Index | Children | Closed | Open | Action taken |
|---|---|---|---|---|
| #103 | 5 (#98 #99 #100 #101 #102) | 3 | #100, #101 | checklist synchronised (3 items checked) |
| #125 | 10 (#115…#124) | 4 | #116, #117, #118, #119, #122, #124 | checklist synchronised (4 items checked) |
| #147 | 13 (#134…#146) | 5 | #135, #136, #138, #139, #140, #142, #143, #144 | checklist synchronised (5 items checked) |
| #158 | 4 (#154 #155 #156 #157) | 0 | all four | no change (already accurate) |

The synchronisation was performed by
`D:/ClawX-work/nop-issues-batch1-20261010/tracking/sync-tracking-checklists.mjs`,
which reads each child's real `state` from GitHub, flips `- [ ]` to `- [x]` only
on checklist lines naming a CLOSED child, writes the before/after bodies plus a
machine-readable report, and (with `--apply`) edits the issue and reads the body
back. All four bodies were read back after the edit; the three edited issues
report `readBackMatches=true`. The indexes stay OPEN by design.

## Verification

Agent-driven commands run from the candidate worktree; raw stdout per gate in
`D:/ClawX-work/nop-issues-batch1-20261010/logs/<id>.log`, machine-readable
results in `gates.json`, driver `run-gates.mjs`. 17 of 17 gates behaved as
declared (16 pass + 1 deliberate negative control):

| Gate | Result |
|---|---|
| `vitest run tests/unit/repository-artifact-retention.test.ts` | 12 passed |
| `vitest run tests/unit/feature-leaf-consumers.test.ts` | 10 passed |
| `vitest run tests/unit/reference-graph-analysis.test.ts` | 11 passed |
| `node scripts/check-feature-leaf-consumers.mjs` | 129 leaves / 5267 sources / 19 pinned, exit 0 |
| `… --self-test` | PASS 3/3 |
| `… --root <synthetic fixture>` (negative control) | exit 1 naming the unwired leaf — deliberate |
| `node scripts/analyze-reference-graph.mjs --dir docs --zero-only` | exit 0 |
| `node scripts/check-repository-artifacts.mjs` | passed (tracked paths counted) |
| `node scripts/check-no-bom.mjs` | ok |
| `node scripts/check-spec-lifecycle.mjs` | ok |
| `node scripts/validate-policy-docs.mjs` | ok |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/nop-issue-fixes-batch1-20261010.md` | Spec is valid (diff-owned) |
| `node harness/src/cli.mjs validate --spec harness/specs/rules/runtime-feature-leaf-consumers.md --no-diff` | Spec is valid |
| `node scripts/generate-ext-bridge.mjs` | ok (generated file is gitignored) |
| `tsgo --noEmit -p tsconfig.test.json` | exit 0 |
| `tsgo --noEmit -p tsconfig.node.json` | exit 0 (needs the generated ext bridge, as in CI) |
| scoped eslint over changed files | exit 0 |

Two gate-runner bugs were found and fixed while running them, and are disclosed
rather than hidden: a Windows `.cmd` shim cannot be spawned without `cmd.exe`
(tsgo/eslint gates now go through `%ComSpec%`), and passing a `.d.mts` file to
eslint explicitly produces "File ignored because no matching configuration was
supplied", which `--max-warnings 0` turns into a false failure (declaration files
are now excluded, matching the repository's own `eslint .` behaviour).

The first retention-test run after declaring `packages/vtoken/.tiktoken_cache`
as local-only **failed** (`packages/vtoken/.tiktoken_cache/generated.json: expected
false to be true`) because the test's fixture only wrote the root `.gitignore`.
That is a real finding, not a flake: the fixture now copies every tracked
`.gitignore` (root plus nested per-package files), so the invariant "a declared
local-only path is ignored in fact" is checked against the repository's real
ignore topology instead of the root file alone.

## Change set (18 paths)

New: `scripts/analyze-reference-graph.mjs` (+`.d.mts`),
`scripts/check-feature-leaf-consumers.mjs` (+`.d.mts`),
`tests/unit/reference-graph-analysis.test.ts`,
`tests/unit/feature-leaf-consumers.test.ts`,
`harness/specs/rules/runtime-feature-leaf-consumers.md`,
`harness/specs/tasks/nop-issue-fixes-batch1-20261010.md`, and the four
`docs/dev/*.md` records listed at the top of this file.
Modified: `packages/vtoken/.gitignore`, `tests/unit/repository-artifact-retention.test.ts`,
`scripts/repository-artifacts.json` (four retained docs + one local-only directory),
`.gitignore` (regenerated reviewed-inputs block), `package.json` (two script entries).
Untracked with the on-disk bytes preserved:
`packages/vtoken/.tiktoken_cache/9b5ad71b2ce5302211f9c61530b329a4922fc6a4`.

## Boundaries

- No installer or packaged artifact was produced or inspected on this host, so
  the "uv ships in the installer" conclusion is configuration-derived, not
  artifact forensics.
- The uv-missing branch, offline first-run, and the vtoken Python test suite were
  not exercised. No full unit suite, lint, Electron E2E, packaging or
  cross-platform verification was run except where listed.
- The reference-graph analysis counts exact relative-path **mentions**; it is not
  a semantic dependency proof, and administrative registries must be excluded
  from the corpus or every retained file looks referenced.
- The feature-leaf consumer check is a textual/structural tripwire, not a
  reachability proof; the pinned `coding.uftk` debt belongs to issue #95.
- Priority-prefixed issues referenced by the three closed issues (notably #95 for
  the uftk wiring decision, and #100/#101, #116/#117/#118/#119/#122/#124,
  #135/#136/#138/#139/#140/#142/#143/#144, #154/#155/#156/#157) remain open and
  are explicitly out of scope for this batch.
- The issues' own reference counts for context-engine subdirectories could not be
  reproduced (those names are not subdirectories of `context-engine/`), and rc05
  was not labelled legacy because no marker supports it; both are stated as
  bounded conclusions rather than silently adopted.
