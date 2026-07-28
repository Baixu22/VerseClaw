# TASK-P1-06: Browser supervised production soak

| field | value |
|-------|-------|
| **id** | `TASK-P1-06` |
| **milestone** | `M1-productive` |
| **priority** | `P1` |
| **status** | `done` |
| **completionClass** | `accept-with-residuals` |
| **owner** | Claude |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal
Public allowlist tasks repeatable; approval/recovery explainable; private network stays deny.

## Acceptance criteria
- [x] 0 private-network bypass (matrix lock + defaults)
- [x] approval-deny path verified (browser-security-recovery host workflow)
- [x] recovery e2e green + unit restart recovery lock
- [x] supervised automated scenario pack (6 scenarios)
- [ ] >=10 human public-site soaks — **residual** (protocol documented)

## Tests
```text
unit browser/security: 30 passed (4 files)
e2e browser-security-recovery: 1 passed
e2e agent-browser-workbench: 1 passed
```

Evidence: `artifacts/browser-security-recovery/evidence.json`  
Protocol: `docs/dev/dcs-visible-production/P1-06-BROWSER-SUPERVISED-SOAK.md`

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | unit | 30 pass | |
| 2026-07-22 | e2e | 2 pass | security + workbench |
| 2026-07-22 | protocol | done | |
| 2026-07-22 | close | **accept-with-residuals** | private-net deny held |

## Hard locks
- private network default deny
- no default flips
