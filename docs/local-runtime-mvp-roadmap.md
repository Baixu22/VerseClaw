# Local Runtime Control Plane MVP Roadmap

## Purpose

This document turns the frontier runtime ideas into a bounded MVP plan for the
Verse Claw / OpenClaw local ecosystem. It exists so future development agents
start from the same product boundary instead of re-expanding the scope into a
new runtime, OS kernel, microkernel, or speculative execution platform.

Basis:

- `docs/clawx-design-overview.md`
- `brandnew/前沿思路.md`
- CodeGraph navigation over the current repository
- Direct source review of the files listed below

CodeGraph is a navigation layer only. Any implementation claim must still be
verified against source files before editing.

## MVP Thesis

Build a local runtime control plane around five existing foundations:

1. Context Engineering
2. Dynamic Model Router
3. Skill and MCP Governance
4. Evidence Kernel v0
5. Event-Driven Mission and Task Loop

Do not build Speculative Tool Execution as a standalone runtime direction.
Keep only read-only cache warming under Context Engineering. Do not make eBPF,
Linux cgroup control, or a MicroKernel rewrite part of the default MVP.

## Product Fit

The MVP is shaped for Windows-first desktop usage, mixed local/cloud model
providers, local MCP JSON copy-paste workflows, private API keys, proxies,
enterprise intranet services, and optional local inference through Ollama,
LM Studio, vLLM, and SGLang.

That local ecosystem rewards explainable boundaries more than invisible
automation. The control plane should help users answer:

- What context was sent?
- Why was this model suggested or selected?
- What capability was enabled, and what risk did it carry?
- What evidence proves the task state?
- Why did the long task continue, repair, block, or complete?

## Existing Anchors

Context Engineering:

- `openclaw_runtime/src/context-engine/types.ts`
- `openclaw_runtime/src/context-engine/provider-registry.ts`
- `openclaw_runtime/src/agents/loop-context-pack.ts`
- `openclaw_runtime/src/agents/task-loop-context.ts`
- `openclaw_runtime/src/agents/mission-control/context.ts`

Dynamic Model Router:

- `openclaw_runtime/src/plugins/types.ts`
- `openclaw_runtime/src/plugins/provider-runtime.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/model.ts`
- `openclaw_runtime/src/agents/role-contract.ts`
- `openclaw_runtime/extensions/qwen/**`
- `openclaw_runtime/extensions/deepseek/**`
- `openclaw_runtime/extensions/moonshot/**`
- `openclaw_runtime/extensions/kimi-coding/**`
- `openclaw_runtime/extensions/qianfan/**`
- `openclaw_runtime/extensions/tencent/**`
- `openclaw_runtime/extensions/volcengine/**`
- `openclaw_runtime/extensions/minimax/**`
- `openclaw_runtime/extensions/zai/**`
- `openclaw_runtime/extensions/ollama/**`
- `openclaw_runtime/extensions/lmstudio/**`
- `openclaw_runtime/extensions/vllm/**`
- `openclaw_runtime/extensions/sglang/**`

Skill and MCP Governance:

- `src/lib/capability-audit.ts`
- `src/lib/capability-orchestrator.ts`
- `src/lib/chat-capability-actions.ts`
- `electron/services/skills-api.ts`
- `openclaw_runtime/src/gateway/server-methods/skills.ts`
- `openclaw_runtime/src/skills/lifecycle/install.ts`
- `shared/host-api/contract.ts`
- `shared/types/skill.ts`

Evidence Kernel v0:

- `openclaw_runtime/src/runtime-core/event-log.ts`
- `openclaw_runtime/src/runtime-core/events.ts`
- `openclaw_runtime/src/runtime-core/types.ts`
- `openclaw_runtime/src/runtime-core/evidence-verifier.ts`
- `openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts`
- `openclaw_runtime/src/security-verification-shadow/index.ts`
- `openclaw_runtime/src/trajectory/runtime.ts`
- `electron/services/observability-trajectory.ts`

Event-Driven Mission and Task Loop:

- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `openclaw_runtime/src/agents/mission-control/controller.ts`
- `openclaw_runtime/src/agents/tools/task-loop-tool.ts`
- `openclaw_runtime/src/agents/tools/mission-loop-tool.ts`
- `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts`
- `openclaw_runtime/src/agents/tools/sessions-yield-tool.ts`
- `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts`
- `openclaw_runtime/src/gateway/server-methods/mission-control-methods.ts`
- `electron/gateway/event-dispatch.ts`
- `src/components/agents/RolesOrchestrationPanel.tsx`

## MVP Scope

### 1. Context Engineering MVP

Goal: make context assembly explainable and cache-aware without changing prompt
behavior by default.

MVP behavior:

- Add a shadow-only context report around `LoopContextPack`.
- Preserve current prompt text as authoritative while the report is evaluated.
- Classify context items into stable prefix and dynamic suffix candidates.
- Report P0 preservation, omitted items, truncation, budget pressure, and
  prompt-cache risk.
- Keep diff-aware injection as an input to selection, not as a second prompt
  builder.

Out of scope:

- A second long-context prompt assembler.
- Automatic deletion or rewrite of transcript history before parity proof.
- Context decisions that mutate Task Ledger, Knowledge, or Mission state.

### 2. Dynamic Model Router MVP

Goal: add a deterministic policy recommendation layer over the existing provider
runtime hooks.

MVP behavior:

- Compute a model recommendation using role effort, role risk, task type,
  context pressure, local/cloud availability, privacy preference, latency, and
  observed failure/cost hints.
- Run observe-only first: log the recommendation and reason while preserving the
  selected model.
- Use provider hooks such as `resolveDynamicModel` and `prepareDynamicModel`
  instead of duplicating provider catalogs.
- Keep provider-owned endpoint normalization inside provider plugins.

Out of scope:

- A global black-box router that rewrites all model selections.
- Network-heavy model discovery in synchronous resolution paths.
- Provider-specific string tables in unrelated core code when a plugin hook can
  own the behavior.

### 3. Skill and MCP Governance MVP

Goal: make local capability changes reviewable before they become runnable.

MVP behavior:

- Extend current audit results into a capability action plan that explains
  command, transport, network policy, env/secret exposure, package-manager use,
  lifecycle scripts, remote downloaders, destructive commands, and missing tool
  allowlists.
- Keep chat-triggered enable/register flows behind confirmation and audit.
- Record capability-management traces for accepted or rejected actions.
- Prefer local, pinned, reviewed commands over remote `npx` or downloader
  patterns.

Out of scope:

- Treating plugin install as trust.
- Enabling all exposed MCP tools by default.
- Auto-downloading unpinned remote packages from chat.

### 4. Evidence Kernel v0 MVP

Goal: make task progress and completion claims structurally verifiable in user
space.

MVP behavior:

- Use RuntimeTaskEventLog, EvidenceVerifier, trajectory, and observability as
  the user-space evidence kernel.
- Add a task-scoped evidence summary that links file/test/tool/trace evidence
  and marks missing evidence explicitly.
- Keep shadow verification default-off or observe-only until parity and product
  UX are proven.
- Treat insufficient evidence as a review/blocking signal, not as completion.

Out of scope:

- OS-level immutable audit claims.
- eBPF or cgroup enforcement in the default Windows desktop path.
- LLM-as-judge completion without structural evidence.

### 5. Event-Driven Mission and Task Loop MVP

Goal: connect the control plane to bounded long-task execution without creating
another task database.

MVP behavior:

- Keep Task Ledger as durable work state.
- Keep ClawGraph as durable graph execution state.
- Keep Observability as run evidence.
- Keep Mission as outer policy over Task Loop, ClawGraph, cron/wake, review,
  and governed memory proposals.
- Surface lifecycle, evidence gate, repair budget, context pressure, model
  recommendation, and capability-risk state in one reviewable long-task view.

Out of scope:

- Busy polling subagents instead of push-based completion.
- Ordinary chat implicitly entering long-task state.
- Mission auto-completing goals without Task Ledger and evidence support.

## Explicit Non-Goals

Do not implement a standalone Speculative Tool Execution engine.

Allowed replacement: read-only cache warming under Context Engineering, limited
to deterministic, side-effect-free data such as CodeGraph/source summaries,
known file reads, and local index lookups. It must not execute shell commands,
write files, click browsers, register MCP servers, install skills, or call
external endpoints speculatively.

Do not make eBPF or cgroup control a default product path.

Allowed future: optional enterprise/Linux strong-isolation provider after the
user-space evidence kernel is stable.

Do not rewrite the runtime into a MicroKernel for this MVP.

Allowed future: isolate high-risk Skill/MCP/channel execution through existing
provider/plugin boundaries or sidecar-style adapters, behind explicit task
specs and feature flags.

Do not add another source of truth for work state.

Task Ledger, ClawGraph, Observability, Context Pack, Memory, and Knowledge keep
their existing ownership boundaries from the design overview.

## Delivery Plan

Phase 0: Boundary hardening

- Add the harness task spec and boundary rule.
- Keep this document as the product roadmap.
- Validate the harness spec before implementation tasks begin.

Phase 1: Observe-only reports

- Context report: current pack, omitted items, stable/dynamic split, budget
  pressure, cache-risk diagnostics.
- Router report: recommended model, reason, availability, cost/latency/privacy
  hints, selected-model mismatch.
- Capability report: audit findings and user-confirmed action trace.
- Evidence report: file/test/tool/trace coverage and missing evidence.
- Mission report: current phase, evidence gate, repair budget, blocker, next
  action.

Phase 1 implementation snapshot:

- Runtime report aggregation now lives under
  `openclaw_runtime/src/local-control-plane/**`.
- Reports use `schema=openclaw.local-control-plane.report.v1`,
  `mode=observe`, and `legacyUnaffected=true`.
- Storage is a bounded in-memory ring buffer with no durable task ownership.
- Default-off flags live under `runtime.localControlPlane.*`.
- Read-only Gateway RPCs are `localControlPlane.status`,
  `localControlPlane.reports`, and `localControlPlane.correlations`.
- Renderer-safe typed access is available through
  `hostApi.localControlPlane.status/reports/correlations`; renderer code must
  still not call Gateway HTTP, Gateway WebSocket, or raw IPC directly.
- Correlations are derived on demand from the bounded in-memory report buffer
  by `task`, `run`, `session`, or `evidence`; no report index, durable store,
  or parallel task database is introduced.
- Chat capability actions now project `CapabilityAuditResult`, orchestration
  outcome, and caller-owned confirmation context into LCP-compatible
  capability report envelopes inside the existing capability-management
  Observability trace. This does not persist reports into the runtime ring
  buffer and does not change Skill/MCP enable, register, reload, heartbeat, or
  list-tools behavior.
- Producers are observe-only projections from LoopContextPack/TaskLoop,
  model resolution, Gateway skills/tools-effective capability paths,
  EvidenceVerifier summaries, and Mission/Task Loop lifecycle events.
- MVP still has no UI, no active model routing, no active context pruning, no
  active evidence gate, and no capability auto-enable path.

Phase 1 design closure:

- Context report is closed for MVP when `LoopContextPack` remains the only
  context builder authority, prompt text parity is tested, and the report only
  explains P0 preservation, budget pressure, omitted/truncated items,
  stable-prefix/dynamic-suffix candidates, and cache-risk.
- Model router report is closed for MVP when the actual selected model remains
  legacy-owned, the observe-only recommendation mirrors or explains the legacy
  result, and privacy/local-first/context-pressure/role-effort signals are
  reported without introducing provider catalog duplication.
- Capability report is closed for MVP when Skill/MCP install, update, and
  effective-tool reads are projected as governance diagnostics while existing
  confirmation, audit, allowlist, and install-policy behavior remain
  authoritative.
- Evidence report is closed for MVP when file/test/tool/trace coverage and
  missing evidence are computed from RuntimeTaskEventLog, EvidenceVerifier,
  trajectory, security-verification shadow, and TaskLoop evidence without
  changing completion, repair, blocked, or review decisions.
- Mission report is closed for MVP when Mission and TaskLoop lifecycle events
  explain phase, evidence gate, repair count, next action, and blocked reason
  while Task Ledger, ClawGraph, Observability, and Mission state keep their
  existing ownership.
- Chat capability action projection is closed for MVP when action plans,
  `CapabilityAuditResult`, orchestration results, and caller-owned confirmation
  context are mapped into the same report envelope shape inside Observability
  traces without adding a renderer write path or changing confirmation
  semantics.
- Observability projection is closed for MVP when LCP reports may emit
  lightweight `local_control_plane.report` trace events that omit report
  payloads, carry `durableTaskState=false`, and never drive Task Ledger,
  ClawGraph, Mission, Knowledge, Memory, completion, repair, or blocked
  decisions.
- Active behavior promotion is closed for MVP by
  `harness/specs/tasks/local-runtime-control-plane-active-promotion-boundary.md`:
  active context pruning, active model routing, active evidence gating, and
  stronger Skill/MCP isolation each require a separate follow-up spec, feature
  flag, parity tests, rollback path, and comms checks.

Remaining design points after MVP:

- UI or developer-panel presentation is intentionally deferred. If added, it
  must use the typed host-api bridge above and include Electron E2E coverage.
- Report correlation can become richer later, but it must continue to derive
  from `sessionKey/runId/taskId/evidenceRefs` in the bounded report buffer; do
  not add a parallel task database, durable report store, or independent
  correlation index for this.
- Persisting chat capability action projections into the runtime LCP ring
  buffer is intentionally deferred unless a future design adds an internal,
  non-renderer write path that preserves existing confirmation semantics.
- Active context pruning, active model routing, active evidence gating, and
  stronger Skill/MCP isolation each require their own follow-up task spec
  derived from `local-runtime-control-plane-active-promotion-boundary`, explicit
  feature flag, parity tests, rollback path, and communication checks.
- Observability integration is limited to lightweight `local_control_plane.report`
  trace projections. These events omit report payloads, carry
  `durableTaskState=false`, and must not drive Task Ledger, ClawGraph, Mission,
  Knowledge, Memory, or other durable runtime ownership.

Phase 2: Guided active behavior

- Enable active context selection only after shadow parity tests prove prompt
  safety.
- Allow model routing only for explicitly configured agents or roles.
- Require confirmation for high-risk capabilities.
- Use evidence reports to gate complete/blocked decisions in Task Loop and
  Mission surfaces.

Phase 3: Product surface

- Add a local runtime control-plane view or fold the information into existing
  Agents, Observability, Task Ledger, Skills, and Models surfaces.
- The UI should show decisions, evidence, and risks without exposing a fake
  kernel or hidden automation story.

## Future Vision

The long-term product is a local agent control plane:

- Context becomes bounded, explainable, cache-aware, and diff-aware.
- Model selection becomes policy-driven, provider-aware, and privacy-sensitive.
- Skills and MCP become auditable capabilities instead of blind executable
  strings.
- Runtime progress becomes evidence-backed instead of transcript-backed.
- Mission Control becomes a user-reviewable policy loop over bounded execution.

The local ecosystem vision is not maximum autonomy. It is inspectable autonomy:
users can let the agent work longer because they can see the context, model,
capability, evidence, and lifecycle decisions that shaped the run.

## Required Follow-Up Discipline

Any implementation that touches this roadmap must start from:

```text
pnpm harness context --spec harness/specs/tasks/local-runtime-control-plane-mvp.md
pnpm harness validate --spec harness/specs/tasks/local-runtime-control-plane-mvp.md
```

If the `pnpm` harness shim is unavailable, use:

```text
node harness/src/cli.mjs context --spec harness/specs/tasks/local-runtime-control-plane-mvp.md
node harness/src/cli.mjs validate --spec harness/specs/tasks/local-runtime-control-plane-mvp.md
```

Follow-up implementation specs may split the five modules into narrower tasks,
but they must keep the same non-goals and ownership boundaries unless a new
design overview update explicitly changes them.
