# CODING-C7-COMPLETE

**Date**: 2026-07-15
**Branch**: `codex/dcs-c7-memory-shadow`
**Scope**: DCS Phase5 C7-1..C7-3 unified memory/knowledge **shadow** (routing-memo + SEKB experience + verifier discipline)
**Completion class**: `done (shadow)`
**Cutover recommended**: **false** (no default production injection flip)
**SHA**: `d5bd9fc189b3fd583fa872e292fb235b7d9887e3`

## Honesty (required)

- This wave is **shadow / structure / discipline only**.
- **Default production memory/knowledge injection paths are unchanged** (red line 2).
- COMPASS / role-memory / routing memo pilot **not** flipped to production default inject.
- `runtime.coding.routingMemo.shadow` default **false**.
- `runtime.coding.sekb.experienceShadow` default **false**.
- Assessment APIs always keep `cutoverAllowed: false`.
- C7-2 residual: productized shadow journal + confirm hook exist; live multi-session experience hit-rate is fixture-level only (**partial / residual**, not fake done(loop)). `experienceHitRate: 0` in acceptance fixture.
- C5/C6 structural deps merged onto this branch base for stability; C7 does not re-own those cards.
- Package-boundary path map fix (`extensions/tsconfig.package-boundary.paths.json` dist d.ts -> src) is an E2E/runtime resolution fix, **not** a memory cutover.

## Cards

| Card | Status | Deliverable |
|------|--------|-------------|
| C7-0 phase producer | N/A | SEKB V-1 / D2 already verified (`CODING-V1-COMPLETE.md`) |
| C7-1 routing memo shadow | **done (shadow)** | `knowledge/routing-memo-shadow.ts` JSONL + gated `recordRoutingMemoShadow` + shadow Block |
| C7-2 SEKB experience shadow | **done (shadow)** / residual productization | `experience-block-bridge` optional shadow + `experience-shadow-product` journal/assessment |
| C7-3 verifier discipline | **done** | `verifier-discipline.ts` no self-repair + lead fix task factory; orchestrator plan field |

## How to enable (explicit, default off)

| Feature | Default | Explicit enable |
|---------|---------|-----------------|
| Routing memo dual-write shadow | off | `runtime.coding.routingMemo.shadow=true` or `recordRoutingMemoShadow({enabled:true})` |
| SEKB experience shadow journal | off | `runtime.coding.sekb.experienceShadow=true` or `confirm_and_save(..., { experienceShadow: { enabled:true, workspaceRoot } })` |
| Verifier no self-repair | **on** (discipline default) | `verifierNoSelfRepair: false` only to opt out of lead fix-task factory (still never auto-edits code) |

## Artifacts

- `artifacts/coding-c7/acceptance.json` (`ok: true`, `defaultInjectionUnchanged: true`, `cutoverRecommended: false`, `completionClass: "done (shadow)"`)
- `artifacts/coding-c7/gates.json`
- Script: `openclaw_runtime/scripts/coding-c7-acceptance.mts`

## Key paths

- `openclaw_runtime/src/knowledge/routing-memo-shadow.ts` (+test)
- `openclaw_runtime/src/knowledge/sekb/experience-shadow-product.ts` (+test)
- `openclaw_runtime/src/knowledge/sekb/experience-block-bridge.ts` (optional shadow on confirm)
- `openclaw_runtime/src/knowledge/sekb/distillation-tool.ts` (opt-in shadow options)
- `openclaw_runtime/src/agents/verifier-discipline.ts`
- `openclaw_runtime/src/agents/orchestrator.ts` (`verifierNoSelfRepair` on plan)
- `openclaw_runtime/src/context-engine/coding-runtime-flags.ts`
- `openclaw_runtime/extensions/tsconfig.package-boundary.paths.json` (E2E path resolution: prefer src over stale dist d.ts)
- `electron/services/knowledge-api.ts` (typecheck casts for body records)

## Gates (all exit 0)

| Gate | Result |
|------|--------|
| directed vitest C7 (routing-memo-shadow / experience-shadow / bridge) | **23/23 pass** (`tmp/c7_unit4`) |
| `pnpm run test:dcs` | **PASS** 168 + 10 + 73 (`tmp/c7_dcs`) |
| `pnpm run typecheck` | **PASS** exit 0 (`tmp/c7_tc3`) |
| `pnpm run lint:check` | **PASS** 0 errors, **109** warnings (budget ≤111) (`tmp/c7_lint2`) |
| `pnpm --dir openclaw_runtime build` | **PASS** exit 0 (`tmp/c7_build3`) |
| acceptance `coding-c7` | **PASS** ok:true, defaultInjectionUnchanged:true (`tmp/c7_accept2`) |
| playwright `dcs-production-wiring-w5` | **PASS** 3/3 (~1.2m) (`tmp/c7_e2e8`) |

## Residual / next (C7-H — not this wave)

- Stable-window dual-write compare for routing memo shadow → product cutover decision
- Full SEKB experience confirm chain productization + live hit-rate scorecard
- Any default injection flip requires **written user approval**

## G0 preflight (passed)

- C6 structural modules present on branch (archive/compress/pressure)
- SEKB V-1 / D2 verified
- C0–C4 on ancestry; C5/C6 merged into C7 branch base
- Understood: no default COMPASS/role-memory/routing production injection cutover