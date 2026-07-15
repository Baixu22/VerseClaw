# CODING C1 Live A/B Assessment

**Updated**: 2026-07-15  
**Status**: **BLOCKED** (no live traffic / comms replay env in this closeout)

## What exists

- Simulated three-arm fixtures: `coding-ab-fixtures.ts` (≥10 fixtures, baseline / factstore / mcp_control)
- Gate helper: `evaluateAbGate` (≥3× tool-call reduction + pass-rate parity)
- Remaining ACCEPT records C1-2 sim metrics

## What is missing for live

1. Production or staging session corpus with coding tasks
2. `comms:replay` harness binding for fact-tool vs baseline arms
3. Owner-approved scorecard window and rollback owner
4. Decision to flip `tool-registry` / `working-memory` defaults (still false)

## Decision

- Wave C1 remains **`done (sim)`**
- **No flag flips** in this round