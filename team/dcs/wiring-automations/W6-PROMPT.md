# DCS W6 Gate Runner (auto)

You are a gated DCS W6 runner for the ClawX repo.

## Hard gate (MUST run first, before any code edits)

Working root:
`C:\Users\27933\Desktop\clawx\ClawX`

Check files:
1. If `team/dcs/DCS-W5-COMPLETE.md` is missing -> reply exactly `WAITING_FOR_W5` and STOP. No code changes.
2. If `team/dcs/DCS-W6-COMPLETE.md` already exists -> reply exactly `W6_ALREADY_DONE` and STOP.
3. If `team/dcs/.w6.lock` exists and is younger than 2 hours -> reply exactly `W6_IN_PROGRESS` and STOP.
4. If `team/dcs/.w6.lock` is stale (>2h), delete it and continue.

Only when the gate is open:
- Create `team/dcs/.w6.lock` with ISO timestamp and this thread id if available.
- Execute the full W6 mission below end-to-end.
- On success: write `team/dcs/DCS-W6-COMPLETE.md` + `team/dcs/DCS-WIRING-REPAIR-ACCEPTANCE.md`, remove `.w6.lock`.
- On failure: write a short `team/dcs/DCS-W6-INCOMPLETE.md` with blockers, remove `.w6.lock` so next poll can retry.

## Fixed constraints

1. Stay on `main`. No branch / worktree / rebase / reset / stash / push.
2. Serial `pnpm` / Vitest only.
3. Commits only via `openclaw_runtime/scripts/committer` + explicit file list.
4. No unrelated refactors. No Settings/UI/host-api control plane. No blanket lint suppressions. No skip/weaken assertions for green.
5. Default DCS flags stay **false** outside tests/E2E fixtures.
6. Prefer minimal production wiring. No fake dashboard for observability.
7. COMPLETE report must include: `production wiring status: <dead|partial|live>` and residual debt with file:line if anything remains deferred.

## Required reading before coding

- `AGENTS.md`
- `team/dcs/DCS-WIRING-REPAIR-DISPATCH.md` (WINDOW PROMPT W6 section)
- `team/dcs/dcs-v1.6-spec.md`
- `team/dcs/dcs-v1.6.1-addendum.md`
- `team/dcs/README.md`
- `team/dcs/DCS-W1-COMPLETE.md` .. `DCS-W5-COMPLETE.md`
- external status board: `C:\Users\27933\Desktop\clawx\team\claude\DCS-ROUND-DISPATCH.md`
- any AGENTS.md under touched paths

## Mission (W6 / D3 + D7 + docs)

1. **D3**: implement the minimal workspace authority fingerprint / invalidate path deferred from R2 (do not boil the ocean; follow addendum + coding-runtime-workspace task facts). If still too large, deliver a vertical slice with honest NOT DONE remainder — do not claim COMPLETE for unfinished fingerprint.
2. **D7**: dual-injection observability counters for CVK systemPromptAddition vs DCS transformContext/assembler injection (char counts + duplicate suppression count). Use existing observability base; no fake dashboard.
3. **Docs**: update `team/dcs/README.md` and external `DCS-ROUND-DISPATCH` status for wiring repair; correct over-claims that "producer PASS" meant production caller.

### Commit(s)
- `feat(runtime): dcs workspace fingerprint slice` (if code)
- `feat(runtime): dcs dual-injection observability`
- `docs(dcs): record wiring repair acceptance`

### Deliverable
- `team/dcs/DCS-W6-COMPLETE.md`
- final `team/dcs/DCS-WIRING-REPAIR-ACCEPTANCE.md` summarizing D1-D8 final state

## Execution notes

- Do not re-run W5 product E2E unless a regression is introduced by W6.
- After final docs commit, leave worktree clean of W-series wiring files you own; do not touch unrelated dirt.
- Success program definition: D1/D2 no longer fatal; D4/D5 have production callers; D6 has real E2E evidence; D3/D7 live or explicitly residual with file:line.
