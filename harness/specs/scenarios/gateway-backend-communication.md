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

Allowed flow:
Renderer page/component -> `src/lib/host-api.ts` (typed facade) or `src/lib/host-api-client.ts` (typed request client) -> Electron Main typed host service or IPC handler -> Main-owned OpenClaw Gateway WebSocket -> runtime result -> store/UI.

Renderer code must not own transport selection, direct IPC channels, direct Gateway HTTP calls, retry policy, or protocol fallback.

Renderer code must not create direct Gateway WebSocket connections. Gateway frame diagnostics must be emitted by Main-process Gateway logging.

Provider readiness must recognize resolvable environment SecretRefs in Main without persisting their values. Missing variables, incompatible secret provider sources, and allowlist exclusions must remain unavailable; renderer receives only the existing masked key status.

Channel/plugin migration behavior is also part of this scenario when Verse Claw rewrites OpenClaw config before Gateway launch. Upgrades must preserve single-owner channel registration for migrated plugin-backed channels such as Feishu/Lark.

Chat composer intent metadata, including per-message knowledge scope and work mode, must cross this boundary through the typed host API. Main process may annotate runtime messages with untrusted metadata blocks, but renderer UI state must not bypass host-api/api-client or directly alter Gateway/OpenClaw tool policy.

Tool cancellation must survive runtime adaptation, client delegation, policy evaluation, plugin approval registration, and process input waits. Cancelled calls must not return late success or a pending client handoff. Process polling preserves unread output and the execution owner's terminal status; removing a process prevents late exit callbacks from restoring its entry. Repeated delivery of the same tool outcome must not inflate loop evidence.

Knowledge Librarian model-only QA sends owner-bound reference intent through the agent route. The runtime re-resolves it under the current session and selected provider, then DCS packs complete knowledge units in admitted order. The retained evidence manifest contains only bytes still present in the final context; source, chunk and DCS projection digests remain distinct.

Chat knowledge mode and retrieval profile are independent. Optional reads are bounded and cancellable; session, workspace, scope, profile and query changes fence late responses and preserve the current draft. Preflight inspects owner-checked bytes before attachment. Ordinary queued and media sends retain reference intent, and Used Knowledge binds the user turn to its terminal DCS receipt. See `project-rag-chat-interactions` and its Electron journey.

Retrieval and SourceRef-pinned inspection read the owner's current bytes without materializing imports or derived Markdown. Pinned inspection rechecks permission, revision, digest and raw range; unpinned owner operations retain their existing import refresh path.

Pending preparation and policy promises must release their local wait on cancellation without waiting for the plugin to return. Input acknowledgements must report a process that exited during the write with its owner's terminal status and output. Session alias merges must not duplicate a tool call, and changes to process poll wait duration must not reset otherwise unchanged loop evidence.

Long-session archive and restore mutations cross the same boundary but remain
runtime-owned. The renderer calls the typed sessions host service, Main persists a
lifecycle operation gate and invokes the Gateway method, and the runtime acquires
the existing admission fence before transcript/index/store mutation. A transport
failure or unknown receipt keeps the same operationId open for retry; Main or the
renderer must not sweep, hide success, or perform a second direct transcript
rename. Restore creates a fresh physical generation while retaining the logical
SessionKey, and archived rows are excluded from the live list until the runtime
commit reconciles.

## Explicit coding diagnostics

An explicitly selected runtime diagnostic consumer may observe destructive-tier classification rates through the existing diagnostic logger. It must not create approvals or alter tool effects; missing/expired windows are unavailable, not healthy. See `coding-approval-rate-diagnostics` and task `harness-gap-approval-rate-alerts`. Main-process copies of process-local counters do not count as runtime observations.

## Error governance across this boundary

Every failure that crosses this boundary keeps the single existing `HostResponse` envelope and the existing error taxonomies: `HostErrorCode` in Main and `AppError` plus the closed `APP_ERROR_CODES` set in the renderer. A third envelope, a parallel error class or a second code union must not be introduced here.

A failure that has no class in the renderer set is either mapped or declared as a gap with written evidence; it must never be silently collapsed into a success or into an unmapped string. The renderer keeps the local correlation id generated for the request, and that id must stay distinguishable from the redacted provider-side request id.

Waiting and approval requests raised by this boundary stay fail-closed: an approval type or waiting status that the declared taxonomy does not recognize is held, never auto-approved, and executes no action. The declared taxonomy covers the real status and approval unions in `shared/host-api/contract.ts`, and any new union member fails the governance check until it has a declared decision.

This boundary owns no manual prerequisite: any step that would otherwise need a person is performed by an automated, agent-driven equivalent whose evidence is labelled `driven_by: agent`. A manual verdict is never an acceptance condition for this scenario.

Project RAG operations use the same Host boundary for canonical configuration and explicit index enable, pause, resume, rebuild and cleanup. Main validates configuration before RPC, carries the config base hash, derives the read identity and rejects late status after owner changes. Gateway returns current profile capabilities and indexing/deletion/cleanup state. Paused indexing persists across restart and keeps owner revocation effective. The executable journey is `tests/e2e/project-rag-settings-operations.spec.ts`; its receipt records agent attribution and actual config readback.

Explicit coding relationship requests use the existing context tools and FactStore. Each resolved source and target carries its current file/repository version and passes owner checks before its code enters the tool-result context. Traversal defaults to one hop and stops at two hops or the endpoint cap. `taskLedger.contextHint` derives identity from Main's current workspace/session owner, reads the existing task binding and returns revision, constraints and evidence references. It rechecks identity and task revision without claiming, renewing or editing a task. The normal Chat journey and stale/cross-workspace/rollback checks are in `tests/e2e/project-rag-research.spec.ts`.

Explicit Chat Research uses the typed knowledge start/status/cancel actions. Main freezes the owner selection and total deadline before retrieval; subqueries reuse the same scope. Planning calls pass owner-only token/cost/call limits through the model-only agent route to Provider Spend. Cancellation stops late acceptance, and status delivery rechecks current owner pins. DCS-retained evidence binds quoted coverage and permits deterministic recomputation after budget cuts. The Research journey in `tests/e2e/project-rag-research.spec.ts` records multi-round retrieval, partial/cancelled output, conflicting sources, scope rejection and Local rollback.

Executable governance: `node scripts/check-error-governance.mjs` reconciles the surface declared by `harness/specs/rules/error-governance-boundary.md` with `shared/host-api/types.ts`, `electron/main/ipc/host-contract.ts`, `electron/main/ipc/host-invoke.ts`, `src/lib/host-api-client.ts`, `src/lib/error-model.ts` and this scenario. `tests/unit/error-governance-boundary.test.ts` pins the fail-closed waiting decisions and the rejection of each deliberately broken governance axis. The decisions themselves are recorded in `docs/dev/error-governance-decision-record.md`.

Native memory files and Role Memory cards preserve separate source domains and namespaces across the Host boundary. Memory pins use the backend-only memory.readSource route, which resolves the selected owner and rechecks scope, generation, policy and raw bytes. The selected Runtime Memory diagnostic slot does not become an active file adapter. See project-rag-memory-source-adapters and its source-domain Electron journey.

Knowledge owner revalidation uses `sessions.describe({ key, identityOnly: true })` to read the current canonical key, generation and status from the session owner without model or transcript decoration. Full session descriptions retain their existing default response. Missing, archived or changed generations still fail source admission.
