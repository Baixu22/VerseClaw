# DCS W5 Gate Runner (auto)

You are a gated DCS W5 runner for the ClawX repo.

## Hard gate (MUST run first, before any code edits)

Working root:
`C:\Users\27933\Desktop\clawx\ClawX`

Check files:
1. If `team/dcs/DCS-W4-COMPLETE.md` is missing -> reply exactly `WAITING_FOR_W4` and STOP. No code changes.
2. If `team/dcs/DCS-W5-COMPLETE.md` already exists -> reply exactly `W5_ALREADY_DONE` and STOP.
3. If `team/dcs/.w5.lock` exists and is younger than 2 hours -> reply exactly `W5_IN_PROGRESS` and STOP.
4. If `team/dcs/.w5.lock` is stale (>2h), delete it and continue.

Only when the gate is open:
- Create `team/dcs/.w5.lock` with ISO timestamp and this thread id if available.
- Execute the full W5 mission below end-to-end.
- On success: write `team/dcs/DCS-W5-COMPLETE.md`, remove `.w5.lock`.
- On failure: write a short `team/dcs/DCS-W5-INCOMPLETE.md` with blockers, remove `.w5.lock` so next poll can retry.

## Fixed constraints

1. Stay on `main`. No branch / worktree / rebase / reset / stash / push.
2. Serial `pnpm` / Vitest only.
3. Commits only via `openclaw_runtime/scripts/committer` + explicit file list.
4. No unrelated refactors. No Settings/UI/host-api control plane. No blanket lint suppressions. No skip/weaken assertions for green.
5. Default DCS flags stay **false** outside tests/E2E fixtures.
6. Prefer minimal production wiring. No fake metrics framework in production code.
7. COMPLETE report must include: `production wiring status: <dead|partial|live>` and remaining open callers / missing E2E.

## Required reading before coding

- `AGENTS.md`
- `team/dcs/DCS-WIRING-REPAIR-DISPATCH.md` (WINDOW PROMPT W5 section)
- `team/dcs/dcs-v1.6-spec.md`
- `team/dcs/dcs-v1.6.1-addendum.md`
- `team/dcs/README.md`
- `team/dcs/DCS-W1-COMPLETE.md` .. `DCS-W4-COMPLETE.md` honesty sections
- any AGENTS.md under touched paths

## Mission (W5 / D6)

Prove one real path (prefer Windows Electron + Gateway coding chat, or the closest existing real harness already used by T3 CodeGraph E2E patterns):

### Cases
1. Flags default off: no DCS always-on leakage; tools may exist but Blocks not forced.
2. Flags on (test-only env/config): working_memory and/or tool_registry and/or task_state observable in store after real actions.
3. `context_read` / `context_search` / `context_write` callable for non-destructive reads; write respects whitelist.
4. Explicit SEKB off remains off; if SEKB on fixture exists, experience write optional.
5. Record counts in **E2E helper only**: tools total, schema chars/UTF-8 bytes if useful — no production metrics framework.

### Requirements
- No mock BlockStore for the primary evidence case.
- No skip to green.
- Reuse T3 E2E patterns where possible; do not regress CodeGraph 15-tool suite.

### Commit
`test(e2e): prove dcs production wiring on windows path`

### Deliverable
`team/dcs/DCS-W5-COMPLETE.md` with raw command results and exit codes.

## Execution notes

- Do not start W6.
- Do not implement D3 fingerprint or D7 counters here (W6).
- If blocked on environment (Electron/Gateway not runnable), document exact command failure and keep COMPLETE only if acceptance criteria are truly met; otherwise write INCOMPLETE.
