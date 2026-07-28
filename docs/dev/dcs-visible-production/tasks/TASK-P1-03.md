# TASK-P1-03: tool_registry injection catalog consistency

| field | value |
|-------|-------|
| **id** | `TASK-P1-03` |
| **milestone** | `M1-productive` |
| **priority** | `P1` |
| **status** | `done` |
| **blockedBy** | — |
| **owner** | Claude |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal
When tool_registry is on, system tool summary matches real catalog (on_demand friendly).

## Acceptance
- [x] Settings/config flag on injects tool_registry path (factory + assembler)
- [x] unit tests: flag off omits; flag on writes Block with mapped entries (**8**)
- [x] Settings writable switch default off + E2E visible
- [x] no default-on
- [x] C1 schema mode remains summary/full via existing env (unchanged)

## Changes
- catalog + writable spec `tool-registry` → `runtime.contextBlock.tool-registry.enabled`
- AppSettings `dcsToolRegistryEnabled`
- E2E asserts switch default unchecked

## Tests
```text
dcs-prod-flags-control: 8 passed
extensions.tool-registry.test.ts: 8 passed
e2e dcs-prod-p0-settings: 3 passed
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | UI+config | done | Settings path |
| 2026-07-22 | tests | pass | 8+8+3 |
| 2026-07-22 | close | **done** | |
