# TF-0512 runtime effective capability evidence

- Status: required Agent-driven gates passed
- Actor: `agent:codex`
- Implementation commit: `686ea945296d321f0983abbdf5e313b79e7a42b6`
- Base commit: `857baf3ece4cd223c4ca8a13816b486cb8e575eb`
- Evidence environment: clean detached worktree at the implementation commit

## What the change proves

1. `chat.send` carries the canonical workspace identity through `MsgContext`, `FollowupRun`, embedded-run parameters and the runtime profile scope.
2. The embedded runner refreshes `ModelCapabilityProfile/v1` after prompt hooks and runtime context composition, then appends its bounded text immediately before `activeSession.prompt()`.
3. A runtime ack is trusted only when complete, fresh and matched to the real process gateway generation. Missing, `unknown`, stale or mismatched acknowledgements leave availability and drivers unknown.
4. Tool inventory, runtime states, grants, quarantine, memory, knowledge and driver facts are represented on separate axes. Disabled, degraded, loading, unavailable, expired, revoked and quarantined cases fail closed.
5. Static and effective digests have distinct semantics. Observation-only changes do not alter the effective digest; effective fact changes do.
6. A run-local generation guard rejects a late refresh after a newer generation starts.
7. A fallback profile keeps static dispositions available for audit while every runtime availability and driver fact remains unknown.

## Required gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Focused profile/adapter tests | 25 passed | `01-focused-tests.txt` |
| Full typecheck | passed | `02-typecheck.txt` |
| Host contract | passed | `03-contract.txt` |
| Comms replay | passed | `04-comms-replay.txt` |
| Comms comparison | PASS, no regressions | `05-comms-compare.txt` |
| Targeted ESLint | passed | `06-eslint.txt` |
| Harness validate with real diff | passed | `07-harness-validate.txt` |
| Repository evidence references | PASS, 171 paths | `08-repo-evidence-check.txt` |

## Supplementary full-suite boundary

`pnpm test` was run as an extra broad check. It reached 8,700 passing tests and 13 failures across 7 files. The failures are outside TF-0512: a checked-in VerseGit spec has `lifecycleStatus: planned`, clean-worktree tests lack ignored VerseShell binaries (`resources/bin/win32-x64/ae.exe`), and retained VerseGit closeout/acceptance evidence does not reproduce in this detached checkout. The exact output is retained in `00-full-tests.txt`; this extra run is not claimed as a product-wide pass.

This evidence is automated and `driven_by: agent`; it does not claim real-human evidence.
