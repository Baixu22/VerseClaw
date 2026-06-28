---
id: runtime-local-ecosystem-boundary
title: Runtime Local Ecosystem Boundary
type: ai-coding-rule
appliesTo:
  - local-runtime-control-plane-mvp
---

Local runtime control-plane work must preserve the existing Verse Claw /
OpenClaw ownership boundaries.

- Treat CodeGraph as navigation only. Verify behavior claims by reading source.
- Keep Verse Claw Renderer calls behind `src/lib/host-api.ts` and
  `src/lib/api-client.ts`.
- Keep Main/Gateway as the transport and policy boundary. Do not add direct
  renderer Gateway HTTP/WebSocket calls.
- Keep runtime core, context, provider, evidence, task-loop, mission-loop, skill,
  MCP, and observability behavior inside `openclaw_runtime/**` or existing
  Main-owned bridge services.
- Keep Task Ledger as durable work state, ClawGraph as graph execution state,
  Observability as run evidence, and Context Pack as bounded injection.
- Do not add another task database, rule system, mission store, or hidden
  parallel source of truth.
- Do not implement a standalone Speculative Tool Execution engine. Read-only
  cache warming may live under Context Engineering only when it is deterministic,
  side-effect-free, and audited.
- Do not make eBPF, cgroup v2, Linux-only resource control, or OS-level immutable
  audit a default MVP path. These may appear only as optional enterprise/Linux
  providers behind a follow-up task spec.
- Do not rewrite the runtime into a MicroKernel for the MVP. Use existing plugin,
  provider, skill, MCP, Gateway, and runtime-core extension seams first.
- Keep all active behavior behind feature flags or explicit user configuration
  until shadow reports, parity tests, rollback, and docs are complete.
- Do not promote model routing, context pruning, skill/MCP enablement, evidence
  gating, or mission completion from observe-only to active behavior without a
  follow-up harness task spec and validation plan.

