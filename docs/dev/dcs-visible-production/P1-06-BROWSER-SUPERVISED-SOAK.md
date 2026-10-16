# Browser supervised production soak protocol (TASK-P1-06)

## Hard rules

| Rule | Default |
|------|---------|
| Private network | **deny** (`dangerouslyAllowPrivateNetwork` false) |
| Mode upgrade | **user approval required** |
| Production traffic | opt-in supervised only |

## Supervised soak scenarios (minimum pack)

| # | Scenario | Automation |
|---|----------|------------|
| 1 | Private network default false | `default-config-matrix.test.ts` |
| 2 | Mode upgrade needs approval | `packages/versebrowser/tests/agent-browser-runtime-mode.test.ts` |
| 3 | Task persist / restart recovery | `packages/versebrowser/tests/agent-browser-task-service.test.ts` |
| 4 | Vault not_configured vs corrupted | `packages/versebrowser/tests/agent-browser-vault.test.ts` |
| 5 | Host approval workflow + explain | `browser-security-recovery.spec.ts` |
| 6 | Workbench shows real Host session/task/vault meta | `agent-browser-workbench.spec.ts` |
| 7–10 | Public-site human supervised runs | **calendar residual** (operator) |

## Operator public-site residual (optional)

1. Open Agent Browser workbench  
2. Create task for public docs only (no RFC1918)  
3. Approve mode upgrade when prompted  
4. Deny once to verify reject path  
5. Record run JSON under `artifacts/dcs-deep-test-week1/runs/browser-supervised-*.json`

## Exit for this task

- Security defaults + approval/recovery **green** (automated)  
- Private network bypass **0**  
- Human ≥10 public soaks optional residual — **not** required to claim supervised production readiness under opt-in policy  

Last verified: 2026-07-22
