---
id: execution-environment-migration
title: Continue one task and conversation in another execution checkout
type: scenario
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - runtime-lifecycle-governance-boundary
---

1. The user opens the existing Chat work controls, chooses a configured target workspace and starts migration. Names and task progress remain the normal navigation surface.
2. Workspace persists one operation ID and request digest. The original session key, task contract revision, source generation, checkpoint and artifact references are recorded before closing source admission.
3. Existing runtime and resource owners stop new effects and prove the source drained. Pending or unknown effects retain the operation and its recovery reason. Only verified task and checkout authority can reserve the target.
4. Runtime records the session migration in its existing mutation journal. Transcript copying preserves the source; session generation/root replacement and store-committed state are atomic. The target remains prepared until task handoff and receiver readback are confirmed.
5. TaskSystemStore hands the same task to the new generation and checkout. The target binding remains paused until the receiving side reads the expected contract, checkpoint artifacts and zero unresolved operations.
6. Confirmation opens the target and publishes Workspace ownership together. The original generation stays fenced. A lost reply or restart resumes the same operation and does not create another conversation or task.
7. Same ID with another request rejects; stale source or changed artifacts remain recoverable errors. Closing the window or navigating elsewhere does not rename, complete or silently recreate the task.
8. UI exposes saved progress and resume in all four locales. Automation records the actual owner receipts and actor, including failures and restart recovery.

Publication keeps the target reservation until the active binding and confirmed operation are durable. Reservation settlement is recorded separately so a window restart can resume that final step. Replay never releases a later writer. An expired target claim is renewed through the existing task handoff only after the same task, generation, contract and resource drain are verified. Checkpoint artifact paths remain anchored to their source checkout.
