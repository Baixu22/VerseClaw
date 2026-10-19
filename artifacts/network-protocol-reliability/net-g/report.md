# Network reliability fault injection (NET-G / TF-0444)

- Candidate: `cb3f3e7cc5949da985cf45d72b4f092cf3138456` (tree `fe8d431eacca3f994605a4693bdf967d77990f66`)
- Generated: 2026-10-19T02:22:29.821Z
- Driven by: agent (no live provider request, no credential)
- Decision: **acceptance-ok** — 8/8 checks passed, 0 failed, 4 unverified

## Checks by plane

| Plane | Check | Faults | Exit | Tests | Status | Log |
|---|---|---|---|---|---|---|
| wire_attempt | wire-retry-budget | retry budget, Retry-After lower bound, physical attempt accounting | 0 | 15 passed / 0 failed | PASS | `logs/wire-retry-budget.log` (`37ec518d4b5f9a71…`) |
| wire_attempt | wire-provider-429-503-breaker | provider 429, provider 503, breaker open fast-fail, half-open single probe, budget refusal non-double-count | 0 | 33 passed / 0 failed | PASS | `logs/wire-provider-429-503-breaker.log` (`2eb82c325a57ecaf…`) |
| logical_turn | turn-gateway-seq-gap-reconnect | gateway disconnect, sequence gap, reconnect resubscribe | 0 | 40 passed / 0 failed | PASS | `logs/turn-gateway-seq-gap-reconnect.log` (`9f6623f07b817633…`) |
| logical_turn | turn-mid-stream-failure | mid-stream provider failure, partial output, client disconnect | 0 | 20 passed / 0 failed | PASS | `logs/turn-mid-stream-failure.log` (`4081cc4c919153d0…`) |
| logical_turn | turn-stream-failure-isolation | failed-attempt tool isolation, typed stream error | 0 | 13 passed / 0 failed | PASS | `logs/turn-stream-failure-isolation.log` (`4d28b17f489de970…`) |
| logical_turn | turn-gateway-provider-deadline | gateway deadline gate, provider request-timeout clamp, spent deadline fail-closed | 0 | 40 passed / 0 failed | PASS | `logs/turn-gateway-provider-deadline.log` (`2b8273d1154bd37e…`) |
| repo_gate | repo-typecheck | type surface drift | 0 | 0 passed / 0 failed | PASS | `logs/repo-typecheck.log` (`007bdaad98d158e0…`) |
| logical_turn | turn-deadline-cancel | host deadline clamp, expired deadline fail-fast, long-action clamp, renderer timeout details | 0 | 28 passed / 0 failed | PASS | `logs/turn-deadline-cancel.log` (`da0a8cc81aedc2a5…`) |

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

`report.json` sha256: `41955a33173f4c6d769042547f0900e0cc8319703de17ca0d8e355de06e8d825` (see `SHA256SUMS`). Unverified checks never count as pass; a failing check keeps TF-0437/TF-0444 open.
