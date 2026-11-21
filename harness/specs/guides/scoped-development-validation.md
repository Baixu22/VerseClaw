---
id: scoped-development-validation
title: Scoped development checks before frozen-candidate release acceptance
type: guide
appliesTo:
  - all
---

The owner confirmed this split on 2026-09-28: development validates the changed
surface; formal release keeps full acceptance against a frozen candidate.

During development, run the smallest tests that exercise the changed production
path, targeted lint and the applicable typecheck. Add a regression for the root
cause. Run comms checks for communication changes, and focused Electron coverage
when the visible interaction changes. Do not launch the full RC-09 suite after
every bug fix. A development run must report commands, exits, counts, timing and
omissions; it cannot claim formal RC acceptance.

For channel startup and the RC-10 driver, use:

- `pnpm run test:channel-startup`: config sync, sidecar and real local IRC transport,
  plus runtime sidecar unit tests. No build, Electron or paid provider.
- `pnpm run check:rc10:dev`: the above, driver argument/CLI regressions, uncached
  typecheck and targeted lint/syntax checks.
- `pnpm run test:integration` includes the channel regression so the existing
  formal integration gate also covers it.

The channel regression uses a supplied startChannels callback and a real IRC
client; it does not load the complete plugin manager or launch Electron. Keep the
live product scenario for that boundary. H-02..H-06 now have their own real-product driver and a focused Electron E2E
spec. H-01, a TCP connection or a fixture cannot stand in for those scenarios.

Before release, finish scenario development and focused checks, freeze the
candidate, then run the existing full Executor/independent Verifier cycle and
H-01..H-06. One full run means one complete acceptance cycle, including both
roles. If it finds a defect, diagnose with focused checks, fix it, refreeze and
repeat the required formal cycle. Old-candidate verdicts and development results
do not transfer to new product code. Do not change retry counts, assertions, skip
budgets, product locks or candidate/digest binding to save runtime.

Harness `fast` is a historical broad profile name (including the root suite),
not a promise of seconds. Use task-specific development commands; use
`harness run --dry-run` to inspect the formal profile without executing it.

For G3 harness lazy-loading development, use `pnpm run test:recovery:light`.
It runs the selection, built-in harness and late bytecode-cache test files with
one worker, serial files and stop-on-first-failure. The cache checks interrupt
isolated Node processes at the command, embedded and selection boundaries.
Keep Windows temporary output on `D:`; linked worktrees also set
`pnpm_config_verify_deps_before_run=false` to reuse their installed dependencies.
This lane records focused development evidence. Frozen G3 acceptance keeps its
existing build, type, real recovery, live-provider and packaging gates.

Concurrent development uses observed capacity. Check active commands, available
memory, CPU and paging before each expensive step; an active chat alone does not
reserve the entire machine. Continue source work and read-only review while one
bounded local check runs. Use serial projects or one test worker when memory is
the constraint, and lower the priority of owned validation processes. Retain
separate output directories and leave other sessions' processes and dependencies
under their owners. Record throttled runs as correctness evidence; performance
gates use their original command and thresholds in a stable measurement window.
