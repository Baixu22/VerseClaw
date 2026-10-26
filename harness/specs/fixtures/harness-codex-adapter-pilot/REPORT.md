# TF-0568 Harness Adapter Pilot

> Agent-driven evidence. This is one adapter contract plus real adapter protocol probes; it is not product adoption or GA.

## Verdict

- ACPX Codex adapter initialize: pass (protocolVersion 1).
- Codex ACP adapter version: 0.15.0; binary present; upstream-deprecated in the installed dependency tree.
- Auth methods were advertised explicitly; no prompt turn was attempted without credentials.
- OpenCode binary 1.16.2; local session failed before a model turn with a SQLite schema error.
- Native/Codex quality, latency, and cost comparisons: not-run.
- No selector, default, product approval or release state changed.

## Boundaries

- No credentials or private prompts are retained.
- ACP initialize is protocol evidence, not a model-quality or cost verdict.
- OpenCode's failure is local DB schema drift, not a model-quality verdict.

## Protocol lifecycle fixture

- Local ACP mock reached initialize -> session/new -> session/prompt -> session/cancel.
- It proves protocol shape and lifecycle handling only; it is not a model-quality, latency-to-provider, or cost measurement.
