# J-04 non-fullAccess approval boundary

- Operator: agent-driven, Windows x64, one provider, one workspace. Not a human operator.
- Acceptance candidate (run r3): `a8c9f4b69209c0a72c8ca91c8556d10bdabd234f` on `feat/runtime-lifecycle-governance`; `candidate.dirty=false`, `statusPorcelain=""` (`candidate.json`, `journey.json.candidate`).
- Workspace permission: `readOnly`.
- Provider: senseaudio-s2-flash via `https://api.senseaudio.cn/v1`. The key lived only in the driver process environment and was passed through `providers.save` into an isolated temp user-data directory. It is not in this directory (`hashes.json` credential scan: 0 hits).
- Flags: `OPENCLAW_RC02_SHADOW_CENSUS=1` and `OPENCLAW_RC03_SEAL=1`, set only on the Electron process spawned by the driver. Product defaults stay off.

## What the boundary produced (r3, 2026-09-22)

| Step | Evidence | Time (UTC) |
| --- | --- | --- |
| Runtime request | `gateway-events.jsonl` → `exec.approval.requested`, approval `8089e5b5-104d-44a1-9d5d-a9d5b30f3f86`, command `node --test`, `allowedDecisions=["allow-once","deny"]` | 12:22:18.468 |
| ClawX host gate | `approval-boundary.json` → host `gateway.rpc exec.approval.list` returns `blocked: true`, `Read-only mode does not allow Gateway mutations` (`electron/services/workspace-permissions.ts` `decideGatewayRpc`; this is the ClawX gate, not the runtime approval service) | 12:22:08.818 (pre-task probe) and 12:22:25.568 (in-loop) |
| Pending list | direct `exec.approval.list` over the driver's own gateway websocket (`operator.approvals`), `ok: true`, one pending row with the same approval id | 12:22:41.437 |
| Decision | direct `exec.approval.resolve {id, decision: "allow-once"}` → `ok: true`; the `exec.approval.resolved` frame was captured on the listener socket | 12:22:41.818 (call) / 12:22:41.816 (frame) |
| Continuation | `session.jsonl` → `message.toolResult` for `exec` (the `node --test` TAP output) after the decision | 12:22:43.838 |
| Second request | another `exec.approval.requested` for the next gated command | 12:22:52.970 |

The run stopped with `stopReason=approval-boundary-observed` and `boundaryProven=true` after 79 seconds (`journey.json.startedAt` → `finishedAt`). `finished=false`: completing the coding task is not the J-04 criterion — in a readOnly workspace the model cannot finish the edit, so `node --test` fails both before and after (`exitCode=1`).

Receipts for the same run (driver flags only): `runtime_receipts=12`, `v1ContextWirePairs=3` joined on `correlation_digest`.

## Runs kept here

| Run | Local data dir | Outcome |
| --- | --- | --- |
| 1 (partial) | `%LOCALAPPDATA%/ClawX-live-data/journey-20260922-j04/2026-09-22T10-24-26-811Z` | boundary happened, driver stopped before writing `journey.json`; preserved byte-for-byte under `run-1-partial/` |
| 2 (`driver-r2.mjs`) | `%LOCALAPPDATA%/ClawX-live-data/journey-20260922-j04-r2/2026-09-22T12-18-17-779Z` | complete `journey.json` with the boundary proven, but no runtime event capture |
| 3 (`driver-r3.mjs`) | `%LOCALAPPDATA%/ClawX-live-data/journey-20260922-j04-r3/2026-09-22T12-21-39-956Z` | acceptance run: same boundary plus the captured `exec.approval.requested` / `exec.approval.resolved` frames |

Runs 2 and 3 were launched on clean candidates (`e72f02ca6` and `a8c9f4b69`); run 3 is the one folded into this directory. Only the driver (evidence tooling) changed between them; no product source was touched.

## Limits

1. ClawX has no in-app approval UI. The decision was made by the agent over a direct gateway websocket — not through the app, and not through host `gateway.rpc`, which blocks `exec.approval.*` outside fullAccess.
2. Receipts remain off by default. This run did not change product defaults.
3. The operator is agent-driven, not a named human.
4. The r3 listener socket reports `error: "listener socket error"` in `journey.json.gatewayListener`; it had already opened and captured all 32 frames (both requests, the resolve, plus agent/health/presence/tick traffic), so the flag marks socket teardown, not a lost event.

## Verify offline

`hashes.json` covers every file in this directory except itself (24 files, sha256). `run-1-partial/hashes.json` is the first attempt's own 7-file manifest.
