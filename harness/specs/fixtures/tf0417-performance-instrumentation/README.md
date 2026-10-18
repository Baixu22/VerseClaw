# TF-0417 Performance Instrumentation

This fixture keeps a real Electron probe for the local performance counters
introduced by TF-0417. The probe reads:

- Main startup marks and process/timer/watcher counters through
  `efficiency.getState().performance`.
- Renderer long-task, input-latency, IPC P50/P95 and first-paint samples from
  the local JSON ring buffer in `localStorage`.

Run the smoke variant:

```powershell
$env:TF0417_DURATION_MS='15000'; node harness/specs/fixtures/tf0417-performance-instrumentation/probe.mjs
```

Run the five-minute baseline:

```powershell
$env:TF0417_DURATION_MS='300000'; node harness/specs/fixtures/tf0417-performance-instrumentation/probe.mjs
```

All output is local and `driven_by: agent`; no network upload or real-human
verdict is involved.
