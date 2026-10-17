# Gaps — VerseBrowser Acceptance 2026-10-16 (Updated)

## RESOLVED in this session

### ~~Real model browser round-trip (M08)~~ — ✅ RESOLVED
- **Fix**: Use `D:\versebrowser\.local\runtime\node.exe` (v24.16.0) and repo temp directory instead of `D:\tmp`. The model (glm-5.3-flash) successfully completed the full round-trip with all 7 checks true.

### ~~Electron E2E workbench + security-recovery~~ — ✅ RESOLVED
- **Fix**: Root cause was EPERM when Electron creates `.openclaw` in HOME directory under `D:\tmp`. Fixed by setting:
  - `TEMP=D:\ClawX\.tmp\playwright-temp`
  - `CLAWX_E2E_RUN_ROOT=D:\ClawX\.tmp\e2e-root`
  - Using Node 24.16.0 from `D:\versebrowser\.local\runtime`
- **Result**: Both E2E tests pass (15.1s).

## Remaining gaps

### 1. Non-Windows platform
- **Status**: not_run(platform)
- **Reason**: Only Windows was available for this acceptance run.

### 2. Electron peer >=44 vs installed 40.8.4
- **Status**: unknown
- **Reason**: The module's peerDependencies declares electron >=44, but the installed Electron is 40.8.4. Not proven risk-free through a full Electron 44 test.

### 3. NSIS installer/uninstaller interactive execution
- **Status**: not_run(interactive)
- **Reason**: NSIS installer requires interactive desktop/UAC session. Per HITL policy, agent-driven equivalent was used.
