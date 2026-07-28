# DCS Ops Canary Runbook (TF-0009)

> **Scope:** controlled internal use / opt-in canary only  
> **Not:** default-on, liveReady graduation, joint-system GA  
> **Authority:** `docs/dev/dcs-deep-test-week1-kickoff.md`  
> **Profiles:** `artifacts/dcs-deep-test-week1/profiles.json`  
> **OS focus:** Windows (Git Bash / PowerShell / Electron)

## 0. Hard rules (read before any opt-in)

1. Defaults stay **off / fail-closed**. Never flip production constants to "prove usable".
2. SEKB: **human confirm only**; no auto writeback; `cutoverAllowed=false`.
3. Browser: private network **deny**; mode upgrade needs approval.
4. Runtime Memory: **diagnostics-only**; no default inject.
5. Canary / synthetic evidence ≠ live production corpus.
6. Decision vocabulary: **continue | shrink | stop** only. No GA language.
7. No commit/push/PR/publish without explicit user authorization.

**NO-GO → immediate stop:** unauthorized write, unconfirmed SEKB write, private-network reachable, approval bypass, default flip, credential leak.

## 1. One-command preflight

From repo root:

```powershell
pnpm run dcs:ops:preflight
```

Expect: exit 0, prints gate table, hard veto all safe, canary recommendation ≠ `default-on`.

If fail: follow printed **next step** (do not dig only in raw logs).

Manual equivalent:

```powershell
pnpm run dcs:prod-p0:smoke
pnpm run dcs:prod-p0
pnpm run lint:dcs
pnpm run test:dcs
pnpm run p0:accept
pnpm run dcs:canary:c1
pnpm run dcs:corpus:validate
```

Archive summary into `artifacts/dcs-deep-test-week1/day1-gates.json`.

## 2. Profiles (ops table)

| id | opt-in | budget | kill |
|----|--------|--------|------|
| `dcs-coding` | `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1` (+ optional staleWriteGuard) | ≤3 tasks/day, ≤30 min | runbook close 1→6 |
| `sekb-assisted` | SEKB UI/golden path, human confirm | ≤2 tasks, no batch writeback | experienceShadow=false; stop writeback entry |
| `browser-supervised` | Browser workbench, public sites | ≤2 tasks | terminate task; demote mode |

Fill real `roles.owner` / `operator` / `safety` in profiles before L3.

### Enable (dcs-coding example, PowerShell)

```powershell
$env:OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = "1"
# restart gateway/runtime/app so env is visible
# do NOT set patchFlow.default=true
# do NOT change isolation default away from shared
```

### Enable (SEKB)

- Follow `docs/dev/sekb-golden-path.md` if present; otherwise Settings SEKB path.
- Every writeback requires **explicit human confirm**.
- Cancel path must leave **zero** unconfirmed writes.

### Enable (Browser)

- Public docs only.
- Mode upgrade must show approval UI.
- Never target private/RFC1918 ranges for canary.

## 3. Live task recording template

Write `artifacts/dcs-deep-test-week1/runs/<profile>-<yyyyMMdd-HHmm>.json`:

```json
{
  "profile": "dcs-coding",
  "startedAt": "",
  "endedAt": "",
  "operator": "",
  "enableFlags": ["OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1"],
  "taskSummary": "",
  "metrics": { "latencyMs": 0, "tokenIn": 0, "tokenOut": 0, "errors": 0 },
  "privacyOk": true,
  "unauthorizedWrite": false,
  "killed": true,
  "rollbackOk": true,
  "decisionHint": "continue"
}
```

## 4. Kill / rollback order (Windows)

Strict order after any enhanced session:

1. Unset env:
   ```powershell
   Remove-Item Env:OPENCLAW_DCS_CONTEXT_VIEW_TOOLS -ErrorAction SilentlyContinue
   Remove-Item Env:OPENCLAW_DCS_CONTEXT_TOOLS -ErrorAction SilentlyContinue
   ```
2. `staleWriteGuard.enabled=false`
3. `symbolLease.enabled=false`
4. Stop patch-flow callers; ensure `patchFlow.default=false`
5. `worktree.backend=inprocess`; isolation `shared`
6. `routingMemo.shadow=false`; `sekb.experienceShadow=false`
7. Only if journal I/O is the incident: temporarily disable `writeJournal` (loses undo)
8. Restart OpenClaw Gateway / Electron app

Post-check:

```powershell
pnpm run dcs:prod-p0:smoke
```

Confirm packaging `redLines` still safe and baseline chat works.

Record live drill in `artifacts/dcs-deep-test-week1/rollback-drill.json` (set `kind` to `live`, not dry-run).

## 5. Decision after each day

Owner only:

| choice | when |
|--------|------|
| **continue** | metrics acceptable, zero NO-GO, residual plan clear |
| **shrink** | noise/cost high but no safety break — reduce tasks/flags |
| **stop** | any NO-GO or unrecoverable red-line |

Update `artifacts/dcs-deep-test-week1/decision.md` and `summary.json`.

## 6. Windows notes

- Use Windows Node/pnpm for Electron E2E (not WSL-only).
- E2E needs display/session; headless cloud may show dbus noise (harmless for non-UI gates).
- Prefer:
  ```powershell
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/dcs-production-wiring-w5.spec.ts tests/e2e/dcs-prod-p0-settings.spec.ts tests/e2e/sekb-golden-path.spec.ts tests/e2e/browser-security-recovery.spec.ts
  ```
- TLS `NODE_TLS_REJECT_UNAUTHORIZED=0` warnings may appear from local env; do not treat as gate failure unless tests fail.
- Git Bash path if POSIX needed: `C:\Program Files\Git\bin\bash.exe` (not WSL `bash`).

## 7. Fault close checklist (incident)

1. Stop agent turn / browser task immediately  
2. Execute kill order §4  
3. Capture logs (redact secrets) under `artifacts/dcs-deep-test-week1/runs/incident-*`  
4. Set decision=`stop` if NO-GO; else `shrink`  
5. Do **not** "fix" by opening defaults  
6. Escalate owner; keep TF-0006 blocked  

## 8. Forbidden claims in any report

Do not write true for:

- `liveReady`
- `productApproved`
- `readyForDefaultFlagGraduation`
- `default-on` recommendation
- joint-system GA

Canary script already refuses writing `default-on` / `liveReady=true` for C1.

## 9. Related docs

- Production flags/runbook: `docs/dcs-production-p0-runbook.md` (+ zh-CN)
- Week kickoff: `docs/dev/dcs-deep-test-week1-kickoff.md`
- P0 closeout: `docs/dev/component-controlled-rollout-p0-closeout.md`
- TF-0006 blocked status: `artifacts/tf0006-evidence-upgrade/status.json`
