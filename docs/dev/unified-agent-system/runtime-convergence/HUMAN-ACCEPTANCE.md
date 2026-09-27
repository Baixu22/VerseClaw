# Final Human Acceptance

Do not start this document until RC-09 is engineering-accepted and `STATUS.md` says `human_acceptance_pending`.

## Preconditions

- The final manifest and `final-report.json` are present, mutually bound by run/candidate/manifest digest, and green under the RC-09 local validator.
- `liveReady`, `productApproved`, and `defaultOn` remain false.
- The **agent drives the scenarios itself**. Owner policy: the owner performs no human actions and
  supplies no human data (see `AGENTS.md` §Human-in-the-loop policy), so there is no human operator to
  wait for. Pick and operate a real provider, one real channel, a disposable workspace, and a
  rollback window; if the provider credential or channel project is not already available, request
  that resource from the owner **once** and then automate against it.
- If no real channel exists at all, RC-10 is `blocked`; fixture evidence cannot waive it or permit `done`.
- Do not leave RC-10 open merely because "the owner has not given a verdict" — producing the verdict
  is part of this runbook, not a separate human step.
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

Exactly one verdict is recorded at `artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/human-verdict.yaml`:

```yaml
schema: runtime-authority-convergence-human-verdict/v1
driven_by: agent            # agent | human — must describe who actually drove the scenarios
actor: rc10-agent           # the identity that drove them
candidate_sha: ""
manifest_sha256: ""
engineering_report_sha256: ""
verdict: accepted | rejected | blocked
accepted_scenarios: []
failed_scenarios: []
notes: ""
decided_at: ""
```

Under the owner's standing policy the **agent authors this record**, having driven H-01..H-06 itself.
Record that honestly: `driven_by: agent` plus the driving `actor`. Declaring `driven_by: human`, or
omitting it, when no human performed the work is fabricating real-human evidence and is forbidden —
the same prohibition R5 of `task-forest-autoclose-and-roles.md` already carries. What the policy
removes is the *requirement* that a human drive the scenarios, not the honesty about who did.

`accepted` is valid only when `candidate_sha` equals the final manifest candidate, `manifest_sha256` matches the final manifest, `engineering_report_sha256` matches the independent Verifier `final-report.json`, `accepted_scenarios` is exactly `[H-01, H-02, H-03, H-04, H-05, H-06]`, and `failed_scenarios` is empty. Only then may RC-10 enter `accepted_work_packages`, a Task Forest closeout proposal be created, and `STATUS.md` transition to `done`. `rejected` returns affected packages to `review_needed`; `blocked` leaves the program at `human_acceptance_pending`. No verdict changes default-on, release, GA, or TF-0006 automatically.

After the verdict is recorded, run `node scripts/validate-runtime-authority-convergence.mjs --phase human --manifest artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json --engineering-report artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/final-report.json --human-verdict artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/human-verdict.yaml`. It must read the manifest, independent Verifier final report, and verdict; recompute both file SHA-256 values and the report's semantic `reportDigest`; require Verifier role, green result, `engineeringAcceptedByAgent=true`, `humanEvidenceRequired=true`, `taskStatusRecommendation=review_needed`, `conclusion.residualHumanEvidence=true`, distinct Executor/Verifier identities, and matching run/candidate/manifest digest; compare the verdict candidate; require the exact six-scenario set and empty failures; and reject any product-lock or promotion change. The validator may verify the record; it may not create or edit it — the agent that drove the scenarios authors it. `done` is forbidden unless this validator passes.

> **Naming note.** The `human-verdict.yaml` path, the `--phase human` flag, and the
> `humanEvidenceRequired` field keep their historical names; in this repository "human acceptance"
> now means "the acceptance gate that used to need a human operator", and its verdict is
> agent-driven and labelled as such. Renaming them is deliberate follow-up work, not part of RC-10.
