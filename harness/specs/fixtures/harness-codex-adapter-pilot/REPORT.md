# TF-0568 Harness Adapter Pilot

> Agent-driven evidence. This is one adapter contract plus real adapter protocol probes; it is not product adoption or GA.

## Verdict

- ACPX Codex adapter initialize: pass (protocolVersion 1).
- Codex ACP adapter version: 0.15.0; binary present; upstream-deprecated in the installed dependency tree.
- Auth methods were advertised explicitly; no prompt turn was attempted without credentials.
- OpenCode binary 1.16.2; local session failed before a model turn with a SQLite schema error.
- Real-turn comparison is recorded in `real-turns.json`: direct Responses, native OpenClaw, and ACPX Codex all returned exact `PILOT_OK`.
- No selector, default, product approval or release state changed.

## Boundaries

- No credentials or private prompts are retained.
- ACP initialize is protocol evidence, not a model-quality or cost verdict.
- OpenCode's failure is local DB schema drift, not a model-quality verdict.

## Protocol lifecycle fixture

- Local ACP mock reached initialize -> session/new -> session/prompt -> session/cancel.
- It proves protocol shape and lifecycle handling only; it is not a model-quality, latency-to-provider, or cost measurement.


## Real-turn comparison

Scenario: `Reply with exactly: PILOT_OK`, model `space-bunny`.

| Path | Wall latency | Runtime latency | Output | Token usage |
|---|---:|---:|---|---|
| Direct `/v1/responses` | 5,879 ms | - | PILOT_OK | 162 input / 10 output / 172 total |
| Native OpenClaw Gateway | 28,683 ms | 4,466 ms | PILOT_OK | 30,207 input / 6 output / 30,355 total / 142 cache read |
| ACPX Codex adapter | 13,105 ms | - | PILOT_OK | 16,396 used / 258,400 context |

- Quality: exact expected output on all three paths.
- Currency cost: **not-run**; the endpoint returned token usage but no pricing.
- Latency is a single-run measurement, not P50/P95.
- Native wall time includes client polling; `runtimeMs` is the Gateway session runtime.
- ACPX Codex warned that `space-bunny` has no model metadata and used fallback metadata.
