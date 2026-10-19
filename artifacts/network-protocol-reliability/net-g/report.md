# Network reliability fault injection (NET-G / TF-0444)

- Candidate: `368692dbf10fd2e50479788610a34c63c3e9250e` (tree `bde7b7ff65b10bb3c9300da4704f4f02baa15583`)
- Generated: 2026-10-19T01:27:32.819Z
- Driven by: agent (no live provider request, no credential)
- Decision: **acceptance-ok** — 7/7 checks passed, 0 failed, 4 unverified

## Checks by plane

| Plane | Check | Faults | Exit | Tests | Status | Log |
|---|---|---|---|---|---|---|
| wire_attempt | wire-retry-budget | retry budget, Retry-After lower bound, physical attempt accounting | 0 | 15 passed / 0 failed | PASS | `logs/wire-retry-budget.log` (`433f8da298182f55…`) |
| wire_attempt | wire-provider-429-503-breaker | provider 429, provider 503, breaker open fast-fail, half-open single probe, budget refusal non-double-count | 0 | 31 passed / 0 failed | PASS | `logs/wire-provider-429-503-breaker.log` (`84b29cc62df7cc1c…`) |
| logical_turn | turn-gateway-seq-gap-reconnect | gateway disconnect, sequence gap, reconnect resubscribe | 0 | 40 passed / 0 failed | PASS | `logs/turn-gateway-seq-gap-reconnect.log` (`ce4752100bacb76f…`) |
| logical_turn | turn-mid-stream-failure | mid-stream provider failure, partial output, client disconnect | 0 | 20 passed / 0 failed | PASS | `logs/turn-mid-stream-failure.log` (`09e3b6ebc43efce4…`) |
| logical_turn | turn-stream-failure-isolation | failed-attempt tool isolation, typed stream error | 0 | 13 passed / 0 failed | PASS | `logs/turn-stream-failure-isolation.log` (`8f8cb787ffb57fdd…`) |
| repo_gate | repo-typecheck | type surface drift | 0 | 0 passed / 0 failed | PASS | `logs/repo-typecheck.log` (`3a0384804b1ec288…`) |
| logical_turn | turn-deadline-cancel | host deadline clamp, expired deadline fail-fast, long-action clamp, renderer timeout details | 0 | 21 passed / 0 failed | PASS | `logs/turn-deadline-cancel.log` (`55d1c8bd65741690…`) |

## Not verified

- `live-provider-429-503`: no real credential or paid provider request is allowed; 429/503 are injected synthetically
- `gateway-wire-deadline`: TF-0442 keeps the logical deadline as host-request metadata; a gateway/provider wire-level deadline is not propagated yet
- `electron-e2e-disconnect`: disconnect is injected through the loopback HTTP harness, not a packaged Electron run
- `network-pooling-p50`: pooling and P50 latency are owned by TF-0413/TF-0414, not this phase

## Re-run

```bash
node scripts/network-reliability-fault-injection.mjs
node scripts/network-reliability-fault-injection.mjs --check turn-mid-stream-failure
```

`report.json` sha256: `db39df1991c125ed63467a3d1b3a7dbd92a08a3828db4a89961d7cee9cdad7ec` (see `SHA256SUMS`). Unverified checks never count as pass; a failing check keeps TF-0437/TF-0444 open.
