# Telemetry consent lifecycle (#129)

## Behavior

- `settings.set`/`setMany`/`reset` apply the persisted `telemetryEnabled` value to the
  existing Main-owned PostHog SDK lifetime immediately; no restart is required.
- Revocation aborts the session's outbound transport, stops accepting new captures
  and discards the disabled client's local queue. Re-enabling creates a new SDK
  lifetime; the discarded queue is never revived.
- A request already handed to the network cannot be recalled; abort is best effort.
- Cold-start opt-out does not construct a client, read a machine identifier or send
  an event. `app_installed`/`app_opened` are reported at most once per process.
- The frozen defaults, collector endpoint and public ingest identifier are unchanged;
  GitHub issue #86 remains a separate policy question.

## Verification

`tests/unit/telemetry-consent.test.ts` exercises the real installed SDK queue through
a no-network sink plus a negative control proving `disable()` alone still flushes an
already queued batch. `tests/unit/telemetry.test.ts`, `tests/unit/host-services.test.ts`
and `tests/e2e/telemetry-consent.spec.ts` cover the host settings entry points and the
visible switch. All runs are agent-driven; no real machine identifier or collector
traffic is used.

## Agent-driven verification record (2026-10-10)

| Gate | Result | Artifact |
|---|---|---|
| Real SDK + synthetic no-network sink (9 cases incl. negative control) | red 2/9 before fix; green 9/9 after | `D:/ClawX-work/p1-telemetry-consent-20261010/red-queued.json`, `green-initial2.json` |
| Focused suite (`telemetry-consent`, `telemetry`, `host-services`) | 41 passed / 0 failed / 0 skipped | `D:/ClawX-work/p1-telemetry-consent-20261010/green-initial2.json` |
| `pnpm run typecheck` (node + web + test) | exit 0 | `D:/ClawX-work/p1-telemetry-consent-20261010/typecheck-full.receipt.json` |
| Scoped ESLint | exit 0 | `scoped-lint.receipt.json` |
| Harness validate / dry-run since `78685beff` | exit 0 | `harness-validate2.log`, `harness-flow2.log` |
| Electron E2E `telemetry-consent.spec.ts` (Node 24.21, real Electron 40.8.4) | 1 passed / 26.6s | `e2e3.receipt.json` |
| `pnpm run comms:replay` / `comms:compare` | exit 0 | `comms-replay.receipt.json`, `comms-compare.receipt.json` |
| Repository artifact retention | passed (18072 tracked paths) | `retention-write2.log` |

The negative control proves the real installed SDK still flushes an already queued
batch after `disable()` alone, so the transport-level revocation in this change is
load-bearing. No collector request, real machine identifier or user data was used.
