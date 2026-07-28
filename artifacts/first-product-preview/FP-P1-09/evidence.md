# FP-P1-09 evidence — ack timeout parameterization

Date: 2026-07-26.

## Measured restart→ack latency (real Electron + real gateway children)

`pnpm run test:e2e:run tests/e2e/dcs-flag-ack-tuning-fp-p1-09.spec.ts --workers=1` → **1 passed (15.6m)**

Five full cycles; every cycle spawns a NEW child process (5 distinct pids ⇒ each is a
child cold start). `ackWaitMs` measured host-side around collectRuntimeFlagAck only
(excludes the restart itself); `totalMs` = save+restart+ack end to end.

```
{"run":0,"ackWaitMs":12729,"totalMs":157382,"generation":"2","childPid":8784}
{"run":1,"ackWaitMs":12671,"totalMs":154147,"generation":"3","childPid":32672}
{"run":2,"ackWaitMs":12412,"totalMs":165494,"generation":"4","childPid":37808}
{"run":3,"ackWaitMs":11709,"totalMs":155921,"generation":"5","childPid":26824}
{"run":4,"ackWaitMs":11633,"totalMs":152337,"generation":"6","childPid":20396}
```

min 11633 / max 12729 / mean 12231 ms. A separate attempt to measure the child
standalone (scripts/measure-flag-ack-latency.mjs) showed the gateway never binds its
port outside the Electron utilityProcess environment — standalone numbers would have
been fiction, so the E2E measurement (the exact production path the timeout guards)
is the recorded dataset. The failed standalone runs are retained in the script for
future diagnosis.

## Margin rule → defaults

- Old: 20s fixed = 1.57× the max measured ack — thin margin on the dev reference
  machine; a modestly slower machine would routinely hit `ack-timeout`.
- New default `DCS_FLAG_ACK_TIMEOUT_MS = 60_000` ≈ **4.7× max measured** — a machine
  ~4× slower than reference still resolves before deadline. Poll starts 250ms and
  doubles to a 4s ceiling.
- Overrides: AppSettings `dcsFlagAckTimeoutMs` / `dcsFlagAckPollInitialMs`
  (0 = defaults; clamped 1s–600s / 50ms–10s so a typo cannot disable the wait).

## Backoff RPC-count comparison (60s silent-child window, virtual clock)

`[fp-p1-09-rpc-count] {"legacyCalls":120,"backoffCalls":19}` — 84% fewer ack RPCs.

## Requery (recover from ack-timeout without re-flipping)

`[fp-p1-09-requery] {"status":"applied","ackWaitMs":130,"generation":"6","childPid":20396}`
Same childPid as cycle 4 and gateway status unchanged ⇒ no restart, no save. UI:
`settings-dcs-flag-ack-requery` button appears on `failureReason === 'ack-timeout'`.

## Unit

`pnpm exec vitest run tests/unit/dcs-flag-ack.test.ts` → **23 passed / 0 failed**
(18 pre-existing FP-P0-04 cases untouched and green + 5 new: tuning fallback/clamps,
RPC comparison, first-poll fast path, mid-backoff ack acceptance).

## Hard-lock check

Timeout semantics unchanged: timeout-while-running is still `pending-restart` and
timeout-while-stopped still `failed` (FP-P0-04 cases 「ack timeout while running…」
「ack timeout with a stopped gateway…」 pass unmodified). No state was promoted to
`applied` by tuning.
