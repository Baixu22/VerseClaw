---
id: p2-issue-fixes-batch16-20261010
title: P2 issue batch 16 - bounded runtime performance baseline
lifecycleStatus: active
taskType: performance-evidence
intent: Produce a reproducible, bounded runtime performance baseline across idle / single-task / burst / large-history scenarios with explicit process attribution, then rank the measured hot spots so any optimization is justified by samples rather than by API names.
touchedAreas:
  - scripts/**
  - tests/unit/**
  - docs/**
  - docs/README.md
  - harness/specs/**
  - package.json
expectedUserBehavior:
  - Running the benchmark emits a machine-readable report with four non-empty scenarios, explicit measurement scope and bounded durations.
  - The gate rejects a report that claims health without samples, hides a work error, or overstates process scope.
  - The reported hot spot is the large-history transcript read/parse/aggregate path, supported by measured CPU and memory rather than by the presence of readFile/JSON.parse in source.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
humanEvidence: not-required
forbiddenPatterns:
  - treating Agent Dev build/test duration as product runtime performance
  - using a Main-process RSS number as if it were the whole tree or the whole machine
  - claiming real provider latency from a provider stub
  - forcing a refactor when no hot spot is demonstrated
  - an unbounded benchmark that spawns uncontrolled background load
requiredTests:
  - pnpm runtime:perf -- --duration-ms 2000 --sample-interval-ms 200 --history-lines 60000 --out artifacts/runtime-perf/report.json
  - node scripts/check-runtime-perf-report.mjs --report artifacts/runtime-perf/report.json
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-perf-report.test.ts
  - pnpm harness validate --spec harness/specs/tasks/p2-issue-fixes-batch16-20261010.md
acceptance:
  - Issue #157 - idle / single-task / burst / large-history each produce a non-empty sample set, and zero samples, unsupported scope or a work error is never reported as healthy.
  - Issue #157 - every sample carries an explicit scope; in-process CPU/RSS is labelled single-process and the OS tree probe is described as an explicit PID set, not the whole machine.
  - Issue #157 - the benchmark is bounded (duration + sample interval + fixture size) and provider-stub-only with no network or paid model call.
  - Issue #157 - the measured hot spot names a concrete path with CPU/memory evidence; if no hot spot is measured, the no-optimization conclusion is the deliverable instead.
docs:
  required: true
  files:
    - docs/dev/p2-issue-fixes-batch16-20261010.md
---

# P2 issue batch 16

This batch addresses issue #157. It adds a bounded, agent-runnable runtime
performance baseline and gate, records the measured hot spot, and does not
change frozen GPU/power/concurrency defaults.