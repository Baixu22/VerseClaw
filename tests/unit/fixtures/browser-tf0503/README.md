# TF-0503 Browser supervised task capability

- Task: `TF-0503` - make Browser a natural supervised task capability
- Actor: `codex` | Evidence driver: `agent`
- VerseGit scope: excluded
- Release boundary: no public release, GA, liveReady or productApproved claim

## What changed

| Area | Change |
|---|---|
| `shared/agent-browser/private-network-policy.ts` | New default-deny classifier: loopback, RFC1918, link-local (incl. 169.254.169.254), IPv6 loopback/ULA, and local names are non-public. Private navigation needs a bounded approval or the host own running preview origin (loopback only). |
| `electron/services/agent-browser-api.ts` | The host adapter now calls `assertBrowserNavigationAllowed` for `open`/`navigate`/`createTask`, resolves first-party preview origins from Main-side workspace state (never the payload), registers the shutdown reaper, and closes every live session on quit. |
| `electron/services/agent-browser-capabilities.ts` | The snapshot now declares `supervision: "required"` and marks each action supervised/unsupervised; supervised-ness is part of the snapshot digest. |
| `tests/e2e/browser-supervised-task-tf0503.spec.ts` | Real Electron run (unmocked `host:invoke`): supervised self-description, 5/5 private refusals by the guard reason, public navigation not guard-blocked, reaper registered. |

No new global switch was added. `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork` and every
other product default are unchanged.

## Acceptance mapping

| Criterion | Status | Evidence |
|---|---|---|
| Real Electron path can start a Browser task from Chat/Workspace | pass | `02b-electron-real.txt`; `raw-evidence.json#realElectronPath` |
| Private network default deny, approval bypass = 0, no unauthorised egress | pass | `01-guard-unit.txt`, `02b-electron-real.txt`, `08-navigation-guard-wired.txt` |
| No orphan session after cancel / timeout / restart | pass | `01-guard-unit.txt`; `02b-electron-real.txt` (will-quit listener present) |
| Model states Browser needs supervised permission | pass | `02b-electron-real.txt` (`supervision=required`, 19 supervised actions) |

## Gates

All ten gates pass (`verification.json`): guard unit, browser regression, real Electron,
typecheck, lint, contract, no-BOM, diff check, wiring audit, scope audit.

## Unverified boundary

- The first-party exception covers loopback origins persisted in the active workspace
  state; it can never cover metadata or RFC1918 ranges.
- The reaper runs on the Electron `will-quit` lifecycle; a hard process kill cannot run it.
- The public-navigation check asserts only that the private-network guard is not the
  refusing layer; real page loads are covered by the pre-existing browser E2E suites.
- Agent-driven only; no human evidence is claimed.
