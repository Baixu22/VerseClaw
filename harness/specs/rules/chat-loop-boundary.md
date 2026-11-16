---
id: chat-loop-boundary
title: Chat Loop Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Ordinary Chat and `/loop` are separate control surfaces.

Hard boundaries:

- Ordinary Chat must keep full Codex-parity capability access: files, code editing, terminal/commands, MCP tools, Skills, Office/document artifacts, Web/search/read, and read-only Knowledge/Memory context are all available when the underlying runtime permissions, providers, skills, and approvals allow them.
- Ordinary Chat is lightweight by default. It must not create a Task Ledger root node, enter checkpoint/intervention/loop state machines, or silently promote a single turn into long-running task state.
- Ordinary Chat facts come from the session transcript, runtime turn events, files changed, and approvals. Task Ledger, Knowledge, Memory, Observability, and UI projections may cite or mirror those facts, but they do not replace them for normal chat replay.
- Ordinary Chat may display an `ExecutionGraph` or similar graph view, but that graph is a projection of the current turn/run events. It is not a long-term task tree, dependency model, or source of task completion truth.
- Task Ledger writes and Knowledge writes are best-effort side effects for ordinary Chat. A failed Task Ledger write, Knowledge draft/inbox write, provenance write, or memory proposal write must never fail an ordinary Chat send/receive path.
- `/loop` is the explicit long-task entry point. Starting `/loop` must create one Task Ledger root node before recoverable long-task state begins.
- `/loop` checkpoints, interventions, decisions, deviations, evidence, review items, session links, and completion/blocking status must attach to the same Task Ledger root node for that loop.
- User interventions in `/loop` modes `guide`, `queue`, `interrupt`, and `revise-goal` must be persisted, including supersession/revision metadata when applicable.
- The composer offers those explicit modes only when the session's latest long-task checkpoint carries a `/loop` Task Ledger root — the same fact `chat.send` checks before accepting an `inputMode`. `available` on the status only means it was readable. Without a root, a draft sent during a run goes out as a plain send and waits in the renderer queue; it must never be sent with an `inputMode` the gateway will reject. While a run is active, the composer shows one Stop control beside Send, keeps the modes behind a single labelled menu rather than a row of icon buttons, and leaves Shift+Enter as a newline.
- Automatic Knowledge deposition from Chat, `/loop`, Task Ledger, ClawGraph, or Mission flows may only create Knowledge Inbox items, drafts, or proposals. It must not call `wiki.apply`, `applyReviewedChange`, archive, delete, merge, or otherwise mutate formal Knowledge without explicit user confirmation.
- Project rules remain sourced from `AGENTS.md` plus `harness/specs/**`. `.clawx/rules/*.md` files are active-workspace supplemental material and inspection/bootstrap inputs only; they must not become a parallel source of truth or a new rules directory hierarchy.
- Work Mode is not a long-term state machine, authority boundary, or capability switch. New work must replace Work Mode with explicit thinking intensity and response intensity preferences, treated as untrusted per-send hints that cannot grant tools, bypass approvals, mutate Task Ledger, or change runtime permissions.
- `LoopContextPack` is the only `/loop` recovery-context generation entry point. Chat, Work Mode/intensity controls, Knowledge, Task Ledger, Mission, or ad hoc renderer code must not each concatenate their own long-context prompt for loop recovery.
