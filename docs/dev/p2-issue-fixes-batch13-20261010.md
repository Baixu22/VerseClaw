# P2 issue fix: automated runtime-memory cutover evidence gate

Scope: issue #143. This record is agent-authored and does not claim that a
default product cutover was authorized or executed.

## Change

- Added `evaluateMemoryCutoverGate` to the existing memory dual-gate owner.
- The evaluator consumes bounded, agent-generated evidence:
  - sample size
  - success rate
  - baseline and candidate p95 latency
  - token overhead ratio
  - safety regressions
  - evidence refs and `drivenBy`
- Decision stages:
  - `shadow`: insufficient sample or unsafe evidence
  - `guarded-opt-in`: sufficient sample but performance/token thresholds miss
  - `product-cutover`: every threshold, agent provenance and evidence-ref check passes
- The evaluator returns `defaultGateUnchanged: true`; it does not mutate
  `writeEnabled`, `useEnabled`, COMPASS flags or any product lock.
- Added `pnpm memory:cutover-gate --evidence <evidence.json>` as an
  agent-runnable evaluation entry.

## Verification

```text
node node_modules/vitest/vitest.mjs run tests/unit/memory-dual-gate-p3-003.test.ts
pnpm memory:cutover-gate --evidence <evidence.json>
```

The default gate remains closed by design. Flipping a frozen default is a
separate owner-authorized product decision; the evaluator removes the
"waiting for a human verdict" gap by making eligibility reproducible from
bounded artifacts.