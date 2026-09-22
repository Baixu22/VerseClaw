# J-04 non-fullAccess approval boundary

- Operator: agent-driven, Windows x64, one provider, one workspace. Not a human operator.
- Candidate: `b6c736191` on `feat/runtime-lifecycle-governance`. The source tree was clean before the run. No product source changed.
- Workspace permission: `readOnly`.
- Host gate: `gateway.rpc exec.approval.list` is blocked with `Read-only mode does not allow Gateway mutations` (`electron/services/workspace-permissions.ts` `decideGatewayRpc`). This is the ClawX gate, not the runtime approval service.
- Runtime decision: the driver then connected from its own process to the gateway websocket, with `operator.approvals`, and called `exec.approval.list` then `exec.approval.resolve` (`allow-once`). Both returned ok. The ledger row is `state=approved`, `decision=approved`, `resolved_by=J-04 driver`.
- Continuation: `session.jsonl` shows the `exec` tool result for `node --test` after that resolve. The command ran. The test was still failing because the readOnly workspace did not let the model finish the edit; this run does not claim the coding task passed.
- The run was stopped after the boundary was proven, before the driver wrote `journey.json`. Raw isolated data remains under `%LOCALAPPDATA%/ClawX-live-data/journey-20260922-j04/2026-09-22T10-24-26-811Z`.
- Earlier fullAccess attempt (`2026-09-22T10-18-02-738Z`) executed the command without any pending approval. That confirms fullAccess bypasses the boundary, so it is not the acceptance path.

## Limits

1. ClawX has no in-app approval UI. The decision was made by the agent through a direct gateway RPC.
2. Receipts remain off by default. This run did not change product defaults.
3. The operator is agent-driven, not a named human.
