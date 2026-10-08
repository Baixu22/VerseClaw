---
id: local-runtime-control-plane-mvp
title: Local runtime control plane MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Plan and implement a bounded MVP across Context Engineering, Dynamic Model Router, Skill/MCP Governance, Evidence Kernel v0, and Event-Driven Mission/Task Loop while preserving local ecosystem boundaries and avoiding speculative execution, eBPF defaulting, or MicroKernel drift.
ownedPaths:
  - docs/architecture-overview.md
  - harness/specs/tasks/local-runtime-control-plane-mvp.md
  - harness/specs/tasks/local-runtime-control-plane-active-promotion-boundary.md
  - harness/specs/rules/runtime-local-ecosystem-boundary.md
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/local-control-plane/**
  - openclaw_runtime/src/agents/loop-context-pack.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/mission-control/**
  - openclaw_runtime/src/plugins/**
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/security-verification-shadow/**
  - openclaw_runtime/src/trajectory/**
  - openclaw_runtime/src/gateway/server-methods/**
  - openclaw_runtime/src/skills/**
  - electron/services/**
  - electron/gateway/**
  - shared/host-api/contract.ts
  - shared/types/**
  - src/lib/capability-audit.ts
  - src/lib/capability-orchestrator.ts
  - src/lib/chat-capability-actions.ts
  - src/components/agents/**
  - tests/unit/**
  - tests/e2e/**
touchedAreas:
  - docs/architecture-overview.md
  - harness/specs/tasks/local-runtime-control-plane-mvp.md
  - harness/specs/rules/runtime-local-ecosystem-boundary.md
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/local-control-plane/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/plugins/**
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/security-verification-shadow/**
  - openclaw_runtime/src/trajectory/**
  - openclaw_runtime/src/gateway/**
  - openclaw_runtime/src/skills/**
  - electron/services/**
  - electron/gateway/**
  - shared/**
  - src/lib/**
  - src/components/agents/**
  - tests/**
expectedUserBehavior:
  - Users can inspect what context was assembled, what model was recommended, what capability risk was detected, what evidence exists, and why a mission/task loop continued, repaired, blocked, or completed.
  - With MVP feature flags disabled, existing chat, context prompts, model selection, skill/MCP flows, task-loop lifecycle, mission lifecycle, evidence logging, and observability behavior remain unchanged.
  - With observe-only MVP reports enabled, the system records local runtime control-plane diagnostics without changing prompt text, selected model, capability enablement, task status, Gateway payload shapes, approval semantics, or event ordering.
  - Active behavior is enabled only through follow-up task specs, explicit feature flags, user configuration, and parity/rollback proof.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - capability-owner-resolution
  - active-config-guards
  - chat-loop-boundary
  - runtime-local-ecosystem-boundary
  - workspace-harness-single-source
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - standalone Speculative Tool Execution engine
  - speculative shell, file-write, browser-click, skill-install, MCP-register, network-side-effect, or external-endpoint calls
  - eBPF, cgroup v2, Linux-only resource control, or OS-level immutable audit as default MVP behavior
  - MicroKernel rewrite or a second runtime service, daemon, process, port, local HTTP server, WebSocket server, or Gateway instance
  - a parallel task database, mission store, rule system, context store, or hidden source of truth outside Task Ledger, ClawGraph, Observability, Context Pack, Memory, Knowledge, and harness specs
  - renderer direct `window.electron.ipcRenderer.invoke`, direct Gateway HTTP, or direct Gateway WebSocket calls
  - prompt text, model selection, task status, evidence decisions, capability enablement, approval state, retry behavior, errors, or event ordering changes from observe-only reports
  - provider-specific model routing tables in unrelated core code when provider plugins can own endpoint/model behavior
featureFlags:
  - runtime.localControlPlane.contextReport defaults off or observe-only and must preserve prompt text.
  - runtime.localControlPlane.modelRouterReport defaults off or observe-only and must preserve selected model.
  - runtime.localControlPlane.capabilityReport defaults off or observe-only and must not enable or register capabilities automatically.
  - runtime.localControlPlane.evidenceReport defaults off or observe-only and must not change completion/blocking decisions until a follow-up spec promotes it.
  - runtime.localControlPlane.missionReport defaults off or observe-only and must not change mission/task-loop lifecycle decisions.
rollback:
  - Disable runtime.localControlPlane.* flags to return to legacy behavior without data migration.
  - Remove report producers while keeping legacy ContextEngine, provider runtime, Skill/MCP, EventLog, EvidenceVerifier, TaskLoop, Mission, Gateway, and host-api paths intact.
  - Do not depend on deleting user data, replaying persistent dual-write state, or running a second runtime service.
indexUpdateRules:
  - Runtime report types, registries, and descriptors must live under existing runtime-owned paths or existing Main bridge contracts.
  - Shared and Electron may expose typed bridge surfaces, but must not own runtime core decisions, context selection, model routing policy, evidence verification, mission state, or capability risk classification.
  - Follow-up implementation lanes may split this MVP into smaller task specs, but must reference this task or the runtime-local-ecosystem-boundary rule.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/local-runtime-control-plane-mvp.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/local-runtime-control-plane-mvp.md --no-diff
pnpmHarnessAliases:
  - pnpm harness context --spec harness/specs/tasks/local-runtime-control-plane-mvp.md, or node harness/src/cli.mjs context --spec harness/specs/tasks/local-runtime-control-plane-mvp.md when the pnpm shim fails
  - pnpm harness validate --spec harness/specs/tasks/local-runtime-control-plane-mvp.md --no-diff, or node harness/src/cli.mjs validate --spec harness/specs/tasks/local-runtime-control-plane-mvp.md --no-diff when the pnpm shim fails
implementationTestCandidates:
  - pnpm run typecheck, or corepack pnpm run typecheck when the pnpm shim fails
  - pnpm exec vitest run tests/unit/local-control-plane.test.ts tests/unit/host-services.test.ts tests/unit/host-api-facade.test.ts tests/unit/loop-context-pack.test.ts tests/unit/context-provider-registry.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/mcp-api.test.ts tests/unit/mission-control-loop.test.ts tests/unit/provider-model-sync.test.ts tests/unit/model-options.test.ts, or corepack pnpm exec vitest run the same files when dependencies are installed
  - pnpm run comms:replay, or corepack pnpm run comms:replay when communication paths change
  - pnpm run comms:compare, or corepack pnpm run comms:compare when communication paths change
acceptance:
  - The MVP has five modules only: Context Engineering, Dynamic Model Router, Skill/MCP Governance, Evidence Kernel v0, and Event-Driven Mission/Task Loop.
  - Standalone Speculative Tool Execution is excluded; only deterministic read-only cache warming is allowed under Context Engineering.
  - eBPF/cgroup resource control and MicroKernel rewrites are excluded from the default MVP and may only return as optional future providers or sidecar isolation work under separate specs.
  - Observe-only reports cannot change prompt text, selected model, capability enablement, task status, Gateway payload shape, approval semantics, retry behavior, errors, or event ordering.
  - Context work extends `ContextEngine` and `LoopContextPack`; it does not create another long-context assembler or durable task source.
  - Model routing works through provider runtime hooks, role effort/risk, provider availability, and explicit policy; it does not duplicate provider catalogs in unrelated core code.
  - Skill/MCP governance builds on the existing capability audit, host-api confirmation, Gateway skills methods, and lifecycle install policy; install does not equal trust.
  - Evidence Kernel v0 uses user-space RuntimeTaskEventLog, EvidenceVerifier, security-verification shadow, trajectory, and observability; it does not claim OS-level immutability.
  - Mission/Task Loop work preserves Task Ledger as durable work truth, ClawGraph as graph execution state, Observability as run evidence, and push-based completion.
  - Read-only report access is exposed through Gateway RPC and the typed host-api bridge; renderer code must use host-api/api-client and must not call Gateway HTTP, Gateway WebSocket, or raw IPC directly.
  - Report correlation is derived on demand from the bounded in-memory report buffer by sessionKey/runId/taskId/evidenceRefs; it is not durable state and not a parallel task database.
  - Future implementation agents can discover the roadmap, required rules, non-goals, feature flags, rollback, and validation commands from this task spec without relying on chat history.
designClosure:
  - Context report closure means LoopContextPack stays authoritative and prompt parity is proven while the report explains P0 preservation, budget pressure, omitted/truncated items, stable-prefix/dynamic-suffix candidates, and cache risk.
  - Model router report closure means selected models and fallback errors stay legacy-owned while observe-only recommendations report privacy/local-first/context-pressure/role-effort signals without provider catalog duplication.
  - Capability report closure means Skill/MCP governance diagnostics project existing audit, install/update, and effective-tool read paths without changing confirmation, approval, allowlist, install, or auto-enable behavior.
  - Evidence report closure means file/test/tool/trace coverage and missing evidence are reported from existing event, verifier, trajectory, security-shadow, and TaskLoop evidence sources without changing completion, repair, blocked, or review decisions.
  - Mission report closure means lifecycle reports explain phase, evidence gate, repair count, next action, and blocked reason while Task Ledger, ClawGraph, Observability, and Mission state keep existing ownership.
  - Renderer-safe read closure means `hostApi.localControlPlane.status/reports/correlations` mirrors read-only Gateway RPCs and does not expose any flag, report, task, or runtime mutation path.
  - Correlation closure means task/run/session/evidence summaries are computed from current ring-buffer snapshots only, support existing report filters and limits, and disappear with buffer eviction.
  - Chat capability action closure means `CapabilityAuditResult`, orchestration results, and caller-owned confirmation context are projected into LCP-compatible capability report envelopes inside existing Observability traces without changing Skill/MCP confirmation, enablement, registration, reload, or verification behavior.
  - Observability closure means runtime LCP reports may emit lightweight `local_control_plane.report` trace projections with no report payload, `durableTaskState=false`, and no authority over Task Ledger, ClawGraph, Mission, Knowledge, Memory, completion, repair, or blocked decisions.
  - Active promotion closure means active context pruning, active model routing, active evidence gating, and stronger Skill/MCP isolation are blocked behind `local-runtime-control-plane-active-promotion-boundary` and cannot be implemented inside the observe-only MVP spec.
deferredDesign:
  - UI/dev-panel presentation is deferred; it must use the existing host-api bridge and add Electron E2E coverage when introduced.
  - Richer report correlation must still build on sessionKey/runId/taskId/evidenceRefs and must not introduce a durable report store, parallel task database, or independent correlation index.
  - Persisting chat capability action projections into the runtime LCP ring buffer remains deferred unless a future design adds an internal, non-renderer write path that preserves existing confirmation semantics.
  - Active context pruning, active model routing, active evidence gating, and stronger Skill/MCP isolation each require a narrower task spec derived from `local-runtime-control-plane-active-promotion-boundary` with explicit feature flag, parity tests, rollback, and comms checks.
  - Observability integration is limited to lightweight `local_control_plane.report` trace projections that omit report payloads, declare `durableTaskState=false`, and never become Task Ledger, ClawGraph, Mission, Knowledge, Memory, or other durable runtime ownership.
docs:
  required: true
  files:
    - docs/architecture-overview.md
  note: Future implementation tasks must update docs/clawx-design-overview.md and README variants when behavior, flows, public interfaces, or user-visible surfaces change.
---

# Local Runtime Control Plane MVP

This task spec is the durable entry point for implementing the five-module local
runtime control-plane MVP described in `docs/local-runtime-mvp-roadmap.md`.

Use it when work touches context engineering, model recommendation/routing,
Skill/MCP governance, evidence verification/reporting, Mission Control, Task
Loop, Task Ledger projection, Gateway runtime paths, or related UI surfaces.

The first implementation pass should be observe-only. It may record reports,
diagnostics, trace metadata, or review summaries, but it must not change active
runtime behavior until a narrower follow-up task spec promotes one module from
observe-only to active behavior with tests and rollback proof.

## Validation

```text
node harness/src/cli.mjs context --spec harness/specs/tasks/local-runtime-control-plane-mvp.md
node harness/src/cli.mjs validate --spec harness/specs/tasks/local-runtime-control-plane-mvp.md --no-diff
pnpm harness context --spec harness/specs/tasks/local-runtime-control-plane-mvp.md
pnpm harness validate --spec harness/specs/tasks/local-runtime-control-plane-mvp.md --no-diff
```

If the `pnpm harness` shim fails, use the equivalent `node harness/src/cli.mjs`
commands.

## Promotion Rule

Promoting any module from observe-only to active behavior requires a follow-up
task spec that names:

- the exact active behavior being promoted;
- the legacy behavior that must remain available;
- the feature flag or user configuration gate;
- the rollback path;
- parity tests for flag-off behavior;
- shadow/observe-only comparison tests;
- communication regression checks when Main/Gateway/host-api paths change;
- E2E coverage when visible UI changes.
