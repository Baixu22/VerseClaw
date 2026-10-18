# TF-0407 P1 Read Benchmark

This fixture retains both the pure-idle counter-evidence and the controlled
read-path benchmark used by TF-0407.

- `pure-idle-before.json`: pre-P1 + TF-0417 counters, 301148 ms, 7 `execFile`
  spawns.
- `pure-idle-after.json`: P1 + TF-0417 counters, 301113 ms, 7 `execFile` spawns.
  No repeated git reads occurred while idle, so this pair is not a reduction
  claim.
- `before-controlled.json`: pre-P1 + counters, 302727 ms, 298 `git.status`
  reads, 1216 `execFile` spawns.
- `after-controlled.json`: P1, 301892 ms, 297 `git.status` reads, 204
  `execFile` spawns.
- `comparison.json`: 83.22% controlled-path reduction; target >= 80%.

The controlled probe issues `git.status` through the renderer host bridge once
per second with a fixed workspace profile pointing at the tested worktree. It
is intentionally distinct from the pure-idle run and never relabels an idle
result as a controlled benchmark.
