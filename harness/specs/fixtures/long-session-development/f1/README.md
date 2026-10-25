# F1 cross-restart journey evidence

Source candidate: 504b284ba79fde7bfd32562cfdd10631a5b35a2a (branch codex/long-session-implementation-20261022, tree 693ddf8b44ec5a850e7c12033c1b05a64a949a1d).

- restart-journey-results.json: the six real Electron/Host/Gateway journeys (bind, restart recovery with Task Ledger readback, second-workspace isolation, handoff/fork/compact, revoke/archive with terminal reclaim, delete with late-event refusal), their negative cases, the zero-leak/zero-duplicate claims, and per-route evidence levels.
- host-runtime-receipts.json: the exact host modules and owner readback per journey, plus the observation file hash so the raw run can be re-verified.
- ui-evidence-index.json: which suites are runtime-wiring proof and which are UI-only with IPC mocks. Mocked UI passes are explicitly not counted as runtime evidence.
- verification-receipt.json: acceptance mapping, gate receipt, counts, cleanup and honest limits.

OpenClaw runtime paths are proven by real built Electron + Gateway runs. Native-backend/provider continuity stays unverified because this
environment has no provider credential; that limit is recorded instead of being smoothed over.

All actions are agent-driven (driven_by: agent, actor: codex-long-session-f1). No real-human operation, verdict or data is claimed.
