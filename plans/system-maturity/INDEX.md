# System Maturity Index

| Phase | Tier | Owner | Findings | Dependencies | Status |
|---|---|---|---|---|---|
| phase0-foundation | M0→M1 | program-governance | F-GOV-001, F-GOV-002, F-GOV-003, F-REL-004 | none | done |
| phase1-direct-boundaries | M1→M2 | main-boundary | F-SEC-001, F-SEC-002, F-SEC-003, F-SEC-004, F-SEC-005, F-SEC-006, F-SEC-007, F-SEC-010 | phase0-foundation | planned |
| phase2-authorization-isolation | M2→M3 | runtime-auth | F-AUTH-001, F-AUTH-002, F-AUTH-003, F-AUTH-004, F-AUTH-005, F-AUTH-006, F-ISO-001, F-ISO-002, F-REL-003 | phase1-direct-boundaries | done |
| phase3-data-authority | M3→M4 | data-governance | F-DATA-001, F-DATA-002, F-DATA-003, F-DATA-004, F-DATA-005 | phase2-authorization-isolation | done |
| phase4-runtime-surfaces | M4→M5 | runtime-surfaces | F-AUTH-008, F-AUTH-009, F-SEC-007, F-REL-003, F-DATA-004 | phase2-authorization-isolation, phase3-data-authority | done |
| phase5-reliability-abuse | M5→M6 | reliability | F-REL-001, F-REL-002, F-REL-005, F-UX-001, F-GOV-001 | phase0-foundation, phase2-authorization-isolation | done |
| phase6-supply-release | M6→M7 | supplychain-release | F-SUPPLY-001, F-SUPPLY-002, F-GOV-003 | phase0-foundation, phase5-reliability-abuse | planned |
| phase7-continuous-governance | M7→continuous | program-governance | F-GOV-001, F-GOV-002, F-GOV-003, F-UX-002 | phase6-supply-release | planned |

## Completion rule

A phase is complete only when every task in its STATUS.json is done and every task acceptance has evidence.
