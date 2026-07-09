# Context Family Goal Runbook

This runbook is the control protocol for long-running Context Family work. It exists so future Goal sessions can develop from documents and acceptance criteria instead of relying on long chat history.

## Fixed Reading Set

Every Context Family Goal must start by reading:

- `AGENTS.md`
- `reports/agent-context-guidance-queue-current-state.md`
- `docs/context-family/goal-runbook.md`
- `docs/context-family/phase-plan.md`
- `docs/context-family/task-slices.md`
- `docs/context-family/goal-prompts.md`
- `harness/specs/scenarios/context-family.md`
- `harness/specs/rules/context-family-boundary.md`
- The active task spec under `harness/specs/tasks/context-*.md`
- Related existing specs when relevant:
  - `harness/specs/tasks/context-runtime-kit.md`
  - `harness/specs/tasks/context-runtime-kit-default-on.md`
  - `harness/specs/tasks/token-dense-recovery-compression-v1.md`
  - `harness/specs/tasks/chat-session-handoff-mvp.md`
  - `harness/specs/tasks/chat-session-runtime-fork.md`

If the Goal is implementation-stage, also run:

```powershell
pnpm harness context --spec harness/specs/tasks/<active-spec>.md
pnpm harness validate --spec harness/specs/tasks/<active-spec>.md
```

## Long Conversation Control

Each Goal owns exactly one stage from `docs/context-family/task-slices.md`. Do not blend two adjacent stages unless the active task spec explicitly says so.

During work:

- Keep changes scoped to the active stage paths.
- Update `docs/context-family/goal-progress.md` after each meaningful checkpoint.
- Record decisions and non-decisions. Non-decisions are useful because they stop later Goals from assuming a boundary was intentionally promoted.
- If context pressure rises, prepare a handoff packet before continuing.
- If evidence conflicts, trust code over design prose and record the correction in `goal-progress.md`.
- If a task discovers a needed runtime behavior outside its scope, add it to the next-stage notes instead of implementing it.

## Handoff Packet

Every Goal must leave this packet in `docs/context-family/goal-progress.md` before completion or handoff:

```markdown
## Handoff Packet

- Objective:
- Status: complete | partial | blocked
- Done:
- In progress:
- Blocked:
- Decisions:
- Files touched:
- Tests run:
- Validation gaps:
- Risks:
- Next action:
```

## Boundary Rules

Context Family work must not:

- Replace Task Ledger, ClawGraph, Observability, Memory, Knowledge, `CompressionArtifact v1`, `LoopContextPack`, or existing Context Pack.
- Create a parallel durable source of truth.
- Store large payloads in the Registry.
- Change prompt text, prompt order, tool execution, approvals, retry behavior, Host API, Gateway RPCs, renderer UI, or storage schema unless the active task spec explicitly authorizes that promotion.
- Claim lossless recovery before an `ArchiveHandle` exists and checksum validation passes.
- Enable observation masking before archive handles exist for the masked payloads.

## Promotion Rule

Shadow work can be implemented under a flag with flag-off parity. Production behavior needs a separate promotion spec with:

- flag-off parity proof;
- rollback path;
- metrics;
- targeted unit tests;
- comms replay/compare when communication paths are touched;
- docs sync when behavior changes.
