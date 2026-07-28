# FP-P0-06 evidence — config type / zod schema parity guard

Date: 2026-07-26. All commands run from repo root `ClawX-maturity-p0`.

## 1. Survey: pre-fix (git HEAD 60931957b) schema vs exhaustive type fixture

Method: extracted `git show HEAD:openclaw_runtime/src/config/zod-schema.ts` (pre-fix state,
zero FP-P0-02/06 markers) into the config dir as a temporary module, ran the exact same
diff algorithm the guard uses (`safeParse` per typed leaf; zod introspection per schema leaf;
labels/help key resolution). One-off test file deleted after capture.

### Direction type→schema: 29 typed leaves rejected by pre-fix schema

```
SURVEY_TYPE_HAS_SCHEMA_MISSING(29)
runtime.coding.factViews.enabled          runtime.coding.parseOnTouch.enabled
runtime.coding.staleWriteGuard.enabled    runtime.coding.writeJournal.enabled
runtime.coding.worktree.backend           runtime.coding.symbolLease.enabled
runtime.coding.symbolLease.mode           runtime.coding.patchFlow.default
runtime.coding.patchFlow.enabled          runtime.coding.sekb.enabled
runtime.coding.sekb.experienceShadow      runtime.coding.routingMemo.shadow
runtime.coding.routingMemo.enabled        runtime.coding.verifier.noSelfRepair
runtime.memory.injectPilot.enabled        runtime.memory.injectPilot.providers
runtime.memory.injectPilot.totalTokenBudget  runtime.memory.injectPilot.sessions
runtime.contextEnhancement.killSwitch     runtime.vtoken.assembly.enabled
runtime.vtoken.assembly.budgetTokens      runtime.vtoken.assembly.renderMode
runtime.vtoken.assembly.sessions          runtime.vtoken.assembly.timeoutMs
runtime.vtoken.assembly.maxSourceFiles    runtime.vtoken.assembly.maxSourceChars
runtime.orchestration.routingMemoPilot    runtime.orchestration.handoffArtifacts
runtime.resilience.anomalyClassifierPilot
```

Grouped disposition (all = **补 schema**, none deleted from type, none whitelisted):

| group | leaves | disposition |
|---|---|---|
| `runtime.coding.*` | 14 | schema added (`zod-schema.ts` coding block) — read by coding-runtime-flags.ts |
| `runtime.vtoken.assembly.*` | 7 | schema added — read by chat-turn-vtoken-injection.ts |
| `runtime.memory.injectPilot.*` | 4 | schema added — documented pilot, labels/help existed |
| `runtime.orchestration.*` | 2 | schema added — read by orchestrator.ts |
| `runtime.contextEnhancement.killSwitch` | 1 | schema added in FP-P0-02 (historical defect; regression-locked) |
| `runtime.resilience.anomalyClassifierPilot` | 1 | schema added — read by mission reviewer |

### Direction schema→type: 0

```
SURVEY_SCHEMA_HAS_TYPE_MISSING(0)
```

### Documented (labels/help) but pre-fix-rejected: 21 keys

```
SURVEY_DOCUMENTED_BUT_REJECTED(21)
runtime.memory / runtime.memory.injectPilot(.enabled|.providers|.totalTokenBudget|.sessions)
runtime.vtoken / runtime.vtoken.assembly(.enabled|.budgetTokens|.renderMode|.sessions|.timeoutMs|.maxSourceFiles|.maxSourceChars)
runtime.contextEnhancement.killSwitch
runtime.orchestration(.routingMemoPilot|.handoffArtifacts)
runtime.resilience(.anomalyClassifierPilot)
```

Every one of these was "documented in the UI, but writing it exits the gateway code=1".

### Intentional-gap whitelist

`SCHEMA_PARITY_INTENTIONAL_GAPS` = **empty** (openclaw_runtime/src/config/runtime-feature-leaves.ts:30).
After the fix every typed runtime leaf is schema-accepted; the whitelist mechanism exists
with a mandatory per-entry `reason` (guard test fails on empty reason).

## 2. Guard run (post-fix)

```
pnpm exec vitest run tests/unit/config-schema-parity.test.ts --maxWorkers=2
 Test Files  1 passed (1)
      Tests  83 passed (83)
```

## 3. Reverse injection (guard must really fail)

Temporarily renamed the `contextEnhancement` key in `zod-schema.ts`, re-ran:

```
 tests/unit/config-schema-parity.test.ts (83 tests | 3 failed)
 × typed leaf is accepted by the strict schema: runtime.contextEnhancement.killSwitch
   AssertionError: type-declared config leaf "runtime.contextEnhancement.killSwitch"
   (sample true) is rejected by zod-schema.ts — writing it would make the gateway exit
   code=1 on start. Issues: [{"code":"unrecognized_keys","keys":["contextEnhancement"],...}]
 × every schema-accepted runtime leaf exists in the compile-checked type fixture
   AssertionError: zod-schema.ts accepts runtime leaves that RuntimeFeatureConfig does not declare
 × regression: runtime.contextEnhancement.killSwitch is schema-accepted
 Tests  3 failed | 80 passed (83)
```

Restored; re-run = 83 passed. Type-side reverse direction is compile-enforced:
`DeepRequired<RuntimeFeatureConfig>` in runtime-feature-leaves.ts stops compiling if a
type leaf is missing from the fixture (`pnpm lint:dcs` exit 0, file registered in its list).

## 4. CI path

- `tests/unit/config-schema-parity.test.ts` — picked up by root `pnpm test` first leg
  (`vitest run --maxWorkers=2` glob over tests/unit, not in any exclude list).
- `openclaw_runtime/src/config/runtime-feature-leaves.ts` — registered in `lint:dcs`
  type-aware file list (package.json), so fixture drift breaks lint.
- `pnpm contract:check` → `Contract check passed.`

## 5. G3 runtime (real Electron + real gateway child)

`tests/e2e/config-schema-parity-fp-p0-06.spec.ts`: writes a config containing every
formerly-rejected section (coding / vtoken / orchestration / resilience /
memory.injectPilot / contextEnhancement, all OFF/neutral values), launches real Electron,
starts real gateway child, asserts child pid ≠ main pid + `runtime.flags.ack` answers +
defaults stay off. Output appended below when run completes.
