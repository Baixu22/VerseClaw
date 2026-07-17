# CODING Optimization Status (SoT)

**Source of truth for wave completion after 2026-07-15 round closeout.**  
Rules:
1. Status may only flip to `done` when DEV + TEST + ACCEPT evidence exists.
2. `done` must include a **Completion class**.
3. `done (sim)` / `done (interface)` are **not** production-hard defaults.
4. **C0閳ユ弲3 implementation authority is `main`** (landed via dcs C0/C1/C2/C3 branches). This worktree must not re-land parallel C0閳ユ弲3 rewrites.
5. This round's unique land is **C4閳ユ弲7 residual + C1 sim fixtures + flag/obs extensions**.

**Updated**: 2026-07-15 (Round closeout on main base)  
**Codebase**: `ClawX-context-coding-wt/openclaw_runtime`  
**Plan**: [reports/CODING-CLOSEOUT-PLAN.md](../reports/CODING-CLOSEOUT-PLAN.md)

### Completion class legend

| Class | Meaning |
|---|---|
| `done (loop)` | DEV + TEST + ACCEPT; production wiring basically usable (safe defaults may still apply) |
| `done (sim)` | Simulated / fixture evidence only |
| `done (interface)` | Protocol/structure-level proof; not production-hard |

## Wave status

| Wave / Card | Status | Completion class | Authority / Evidence |
|---|---|---|---|
| **C0 wave** | **done** | `done (loop)` | **main** 閳?`artifacts/coding-c0/*`, `context-agent-tools`, WFS |
| **V-1 D2/SEKB** | **done** | `done (loop)` | **main** harness + producer |
| **C1 wave** | **done** | `done (sim)` | **main** wiring + this wt `coding-ab-fixtures` / remaining ACCEPT; live A/B **blocked** |
| **C2 wave** | **done** | `done (loop)` | **main** 閳?`artifacts/coding-c2/*` |
| **C3 wave** | **done** | `done (loop)` | **main** 閳?`artifacts/coding-c3/*`; planner fill=**partial** |
| **C4 worktree isolation** | **done** | `done (loop)` | this wt 閳?`worktree-service.ts`; default **inprocess** |
| **C5 symbol lease + patch-flow** | **done** | `done (loop)` | this wt 閳?`symbol-lease.ts` / `patch-flow.ts`; default **memory**, patchFlow.default **false** |
| **C6 context ladder** | **done** | `done (hard-gates+recorded)` | Goal B B1 — flip decision pack + recorded 64K; **no** assembler flip |
| **C7 unified memory** | **done** | `done (shadow+stable-window)` | Goal B B2 — stable window + manual cutover pack; cutover **never auto** |

## Residual summary (do not over-read `done`)

| Area | Residual / boundary |
|---|---|
| **C1-2** | Simulated three-arm fixtures; live A/B blocked 閳?see `CODING-C1-LIVE-AB.md` |
| **C3** | Planner fill partial on main (`fileHints` / explicit worker writeSet only) |
| **C4** | Git backend opt-in + C4-P hardlink install opt-in; default inprocess / install none |
| **C5** | WAL opt-in; C5-P patch-flow graduation keep-off (recommend-only) |
| **C6** | Recorded/synthetic 64K + flip decision pack (Goal B); live64k residual; no assembler production flip |
| **C7** | Shadow + stable-window fixture + manual cutover pack (Goal B); `cutoverAllowed` always false |
| **Do not ship** | Parallel `context-fact-tools.ts` / team-orchestrate-request rewrites of main C0閳ユ弲3 |

## ACCEPT commands (this round residual)

```bash
# from openclaw_runtime/
node --import tsx scripts/coding-remaining-acceptance.mts
node --import tsx scripts/coding-c0-acceptance.mts
node --import tsx scripts/coding-c2-acceptance.mts
# focused unit
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts \
  symbol-lease block-lifecycle coding-ab-fixtures coding-long-chat-curve \
  routing-memo-shadow experience-shadow-product coding-tool-navigation
node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts \
  worktree-service isolation-mode-matrix
```

## Active work log

| When | Action | Result |
|---|---|---|
| 2026-07-15 | Dirty wt C0閳ユ弲7 parallel attempt | uncommitted; behind main 8 |
| 2026-07-15 | Closeout inventory | main owns C0閳ユ弲3; wt unique = C4閳ユ弲7 |
| 2026-07-15 | Restore C0閳ユ弲3 wiring from main content | no C0閳ユ弲3 regression rewrite |
| 2026-07-15 | Land C4閳ユ弲7 modules + flags/obs + docs | round closeout pack |

## Production packaging (P0)

| Item | Status | Notes |
|---|---|---|
| **Prod P0 opt-in packaging** | **done (loop)** | Config surface + runbook + observability export; **no default flag flips**. See artifacts/coding-prod-p0/report.json and docs/dcs-production-p0-runbook.md. |
| **Goal A (A1+A2+A3)** | **done** | A1 C1 decision keep-off; A2 C4-H hard (defaults shared/inprocess); A3 C5-H multiProcessWalHardened (lease/patch defaults off). See artifacts/coding-prod-goal-a/report.json. |
| **Goal B (B1+B2 C6-H/C7-H)** | **done** | B1 hard-gates+recorded (live64k residual, no auto flip); B2 shadow+stable-window manual cutover pack (cutoverAllowed always false). See artifacts/coding-prod-goal-b/report.json. |
| **Goal C (C1-R+C4-P+C5-P)** | **done** | C1 residual keep-off; C4-P hardlink install opt-in; C5-P patchFlow keep-off. See artifacts/coding-prod-goal-c/report.json. |
| **Round ACCEPT 2.0** | **done** | accept-with-residuals over Goal A/B/C; readyForDefaultFlagGraduation=false. See artifacts/coding-prod-round-accept-2/report.json. |

<!-- status-table-end -->
