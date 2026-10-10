# P2 issue batch 5: role contract diagnostics, sensitive-sink taxonomy, memory baseline truthfulness

Date: 2026-10-10 (agent-driven)
Base: private `main` = `1f72a0d09` ("fix(gateway,harness,repo): close P2 batch 4")
Issues closed by this change: **#109, #151, #146** (all `[P2]`).

This batch makes two silent configuration/contract contradictions visible, and
replaces a stale hand-written evaluation baseline with a tracked artefact
reference. No product default, permission default, frozen lock, tool policy or
release state changes, and no claim of human execution is made anywhere here.

## #109 - role contract accepted read-only tool conflicts and dangling handoffs

**Verified at HEAD:** `validateRoleContract` checked name/displayName/rolePrompt
identifiers, the `filesystem=none` + path-permission cross-check and the output
format, but never compared `tools` against the permission-derived deny list in
`role-permissions-policy.ts`. A role declaring `permissions.filesystem=read` with
`tools: ['write','edit']` validated cleanly, and `handoff.to` was never resolved
against the merged registry, so a target that exists nowhere registered silently.
At spawn time `buildRolePermissionDenyPatches` then stripped `write`/`edit`,
leaving the declared capability and the effective capability contradictory.

**Change**

- `role-contract.ts`: `RoleContractValidationIssue` gains an optional
  `severity` (`error` default, `warning` for diagnostics); `ok` is now "no
  `error`-severity issue", so warnings never drop a previously accepted config
  entry. A new cross-field check reuses the real
  `buildRolePermissionDenyList` mapping and reports every declared tool that the
  role's own permissions deny, naming the tool, `filesystem`/`network`/`commands`
  values and the conflict.
- `role-registry.ts`: after the full merge, every role in the final registry
  (built-in and config) has its `handoff.to`/`handoff.from` targets resolved
  against the merged name set. A forward reference inside the same config batch
  and a built-in reference are valid by construction; an unresolvable target is
  reported with the field (`handoff.to` / `handoff.from`), the role name and the
  config index (`-1` marks a built-in finding, and a config override replaces the
  built-in finding). Warning-severity validation issues from accepted config
  roles are now surfaced instead of discarded.
- `role-orchestration-methods.ts`: the existing `roles.list` response gains an
  additive `issues: registry.issues` field so a caller no longer has to derive the
  role and wait for it to fail.

**Newly surfaced by this check (reported, not silently fixed):** the shipped
built-ins `tester` and `skeptic` declare `bash` while `permissions.filesystem=read`
already denies shell tools, and the built-in `knowledge-librarian` hands off to
`researcher`, a role that exists nowhere. These are pre-existing contract
inconsistencies; changing built-in capabilities or handoff targets is a product
decision, so this batch reports them.

**Tests:** `tests/unit/role-contract-validation.test.ts` (10) covers read-only +
write/edit, `none` + filesystem tools, `none` network + network tools, the clean
role, the issue's exact reproduction, same-batch forward references, dangling
`handoff.from`, the built-in `knowledge-librarian` finding, and that
error-severity issues still skip the entry. `role-orchestration-methods.test.ts`
(+1) asserts `roles.list` returns the diagnostics while still listing the role.
Existing role/agency suites (85 + 14 tests) pass unchanged.

## #151 - sensitive-sink classification table disagreed with the implementation

**Verified at HEAD:** all five sinks the issue names really do have narrow,
production-wired enforcement that rejects (secret-read, credential-use,
browser-effect ×2 points, external-write, network-send), yet the centralized table
marked them `classification-only` and `tests/unit/external-content-provenance.test.ts`
pinned that state.

**Change**

- `shared/security/content-provenance.ts`: the taxonomy is now a discriminated
  union. `enforcement` is `narrow | source-dependent | classification-only`;
  `narrow` and `source-dependent` require a non-empty `enforcedAt` list of
  `{ policyFile, exportedSymbol, callSite, rejectsWith }` (`policy-throw`,
  `call-site-throw`, `constrain`), and `classification-only` forbids
  `enforcedAt` (`?: never`). The comment states explicitly that every
  non-`classification-only` value is a narrow, deliberately partial gate — never
  a claim of complete coverage.
- `tests/unit/external-content-provenance.test.ts`: the misleading test that
  pinned the five sinks to `classification-only` now asserts `narrow`
  enforcement with a non-empty `enforcedAt` that rejects.
- `tests/unit/sensitive-sink-enforcement-drift.test.ts` (new, 5 tests): resolves
  every declared policy file, exported symbol, call site and denial style against
  the working tree, plus a reverse sweep that every module in
  `openclaw_runtime/src` which imports `isExternalOrUnknownProvenance` must appear
  in the table. Mutation checks (bad path, wrong `rejectsWith`, downgraded sink)
  were run against the guard and all failed as designed.

**Also updated (Lead follow-up that the subagent could not touch):** the seven
`harness/specs/tasks/*provenance-boundary.md` acceptance bullets that still said
the centralized classification "remains classification-only" now state that the
centralized table records this task's policy as a `narrow` enforcement point
without claiming broader coverage. All seven specs still validate.

**Residual:** `docs/dev/harness-gap-closure/source-inventory.json` records the
pre-change sha256/line for `shared/security/content-provenance.ts`. That file is a
historical B00 source baseline (`scope: B00-source-baseline-not-runtime-acceptance`)
that the tree has already diverged from in other entries, and its verifier
(`scripts/check-harness-gap-baseline.mjs`) is not wired into `harness:ci`; it is
therefore not rewritten. The planning notes that repeat "5 classification-only"
(`docs/dev/harness-gap-closure/design.md`, `baseline.md`,
`harness/specs/tasks/harness-gap-closure-plan.md`) are historical records of the
state at planning time and are likewise left as-is.

## #146 - memory design document scheduled from a stale hand-written baseline

**Verified at HEAD:** `docs/runtime-design/mem.md:284` still carried
`当前 17.3% 39.6% 52.8% 66.1% 43.0%` while the tracked artefact
`tests/fixtures/runtime-memory-eval/locomo-full-500-report.json` records
`metrics.overall.j_score = 0.752` (32.2 points apart), and the stage targets were
derived from the stale number.

**Change**

- `docs/runtime-design/mem.md`: a new §零 machine-quoted baseline block binds the
  document to the tracked artefact (sha256, report version, generatedAt, question
  count, per-metric values) plus the frozen judge id
  (`frozen-v2-generous-2026-07-04`) and its five exemption rules, verified in
  `tests/unit/helpers/runtime-memory-judge-freeze.ts`. The §三 table's `当前` row
  is derived from the same artefact metrics (80.7% / 61.5% / 78.0% / 82.0% /
  75.2%) and the four phase-target rows are withdrawn as invalid rather than
  replaced with new invented targets. The document additionally records that the
  tracked artefact's `escalation.full_conversation_rate` **does not exist** in this
  old-schema report (so the degradation share cannot be quoted from it), that the
  new report schema requires that field and rejects mixed memory/fallback scores,
  and that the old "DeepSeek V4 Pro judge" and cross-paper ranking claims were
  unfounded.
- `tests/unit/runtime-memory-baseline-doc-guard.test.ts` (new, 9 tests): fails
  closed when the marker block, the `当前` row, the fixture or a quoted metric
  path is missing/unparsable, when the quoted block drifts from the fixture bytes
  or metadata, when the judge id or exemption rules drift from the code constants,
  or when the escalation disclosure contradicts the artefact. It also pins the
  degradation disclaimer.

**Verified facts recorded by this fix (issue audit corrections):** `.gitignore`
ignores `/runtime-research/` at **line 112** (the issue said 217),
`git ls-files runtime-research` returns 0 rows, the directory is absent from a
clean worktree, and only the Phase 35 spec's `ownedPaths`/rollback paths point
into it — the Phase 36 spec does not. Making that directory tracked is a Lead
decision and was not done here.

## Gates executed on the candidate (agent-driven)

| Gate | Command | Result |
| --- | --- | --- |
| Focused unit | `node node_modules/vitest/vitest.mjs run <11 files>` | 11 files / **153 passed + 1 skipped**, exit 0 |
| Typecheck (node/web/test) | `tsgo --noEmit -p tsconfig.{node,web,test}.json --composite false` | all exit 0 (after `node scripts/generate-ext-bridge.mjs`) |
| Lint (changed files) | `node node_modules/eslint/bin/eslint.js <9 changed TS files>` | exit 0 |
| Harness specs | `validate --spec` for this batch's task spec and the seven updated provenance-boundary specs (`--no-diff`) | all `Spec is valid`, exit 0 |
| i18n lint | `node scripts/i18n-lint.mjs` | `i18n lint passed.`, exit 0 |
| Comms regression | `node scripts/comms/replay.mjs` + `node scripts/comms/compare.mjs` | exit 0, all metrics PASS |
| Policy docs | `node scripts/validate-policy-docs.mjs` | 10 checks PASS, exit 0 |
| Artifact retention | `node scripts/check-repository-artifacts.mjs` | see the evidence report |
| Whitespace | `git diff --check` | see the evidence report |

**Environment note (external to this change):** part-way through the batch the
shared checkout's `D:\ClawX\node_modules` was emptied by a process outside this
session (the candidate's junction then resolved to an empty directory and vitest
failed with `MODULE_NOT_FOUND`; several other candidate worktrees show the same
0-entry state). Without touching `D:\ClawX`, the candidate's two junctions were
re-pointed to the populated sibling install
`D:\ClawX-candidates\tf0029-unblock-20260916\{node_modules,openclaw_runtime\node_modules}`
(123 root entries, vitest/eslint/tsgo present; the lockfiles differ only in line
ordering). All gates above ran against that install. This is environment repair,
not a product change, and the affected worktrees outside this session were left
untouched.

**Not run:** full repository unit suite, `harness:ci`, Electron E2E, Agent Dev
deep-test/audit, packaging, cross-platform checks, live provider calls and any real
evaluation run. No UI surface was changed, so no E2E spec was added.

**Credentials:** the changed files and evidence are scanned for common credential
shapes by the evidence driver; results are in `credential-scan.json`.

**Boundaries:** evidence is `driven_by: agent`; no human action, verdict or data
is claimed. `pnpm run <script>` cannot run in the junction-based candidate
worktree, so the wrapped `node` commands were invoked directly.
