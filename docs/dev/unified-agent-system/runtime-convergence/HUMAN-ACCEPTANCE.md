# Final Human Acceptance

Do not start this document until RC-09 is engineering-accepted and `STATUS.md` says `human_acceptance_pending`.

## Preconditions

- The final manifest and `final-report.json` are present, mutually bound by run/candidate/manifest digest, and green under the RC-09 local validator.
- `liveReady`, `productApproved`, and `defaultOn` remain false.
- The user has selected a real provider, one real channel, a disposable workspace, and a rollback window. If a real channel is unavailable, RC-10 is `blocked`; fixture evidence cannot waive it or permit `done`.
- No credential is copied into this document or an evidence report.

## User Scenarios

| ID | Operation | Required observation |
|---|---|---|
| H-01 | Send a normal desktop task | Context lineage explains selected and omitted sources; task completes normally. |
| H-02 | Trigger the controlled Cron workflow | Desktop Inbox receives one decision; approval produces one effect and one receipt. |
| H-03 | Repeat H-02 through one real channel | The same run/context/effect contract is visible and delivery returns to the origin. |
| H-04 | Restart while approval is pending | Pending state recovers; no effect occurs before approval. |
| H-05 | Restart after the effect completed | Completed effect is not repeated; recovery states what is irreversible. |
| H-06 | Deny, cancel, fork, and hand off | Denial/cancel creates no effect; fork/handoff references prior effects without replaying them. |

For every scenario, record the run ID, receipt IDs, result, recovery observation, and a short user note. Screenshots may be attached outside this document.

## Verdict

The user records exactly one verdict at `artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/human-verdict.yaml`:

```yaml
schema: runtime-authority-convergence-human-verdict/v1
candidate_sha: ""
manifest_sha256: ""
engineering_report_sha256: ""
verdict: accepted | rejected | blocked
accepted_scenarios: []
failed_scenarios: []
notes: ""
decided_at: ""
```

`accepted` is valid only when `candidate_sha` equals the final manifest candidate, `manifest_sha256` matches the final manifest, `engineering_report_sha256` matches the independent Verifier `final-report.json`, `accepted_scenarios` is exactly `[H-01, H-02, H-03, H-04, H-05, H-06]`, and `failed_scenarios` is empty. Only then may RC-10 enter `accepted_work_packages`, a Task Forest closeout proposal be created, and `STATUS.md` transition to `done`. `rejected` returns affected packages to `review_needed`; `blocked` leaves the program at `human_acceptance_pending`. No verdict changes default-on, release, GA, or TF-0006 automatically.

After the user writes the verdict, run `node scripts/validate-runtime-authority-convergence.mjs --phase final --manifest artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json --engineering-report artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/final-report.json --human-verdict artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/human-verdict.yaml`. It must read the manifest, independent Verifier final report, and verdict; recompute both file SHA-256 values and the report's semantic `reportDigest`; require Verifier role, green result, `engineeringAcceptedByAgent=true`, `humanEvidenceRequired=true`, `taskStatusRecommendation=review_needed`, `conclusion.residualHumanEvidence=true`, distinct Executor/Verifier identities, and matching run/candidate/manifest digest; compare the verdict candidate; require the exact six-scenario set and empty failures; and reject any product-lock or promotion change. The validator may verify the user's record; it may not create or edit that record. `done` is forbidden unless this validator passes.
