# D1 Written Approval + Agent-Proxy Risk Waiver

**Date:** 2026-07-15  
**Stage:** N3 / D1 Phase C would_trigger (mutation-free evidence only)  
**Authority:** product/tech operator directive in session ("开始执行") after N0 Pass + N2 Pass-D0  

## Approvals recorded

| Item | Status |
| --- | --- |
| Allow D1 would_trigger **implementation / observation** | **Approved** |
| Agent-proxy offline evidence risk acceptance for D1 entry (skip N1 live-human for this stage) | **Accepted** |
| Production capture filtering / default-on / D2 ranking pilot | **Not approved** |

## Scope of approval

1. Implement dedicated default-off Phase C flag `runtime.contextBlock.sekb.phaseCWouldTrigger`.
2. Emit `would_trigger` evidence only (in-process / report / artifact observation).
3. Must **not** mutate trajectory, principle, candidate pool, or capture filter authority.
4. Must **not** read offline artifacts as runtime decision inputs.
5. Shadow V1 threshold remains **50** (no holdout retune).
6. Kill switch = flag/env off; no reverse migration.

## Residual risks accepted for D1 only

- Label origin remains agent dual-review proxy (not live-human dual-review equivalence).
- Kappa optimism and score≥50 discrimination limits from Tier C freeze still apply.
- Session-scoped usefulness metrics are not a production usefulness certificate.

## Sign-off

- Product+Tech: approved via operator execution request 2026-07-15 (Codex session)
- Implementation owner: `sekb-phase-c-would-trigger`
