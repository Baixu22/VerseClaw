# FP-P0-06 evidence — config type / zod schema parity guard

Date: 2026-07-26. All commands run at repo root `ClawX-maturity-p0` @ main (60931957b + working tree).

## Survey result (差集普查)

Type-has / schema-missing (all read by production code; all were gateway-killers on write):

| runtime.* leaf group | read by | disposition |
|---|---|---|
| `coding.*` (10 leaves) | `context-engine/coding-runtime-flags.ts:46` | 补 schema |
| `vtoken.assembly.*` (7 leaves) | `context-engine/chat-turn-vtoken-injection.ts:153` | 补 schema |
| `orchestration.routingMemoPilot/handoffArtifacts` | `agents/orchestrator.ts:172`, `agents/routing-memo.ts:137`, `agents/handoff-artifacts.ts:108` | 补 schema |
| `resilience.anomalyClassifierPilot` | mission reviewer (Area 3 R2) | 补 schema |
| `memory.injectPilot.*` (4 leaves) | `context-engine/chat-turn-memory-injection.ts:78`, `context-orchestrator.ts:134` | 补 schema |

Schema-has / type-missing: none found.
Labels/help phantom keys (documented but unwritable before fix): all of the above
(`schema.labels.ts` 767-805, `schema.help.ts` 2055-2126 document vtoken/orchestration/
resilience/injectPilot) — resolved by the schema additions; locked by direction-3 test.
Whitelist (`SCHEMA_PARITY_INTENTIONAL_GAPS`): empty — no intentional gaps remain.

## Guard

- `openclaw_runtime/src/config/runtime-feature-leaves.ts` — DeepRequired compile-checked
  exhaustive fixture (type-side anchor), enforced by `pnpm lint:dcs` (file added to list).
- `tests/unit/config-schema-parity.test.ts` — 83 tests, 3 directions + strictness lock
  + contextEnhancement regression. On default CI path (root vitest glob).

## Test runs (final)

- `pnpm exec vitest run tests/unit/config-schema-parity.test.ts` → 1 file / **83 passed / 0 failed**
- 6-file related sweep (launch-contract-matrix, vtoken-launch-default, vtoken-bridge,
  gateway-process-launcher-env, config-schema-parity, default-config-matrix)
  → **6 files / 136 passed / 0 failed**
- `pnpm contract:check` → Contract check passed.
- `pnpm lint:dcs` → exit 0
- `git diff --check` on all FP-P0-06 touched files → clean (exit 0)

## Reverse-injection verification (guards are not idle)

1. Schema-side: removed `contextEnhancement` leaf from zod-schema.ts →
   `tests/unit/config-schema-parity.test.ts (83 tests | 2 failed)`:
   `× typed leaf is accepted by the strict schema: runtime.contextEnhancement.killSwitch`
   `× regression: runtime.contextEnhancement.killSwitch is schema-accepted`
   Restored → 83 passed.
2. Type-side: removed `resilience` from the exhaustive fixture →
   `pnpm lint:dcs`: `runtime-feature-leaves.ts:33:14: error typescript(TS2741):
   Property 'resilience' is missing in type ...` Restored → exit 0.

## G3 — real gateway child (E2E)

`pnpm run test:e2e:run tests/e2e/config-schema-parity-fp-p0-06.spec.ts --workers=1`

Run 2 (after openclaw_runtime dist rebuild): **1 passed (2.7m)**
```
[fp-p0-06-parity-start] {"childPid":31916,"gatewayGeneration":"1","configExists":true,"vtokenAssembly":false,"killSwitch":false}
```
Run 1 (stale `openclaw_runtime/dist/entry.js` predating the schema fix): FAILED with
`gateway never became ready with parity config: {"lastStatus":{"state":"stopped",...}}`
— this is the historical defect reproducing live against the old bundle: the child
exits during config validation. Direct child repro against rebuilt dist:
`OPENCLAW_CONFIG_PATH=<parity config> node dist/entry.js gateway --port 39917
--allow-unconfigured` → gateway stays up (killed by timeout, no validation exit).
Drift note: E2E consumes `openclaw_runtime/dist/entry.js`; runtime src changes need
`dist` rebuilt or the E2E tests the old bundle. Recorded as residual (dist-freshness guard).
