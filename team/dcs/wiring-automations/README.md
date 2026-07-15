# DCS W5/W6 Timed Automations

Created: 2026-07-14
Purpose: Poll every 10 minutes; only launch W5 after W4 COMPLETE, W6 after W5 COMPLETE; one window at a time.

## Status gates

| Marker | Meaning |
|---|---|
| `team/dcs/DCS-W4-COMPLETE.md` | W4 done (currently missing while W4 runs elsewhere) |
| `team/dcs/DCS-W5-COMPLETE.md` | W5 done |
| `team/dcs/DCS-W6-COMPLETE.md` | W6 done |
| `team/dcs/.w5.lock` / `.w6.lock` | in-progress guard (stale after 2h) |

## What was registered

### 1) Primary: Windows Task Scheduler (authoritative 10-min poll)

- Task name: `Codex-DCS-W5W6-GatePoller`
- Interval: every 10 minutes
- Script: `team/dcs/wiring-automations/dcs-w5w6-poller.ps1`
- Behavior:
  - no W4 COMPLETE -> log `WAITING_FOR_W4`, exit
  - W4 done, no W5 COMPLETE, no fresh lock -> launch W5 via `codex exec`
  - W5 done, no W6 COMPLETE, no fresh lock -> launch W6 via `codex exec`
  - both done -> log `ALL_DONE`
- Logs/state:
  - `team/dcs/wiring-automations/poller.log`
  - `team/dcs/wiring-automations/poller-state.json`
  - per-run `w5-run-*.log` / `w6-run-*.log`

### 2) Codex automations mirror (best-effort desktop UI)

IDs:
- `dcs-w5-gate-poller`
- `dcs-w6-gate-poller`

Stored in:
- `C:\Users\27933\.codex\sqlite\codex.db`
- `C:\Users\27933\.codex\sqlite\codex-dev.db`
- `C:\Users\27933\.codex\automations\<id>\automation.toml`

RRULE: `FREQ=MINUTELY;INTERVAL=10`
Note: official Codex cron tool docs historically clamp cron to hourly/weekly; minute polling is guaranteed by the Windows task. Codex rows include full gated prompts so a desktop automation run still hard-gates.

## Prompts

- `team/dcs/wiring-automations/W5-PROMPT.md`
- `team/dcs/wiring-automations/W6-PROMPT.md`

## Operator commands

```powershell
# Manual poll now
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\27933\Desktop\clawx\ClawX\team\dcs\wiring-automations\dcs-w5w6-poller.ps1"

# Task status
Get-ScheduledTask -TaskName "Codex-DCS-W5W6-GatePoller" | Get-ScheduledTaskInfo

# Disable
Disable-ScheduledTask -TaskName "Codex-DCS-W5W6-GatePoller"

# Enable
Enable-ScheduledTask -TaskName "Codex-DCS-W5W6-GatePoller"

# Delete
Unregister-ScheduledTask -TaskName "Codex-DCS-W5W6-GatePoller" -Confirm:$false
```

## Current expectation (2026-07-14 setup)

- W4 still running elsewhere
- Poller dry-run result: `WAITING_FOR_W4`
- No locks created
- No W5/W6 process launched
