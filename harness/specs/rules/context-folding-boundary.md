---
id: context-folding-boundary
title: Context Folding and On-Demand Expansion Boundary
type: ai-coding-rule
severity: error
---

# Rule: folded context is an evidence projection, not a new authority

## R1: Original source remains addressable

When a large resource is represented by a handle or selector, the owner keeps the original resource and its revision. A summary, compact view, or child result must not replace the original transcript, CompressionArtifact, Task Ledger fact, Memory card, Knowledge record, or workspace file.

## R2: Expansion is bounded and scoped

Every expansion must require a validated handle/selector, requester identity, owner scope, checksum where available, and a hard character/byte cap. Expansion must fail visibly on stale, missing, ambiguous, cross-session, cross-workspace, or expired references.

## R3: A handle grants no authority

A ContextHandle, selector, archive URI, child result, or summary cannot grant tools, filesystem writes, approval, memory writes, knowledge writes, resource leases, or cross-project access. Permission is decided by the owning runtime surface.

## R4: Child context is folded by contract

A child task may use the tools allowed by its own request, but the parent must receive a `ContextFoldResult` projection containing summary, structured output, evidence refs, unresolved claims, blockers, failed attempts, child identity, and usage. Do not inject the child's raw transcript or unbounded tool output into the parent by default.

## R5: Summary cannot self-accept

A summary or FoldedResult is not a task verdict, completion authority, memory proposal, or release claim. It may provide evidence and next action, but the existing Task Ledger / run / review / memory owners remain authoritative.

## R6: Off-mode parity

The feature flag default must be off. With the feature off, prompt bytes, tool visibility, compaction timing, existing context tools, subagent behavior, and no new durable rows/writes must remain compatible with the baseline. A flag-on path must name a disable-only rollback.

## R7: Evidence before optimization

A route that reduces main-model context but loses required evidence, changes scope, hides a stale reference, or fails the real-task oracle is a failed result. Token savings alone cannot promote the feature.

## R8: Worktree isolation

Changes for this track are made in the dedicated worktree identified by `worktree:context-folding-rlm`. Do not modify or relabel another worktree's nodes, claims, or evidence. The real-task fixture is copied to a disposable `D:/tmp` directory before execution; never modify the checked-in fixture in place.

## R9: Real task is agent-driven

The prepared real task and acceptance artifacts must be labeled `driven_by: agent` and `actor: <agent-name>`. Do not claim real-human evidence, real-user traffic, or production release approval from an agent-driven task run.

## Validation

- `pnpm harness context --spec harness/specs/tasks/context-folding-rlm.md`
- `pnpm harness validate --spec harness/specs/tasks/context-folding-rlm.md`
- `pnpm run typecheck`
- The focused context-folding tests and real-task oracle identified by the task spec.
