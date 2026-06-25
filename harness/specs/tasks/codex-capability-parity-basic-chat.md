---
id: codex-capability-parity-basic-chat
title: Codex capability parity for basic chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Bring ordinary Verse Claw chat to Codex CLI capability parity while keeping the OpenClaw runtime architecture and exceeding Codex with governed memory, explicit `/loop` Task Ledger state, and richer UI projections.
touchedAreas:
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - src/stores/chat.ts
  - src/stores/chat/**
  - src/pages/Chat/**
  - src/components/task-ledger/**
  - electron/services/chat-api.ts
  - electron/services/task-ledger-*.ts
  - electron/services/knowledge-api.ts
  - electron/services/workspace-permissions.ts
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/plugins/memory-*.ts
  - tests/unit/**
  - tests/e2e/task-ledger.spec.ts
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - chat-loop-boundary
  - comms-regression
  - docs-sync
expectedUserBehavior:
  - Ordinary chat has full access to file, code, terminal, MCP, Skill, Office, Web, and read-only Knowledge capabilities when the underlying permissions, providers, skills, and approvals allow them.
  - Ordinary chat is lightweight by default: it does not create a Task Ledger root node and does not enter checkpoint, intervention, or loop state machines.
  - Ordinary chat works even when Task Ledger, Knowledge, or Memory writes fail.
  - Every ordinary chat turn has a stable structured projection with user input, assistant final/error state, tool activity, file evidence, approval state, knowledge references, memory citations, and optional turn/run graph projection.
  - Ordinary chat facts are reconstructed from session transcript, runtime turn events, files changed, and approvals; Task Ledger and Knowledge side effects never become the ordinary chat source of truth.
  - Chat may display an ExecutionGraph for the current turn/run, but it is a projection and not a long-term task tree.
  - Memory and Knowledge are visibly effective: selected or auto-attached context is actually read, cited, and linked to the turn.
  - Context injected into model-visible messages is bounded, deterministic, and uses untrusted metadata semantics.
requiredTests:
  - pnpm exec vitest run tests/unit/turn-ledger-recorder.test.ts
  - pnpm exec vitest run tests/unit/chat-runtime-event-handlers.test.ts
  - pnpm exec vitest run tests/unit/chat-knowledge-scope.test.ts
  - pnpm exec vitest run tests/unit/task-ledger-service.test.ts
  - pnpm exec playwright test tests/e2e/task-ledger.spec.ts
  - pnpm exec playwright test tests/e2e/knowledge-hub.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Chat send payloads carry workspace, knowledge mode/references, thinking intensity, response intensity, and optional explicit task/loop linkage only through typed host API.
  - Main-process prompt/context assembly enforces hard caps and stable ordering for Knowledge, Task Ledger, and environment fragments.
  - Main-process prompt/context assembly treats intensity, Knowledge, Task Ledger, and environment fragments as untrusted bounded context and never as capability grants.
  - A mocked ordinary turn with tool/file activity creates a structured turn projection from events, not only assistant text heuristics, without requiring a Task Ledger root.
  - Auto-read knowledge mode proves a real knowledge or memory read occurs before the final assistant message when references are attached.
  - Memory/Knowledge provenance is visible as selected-reference chat payload evidence and auto-read citation metadata; any Knowledge write candidate enters Inbox/draft/proposal review and never applies directly.
  - Runtime tool/file/approval evidence is keyed by the originating run/turn and does not attach to an unrelated currently active turn.
  - Reloading the app reconstructs the same ordinary-turn projection from persisted transcript/runtime evidence.
docs:
  required: true
  note: Keep docs/codex-capability-parity-basic-chat.md updated when parity status or validation requirements change.
---

Codex CLI is the capability baseline, not the architecture target. Verse Claw should preserve its Electron + OpenClaw runtime architecture and use Codex as the minimum bar for ordinary chat fidelity: full ordinary-chat capability access, structured turns, reliable replay, bounded context, tool/file/approval evidence, and memory citations. ClawX can exceed Codex with governed Knowledge/Memory provenance and richer workspace projections, but `/loop` is the explicit entry point for durable long-task state.
