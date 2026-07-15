# Tier D Rollback Drill Record

**Status:** **Pass (executed)**  
**Last updated:** 2026-07-15T02:35:01.472Z  
**Linked Tier C freeze runId:** `c-human-2026-07-15T01-04-37-795Z-c4aeff8e`  
**Machine record:** [d1-rollback-drill.v1.json](./d1-rollback-drill.v1.json)

## Preconditions

- [x] Tier C offline hard gates green (`evaluable_for_promotion=true`; origin = agent dual-review proxy)
- [x] N1 permanent Pass-Proxy + written agent-proxy risk waiver (`PROXY-LABEL-AUTHORITY.md`, `D1-WRITTEN-APPROVAL.md`)
- [x] Written product/tech approval for D1
- [x] Isolated workspace / state dir (`C:/Users/27933/AppData/Local/Temp/sekb-d1-lab-GeKQRH`)
- [x] Pilot flag identified and default-off confirmed
- [x] No offline artifact path used as runtime authority

## Drill steps (executed)

1. Recorded pre-enable baseline (principle/trajectory counts, counters).
2. Enabled Phase C evaluation path only for a 20-trajectory synthetic batch (lab scheduler; not ambient production).
3. Exercised would_trigger evidence emission.
4. Disabled path (flag-off suppression counter).
5. Diffed store parity: principles/trajectories unchanged by D1 evaluate.

## Result

| Item | Value |
| --- | --- |
| Stage | D1 |
| Flag name | runtime.contextBlock.sekb.phaseCWouldTrigger.enabled / OPENCLAW_SEKB_PHASE_C_WOULD_TRIGGER_ENABLED |
| Operator | codex-agent |
| Date | 2026-07-15T02:35:01.472Z |
| Pass / Fail | **Pass** |
| Notes | Kill switch restores evaluation path; store counts unchanged by D1 evaluate |

## Evidence attachments

- baseline / on / off: `d1-rollback-drill.v1.json`
- full observation: `d1-observation.v1.json`
