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
Verifier. A source tree that is dirty, no longer resolves to the manifest candidate, has missing
or changed inputs, contains a TLS override or provider credentials, or requests mutation/network
flags is rejected before a gate runs.

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
