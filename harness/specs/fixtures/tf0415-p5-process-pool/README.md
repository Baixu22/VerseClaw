# TF-0415 P5 process-pool decision evidence

This fixture supports the TF-0415 decision to reject a general long-lived
git/office utilityProcess worker pool for the current Windows x64 Controlled
Preview.

## Files

- `benchmark.mjs`: 30-sample ABBA-style comparison of direct `execFile('git')`
  versus one persistent Node relay that still executes `execFile('git')` per
  job.
- `worker-relay.mjs`: the persistent relay used by the benchmark.
- `worker-overhead.json`: retained Windows sample.
- `acceptance.json`: decision, risks, rollback path, gaps and gates.

## Reproduce

From the repository root:

```powershell
$env:PROCESS_POOL_BENCHMARK_OUT='harness/specs/fixtures/tf0415-p5-process-pool/worker-overhead.json'
node harness/specs/fixtures/tf0415-p5-process-pool/benchmark.mjs
```

The retained independent sample measured direct P50 47.9499 ms and relay P50
47.7009 ms (0.52% improvement), far below the >=50% implementation threshold.

## Boundary

- This is one local Windows sample, not a cross-platform benchmark.
- The relay approximates the lifecycle cost of a persistent utilityProcess but
  is not itself Electron `utilityProcess`.
- The rejection also rests on existing git caching, existing officecli watch
  reuse, and Windows child-process lifecycle risk.
- No production process-pool path was implemented. The P5 implementation gap
  remains explicit and must not be reported as completed.