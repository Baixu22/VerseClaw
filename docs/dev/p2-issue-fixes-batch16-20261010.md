# P2 issue fix: bounded runtime performance baseline (#157)

Scope: issue #157. Agent-driven, provider-stub-only; no paid model calls and no
change to frozen GPU/power/concurrency defaults.

## What was added

- `scripts/runtime-perf-benchmark.mjs` + `scripts/lib/runtime-perf-benchmark.mjs`
  run four bounded scenarios and write `artifacts/runtime-perf/report.json`:
  - `idle` - monitor only (noise/reference floor)
  - `single-task` - one async provider-stub round trip plus small CPU work
  - `burst` - many concurrent async units (scheduling pressure)
  - `large-history` - the real `parseUsageEntriesFromJsonl` +
    `aggregateUsageEntries` path over a bounded synthetic transcript
- `scripts/check-runtime-perf-report.mjs` gates the report: a missing scenario,
  zero samples, a work error, an undeclared scope or a missing provider-stub
  disclaimer all fail. Zero samples is never "healthy".
- `pnpm runtime:perf` is the agent-runnable entry point.

## Scope honesty

Each sample records what it measured. In-process CPU/RSS covers **one process**,
and the note says so; the OS tree probe is described as an explicit PID set, not
the whole machine. The provider stub is labelled as scheduling evidence, not real
provider latency.

## Measured result

Two consecutive runs of the canonical command
(`pnpm runtime:perf -- --duration-ms 2000 --sample-interval-ms 200 --history-lines 60000`):

| scenario | event-loop delay p95 (ms) | CPU core ratio p95 | RSS max |
|---|---|---|---|
| idle | 23.5 / 23.2 | 0 / 0 | ~101 MB |
| single-task | 16.1 / 16.5 | 0 / 0 | ~101 MB |
| burst | 16.9 / 16.2 | 0 / 0.16 | ~102 MB |
| large-history | **176.2 / 188.0** | **1.29 / 1.69** | **~276-283 MB** |

A direct split of the production path (60k synthetic lines, ~9.7 MB) measured
`parseUsageEntriesFromJsonl` at ~76-93 ms and `aggregateUsageEntries` at
~52-70 ms per pass, running synchronously on the caller's event loop.

**Hot spot**: the transcript history read/parse/aggregate path. It is the only
scenario that both blocks the event loop (p95 ~176-188 ms) and burns over one
core, and it allocates ~2.8x the idle RSS. This is measured, not inferred from
the presence of `readFile`/`JSON.parse`.

## Not done

No optimization was applied in this batch. The evidence supports incremental or
streaming history parsing as the next candidate, but changing it is a separate
change with its own before/after comparison. No hot spot was assumed from API
names, and no frozen default was touched.