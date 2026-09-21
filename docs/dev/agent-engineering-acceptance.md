# Agent Engineering Acceptance

`Agent Engineering Acceptance` is the repository-local, engineering-only verification protocol.
It gives a machine-readable answer to whether an Executor's committed candidate was independently
reproduced by a Verifier. It does not change any controlled-readiness decision.

## Commands

After the package command aliases are installed, use the following sequence from a clean source
worktree with `NODE_TLS_REJECT_UNAUTHORIZED` unset and no real-provider credentials exported:

```powershell
pnpm acceptance:agent:plan --spec harness/specs/tasks/<task>.md --since HEAD^
pnpm acceptance:agent:run --manifest artifacts/agent-engineering-acceptance/runs/<run-id>/manifest.json --actor executor-agent
pnpm acceptance:agent:verify --manifest artifacts/agent-engineering-acceptance/runs/<run-id>/manifest.json --actor verifier-agent
pnpm acceptance:agent:status
```

`acceptance:agent:full` performs the same plan, Executor, and Verifier sequence. It is not a
shortcut around the gates: a failed, timed-out, skipped, stale, or tampered result is `NO-GO`.
The normal final profile is `full`; the optional fast profile is diagnostic evidence only and can
never set `engineeringAcceptedByAgent=true`.

## Evidence contract

Each run gets its own ignored directory under
`artifacts/agent-engineering-acceptance/runs/<run-id>/`. It contains the manifest, Executor and
Verifier reports, redacted stdout/stderr logs, and any controlled adapter output. Reports use
`agent-engineering-acceptance/v1` and include the candidate commit/tree, task spec/rule/lock
digests, selected coverage, parsed test counts and fixed skip budgets, every command/result/log
digest, non-log controlled-artifact hashes, environment fingerprint, residuals, and the Verifier
decision.

The runner creates a disposable detached worktree for the Executor and a separate one for the
Verifier. Every required gate, including spec-declared `requiredTests`, reruns in that detached
worktree. A source tree that is dirty, no longer resolves to the manifest candidate, has missing
or changed inputs, contains a TLS override or provider credentials, or requests mutation/network
flags is rejected before a gate runs. `commandLine` is scanned for forbidden arguments such as
`--fix`. Countable test commands must declare a fixed skip budget, and parsed counts sum every
Vitest `Tests` segment instead of keeping the largest single number. The root `pnpm test` budget
is `ROOT_UNIT_EXPECTED_SKIPS`, derived from `ROOT_UNIT_SKIP_INVENTORY` in
`scripts/lib/agent-engineering-acceptance.mjs`: one entry per test file whose skips are gated on
an input the acceptance environment deliberately withholds (currently 50 = 49 `DEEPSEEK_API_KEY`
+ 1 `AGENCY_AGENTS_REPO`). A count above the inventory means a capability-gated test was skipped
(for example the 3 file-symlink tests in `skills-symlink-cleanup.test.ts`); fix the host, do not
raise the number. Ignored provision copies
are locked by sha256 and byte length in the plan.

Before either role runs, the validator regenerates the complete gate contracts from the
candidate spec, actual comparison diff, and bound Harness profiles. Removing or reordering a
gate, overriding a command, changing a skip/timeout budget, or omitting a source input remains
`NO-GO` after recomputing manifest digests. `--changed` without `--since` is for diagnostic plans
only; formal runs require an explicit comparison base. The root `lint:check` command enforces
zero errors and the existing maximum of 120 warnings.
When the candidate spec fixes `diffBase`, the selected `--since` must resolve to that same
commit. The manifest stores the resolved commit SHA, so moving a symbolic ref cannot change
the plan's baseline. Selecting an empty diff cannot shrink the required gate set.

Test counts include Vitest segments with only failures/skips, Playwright summaries, and Node
spec/TAP summaries. Todo/not-run cases count as skips, interrupted/cancelled cases as failures,
and Playwright cases that pass after a retry count as passed. A contradictory Vitest total is
rejected. Quoted or `=value` forms of forbidden options are rejected too.
For test runners, report validation also reparses the saved stdout and stderr after verifying their hashes.
The report must match those parsed counts; a rehashed report cannot conceal skipped or failed
tests, or claim test counts when its logs contain no summary. This check runs before Verifier
gates and also applies when the convergence validator reads a final report.
The TF-0009 adapter gets its counts from its required, schema-validated JSON artifact instead.
Its artifact digest, report identity, 30 validated runs, and gate counts must agree; an ordinary
runner cannot opt into this source by changing a report field. Lint/diff commands that name test
files remain checks, while package-manager directory/filter/workspace options preserve test-count
enforcement. CI fetches complete history so the live prerequisite provenance test can inspect its
fixed historical commits rather than depending on a shallow checkout.

`node scripts/rc00-acceptance-bootstrap.mjs <output-dir>` is a negative protocol regression:
the abbreviated one-gate fixture must be rejected before execution. Its successful exit means
that rejection worked; it does not produce engineering acceptance for RC-00.

The full profile begins with `pnpm install --offline --frozen-lockfile --ignore-scripts` in the
temporary worktree. It therefore fails closed if the controlled build image has not already made
the exact dependencies available; it never fetches a dependency during acceptance.

## Boundaries retained

This evidence may say only `engineeringAcceptedByAgent=true`. It never means a task has real
human validation, product approval, controlled use, release approval, default-on permission, or
GA. A task whose Harness spec declares `humanEvidence: required` remains `review_needed` even
when its engineering gates reproduce.

The protocol does not write Task Forest state, promotion state, release state, C1, SEKB evidence,
or product configuration. It preserves `liveReady=false`, `productApproved=false`, and
`defaultOn=false`. The TF-0009 adapter runs its existing legacy suite only inside the disposable
worktree, exports a copy into the current run directory, and rejects any report that claims human
or live evidence or changes a frozen product lock.
