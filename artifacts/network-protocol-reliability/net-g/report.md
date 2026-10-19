# Network reliability fault injection (NET-G / TF-0444)

- Candidate: `1f7dea8854816aa357337353b8909db57ef47a59` (tree `8bb34151fe6d29d711351736dbd0162e57866ef5`)
- Generated: 2026-10-19T01:59:56.648Z
- Driven by: agent (no live provider request, no credential)
- Decision: **acceptance-ok** — 8/8 checks passed, 0 failed, 4 unverified

## Checks by plane

| Plane | Check | Faults | Exit | Tests | Status | Log |
|---|---|---|---|---|---|---|
| wire_attempt | wire-retry-budget | retry budget, Retry-After lower bound, physical attempt accounting | 0 | 15 passed / 0 failed | PASS | `logs/wire-retry-budget.log` (`ed28596d2de62514…`) |
| wire_attempt | wire-provider-429-503-breaker | provider 429, provider 503, breaker open fast-fail, half-open single probe, budget refusal non-double-count | 0 | 33 passed / 0 failed | PASS | `logs/wire-provider-429-503-breaker.log` (`a5081b5cedc87317…`) |
| logical_turn | turn-gateway-seq-gap-reconnect | gateway disconnect, sequence gap, reconnect resubscribe | 0 | 40 passed / 0 failed | PASS | `logs/turn-gateway-seq-gap-reconnect.log` (`73fd6efb7a52b6c5…`) |
| logical_turn | turn-mid-stream-failure | mid-stream provider failure, partial output, client disconnect | 0 | 20 passed / 0 failed | PASS | `logs/turn-mid-stream-failure.log` (`57fe1fe568c53ac7…`) |
| logical_turn | turn-stream-failure-isolation | failed-attempt tool isolation, typed stream error | 0 | 13 passed / 0 failed | PASS | `logs/turn-stream-failure-isolation.log` (`188045dc42c3f1c8…`) |
| logical_turn | turn-gateway-provider-deadline | gateway deadline gate, provider request-timeout clamp, spent deadline fail-closed | 0 | 40 passed / 0 failed | PASS | `logs/turn-gateway-provider-deadline.log` (`e63cf72c8db8d1f3…`) |
| repo_gate | repo-typecheck | type surface drift | 0 | 0 passed / 0 failed | PASS | `logs/repo-typecheck.log` (`7069286b6dd582f1…`) |
| logical_turn | turn-deadline-cancel | host deadline clamp, expired deadline fail-fast, long-action clamp, renderer timeout details | 0 | 28 passed / 0 failed | PASS | `logs/turn-deadline-cancel.log` (`81dc49a96a4b66fe…`) |

## Not verified

- `live-provider-429-503`: no real credential or paid provider request is allowed; 429/503 are injected synthetically
- `non-chat-gateway-deadline`: TF-0442 propagates the deadline through the chat turn path (chat.sendWithMedia -> chat.send -> provider); other gateway RPC methods and a packaged Electron run are not covered
- `electron-e2e-disconnect`: disconnect is injected through the loopback HTTP harness, not a packaged Electron run
- `network-pooling-p50`: pooling and P50 latency are owned by TF-0413/TF-0414, not this phase

## Re-run

```bash
node scripts/network-reliability-fault-injection.mjs
node scripts/network-reliability-fault-injection.mjs --check turn-mid-stream-failure
```

`report.json` sha256: `f7ca2c5a789de8599e7e0bc65b93c4693f7c4d507be0da12ff0d0c187df5ab9d` (see `SHA256SUMS`). Unverified checks never count as pass; a failing check keeps TF-0437/TF-0444 open.
