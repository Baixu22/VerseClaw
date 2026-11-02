---
id: admission-seam-migration
title: ADMISSION A4 — E2E seam migration record
type: guide
appliesTo:
  - admission
  - e2e
---
# ADMISSION A4 — E2E seam migration record

- Status: complete (2026-11-02)
- driven_by: agent
- actor: codex/admission-a4
- Scope: TF-0650 (A4) and TF-0663 (A4b)

## Result

All four flat IPC channels that only existed for E2E mocking are now supplied
through `host:invoke` typed seams. `tests/` registers none of them:

| channel | `ipcMain.handle` sites in `tests/` | replacement |
|---|---|---|
| `gateway:status` | 0 | `mockConfig.gatewayStatus` + `publishGatewayStatus` |
| `gateway:rpc` | 0 | `gatewayRpc` / `gatewayRpcByMethod` / `gatewayRpcSequences` |
| `file:stat` | 0 | `mockConfig.fileStat` (path map, `*` fallback) |
| `file:readText` | 0 | `mockConfig.fileReadText` |

`scripts/contract-check-flat-ipc.json` records all four as
`disposition: migrate` with `migration.status: consumers-migrated`
(node TF-0650). `pnpm contract:check` passes.

## What changed in the fixture

Deleted (no longer needed once no spec overrides them):

- `getLegacyOverride`, `originalLegacyGatewayRpc`, `originalLegacyFileStat`,
  `originalLegacyFileReadText`
- the three flat fallbacks inside the `host:invoke` interceptor
- the `gateway:status` flat handler

Added:

- `mockConfig.fileStat` / `mockConfig.fileReadText` — path-keyed maps with `*`
- `mockConfig.gatewayRpcByMethod` — plain method-name keys with `*`
- `mockConfig.gatewayRpcSequences` — per-method response sequences, last repeats
- `mockConfig.gatewayRpcDelays` — per-method delay in ms
- `publishGatewayStatus(app, status)` — pushes `gateway:status-changed`

## Root cause found during the migration

`gatewayRpcByMethod`, `gatewayRpcDelays` and `gatewayRpcSequences` were all
unreachable: the rpc branch was gated on `mockConfig.gatewayRpc` being truthy, so
a spec that supplied only the newer seams silently fell through to the (now
deleted) legacy bridge. Several failed migration attempts were caused by this,
not by the specs. The branch now admits any of its seams.

## Verification

All figures are real Electron runs recorded by this task.

| batch | specs | result |
|---|---|---|
| 1 | chat-cache-guard, chat-file-changes, chat-history-startup-retry | 6 passed |
| 2 | startup-loading-experience, chat-model-picker | 7 passed |
| 3 | chat-agent-effort, effort-intensity-smoke, chat-model-picker-tiers, chat-memory-injection-panel | 10 passed |
| 4 | chat-welcome-hero-fakecoding, chat-welcome-hero-verse-shot, sidebar-session-folders-archive | 10 passed |

Plus: `tests/unit/gateway-events.test.ts` 17 passed; `pnpm contract:check`
passed; `tsgo --noEmit -p tsconfig.test.json` exit 0.

### Not run

`tests/e2e/visual-tune.spec.ts` cannot launch Electron in this environment
(`Process failed to launch!`). The same failure reproduces on the pre-migration
baseline, so it is an environment limit. Recorded as `not-run`, never as a pass.

## Remaining for A5 (TF-0651)

The four handlers still exist in `electron/main/ipc-handlers.ts`, and
`gateway:status` is still in the preload allowlist. Retiring them is A5 scope;
this record only moves them from `freeze` to `migrate`.

