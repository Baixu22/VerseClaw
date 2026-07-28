# FP-P1-02 evidence — workspace preflight 与权限选择

Date: 2026-07-26.

## Implementation surface

- `electron/services/workspace-preflight.ts` — six-check preflight (exists/readable/
  writable-probe/git/sensitive/disk), judged on realpath; pure decision helpers
  (`isSensitiveWorkspacePath`, `summarizePreflight`) unit-covered.
- `workspaces.preflight` host action (contract + facade + service).
- `src/pages/Setup/WorkspaceStep.tsx` — Setup step: pick → preflight table →
  explicit permission choice (只读 / 受控写入; not-writable folders lock to 只读)
  → create+activate workspace. Complete page shows the workspace + mode.
- Single authority: `syncActiveWorkspaceRootToRuntime`
  (electron/services/workspace-runtime-sync.ts) pins `agents.defaults.workspace`
  to the active profile rootPath on every create/update/switch/delete — the
  gateway agent and the UI now judge the same boundary; cwd/`~/.openclaw/workspace`
  fallback is no longer a second authority once a workspace is chosen.
- Boundary denial now names the boundary (workspace-permissions.ts reason string).

## Unit tests

- `tests/unit/workspace-preflight.test.ts` → 14 passed (decision table, sensitive
  classification, real-fs preflight incl. git/credential-material, `../` traversal
  resolved-first, symlink/junction escape, readOnly/acceptEdits behaviors)
- `tests/unit/workspace-runtime-sync.test.ts` → 6 passed (3 new: root sync writes /
  idempotent / creates chain)
- Pre-existing: workspace-permissions (10) + path-broker-resolved (1) still green.
  Combined run: **3 files / 25 passed** + runtime-sync 6.

## E2E (real Electron)

`pnpm run test:e2e:run tests/e2e/workspace-preflight-fp-p1-02.spec.ts --workers=1`
→ **1 passed (22.7s)** (full log: e2e-output.log)

- System dir (C:\Windows) picked → `setup-workspace-blocked` shown, Next disabled.
- Real folder → checks render ok; controlled-write chosen explicitly; workspace
  activated (`[fp-p1-02-active]` … "permissionMode":"acceptEdits").
- Real host write route: inside write ok (content verified on disk);
  outside write → `approvalRequired`, approval.reason =
  "Write target is outside the workspace boundary (…\workspace); external writes
  require approval"; `../` traversal → same rejection; neither file exists on disk.
- OS folder picker stubbed (cannot be driven headlessly); preflight/creation/boundary
  all real production code.

## G3 scope note (honest boundary)

The live-rejected writes above go through the Electron host write route (the
production path for UI-driven file writes). Gateway-child agent-tool writes ride
the same single workspace authority via agents.defaults.workspace + synced sandbox/
exec-approval config; their live in-loop proof belongs to FP-P1-04 (read→write→
diff→test→undo) and is asserted there.
