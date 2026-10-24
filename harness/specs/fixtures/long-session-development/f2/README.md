# F2 long-session long-use budget evidence

Source candidate: 9db3a116e10b0bfd063ab0c8e9168dd98c46d4d4.

- long-use-before-after.json: frozen budget versus measured load/switch/compact/continuation P50/P95, fixture bytes, summary keys, long tasks and raw samples.
- rss-and-owner-counts.json: five-minute idle RSS curve for Main/renderer/Gateway, process tree, disk usage, per-session owner attribution and the 50-cycle lifecycle audit counts.
- notification-budget.json: duplicate-completion, no-change follow-up, hidden-UI and bounded paused/expired queue receipts.
- SHA256SUMS: digests of the curated artifacts.

Re-run: node --experimental-strip-types scripts/long-session-long-use-budget-evidence.mjs
Verify: node --experimental-strip-types scripts/long-session-long-use-budget-evidence.mjs --check

All measurements are agent-driven (driven_by: agent, actor: codex-long-session-f2). No real-human evidence is claimed.
