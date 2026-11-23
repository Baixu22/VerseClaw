---
id: gateway-backend-communication
title: Gateway Backend Communication
type: runtime-bridge
ownedPaths:
  - src/lib/host-api-client.ts
  - src/lib/host-api.ts
  - src/stores/gateway.ts
  - src/stores/chat.ts
  - src/stores/chat/**
  - electron/main/ipc/**
  - electron/services/**
  - electron/gateway/**
  - electron/preload/**
  - electron/utils/**
requiredProfiles:
  - fast
  - comms
conditionalProfiles:
  e2e:
    when:
      - user-visible gateway status changes
      - user-visible chat send/receive behavior changes
      - channels/agents/settings UI depends on new backend response shape
requiredRules:
  - prompt-cache-observation-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - channel-plugin-migration-guards
  - capability-owner-resolution
  - active-config-guards
  - comms-regression
  - docs-sync
  - error-governance-boundary
forbiddenPatterns:
  - window.electron.ipcRenderer.invoke in src/pages/**
  - window.electron.ipcRenderer.invoke in src/components/**
  - fetch('http://127.0.0.1:18789 in src/**
  - fetch("http://127.0.0.1:18789 in src/**
  - fetch('http://localhost:18789 in src/**
  - fetch("http://localhost:18789 in src/**
  - fetch('http://[::1]:18789 in src/**
  - fetch("http://[::1]:18789 in src/**
  - new WebSocket('ws://127.0.0.1:18789 in src/**
  - new WebSocket("ws://127.0.0.1:18789 in src/**
  - new WebSocket('ws://localhost:18789 in src/**
  - new WebSocket("ws://localhost:18789 in src/**
  - new WebSocket('ws://[::1]:18789 in src/**
  - new WebSocket("ws://[::1]:18789 in src/**
---

Gateway backend communication covers all Verse Claw paths that move data between the visual desktop UI and OpenClaw runtime/backend services.

Coding retirement also crosses this boundary. Legacy Patch Flow requests and restored worker
metadata must not revive proposal-only execution or delayed candidate application. Developer
flags show retired controls as unavailable, while ordinary journal-backed coding and explicit
worktree isolation remain the supported paths. See `harness/specs/tasks/coding-retired-control-admission.md`.

Allowed flow:
Renderer page/component -> `src/lib/host-api.ts` (typed facade) or `src/lib/host-api-client.ts` (typed request client) -> Electron Main typed host service or IPC handler -> Main-owned OpenClaw Gateway WebSocket -> runtime result -> store/UI.

Renderer code must not own transport selection, direct IPC channels, direct Gateway HTTP calls, retry policy, or protocol fallback.

Renderer code must not create direct Gateway WebSocket connections. Gateway frame diagnostics must be emitted by Main-process Gateway logging.

Manual compaction status and writes use the same generation-bound admission check.
Active runs and lifecycle fences keep compression unavailable until release.
Automated readbacks wait within their existing turn budget and pin the mutation
to the observed session generation so a replacement session rejects stale work.

Global session keys use the selected agent or the captured configuration's default
for admission, fork child ownership and parent command-hook workspace resolution.

Provider readiness must recognize resolvable environment SecretRefs in Main without persisting their values. Missing variables, incompatible secret provider sources, and allowlist exclusions must remain unavailable; renderer receives only the existing masked key status.

Channel/plugin migration behavior is also part of this scenario when Verse Claw rewrites OpenClaw config before Gateway launch. Upgrades must preserve single-owner channel registration for migrated plugin-backed channels such as Feishu/Lark.

Chat composer intent metadata, including per-message knowledge scope and work mode, must cross this boundary through the typed host API. Main process may annotate runtime messages with untrusted metadata blocks, but renderer UI state must not bypass host-api/api-client or directly alter Gateway/OpenClaw tool policy.

Tool cancellation must survive runtime adaptation, client delegation, policy evaluation, plugin approval registration, and process input waits. Cancelled calls must not return late success or a pending client handoff. Process polling preserves unread output and the execution owner's terminal status; removing a process prevents late exit callbacks from restoring its entry. Repeated delivery of the same tool outcome must not inflate loop evidence.

Pending preparation and policy promises must release their local wait on cancellation without waiting for the plugin to return. Input acknowledgements must report a process that exited during the write with its owner's terminal status and output. Session alias merges must not duplicate a tool call, and changes to process poll wait duration must not reset otherwise unchanged loop evidence.

Tool admission checks the current session, workspace, configuration and approval before execution. A completed tool's known result retains its call association; configuration changes produced during the call apply to subsequent admissions.

Long-session archive and restore mutations cross the same boundary but remain
runtime-owned. The renderer calls the typed sessions host service, Main persists a
lifecycle operation gate and invokes the Gateway method, and the runtime acquires
the existing admission fence before transcript/index/store mutation. A transport
failure or unknown receipt keeps the same operationId open for retry; Main or the
renderer must not sweep, hide success, or perform a second direct transcript
rename. Restore creates a fresh physical generation while retaining the logical
SessionKey, and archived rows are excluded from the live list until the runtime
commit reconciles.

The opt-in execution-phase recovery path uses the existing TaskFlow row and CAS
revision as its lifecycle owner. Both task-loop and execution writers must select
taskflow before it writes. User intent, assistant dispatch and real tool results
reach stable transcript storage before continuation. Recovery consumes only the
current session generation and active tail; unknown effects remain in explicit
reconciliation and never authorize a repeated tool effect. The read-only authority
shadow records the observed owner outcome, including failed RPC admission.
See `recovery-tool-redispatch` for the frozen fault-window and post-boundary
assistant-readback validation.

After a Gateway restart exceeds a task lease, the same Session generation and
worktree may resume an idle task by advancing its existing owner epoch. Pending
or unknown effects remain a reconciliation barrier, and stale credentials cannot
start a tool under the new epoch.
The first tool request carries its prepared task ID and epoch. Main checks that
owner in the original task transaction before renewing it; a lost admission ACK
replays that decision. A prepared model context adopts the renewed credential only
after the original task table records admission for that exact run. Explicit
handoffs and prior run identities remain fenced.

## Explicit coding diagnostics

An explicitly selected runtime diagnostic consumer may observe destructive-tier classification rates through the existing diagnostic logger. It must not create approvals or alter tool effects; missing/expired windows are unavailable, not healthy. See `coding-approval-rate-diagnostics` and task `harness-gap-approval-rate-alerts`. Main-process copies of process-local counters do not count as runtime observations.

## Error governance across this boundary

Every failure that crosses this boundary keeps the single existing `HostResponse` envelope and the existing error taxonomies: `HostErrorCode` in Main and `AppError` plus the closed `APP_ERROR_CODES` set in the renderer. A third envelope, a parallel error class or a second code union must not be introduced here.

A failure that has no class in the renderer set is either mapped or declared as a gap with written evidence; it must never be silently collapsed into a success or into an unmapped string. The renderer keeps the local correlation id generated for the request, and that id must stay distinguishable from the redacted provider-side request id.

Waiting and approval requests raised by this boundary stay fail-closed: an approval type or waiting status that the declared taxonomy does not recognize is held, never auto-approved, and executes no action. The declared taxonomy covers the real status and approval unions in `shared/host-api/contract.ts`, and any new union member fails the governance check until it has a declared decision.

This boundary owns no manual prerequisite: any step that would otherwise need a person is performed by an automated, agent-driven equivalent whose evidence is labelled `driven_by: agent`. A manual verdict is never an acceptance condition for this scenario.

Executable governance: `node scripts/check-error-governance.mjs` reconciles the surface declared by `harness/specs/rules/error-governance-boundary.md` with `shared/host-api/types.ts`, `electron/main/ipc/host-contract.ts`, `electron/main/ipc/host-invoke.ts`, `src/lib/host-api-client.ts`, `src/lib/error-model.ts` and this scenario. `tests/unit/error-governance-boundary.test.ts` pins the fail-closed waiting decisions and the rejection of each deliberately broken governance axis. The decisions themselves are recorded in `docs/dev/error-governance-decision-record.md`.
