# UAS-06 Reviewed Real Cohort Runbook

This runbook collects the human-reviewed evidence required to finish TF-0017/UAS-06. It does not
authorize a default-on rollout, product graduation, TF-0006 changes, or the start of UAS-07/UAS-08.

## Preconditions

- An accountable operator has selected a bounded internal cohort and an explicit rollback window.
- The engineering report is current and remains `engineering-only` / `needs-real-canary`.
- Baseline and VerseShell tasks use the same approved task definition and share one `pairedTaskId`.
- The selected VerseShell scope uses the existing operator-owned `tools.exec.host=verseshell` route.
  The model-facing host enum and the approval policy remain unchanged.
- Provider receipts and any raw diagnostics are stored in the approved access-controlled evidence
  location. They are not copied into this repository.

## Capture

1. Run the baseline and VerseShell arms serially. Assign a unique session to each arm and retain the
   pre-run diagnostic sequence number.
2. After each task, collect the `exec.process.completed` diagnostic event from the matching
   `diagnostics.stability` window. The window must have `dropped=0` and the event must show the
   selected host, actual host, lifecycle owner, fallback flag, recovery state, outcome, and duration.
   Do not copy command text, prompt text, session transcripts, output, environment values, approval
   tokens, or credentials into the evidence artifact.
3. Obtain the actual provider usage from a provider response or billing export. Retain the original
   outside the repository and record only its opaque reference, SHA-256 digest, provider/model, and
   exact usage fields in the live observation.
4. Have a reviewer record the observed human recovery minutes for every live observation. For the
   rollback scenario, the reviewer must confirm that the kill switch was engaged and that the prior
   host was restored through an explicit operator configuration change.
5. Enter only the reviewed, low-sensitivity summaries into
   `artifacts/uas-06-single-local-exec-canary/live-observations.json`. The template intentionally
   contains zero observations and is not real evidence.

## Validate

Run the following after the reviewer has completed the input:

```text
pnpm run uas:06:evidence:check
pnpm run uas:06:real-canary
pnpm run uas:06:real-canary:check
```

The first command validates the separate engineering report. The second writes only
`real-cohort-report.json`; it never overwrites the engineering report and never starts a Gateway,
reads a provider key, or runs a provider call. The third detects stale source hashes, altered locks,
or a report that tries to authorize closeout or product graduation.

`real-cohort-report.json` can report `eligible-for-closeout-review` only when the existing
engineering matrix is complete and the live records include a paired baseline/VerseShell task,
actual provider receipts for every live observation, human recovery records for every observation,
and a reviewed successful rollback drill. It is still not an approval to close TF-0017.

## Closeout Boundary

An independent reviewer must inspect the protected source evidence and the generated report. Only
after that review may an operator prepare a Task Forest closeout proposal and ask for explicit
confirmation. Do not infer human review, actual provider cost, soak, ROI, `liveReady`,
`productApproved`, or `defaultOn` from this tooling.
