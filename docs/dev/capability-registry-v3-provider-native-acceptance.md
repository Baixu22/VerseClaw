# Capability Registry V3-07 Provider-native Acceptance

## Scope

This record covers a default-disabled provider-native deferred-loading adapter
with an injected provider owner. It does not add a provider transport, mutate
provider payload wrappers, change prompts/config, or upgrade diagnostics-only
registries into execution authority.

## Decision

V3-07 is accepted as a caller-injected, exact provider/model/workflow
allowlisted adapter. Provider transport remains owned by the caller. No
application config, default activation, prompt mutation, or GA decision is
introduced. V3 remains default-disabled.

## Acceptance Evidence

Acceptance run: 2026-08-14 on branch `codex/v3-capability-registry`, based on
`8306466d175016a938703c41125dc3a3dca68390`.

### Implementation Boundary

- Probe and allowlist checks are exact and wildcard-free. Disabled, probe-miss,
  and allowlist-miss paths do not call the native owner.
- Malformed run inputs and malformed probe results return bounded
  `not_started`/proxy failures without throwing or invoking native `run`.
- Request/event serializers and parsers carry correlation metadata without
  credentials, executor references, or raw target results.
- Controlled owner responses are bound to the active request id and derived
  correlation hash; mismatches and invalid correlations fail closed.
- Retry is bounded to explicitly retryable pre-start failures with abort
  propagation. The async circuit breaker is reusable and fail-closed.
- Proxy fallback is allowed only when native evidence proves that no side
  effect started. Started, completed, or ambiguous requests never replay a
  target side effect. Request and event ids are idempotent in one run.

### Reproducible Gates

| Gate | Result | Evidence |
|---|---|---|
| `pnpm harness context --spec harness/specs/tasks/capability-registry-v3-provider-native.md` | PASS (exit 0) | Context included the communication scenario and all mapped backend boundary rules. |
| `pnpm harness validate --spec ... --no-diff` | PASS (exit 0) | `Spec is valid`. |
| Strict `pnpm harness validate --spec ...` | PASS WITH RESIDUAL (exit 0) | `RESIDUAL` lists only the three pre-existing Task Forest workspace files below; no V3 path is uncovered. `residualPaths` is exact-only: wildcards such as `**` fail validation with exit 1. |
| Harness unit tests (`tests/unit/harness-specs.test.ts`, `tests/unit/harness-git.test.ts`) | PASS | 2 files / 41 tests, including the residualPaths exact-only regression suite. |
| Focused V3 runtime lane | PASS | Capability lane: 11 files / 84 tests; agents lane: 2 files / 27 tests; infra lane: 1 file / 2 tests; total: 14 files / 113 tests. |
| `pnpm --dir openclaw_runtime tsgo:core` | PASS (exit 0) | Runtime production typecheck. |
| `pnpm --dir openclaw_runtime tsgo:core:test` | PASS (exit 0) | Runtime test typecheck. |
| `pnpm run comms:replay` | PASS (exit 0) | Wrote `artifacts/comms/current-metrics.json`. |
| `pnpm run comms:compare` | PASS (exit 0) | All duplicate/loss/order/timeout/fanout and history/RPC latency thresholds passed; report result `PASS`. |
| `pnpm run lint:check` | PASS (exit 0) | ESLint 0 errors, 127 pre-existing warnings; none in V3/harness files touched by this acceptance. |
| `pnpm run typecheck` | PASS (exit 0) | `success: true`; node and web projects exited 0. Test project runs in observation mode (exit 2, 1269 legacy errors) and does not fail the gate; none of its errors sit in lines touched by this acceptance. |
| Task Forest validate | PASS (exit 0) | `校验通过` (validation passed). |
| `git diff --check` | PASS (exit 0) | No whitespace errors. |
| Global `pnpm run harness:ci` | FAIL (exit 1, recorded residual) | The `gateway-backend-communication` scenario spec does not own the V3 change set. Workspace-ownership mismatch, not a V3 failure; Gateway scenario ownership was not expanded and the failure is recorded rather than hidden. |

### Workspace Residual

The three Task Forest files are workspace residuals (agent workbench exports),
not V3 functional failures:

- `.agent-workbench/task-forest/exports/task-forest.graph.json`
- `.agent-workbench/task-forest/exports/task-forest.html`
- `.agent-workbench/task-forest/graph/forest.json`

They are the only paths outside V3 ownership in the strict diff validation and
are declared per spec as exact residualPaths. Near-miss paths such as
`.agent-workbench/task-forest/other.json` remain uncovered and would fail the
strict gate.

## Decision Rationale

Probe/allowlist, protocol normalization, bounded retry/circuit behavior,
idempotency, fail-closed side-effect handling, communication replay, and
static gates are covered. V3-07 remains an optional adapter and does not own
provider transport or authorize a production rollout.