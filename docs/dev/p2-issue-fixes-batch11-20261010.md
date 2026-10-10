# P2 issue fix: failed and retried usage attribution

Scope: issue #124. This record is agent-authored and does not measure real
provider invoices or claim that every failed attempt has usage.

## Change

- `UsageHistoryEntry` now accepts optional execution and attribution fields:
  `executionStatus`, `retryKind`, `attributionStatus`, `runId`,
  `attemptIndex`, `modelCallIndex`, `wireAttemptIndex`, and
  `correlationDigest`.
- The transcript parser reads the entry-level `modelCall` metadata produced by
  #112. Retry/fallback classification is derived from persisted indexes, not
  timestamps:
  - `wireAttemptIndex > 0` => retry
  - otherwise `attemptIndex > 0` => fallback
  - otherwise initial
- `stopReason` maps to execution status: `stop`/`length`/`toolUse` succeed,
  `error` fails, and `aborted` is aborted.
- `usageStatus` remains parse quality. A failed execution with valid usage is
  still billable; a malformed usage payload remains an error.
- Summary and aggregate responses expose failed/aborted/retried/unknown
  attribution counts without changing token/cost conservation.
- Billing recent rows show failed/aborted, retry/fallback, and unknown
  attribution badges in all four locales.

## Verification

```text
node node_modules/vitest/vitest.mjs run tests/unit/token-usage.test.ts
pnpm run typecheck:test
pnpm i18n:lint
pnpm contract:check
pnpm run test:e2e tests/e2e/billing-page.spec.ts
```

The Electron E2E command reaches the repository's normal `build:vite` step; if
the local Windows esbuild temp-file `Access is denied` failure blocks the run,
that is recorded as an environment limitation rather than a pass.