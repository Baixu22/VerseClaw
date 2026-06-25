# Phase 2 Submissions

This directory contains the canonical lane submissions for Phase 2.

Each lane must write exactly one file:

```text
runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/<lane-id>.md
```

Expected lane ids:

- `lane-a-runtime-core-contracts`
- `lane-b-taskloop-event-shadow`
- `lane-c-tool-protocol-shadow`
- `lane-d-context-shadow-adapter`
- `lane-e-evidence-verifier-shadow`
- `lane-f-harness-and-test-wiring`

Lane owners must copy `../submission-template.md` and keep all required headings. Every submission must include an evidence table with these columns:

```text
| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
```

Do not edit another lane's file. Do not edit runtime code, tests, harness specs, package files, or docs outside this handoff package from a lane submission task.

If a lane needs another lane to change, record the issue in that lane's own `Open Questions` or `Handoff Notes`. The synthesis owner reconciles cross-lane conflicts in `../synthesis.md`.

A submission should be marked `needs_revision` when it is missing required headings, lacks evidence, uses the wrong output path, claims behavior without local proof, changes active runtime behavior, or edits another lane's files.
