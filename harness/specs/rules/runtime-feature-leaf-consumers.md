---
id: runtime-feature-leaf-consumers
title: Runtime Feature Leaf Consumers
type: rule
severity: error
driven_by: agent
appliesTo:
  - gateway-backend-communication
  - dcs-production-flags-localization
pathPatterns:
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/schema.help.ts
  - scripts/check-feature-leaf-consumers.mjs
  - tests/unit/feature-leaf-consumers.test.ts
touchedAreas:
  - docs/dev/runtime-feature-control-surface.md
  - harness/specs/rules/runtime-feature-leaf-consumers.md
  - package.json
  - scripts/check-feature-leaf-consumers.mjs
  - scripts/check-feature-leaf-consumers.d.mts
  - tests/unit/feature-leaf-consumers.test.ts
requiredTests:
  - node scripts/check-feature-leaf-consumers.mjs
  - node scripts/check-feature-leaf-consumers.mjs --self-test
  - npx vitest run tests/unit/feature-leaf-consumers.test.ts --maxWorkers=1
---

# Rule: every runtime feature leaf must have a visible consumer

A leaf added to `RuntimeFeatureConfig` is a promise that something reads it.
`runtime-feature-leaves.ts` already forces every typed leaf to be declared and
schema-accepted, but it cannot tell whether any runtime code ever reads the
value — so a leaf can ship in the type, the zod schema, the labels, and the
Settings UI while flipping it does nothing.

Issue #96 found the canonical instance: all 12 `runtime.coding.uftk` gates
(`uftk.enabled`, `baseVersionGuard`, `auditLog`, `gitCheckpoint` (+`pathScoped`,
`safetySnapshot`, `lifecycle`), `concurrencyV2`, `execUndo`, `autoCheckpoint`,
`execSideEffects`, `commandApproval`) are declared, schema-accepted, and
label-rendered, yet no runtime source reads any of them. The capability code
that was meant to honour them (`exec-approvals-allowlist.ts`,
`checkpoint-rollback-executor.ts`, `agents/tools/write-journal.ts`) reads either
an injected option or nothing at all — never `runtime.coding.uftk`.

`scripts/check-feature-leaf-consumers.mjs` is the standing tripwire for that
class of problem.

## Rules

- Adding a leaf to the runtime config means adding its reader in the same
  change. A declared-but-unread leaf is a defect, not a placeholder.
- The guard fails closed on exactly one condition: a leaf that is NOT in
  `FEATURE_LEAF_CONSUMER_BASELINE` has no visible consumer. New zero-consumer
  leaves are therefore rejected.
- `FEATURE_LEAF_CONSUMER_BASELINE` pins known debt with its owner. Pinning a
  new leaf requires recording the owning issue in the comment; the baseline is
  a debt ledger, not an allowlist for convenience.
- Baseline entries must never be fatal in either direction. A pinned leaf that
  gains a consumer (the re-wire fix) and a pinned leaf that disappears from the
  schema (the delete fix) are both informational, so resolving the debt cannot
  turn an unrelated change red.
- Prefer deleting a leaf that has no consumer and no owner over pinning it.
- The consumer test is textual and structural, not a reachability proof. It
  must stay documented as such in the script header and in
  `docs/dev/runtime-feature-control-surface.md`, and it must fail open on
  ambiguity so a missed detection can only weaken the baseline, never produce a
  false red.
- Do not weaken the heuristic to make a specific tree pass; widen
  `FEATURE_LEAF_CONSUMER_BASELINE` explicitly instead, and say why.

## Validation

- `pnpm run check:feature-leaf-consumers`
- `pnpm run check:feature-leaf-consumers:self-test`
- `pnpm exec vitest run tests/unit/feature-leaf-consumers.test.ts`
