# FP-P0-07 evidence — matrix default-cell text lock

Date: 2026-07-26, repo root ClawX-maturity-p0 @ main working tree.

## Implementation

- `tests/fixtures/launch-contract-matrix.ts`: `MdMatrixRow` gains `mdDefaultCell`
  (verbatim md cell text) for all 10 rows.
- `tests/unit/default-config-matrix.test.ts` new describe
  `FP-P0-07 md default-cell text lock (three-way parity)`:
  1. parse md table col 3 per surface row → byte-for-byte equal to fixture `mdDefaultCell`
  2. `mdDefaultCell` normalizes to `declaredDefault` for every variant
     (`**false** (opt-in)` / `**false**` / `**off**` / `**false** (deny)`)
  3. implementation defaults probed per row (DEFAULT_VTOKEN_ASSEMBLY_CONFIG,
     readVtokenBridgeEnabledFromEnv, DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS,
     DEFAULT_MEMORY_INJECT_PILOT_CONFIG, DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS,
     isSekbEnabled/isSekbShadowEvaluationEnabled, applyBrowserPrivateNetworkDefault,
     isContextEnhancementKillSwitchEngaged) must equal declaredDefault
     → md ↔ fixture ↔ implementation three-way lock.

## Test run

`pnpm exec vitest run tests/unit/default-config-matrix.test.ts --maxWorkers=2`
→ 1 file / **17 passed / 0 failed** (was 14 before FP-P0-07)

## Reverse verification

Flipped md cell `| **working-memory** | ... | **false** |` → `**true**` (implementation untouched):

```
× every fixture row matches the md "Product default" cell byte-for-byte
AssertionError: md Product default cell for "working-memory" drifted from the fixture.
md: "**true**" fixture: "**false**". The md is the SoT: if this is a real default change
it must go through a graduation decision, not a doc edit.: expected '**true**' to be '**false**'
Tests  1 failed | 16 passed (17)
```

Restored md → 17 passed. Hard lock respected: md content was only touched for the
injection probe and restored byte-identical (verified by re-run + git diff).
