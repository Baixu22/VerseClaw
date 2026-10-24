# E1 long-session follow-up scheduling evidence

Source candidate: 41c0cbd9a138ab333c24a813fab85cc1591fafec (branch codex/long-session-implementation-20261023-r2).

- followup-schedule-receipts.json: the real Electron/Host/Gateway journey — bind a follow-up to one coordinator generation, watch the fence state, refuse a stale run, then separate pause from cancel.
- pause-cancel-expiry-matrix.json: the scope matrix (unbound/malformed/expired/archived/deleted/reset/invalidated/unresolvable/current), pause vs cancel vs stop semantics, expiry/replay rules and the goal-wake/durable-helper default-off boundary.
- verification-receipt.json: acceptance mapping, gate receipt, counts, cleanup and honest limits.

The delivery-time fence lives in the runtime cron service; the workspace binding stays in Electron and the maintenance pass suppresses (never deletes) a stale schedule.
All actions are agent-driven (driven_by: agent, actor: codex-long-session-e1). No real-human verdict or data is claimed.
