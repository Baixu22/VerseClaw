# Phase 8 — Residual Closure / Continuous Residual Hardening

Tier: M8→residual
Owner: program-governance
Findings: F-SEC-001, F-REL-004, F-DATA-004, F-GOV-002
Dependencies: phase7-continuous-governance

## Objective

Close or formally govern every residual Partial finding left after Phase 0–7,
especially Act-now residuals that would otherwise escape risk-acceptance gates.

## Task list

- P8-001 — Residual Act-now gate + channel secret residual locks — program-governance — F-SEC-001,F-REL-004,F-GOV-002
- P8-002 — Channel secret broker vault for Verse Claw managed credentials — main-boundary — F-SEC-001
- P8-003 — Security capability inventory consolidation for multi-impl residuals — qa-governance — F-REL-004
- P8-004 — Residual re-seal and quarterly residual dimension — program-governance — F-GOV-002,F-DATA-004

## Exit criteria

No unmanaged Partial+Act-now finding; residual register has owners and reviewBy;
channel secret residual path is locked by tests; quarterly audit includes residual gate.

## Phase rule

STATUS.json.phaseStatus=done only when every task status=done.
