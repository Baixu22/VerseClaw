# VerseShell P3-02 External Write Policy Evidence

- Date: 2026-09-02
- Branch: `feat/runtime-lifecycle-governance`
- HEAD at start: `77192122a0fd2897aa20ca773faef8e2ae51aefe`
- Task: `TF-0068` / VS-P3-02
- Scope: external process write classification, static approval warning, and rollback honesty

## Result

The first engineering slice is implemented. `VerseShellCommandPlan` now carries a host-owned
`externalWritePolicy`, and the OpenClaw `exec` path appends a static warning before the existing
approval wait when that policy classifies a command as an external process write. Representative
compiler, script, Git-hook, and terminal-shell cases are covered by focused tests.

The existing OpenClaw exec approval pipeline remains the only authorization surface. No second
approval channel, journal, undo stack, feature flag, or product lock was added.

## Re-review repair

The first Workspace Git audit run was unable to reach its external-write assertions because an
environment-provided `Disk space is running low` toast covered the panel controls. After isolating
Sonner toasts in the affected E2E setup, the audit path reached a real product defect: the panel
referenced `approvals.externalWriteNoRollback`, but that key existed only under the tool approval
namespace. The key is now present in all four shipped `chat` locales, the audit row is explicitly
expanded before detail assertions, and the Vite bundle was rebuilt before rerunning Electron E2E.

The focused audit flow now passes 1/1 and verifies the static external-write summary, the explicit
no-rollback statement, and the absence of command, path, and secret values. Chat/Inbox E2E passes
3/3. The full Workspace Git file passes its two functional flows plus the audit flow (2/3 overall);
the remaining failure is the pre-existing `ai-commit-card` screenshot baseline drift (214 pixels,
about 1%, with matching layout and colors), not an external-write assertion failure.

## Implementation

- `openclaw_runtime/src/agents/verseshell/external-write-policy.ts`
  - Classifies external process writes as `effectLevel="external-write"`.
  - Distinguishes `compiler`, `script`, `git-hook`, `terminal-shell`, and `generic` triggers.
  - Always records `rollbackClaim=false`.
  - Returns a static warning that never copies argv, paths, environment values, or credentials.
- `openclaw_runtime/src/agents/verseshell/command-profiles.ts`
  - Attaches the policy to both direct-argv and explicit-shell plans.
- `openclaw_runtime/src/agents/bash-tools.exec.ts`
  - Pushes the static warning into the existing warnings array before the approval wait.
- `openclaw_runtime/src/agents/bash-tools.exec.external-write.test.ts`
  - Verifies `createExecTool` passes the host-owned plan into the existing approval handler and
    preserves the static warning on the existing `exec.approval.request` payload.
- `openclaw_runtime/test/vitest/vitest.verseshell.config.ts`
  - Registers the new focused test file.
- `harness/specs/tasks/verseshell-p3-external-write-policy.md`
  - Defines the scoped contract and required gates.
- `harness/specs/rules/verseshell-external-write-policy-boundary.md`
  - Records the authority, rollback, retry, and redaction boundary.

## Verification

| Gate | Result |
|---|---|
| `pnpm harness context --spec harness/specs/tasks/verseshell-p3-external-write-policy.md` | exit 0 |
| `pnpm harness validate --spec harness/specs/tasks/verseshell-p3-external-write-policy.md --since HEAD` | exit 0 |
| Focused policy and approval-wiring tests | 2 files / 39 tests passed, exit 0 |
| Inbox/approval focused renderer tests | 2 files / 8 tests passed, exit 0 |
| `vitest.unit-fast.config.ts` | 67 files / 502 tests passed, exit 0 |
| Full `vitest.verseshell.config.ts` | 21 files / 221 tests passed, exit 0 |
| `pnpm --dir openclaw_runtime tsgo:core` | exit 0 |
| `pnpm run typecheck:node` | exit 0 |
| `pnpm run i18n:lint` | exit 0 |
| Targeted `oxlint --type-aware --type-check` | exit 0 |
| `pnpm run build:vite` | exit 0 |
| `pnpm build:runtime` | exit 0 |
| Chat/Inbox E2E (`chat-tool-ui-execution-surfaces` + `fakecoding-inbox-navigation`) | 3 tests passed, exit 0 |
| Workspace Git audit focused E2E | 1 test passed, exit 0 |
| Workspace Git full E2E | 2/3 functional flows passed; 1 existing screenshot drift |
| `pnpm run comms:replay` | exit 0 |
| `pnpm run comms:compare` | PASS |
| `git diff --check` | exit 0 |

`pnpm --dir openclaw_runtime tsgo:core:test` was also attempted as a non-required diagnostic. It
still exits 1 on pre-existing unrelated test typing debt elsewhere in the runtime; the touched
files are covered by the passing targeted type-aware oxlint run above.

## Gate Repair

The full VerseShell suite initially reported the two documented pre-existing
`SessionAdmissionIdentityError` failures in `governed-exec-runtime.test.ts`. The test helper now
supplies the required lifecycle `agentId`, restoring the intended missing-contract assertions;
the full suite is green again.

## Adversarial review repair (2026-09-03)

An independent review of the first slice found the engineering gates green but the classifier
unsound. Two classes of command reached `effectLevel: "none"` while executing arbitrary code, and
four narrower defects were confirmed. Every expectation below was measured against real
git 2.51.0.windows.1 and ripgrep 15.1.0 rather than inferred from documentation.

### Blocker 1 — `git config` write actions classified as read-only

`--show-scope` was in the read-only action set and the config gate only inspected `rest[0]`, so
`git config --show-scope --add <key> <value>` was `none`. Real git rejects `--list`/`--get`
combined with `--add` (exit 129) but accepts `--show-scope`, so a read flag in the leading position
could never vouch for the invocation. Two such commands chained to code execution:

```
git config --show-scope --add diff.external <payload>   → exit 0, key written
git diff                                                → payload executed
```

The gate now scans the whole post-subcommand region, enumerates write actions explicitly
(`--add`, `--unset*`, `--replace-all`, `--remove-section`, `--rename-section`, `--edit`, and the
git ≥ 2.46 `set`/`unset`/`edit` subcommand spellings), rejects any unrecognized flag, and drops the
bare `git config <name>` read form because it is one positional away from a write.

### Blocker 2 — any executable named `git` skipped the script check

The Git branch returned before `isScriptPath` ran, so `C:\evil\git.cmd status` was classified
`profile=git`, `effect=none` — while the same plan carried `interpreterProfile: "windows-cmd"`,
meaning the host knew it was handing a batch file to `cmd.exe`. Script identity is now decided
before any profile branch, keyed on the resolved script, the audited interpreter profile, and the
operator's own token.

### Four further defects

- **No trust anchor on the executable path.** `C:\evil\grep.exe` inherited the read-only allowlist
  from its basename. The plan now carries `sourceExecutable` — the operator's pre-resolution token —
  and a read-only claim requires a bare command name whose basename still matches after host PATH
  resolution. Verified against the real PATH: `rg pattern` resolves to an absolute path and keeps
  its claim, while `C:\evil\rg.exe pattern` does not.
- **`rg --hostname-bin=<cmd>` executed a command while classified `none`.** ripgrep 15.1 accepts a
  `COMMAND` value on two flags, not one; both are now write-capable.
- **Twelve genuinely read-only Git forms were mislabeled `external-write`**, including
  `git rev-parse --git-dir`, `git branch --list <pattern>`, and `git tag -l <pattern>` — the
  workspace Git panel's own core flows. Global-flag scanning is now scoped to the pre-subcommand
  region (`--git-dir=` before a subcommand retargets the repository; after `rev-parse` it is that
  subcommand's read-only argument), and ref listing admits a positional only as an explicit list
  pattern so `git branch <name>` still classifies as a write.
- **`stripSensitiveApprovalDetails` left `requestHash` intact.** That field is built from the
  request (`${cwd}:${command}`, `${path}:${bytes}`, `${method}:${params}`, git action plus args), so
  it re-admitted exactly the content the other deletes removed. The shipped guard test passed only
  because its fixture omitted the field; both fixtures now carry a production-shaped value.

### Engineering hygiene

`command-profiles.ts` had grown to 545 lines against the repository's 500-line `check:loc` bound
(HEAD was 498). Profile bound definitions moved to `command-profile-definitions.ts` and the Git
predicates to `external-write-git.ts`, re-exported so no caller changed. All four files are now
under the bound and none appears in the `check:loc` offender list.

### Repair verification

`external-write-policy.identity.test.ts` adds 92 focused cases. Each fix was probed by reverting it
in isolation and confirming the intended cases fail: config gate 8 red, script ordering 3 red,
trust anchor 6 red, `--hostname-bin` 2 red, global-flag scope 1 red, ref listing 15 red,
`requestHash` 1 red. All restored green.

| Gate | Result |
|---|---|
| `harness context` | exit 0 |
| `harness validate --since HEAD` | exit 0 |
| Full `vitest.verseshell.config.ts` | 22 files / 313 tests passed, exit 0 |
| `vitest.unit-fast.config.ts` | 67 files / 502 tests passed, exit 0 |
| Renderer approval/inbox tests | 2 files / 8 tests passed, exit 0 |
| `tsgo:core` | exit 0 |
| `typecheck:node` / `typecheck:web` | exit 0 / exit 0 |
| `contract:check` | exit 0 |
| `i18n:lint` | exit 0 |
| Targeted type-aware oxlint + changed-file ESLint | exit 0 |
| `build:vite` / `build:runtime` | exit 0 / exit 0 |
| Chat + Inbox E2E | 3 tests passed, exit 0 |
| Workspace Git E2E | 2/3; remaining failure is the pre-existing `ai-commit-card` screenshot drift |
| `comms:replay` / `comms:compare` | exit 0 / PASS |
| `git diff --check` | exit 0 |

Two corrections to the earlier record. The `ai-commit-card` drift measures **214 pixels, ratio
0.01** — the previously recorded 617 was wrong, though the ratio matches — and it is causally
independent of this task: the diff does not touch test 1, which owns that assertion, and the
baseline PNG is unmodified. Separately, the full VerseShell suite's green count is not fully
reproducible — `process-manager.test.ts`'s handshaking case asserts state after `setTimeout(…, 0)`
against a 100 ms handshake timeout, so it fails intermittently under load. That is a pre-existing
race; the new files only perturb scheduling order.

### Residual

The reachability disjunction the review surfaced is recorded rather than closed: no host or renderer
code reads `externalWritePolicy`, and the only ClawX producer of `risk: 'external-write'` is
out-of-workspace `files.writeText`. So the renderer redaction and the runtime classifier currently
cover disjoint command populations. That is the slice boundary this task declared, but the earlier
STATUS.md and evidence wording implied a single mechanism; the wording is corrected above. Wiring
the runtime classification through to the ClawX approval surface belongs to the remaining
external-write coverage work, not to this repair.

## Renderer-side repair (2026-09-03)

A second independent review examined the renderer half and confirmed the disjunction above by
enumeration, plus four defects that follow from it. All four are fixed.

### The disjunction, proven by enumeration

`approval.updated` has exactly two emitters, both in
`embedded-agent-subscribe.handlers.tools.ts`, both on the runtime exec approval path. The ClawX
permission store that `PendingRunApprovals` renders has exactly seven writers, all Electron service
APIs (`clawgraph`, `files`, `gateway`, `git`, `system`, `terminal`, `web-preview`), and none of them
emits a runtime event. The `approval.updated` payload has no `risk` field at all. So the runtime
classification and the UI `risk` field share a string and nothing else, and no command this task
classifies can reach the ClawX approval card.

### Four defects that followed from it

- **The only in-app rendering of the runtime warning was being deleted.** The exec `warningText` —
  which is where VerseShell's static no-rollback notice lands — reaches the renderer as
  `approval.updated.message`, and `task-visualization.ts` puts it on that event's graph row as
  `detail`. `run-surface-promotion.ts` then dropped every approval row unconditionally, on the
  premise that an approval card stands behind it. Given the disjunction, no card does. The rule is
  now conditional: a row carrying a message is kept, a bare label is still dropped.
- **Three panels read `approval.reason` raw** (`WorkspaceGitPanel`, `WorkspaceTerminalPanel`,
  `RolesOrchestrationPanel`). The external-write reason is the one that embeds `workspace.rootPath`
  verbatim (`workspace-permissions.ts` FP-P1-02). All three now read through
  `approvalDisplayDetails`. `PendingRunApprovals` had the same shape behind a positional ternary
  guard; it now reads through `display` so reordering the branches cannot reintroduce the leak.
- **Severity was inverted.** `external-write` rendered in the neutral card variant and the amber
  badge bucket, while `dangerous` — which *is* journal-covered, and therefore recoverable — got
  destructive red. A new `isIrreversibleApproval` predicate groups external-write with the
  destructive risks in both surfaces.
- **`projectApprovalSurface` and `RunApprovalSurface` were dead**: zero callers repo-wide, verified
  by full-tree grep. The diff routed the projector through `approvalDisplayDetails`, which read as
  hardened approval surface in `touchedAreas` while having no product effect. Both are deleted.

### Repair verification

`tests/unit/approval-redaction-contract.test.ts` (17 cases) guards the contract where it actually
broke — at the call sites. It reads the six renderer sources and fails on any raw read of a
request-derived field, because a unit test of the helpers cannot catch a surface that bypasses them.
Probes: raw reason in the Git panel 1 red, in the terminal panel 1 red, in the roles panel 1 red,
severity inversion 1 red, unconditional row drop 1 red, `requestHash` restored 1 red, predicate
collapsed to external-write-only 1 red. All restored green.

| Gate | Result |
|---|---|
| `harness context` / `validate --since HEAD` | exit 0 / exit 0 |
| Focused renderer tests (redaction contract, approvals, promotion, inbox, status rail) | 5 files / 43 tests passed, exit 0 |
| Full `vitest.verseshell.config.ts` | 22 files / 313 tests passed, exit 0 |
| `tsgo:core` / `typecheck:node` / `typecheck:web` | exit 0 / exit 0 / exit 0 |
| `contract:check` / `i18n:lint` | exit 0 / exit 0 |
| Changed-file ESLint | exit 0 |
| `build:vite` / `build:runtime` | exit 0 / exit 0 |
| Chat + Inbox E2E | 3 passed, exit 0 |
| `workspace-preflight-fp-p1-02` E2E (owns the FP-P1-02 reason assertion) | 1 passed, exit 0 |
| Workspace Git E2E | 2/3; pre-existing `ai-commit-card` drift |
| `comms:replay` / `comms:compare` | exit 0 / PASS (all metrics, 0.00% delta) |
| `git diff --check` | exit 0 |

`tests/unit` as a whole had 17 pre-existing failures at the time of this pass. Nine further failures
that were environment-dependent rather than pre-existing are repaired in the next section.

## Unit-suite isolation repair (2026-09-03)

Running `tests/unit` in full for this package surfaced nine failures across five files that had
nothing to do with external-write classification but that made the suite's result depend on the
machine. They are repaired here because a package that cannot state its own baseline cannot claim a
gate; the deviation is recorded rather than folded into the classification narrative.

- **`chat-knowledge-scope` (7 failures) and `chat-api-workspace-fingerprint` (4).** `sendWithMedia`
  gates on persisted session usage before reaching the Gateway, and the real reader walks
  `~/.openclaw` transcripts. This machine's cumulative usage is 8,990,004 tokens against the
  1,000,000-token default, so every send was rejected as `TOKEN_BUDGET_EXCEEDED` before any metadata
  was built — these files passed only on a machine below the budget. Both now mock
  `@electron/utils/token-usage`, matching `chat-resource-limits-p5-004.test.ts`, which owns the
  budget behaviour itself.
- **`file-preview-body` and `use-session-status-failure-states` failed collection**, not assertion:
  their `vi.mock` factories closed over module-level `const` mocks, which hoisting places after the
  factory (`Cannot access 'dialogMessageMock' before initialization`). Converted to `vi.hoisted`, the
  idiom 124 other files in this suite already use.
- **`chat-save-to-knowledge`** mocked `useArtifactPanel` as a selector function only, but Chat also
  calls `useArtifactPanel.getState()` imperatively in three places, so the component threw. Now uses
  the `Object.assign` shape the sibling Chat tests use.

After these repairs `tests/unit` is 800 files / 7121 tests passing with 17 files still failing. Every
one of those 17 was verified untouched by this branch, and the three that could plausibly have been
caused by the promotion change (`chat-render-reachability`, `chat-question-directory`,
`first-product-claims`) fail identically with that change reverted — measured, not assumed. They
are pre-existing baseline debt outside this package's ownership.

## Boundaries

- No default-on, `liveReady`, `productApproved`, or `defaultOn` change.
- No new config leaf, feature flag, dependency, renderer component, or Electron E2E surface.
- No automatic replay of effectful requests.
- No native, MCP, or legacy fallback.
- No claim that external process writes are journal transactions or automatically recoverable.

## Closeout (2026-09-03)

`TF-0068` is `done` at 100%. `TFP-TF-0068-closeout-20260903` is saved and applied; Task Forest
`validate` and `export` pass.

The node's three acceptance criteria hold on the command population it declared. Representative
compiler, script, Git-hook, and terminal-shell cases are classified and covered by focused tests
(92 identity cases plus the original 39). The UI confirmation and audit projection carry no command,
path, parameter, or reason content for an external write, guarded at the six call sites rather than
only in the helper. Rollback-claim false positives are structurally zero: `rollbackClaim` is typed
`false`, so a true value is unrepresentable, and both plan construction paths resolve the policy.
The three success metrics hold on the same population, and no effectful request is replayed.

Two residuals are recorded with the closeout (`TFD-tf0068-closeout-residuals-20260903`) rather than
absorbed into it:

- `workspace-git-panel` E2E is 2/3 on the 214-pixel `ai-commit-card` screenshot drift, shown
  causally independent by diff inspection — the assertion lives in test 1, which the diff does not
  touch, and the baseline PNG is unmodified.
- `tests/unit` carries 17 pre-existing failing files. Each was verified untouched by this branch,
  and the three that could plausibly have been caused by the promotion-table change fail identically
  with it reverted.

Also recorded: the ClawX permission store keeps raw request fields as the record of source, and
redaction happens in the render projection. That is the existing FP-P1-02 storage behaviour and is
what the spec's forbidden-pattern list governs ("警告或审计投影"). Narrowing the record of source
itself would need its own task, since approval decisions read those fields.

The declared slice boundary is unchanged and is carried by the pre-existing `TF-0056` deviations:
other host and plugin write entry points are uncovered, and the runtime classification is not wired
to the ClawX approval surface, so "undeclared external write = 0" does not yet hold repository-wide.
`TF-0069` / VS-P5-01 stays `proposed`; this closeout does not unlock it.

## Cross-plane metric retired — decision, 2026-09-19

The slice boundary recorded above is now a **decided product position**, not an open gap. Recorded
in response to issue #41: the runtime exec-approval plane and the ClawX host permission store stay
disjoint, deliberately.

- **The repository-wide metric "undeclared external write = 0" is retired.** It measures a
  cross-plane property this boundary does not provide, so it could never be satisfied while the
  boundary holds. It is replaced by a plane-scoped statement: *within the ClawX host permission
  plane, the only producer of `risk: 'external-write'` is the out-of-workspace `files.writeText`
  classification in `electron/services/workspace-permissions.ts`.*
- **Option (a) is rejected.** Bridging `externalWritePolicy` into the ClawX approval store would
  produce two approval systems for one command, which
  `harness/specs/rules/verseshell-external-write-policy-boundary.md` forbids ("the existing OpenClaw
  exec approval pipeline is the only authorization surface").
- **Option (b) — a display-only projection — shipped.** The runtime's classification reaches the
  renderer as data, with no decision affordance attached:
  - `shared/chat-runtime-events.ts` — `risk?: 'external-write'` on the `approval.updated` payload
  - `electron/gateway/chat-runtime-events.ts` — read across the runtime boundary
  - `src/pages/Chat/task-visualization.ts` — projected onto the graph step
  - `src/pages/Chat/ExecutionGraphCard.tsx` — badged (`chat-execution-step-external-write`)

**Verified:** the projection renders both ways under unit test. **Not verified end to end:** the leg
only fires for a governed VerseShell exec, which is default-off, so no production or test path emits
the event. This document therefore makes no claim that the projection has been observed on a real
command, and the acceptance criterion in issue #41 is **retired rather than met**.

What this does not change: no rollout lock, no authorization boundary, no second approval channel,
no new journal, undo stack, feature flag, or config leaf. The OpenClaw exec approval pipeline remains
the sole authorization surface, and the runtime's static no-rollback warning text still renders only
on its graph row.
