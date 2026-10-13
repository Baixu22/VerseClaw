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


## Main integration record (2026-10-14, agent-driven)

`codex/p1-telemetry-opt-out-clean` (`3bcea3b08`) was integrated onto `main`
(`5cc931fb4`) preserving main's environment-variable PostHog key
(`VERSE_CLAW_POSTHOG_API_KEY`/`VERSE_CLAW_POSTHOG_HOST`) and main's env-var guard,
which fails closed when no key is configured. Conflicts in `.gitignore`,
`README*.md`, `electron/services/settings-api.ts`, `electron/utils/telemetry.ts`
and `scripts/repository-artifacts.json` were resolved to keep both sides.

| Gate | Command | Result |
|---|---|---|
| Focused suites | `pnpm exec vitest run tests/unit/telemetry.test.ts tests/unit/telemetry-consent.test.ts tests/unit/host-services.test.ts` | 3 files / 51 passed / 0 failed |
| Typecheck (node+web+test) | `pnpm run typecheck` | exit 0 |
| Test typecheck | `pnpm run typecheck:test` | exit 0 |
| Frontend + Electron build | `pnpm run build:vite` | exit 0 |
| Electron E2E | `pnpm exec playwright test tests/e2e/telemetry-consent.spec.ts` | 1 passed / 44.8s |
| Comms replay/compare | `pnpm run comms:replay` && `pnpm run comms:compare` | PASS / 0.00% delta |
| Harness validate/dry-run | `pnpm harness validate`/`run --dry-run --spec harness/specs/tasks/p1-telemetry-opt-out.md` | exit 0 / pass |
| Repository artifact retention | `pnpm run repo:artifacts:check` | passed (17539 tracked paths) |

The Electron E2E drives the real settings switch and asserts the persisted
`telemetryEnabled` host value across opt-out and opt-in. Both the negative control
(`disable()` alone still flushes a queued batch) and the queue-discard assertions
run against the real installed SDK with a synthetic no-network sink; no collector
traffic, real machine identifier or real-human data is used.
