# TaskLoop acceptance checklist (TASK-P1-08)

> Any marketed **task_state / phase / SEKB trajectory** feature **must** be accepted on a **TaskLoop** path. Single-turn chat alone is insufficient.

## Required scenarios

| # | Scenario | Automation | Notes |
|---|----------|------------|-------|
| 1 | TaskLoop phase transitions emit `task_phase_change` | `task-loop-controller.dcs-phase-producer.test.ts` | Production producer |
| 2 | task_state Block handler wiring with DCS deps | `extensions.task-state.test.ts` | sink/store present |
| 3 | Stage0 hooks include `task_phase_change` name | `dcs-stage0-hooks.test.ts` | no duplicate agent_end |
| 4 | Terminal phase can trigger SEKB trajectory path | `sekb` harness tests under `test:dcs` | human-confirm only for writeback |
| 5 | Single-turn chat does **not** claim full task_state lifecycle | product copy | Context layers / DCS panel note |

## Commands

```powershell
cd openclaw_runtime
node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts `
  src/agents/task-loop-controller.dcs-phase-producer.test.ts `
  src/agents/embedded-agent-runner/extensions.task-state.test.ts

# broader DCS batch includes hooks + sekb
pnpm run test:dcs
```

## Product copy rule

When documenting DCS task_state / phase / SEKB trajectory:

- Say: **requires TaskLoop / multi-step task path**
- Do **not** imply single-turn chat always produces task_state phases

Settings: `developer.dcsProdFlags.taskLoopNote` (i18n).

## Exit criteria for marketing claims

- [x] Automated phase producer test green
- [x] Task-state extension wiring test green  
- [x] Product note present in Settings DCS panel
- [ ] Optional: Playwright multi-step TaskLoop e2e (deferred; unit harness sufficient for P1-08)

Last verified: 2026-07-22 (TASK-P1-08)
