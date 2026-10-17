# Browser security & task recovery (TF-0005)

> Status: Active (internal canary gate)
> Node: TF-0005 / P0-4
> Date: 2026-07-19

## Goals

Make Agent Browser suitable for **internal canary**, not a capability expansion:

1. **Private network default closed** (fail-closed; TF-0003 matrix)
2. **Mode upgrade requires explicit user approval**
3. **Tasks persist; after restart, status is explainable** (`running` → `interrupted`)
4. **Vault health distinguishes** `not_configured` vs `corrupted` vs `ready` / `encryption_unavailable`

## Defaults (do not flip)

| Surface | Default | Notes |
|---|---|---|
| `browser.dangerouslyAllowPrivateNetwork` | `false` | See `docs/dev/default-config-matrix.md` |
| Runtime mode at open | `normal_restricted` | Actions need upgrade |
| Mode upgrade | requires `userApproval: true` | Downgrade to `normal_restricted` does not |
| SEKB auto writeback | off | Out of scope |
| Unsupervised browsing GA | **NO-GO** | Out of scope |

## Task persistence & restart

- Storage: `<dataDir>/agent-browser/tasks.json` (wired in `electron/services/agent-browser-api.ts`)
- On load: `recoverTasksAfterRestart()` maps ephemeral `running` → `interrupted` with:
  - `statusExplain` human string
  - `recovery.recoveredFrom` / `reason: app-restart-while-running` / `recoveredAt`
  - clears `sessionId` / `runId` (no dangling live handles)
- `retry` accepts `failed` | `cancelled` | `interrupted`
- Approval gate: `waitForApproval` → `waiting-approval`; `approve` → `queued`; `run` while waiting throws

## Mode upgrade gate

```ts
// packages/versebrowser/src/engine/service.ts (embedded module; host route: electron/services/agent-browser-api.ts)
if (targetMode !== 'normal_restricted' && payload.userApproval !== true) {
  throw new Error('... requires explicit userApproval: true ...');
}
```

Host route: `agentBrowser.requestModeUpgrade`

## Vault health

`AgentBrowserVault.health()` returns:

| state | meaning |
|---|---|
| `not_configured` | vault file missing |
| `ready` | readable, credentials array OK |
| `corrupted` | invalid JSON / shape / version (never looks like not_configured) |
| `encryption_unavailable` | OS encryption missing |

Host route: `agentBrowser.vaultHealth`

## Evidence / tests

| Layer | Path |
|---|---|
| Task persist + restart | `packages/versebrowser/tests/agent-browser-task-service.test.ts`; host wiring `tests/unit/versebrowser-task-session-conservation.test.ts` |
| Vault health | `packages/versebrowser/tests/agent-browser-vault.test.ts` |
| Mode approval gate | `packages/versebrowser/tests/agent-browser-runtime-mode.test.ts`; host adapter `tests/unit/versebrowser-host-adapter.test.ts` |
| Private network default | `tests/unit/default-config-matrix.test.ts` |
| Workflow E2E | `tests/e2e/browser-security-recovery.spec.ts` |
| E2E artifact | `artifacts/browser-security-recovery/evidence.json` |

## Verify

```powershell
pnpm --dir packages/versebrowser exec vitest run tests/agent-browser-task-service.test.ts tests/agent-browser-vault.test.ts tests/agent-browser-runtime-mode.test.ts
pnpm exec vitest run tests/unit/versebrowser-task-session-conservation.test.ts tests/unit/versebrowser-host-adapter.test.ts tests/unit/default-config-matrix.test.ts
pnpm contract:check
pnpm run build:vite
pnpm exec playwright test tests/e2e/browser-security-recovery.spec.ts
```

## Residual / non-goals

- No unsupervised browsing GA
- No private-network default-on
- Unacked private-network allow in openclaw.json (dangerouslyAllowPrivateNetwork or allowPrivateNetwork) is **auto-migrated to deny** on sync; canary requires ack/env
- Full live multi-tab workflow automation is out of scope for this node
