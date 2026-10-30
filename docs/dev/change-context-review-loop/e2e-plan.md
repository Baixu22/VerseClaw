# Change Context Electron acceptance plan

- Actor: codex; driven_by: agent. No real-human evidence is claimed.
- Freeze one source candidate before the acceptance run.
- Run the three tests in `tests/e2e/change-context-review-loop.spec.ts` with
  `--workers=1 --retries=0 --repeat-each=3`: nine executions, zero allowed failures
  or skips. Debug attempts remain separate historical logs; repairs require a
  new candidate and a new complete three-repeat run.
- The first test checks the Electron renderer/IPC with deterministic read-model
  replay and all four locales. The other two tests retain the real Main Change
  Context, comment store, file, Git, permission, Coding journal and Task Ledger
  owners, with the existing VG binding gate off/on respectively.
- Only runtime history/checkpoint facts are scripted. Git repositories, file
  digests, comment freshness/re-anchor, task events, permission consumption,
  successful application, preimages and journal sidecars are real fixture effects.
- Check merge-base, last-commit, last-turn and checkpoint; preserve missing-source
  errors; prove live-to-stale without movement and explicit re-anchor; prove
  request-changes linkage and approve without task completion; prove stale,
  conflicted and unapproved apply leave identical destination bytes, followed by
  one explicit approved journaled apply. VG missing proof stays unmeasured.
- Retain screenshots and final JSON from disk, bind them and the command log to
  the same commit/tree, and hash every retained artifact.
- Use the existing writable low-integrity fixture root on D:, without changing
  application security or filesystem ACLs. Reuse the locally installed Electron
  40.8.4 distribution through the standard override.
- Scope: Windows source-host Electron. No packaged, non-Windows, live-provider,
  external collaboration, stress or publication claim.
