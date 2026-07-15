# CODING Optimization Status (SoT)

**Source of truth for wave completion after 2026-07-15 round closeout.**  
Rules:
1. Status may only flip to `done` when DEV + TEST + ACCEPT evidence exists.
2. `done` must include a **Completion class**.
3. `done (sim)` / `done (interface)` are **not** production-hard defaults.
4. **C0–C3 implementation authority is `main`** (landed via dcs C0/C1/C2/C3 branches). This worktree must not re-land parallel C0–C3 rewrites.
5. This round's unique land is **C4–C7 residual + C1 sim fixtures + flag/obs extensions**.

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
| **C0 wave** | **done** | `done (loop)` | **main** — `artifacts/coding-c0/*`, `context-agent-tools`, WFS |
| **V-1 D2/SEKB** | **done** | `done (loop)` | **main** harness + producer |
| **C1 wave** | **done** | `done (sim)` | **main** wiring + this wt `coding-ab-fixtures` / remaining ACCEPT; live A/B **blocked** |
| **C2 wave** | **done** | `done (loop)` | **main** — `artifacts/coding-c2/*` |
| **C3 wave** | **done** | `done (loop)` | **main** — `artifacts/coding-c3/*`; planner fill=**partial** |
| **C4 worktree isolation** | **done** | `done (loop)` | this wt — `worktree-service.ts`; default **inprocess** |
| **C5 symbol lease + patch-flow** | **done** | `done (loop)` | this wt — `symbol-lease.ts` / `patch-flow.ts`; default **memory**, patchFlow.default **false** |
| **C6 context ladder** | **done** | `done (interface)` | this wt — lifecycle/compress/token-pressure/long-chat curve; **no** assembler flip |
| **C7 unified memory** | **done** | `done (interface)` | this wt — routing-memo-shadow + experience-shadow-product; cutover **never auto** |

## Residual summary (do not over-read `done`)

| Area | Residual / boundary |
|---|---|
| **C1-2** | Simulated three-arm fixtures; live A/B blocked — see `CODING-C1-LIVE-AB.md` |
| **C3** | Planner fill partial on main (`fileHints` / explicit worker writeSet only) |
| **C4** | Git backend opt-in; default inprocess |
| **C5** | WAL opt-in; patch-flow recommend-only |
| **C6** | Synthetic 64K curve; no assembler production flip |
| **C7** | Shadow helpers only; `cutoverAllowed` always false |
| **Do not ship** | Parallel `context-fact-tools.ts` / team-orchestrate-request rewrites of main C0–C3 |

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
| 2026-07-15 | Dirty wt C0–C7 parallel attempt | uncommitted; behind main 8 |
| 2026-07-15 | Closeout inventory | main owns C0–C3; wt unique = C4–C7 |
| 2026-07-15 | Restore C0–C3 wiring from main content | no C0–C3 regression rewrite |
| 2026-07-15 | Land C4–C7 modules + flags/obs + docs | round closeout pack |