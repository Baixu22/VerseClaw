# Quantitative Scorecard

| Category | Score | Evidence |
|---|---:|---|
| Replay corpus coverage | 20/20 | All 28 required replay cases covered. |
| Default behavior parity | 20/20 | Flags off, non-invoked, failed, blocked, long-context, and rollback cases keep byte-identical default reviewer prompt. |
| Boundary/no authority | 20/20 | No runtime/tool/security/approval/retry/completion/provider/model/Gateway authority; no default prompt/provider/Gateway transport insertion. |
| Fail-closed + rollback | 15/15 | Missing/invalid result, budget exhaustion, large candidates, empty candidates, prompt-present paths, and every gate rollback fail closed. |
| Diagnostics/leakage proof | 10/10 | Diagnostics identify gate/input/budget/prompt-present causes; sentinel leakage proof passes. |
| Provider/Gateway/comms safety | 10/10 | Provider ordering unchanged; transport/Gateway/renderer scans pass; comms skipped because no communication path was touched. |
| Maintainability/auditability | 5/5 | Handoff records corpus, results, proof matrices, validation plan, scorecard, and synthesis. |
| Total | 100/100 | Replay Proof accepted threshold met. |

## Readiness Decision

Score 100/100 meets the 95-100 Replay Proof accepted threshold and supports recommending the next Cutover Readiness Review phase.

This does not approve production-ready status, default-on AgentMap, or default cutover.
