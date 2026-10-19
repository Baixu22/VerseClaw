# TF-0411 timer/watcher pressure evidence

Agent-driven P3 evidence:

- `timer-shed.json`: controlled six-task workload; non-interactive work runs
  18 times / 93 ms CPU before shed and 6 times / 32 ms CPU while shedding
  (65.6% CPU reduction).
- `watcher-handles.json`: five directory subscriptions over two real temp roots;
  legacy watchers use 5 real `FSWatcher` handles and the hub uses 2 (60%
  reduction).
- `electron-before.json` / `electron-after.json`: real Electron performance
  counters before/after adoption. The retained sample is 4→2 Main live
  intervals; Main activeWatchers is measured 0 in both runs because runtime
  watchers live outside the Main process.

Generate the shed and watcher samples with:

```powershell
$env:RESOURCE_TIMER_SHED_OUT='harness/specs/fixtures/tf0400-timer-watcher/timer-shed.json'
pnpm exec vitest run tests/unit/resource-timer-shed-pressure.test.ts

$env:RESOURCE_WATCHER_PRESSURE_OUT='harness/specs/fixtures/tf0400-timer-watcher/watcher-handles.json'
pnpm exec vitest run tests/unit/resource-watcher-handle-pressure.test.ts
```

Boundary: the handle workload is controlled and the app-level runtime watcher
set includes more complex chokidar watchers that are not part of this bounded
adoption. The Main process itself reports zero watchers; the metric should not
be read as a whole-app watcher count.