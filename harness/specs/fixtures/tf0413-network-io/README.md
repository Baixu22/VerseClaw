# TF-0413 P4 network and I/O evidence

Agent-driven evidence for `network-io-governance`:

- `fetch-boundary.json`: static audit of all Main TypeScript files. Direct
  `fetch()` calls are confined to `proxy-fetch.ts` and `network-pool.ts`; the
  current tree has 30 `proxyAwareFetch()` call sites.
- `https-p50.json`: controlled self-signed HTTPS A/B over five requests. A fresh
  undici Agent per request is compared with one `NetworkPool`. The pool reports
  actual opened connections from undici connection events, not DNS lookups.
- `production-write-coalescing.json`: a 20-update burst through the production
  `createSqliteAcpEventLedger` path. All rows persist in one update transaction.
- `write-coalescer.json`: primitive-level SQLite pressure sample with
  `maxBatch=5`, retained as a smaller deterministic batching check.
- `wal-schedule.json`: a real `DatabaseSync` WAL maintenance task registered
  and removed through `TimerAligner`.
- `acceptance.json`: the independent detached-worktree run at candidate
  `ef69644e65f2837d09b0b0318ca582b890a689ee`. The retained sample shows an
  81.278% HTTPS P50 reduction and a 95% reduction in ACP update transactions.

Generate the samples from the repository root:

```powershell
$env:TEMP='D:\tmp'; $env:TMP='D:\tmp'

$env:RESOURCE_FETCH_BOUNDARY_OUT='harness/specs/fixtures/tf0413-network-io/fetch-boundary.json'
pnpm exec vitest run tests/unit/electron-network-fetch-boundary.test.ts

$env:RESOURCE_NETWORK_POOL_OUT='harness/specs/fixtures/tf0413-network-io/https-p50.json'
pnpm exec vitest run tests/unit/resource-network-pool-https.test.ts

$env:RESOURCE_SQLITE_COALESCER_OUT='harness/specs/fixtures/tf0413-network-io/production-write-coalescing.json'
pnpm exec vitest run tests/unit/resource-sqlite-write-coalescing.test.ts

$env:RESOURCE_WRITE_COALESCER_OUT='harness/specs/fixtures/tf0413-network-io/write-coalescer.json'
pnpm exec vitest run tests/unit/resource-write-coalescer.test.ts

$env:RESOURCE_SQLITE_WAL_OUT='harness/specs/fixtures/tf0413-network-io/wal-schedule.json'
pnpm exec vitest run tests/unit/resource-sqlite-wal.test.ts
```

## Boundaries

- The HTTPS sample is a local controlled benchmark, not production traffic or a
  cross-platform latency claim.
- Direct Electron requests use `NetworkPool`; fixed-proxy configuration keeps
  Electron `net.fetch` so Chromium remains responsible for proxy routing and
  bypass rules.
- The SQLite sample measures transaction count and row durability on a real
  temporary database. It does not claim a device-level fsync or power-loss
  benchmark.
- All artifacts are `driven_by: agent`; no real-human evidence is claimed.