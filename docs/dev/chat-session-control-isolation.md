# Chat conversation control isolation

This follow-up audits the frontend state owned by conversation controls. It is
not a claim that every program path is defect-free. Verification is agent-driven.

## Reproduced defects

- The compression dialog and its instructions stayed open after switching
  conversations, even though its action callback now belonged to the new view.
  A pending cache-risk check could also finish after A → B → A and still submit
  compression from the first visit.
- A delayed handoff preparation could open its old draft after the user switched
  conversations, including after returning to the same conversation key. Its
  busy state also disabled the new conversation's handoff action.
- Completion of an old compression operation could overwrite the new
  conversation's controls: the regression observed A's 111-token status replacing
  B's 222-token status. Manual refresh callbacks did not have the cancellation
  guard already present on the periodic effects.
- Completion of an old task-loop upgrade cleared the new conversation's draft.
  A late compression completion could likewise close and clear the new
  conversation's compression dialog, even after its parent discarded the result.

## Repair

The chat page now gives each conversation/agent/workspace visit a distinct
identity. Switching views clears the associated status and handoff UI. Status
refreshes, operation completions and handoff results check that identity before
changing the view. Returning to the same key does not reactivate an older visit.
The existing periodic readers still cancel replaced requests and reload the
new scope.

The composer clears the old compression dialog and instructions. Pending
cache-risk assessments and confirmation toasts are cancelled when their
conversation is left or the composer unmounts. No new transport, store, endpoint
or permission policy was introduced. An operation already sent to Main remains
an operation on its original session; this repair prevents its late frontend
result from changing another conversation's controls.
Composer callers also check their visit generation after awaiting an operation,
before clearing input or closing a dialog.

## Verification and scope

The initial four regression assertions failed on the original source. Existing
chat input and execution-graph tests are retained. The Electron regression holds
A's handoff response, switches through the actual sidebar to B, opens B's own
draft, then releases A. The existing host-call recorder provides a completion
barrier before checking that B's draft remains unchanged.

Raw logs, test JSON and screenshots are retained at
`D:/ClawX-work/chat-session-isolation-20261007/`. The first Electron fixture
attempts lacked complete conversation history/membership and used a derived
title as an identity check; those failures are retained separately. The final
fixture checks the selected sidebar row's actual session key.

README descriptions in all four languages were reviewed; these fixes restore
the existing conversation behavior and do not introduce a new user-facing
feature or change activation/default policies. Native worker crashes,
cross-platform execution, paid providers and installer upgrades are outside
this scoped repair.

### Results on 2026-10-07

- The two targeted unit files passed 94 tests. Seven new cases cover dialog
  reset, late cache checks, cancelling an open confirmation, late compression
  completion, late task-loop completion, stale handoff responses and stale
  control refreshes. The initial four failures and the two additional
  completion regressions are retained as before-fix evidence.
- All four Electron cases passed on a fresh build, including the delayed
  A-response/B-draft case, normal handoff creation, active-run gating and manual
  compression. No retries, forced clicks or timeout increases were added.
- All three uncached TypeScript projects (`node`, `web`, `test`) passed when
  run serially. The initial parallel wrapper failed with the Go compiler's
  `runtime: cannot allocate memory`; that failure is retained, not relabelled
  as a successful invocation. Two new test-fixture type errors were corrected
  before the final serial run.
- Scoped ESLint exited 0 (six existing warnings); comms replay/compare,
  startup budget and task Harness validate/dry-run all exited 0. Startup remains
  1.53 MB and the chat increment 3.17 MB under their unchanged limits.
- Structured autoreview's final pass had no actionable findings. Its two
  completion-caller findings were reproduced with failing tests and fixed.
  The first review-tool invocation failed before producing a review and is
  preserved separately.

Primary current receipts are `verified-*.json`, with counts in
`verified-unit-tests.json` and `verified-electron-tests.json`; review output is
`review-4.json`. These are focused development checks, not a new full-project,
Agent Dev maturity, packaged-installer or release acceptance claim.
