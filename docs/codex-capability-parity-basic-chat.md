# Codex Capability Parity — Basic Chat

This document compares Verse Claw / OpenClaw basic chat capability against the OpenAI Codex CLI capability baseline. The goal is **capability parity and then a ClawX superset**, not copying Codex CLI internals.

Evidence snapshot:

- Codex source clone inspected at `C:/Users/27933/AppData/Local/Temp/codex-src/openai-codex`.
- Local Verse Claw workspace inspected at `C:/Users/27933/Desktop/clawx/ClawX`.
- Codex manual fetch was attempted first but blocked by HTTP 403, so the current public GitHub source is the implementation baseline.

## Target Principle

Basic chat must remain reliable even when optional systems fail:

```text
Chat send/receive is the primary path.
Task Ledger, Memory, Knowledge, Work Mode, and Observability are capability layers.
Capability layers may enrich, project, or audit a turn, but must not break ordinary chat.
```

For capability parity, every ordinary chat turn should have:

1. A stable user-visible transcript.
2. A structured turn identity and lifecycle.
3. Tool/file/approval activity attached to the correct turn.
4. Bounded model-visible context.
5. Recoverable/replayable state after reload or resume.
6. Optional memory/knowledge context with traceable evidence.
7. A durable task/work projection that is stronger than Codex CLI's local turn history.

## Codex Capability Baseline

| Capability | Codex evidence | Baseline behavior |
| --- | --- | --- |
| Incremental context | `AGENTS.md` says model-visible context is built incrementally, not rewritten, with hard caps. | Context updates are bounded and cache-friendly. |
| Turn lifecycle | `codex-rs/app-server-protocol/src/protocol/thread_history.rs` projects `TurnStarted`, `UserMessage`, tool events, `TurnComplete`, and errors into `Turn`. | Every turn can be reconstructed from persisted rollout items. |
| Tool activity | `thread_history.rs` routes exec, patch, MCP, dynamic tool, web search, and approval items by `turn_id`. | Late tool completions still attach to the original turn. |
| File changes | `PatchApplyBegin/End` and apply-patch approval events become file-change items. | File mutation evidence is structured and visible in the turn. |
| Plan state | Protocol imports `UpdatePlanArgs`; TUI renders plan activity. | Planning is a first-class live tool surface. |
| AGENTS instructions | `core/src/agents_md.rs` discovers and renders user/project AGENTS instructions as contextual user fragments. | Repo instructions are model-visible, ordered, and bounded by byte limits. |
| Memory citation | `protocol/src/memory_citation.rs` and `items.rs` attach memory citation metadata to agent messages. | Memory evidence can be shown next to assistant output. |
| Resume/history | `thread_history.rs` rebuilds turns from rollout items and preserves original turn IDs. | Reload/resume uses event replay, not UI-only state. |
| Approvals/safety | Analytics and TUI reducers track command/file/permission approval outcomes. | Risk decisions are explicit turn artifacts. |

## ClawX Current Coverage

| Capability | Current ClawX implementation | Status |
| --- | --- | --- |
| Basic send path | `src/stores/chat/runtime-send-actions.ts` sends through typed `hostApi.chat.sendWithMedia`, then Main proxies to Gateway. | Meets baseline. |
| Workspace discovery | `openclaw_runtime/src/agents/agent-tools.ts` exposes the bounded `ls` tool in ordinary and sandboxed coding sessions; `read` is file-only and directs directory paths to `ls`. | Meets baseline for directory listing without shell access. |
| Transcript/history | `src/stores/chat.ts` loads Gateway history and transcript fallback, with optimistic-message reconciliation. | Meets baseline for visible chat, weaker for structured turn replay. |
| Task projection | `src/stores/chat.ts` and `src/stores/chat/runtime-event-handlers.ts` record final/error turns into Task Ledger via `turn-ledger-recorder`. | ClawX advantage; best-effort derived side channel, not chat source of truth. |
| Active task context | `electron/services/chat-api.ts` injects bounded selected Task Ledger node metadata into the runtime message. | Meets basic parity; only selected node plus parent are included by design. |
| Knowledge routing | `src/pages/Chat/ChatInput.tsx` calls `hostApi.knowledge.routeContext`, suggests or auto-attaches references, and records provenance. `electron/services/chat-api.ts` performs `wiki.get` in auto-read mode before `chat.send`. | Meets basic parity for selected/wiki reads; broader native memory-citation UI remains a follow-up. |
| Memory access policy | `electron/services/workspace-permissions.ts` allows read-only memory RPCs and gates writes. | Meets safety baseline. |
| Work modes | `electron/services/chat-api.ts` injects untrusted Work Mode metadata without changing tool policy. | ClawX advantage for UX intent, but context bloat risk. |
| AGENTS/project docs | Current harness and runtime support AGENTS instructions, but ordinary chat parity needs a hard evidence test. | Partial. |
| Tool/patch turn projection | Runtime tool, patch, command, and approval events are normalized into Task Ledger evidence refs; legacy streaming final tool blocks are also normalized. | Meets basic parity for completed ordinary turns. |
| Approval artifacts | `approval.updated` events are projected into turn metadata and evidence refs. | Meets basic parity for ordinary turn projection. |
| Memory citations | Selected Knowledge/Memory references are linked into Task Ledger evidence; auto-read wiki citations are injected into the model-visible message. | Partial; assistant message-level native memory citation badges remain follow-up. |
| Replay/resume | History hydration rebuilds completed ordinary-turn Task Ledger projections with stable fingerprinted turn IDs. | Meets basic replay projection; live late-event mutation after a completed Ledger append remains limited to idempotent re-append. |

## Coupling Assessment

The current coupling level is acceptable for reliability:

- Chat does not require Task Ledger writes to succeed.
- Chat does not require Knowledge/Memory routing to succeed.
- Work Mode, Knowledge, and Task Ledger metadata are passed as untrusted hints rather than real runtime authority.

The main risk is **context coupling**, not state-machine coupling:

- `electron/services/chat-api.ts` can prepend Knowledge, Work Mode, and Task Ledger blocks to the same user message.
- Codex's own rule is bounded model-visible context with hard caps and stable fragments.
- ClawX should keep feature metadata small, structured, and opt-in by relevance.

## Gaps To Close For Parity

### P0 — Structured Turn Projection

Ordinary chat needs a canonical turn projection similar to Codex's thread history:

- Create or expose a `turnId` for every user turn.
- Attach user message, assistant final/error, tool calls, file changes, approvals, knowledge references, memory citations, and Task Ledger node links to that turn.
- Build Task Ledger turn nodes from structured event data first, assistant-text heuristics second.

Acceptance evidence:

- A final turn with shell/tool/file events produces one Task Ledger child node with tool/file evidence.
- A late tool completion still attaches to the originating turn.
- Reloading the app rebuilds the same turn projection from persisted transcript/runtime events.

### P0 — Real Memory/Knowledge Effectiveness

Current tests prove routing metadata and selected references cross the boundary. They must also prove actual read behavior:

- Auto-read mode triggers `knowledge.get` or runtime memory read for selected/auto references.
- Assistant output carries provenance or citation metadata when memory/knowledge was used.
- Task Ledger turn node links to the memory/wiki references used during the turn.

Acceptance evidence:

- E2E/mock runtime records a `knowledge.get` or `memory.*` read before the final answer.
- Chat UI shows a knowledge/memory citation or provenance marker.
- Task Ledger history includes the reference in turn metadata.

### P1 — Bounded Context Fragments

Replace ad hoc prepended text blocks with bounded, typed context fragments:

- Knowledge context fragment.
- Work Mode context fragment.
- Active Task context fragment.
- Environment/workspace context fragment.

Each fragment needs hard character/token caps and deterministic ordering.

Acceptance evidence:

- Unit test fails if any fragment exceeds configured cap.
- Prompt snapshot test proves stable ordering and omission of irrelevant fragments.

### P1 — Approval And Safety Artifacts

Codex makes approval outcomes part of the turn. ClawX should project:

- Permission request.
- User/auto decision.
- File or command affected.
- Final tool status.

Acceptance evidence:

- A denied command appears in the turn projection and Task Ledger as blocked/deviation evidence.
- Approved file change appears as file evidence.

### P1 — Plan/Task Unification

ClawX can exceed Codex by mapping short-lived plans into durable Task Ledger:

- Codex-style live plan remains lightweight.
- Task Ledger stores durable work structure and decisions.
- Completed plan steps can enrich turn summaries but should not rewrite chat history.

Acceptance evidence:

- A turn with plan updates creates/updates Task Ledger evidence without blocking chat.
- Plan status and Task Ledger node status remain distinguishable.

## ClawX Superset Targets

| Area | Codex baseline | ClawX target |
| --- | --- | --- |
| Turn history | Local rollout -> turn projection | Workspace-wide turn projection + Task Ledger + UI graph |
| Memory | Message citations | Memory/wiki citations + governance + provenance + task links |
| Tasks | Live plan and thread history | Durable task tree/DAG with review, decisions, milestones, and session links |
| UI | TUI/CLI thread view | Electron chat, Task Ledger tree/DAG/history/review, work panels |
| Multi-agent | Collaboration mode/subagents | Role orchestration, mission loop, ClawGraph, channel/remote execution |
| Verification | Tests around reducers/protocol | Unit + Electron E2E + replay metrics + task-specific harness specs |

## Validation Plan

## Validated Evidence

- `tests/e2e/task-ledger.spec.ts` now verifies an ordinary chat send carries `workspaceId` and `activeTaskNodeId`, then a Gateway final assistant event triggers `taskLedger.appendEvents`.
- `src/stores/chat.ts` records final/error turns to Task Ledger as best-effort side effects, so Task Ledger failure does not block ordinary chat.
- `turn-ledger-recorder` now accepts structured runtime events and projects tool calls, touched files, and approval updates into Task Ledger evidence refs and node metadata before falling back to assistant-text heuristics.
- Auto-read knowledge mode now performs a real read (`wiki.get`) for selected references before `chat.send`, then injects bounded citation metadata into the turn.
- User-attached Knowledge/Memory references are projected into Task Ledger evidence refs (`other` for wiki, `memory` for memory) so durable turn nodes link back to the context used.
- Reload/history hydration now rebuilds completed ordinary-turn Task Ledger projections from persisted transcript messages with stable turn IDs, so durable work evidence does not depend solely on live Gateway final events.
- Main-process Knowledge, Work Mode, Task Ledger, and citation metadata fragments now have hard character caps before being prepended to the model-visible message.
- The production coding tool surface includes a workspace-guarded `ls` tool in the Files catalog and `coding` profile; read-only sandboxes retain it, while `read` reports an actionable `ls` instruction for directory paths instead of leaking a raw `EISDIR` error.
- The E2E assertion checks the generated Ledger events create a completed child node under the selected task, include structured tool/file/approval evidence, and link it back to `agent:main:main`.

### Unit

- `turn-ledger-recorder`: parses fenced JSON, heuristics, errors, files, tools, and builds valid events.
- Chat runtime event reducer: final/error/tool events produce deterministic turn projection.
- Chat API context fragments: bounded output and stable ordering.
- Knowledge route/get: auto-read forces actual read calls when references are attached.

### Integration

- Mock Gateway emits `turn_started`, tool begin/end, file change, knowledge read, final.
- Renderer state, Task Ledger snapshot, and transcript agree on turn ID and evidence.
- Late tool completion updates original turn, not the newest active turn.

### E2E

- Send ordinary chat with selected Task Ledger node.
- Auto-attach knowledge reference.
- Mock runtime records knowledge read and emits final.
- Verify:
  - send payload includes `workspaceId`, `activeTaskNodeId`, knowledge mode/references;
  - runtime receives bounded context fragments;
  - Task Ledger page shows turn node, evidence, and session link;
  - Chat side panel updates;
  - reloading app keeps the same projection.

## Immediate Recommendation

Do not increase hard coupling between ordinary chat and Task Ledger/Memory. Instead:

1. Add a canonical ordinary-chat turn projection layer.
2. Feed Task Ledger and Memory provenance from that projection.
3. Keep Task Ledger/Memory writes fire-and-forget.
4. Add hard tests that prove the layers actually run.
5. Use Codex CLI as the baseline for turn fidelity, then exceed it with workspace task graph and governed memory.

## Completion Audit - 2026-06-23

Current evidence proves the basic-chat parity objective for the scoped implementation:

- Codex baseline was inspected from `C:/Users/27933/AppData/Local/Temp/codex-src/openai-codex` at commit `e0ac5d3` (`2026-06-22`), focusing on turn lifecycle, tool/file evidence, approvals, memory citations, bounded context, and replay.
- Ordinary chat remains primary: Task Ledger writes are fire-and-forget, Knowledge/Memory context is read-only metadata, and Work Mode/Task Ledger fragments are untrusted hints.
- Structured turn projection is active in both the main chat store and the legacy runtime-event handler path; runtime tool, patch, command, approval, and legacy `tool_use` blocks become Task Ledger evidence.
- Auto-read Knowledge performs a real `wiki.get` before `chat.send` when selected references are attached, then injects bounded citation metadata.
- Selected Knowledge/Memory references are linked from the user turn into Task Ledger evidence refs.
- Reload/history hydration rebuilds completed ordinary-turn projections using stable fingerprinted turn IDs.

Remaining hardening beyond the current basic parity gate:

- Persist full runtime event logs with transcript history so post-final late completions can update the exact existing turn node rather than re-append idempotently.
- Add native assistant-bubble citation badges for runtime-emitted memory citations, beyond current selected-reference evidence and auto-read citation metadata.
- Add a non-IPC mock Gateway E2E that observes `wiki.get`, `chat.send`, final assistant output, Task Ledger projection, and reload in a single process-level scenario.
