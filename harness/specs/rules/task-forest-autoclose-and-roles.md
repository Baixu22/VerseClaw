---
id: task-forest-autoclose-and-roles
title: Task Forest Auto-Close Gate and Delivery Roles
type: ai-coding-rule
severity: error
---

# Rule: evidence-complete work closes without a user confirmation gate

## R1: Roles are fixed

The implementing agent is the mainline developer: it chooses the approach, writes the code and
the evidence, and owns correctness. The repository owner acts as the **publisher**: they review
the finished, evidence-backed result and decide whether it is released or shown. The publisher is
not a source of task-level answers.

Therefore no node requirement, acceptance criterion, or handoff prompt may depend on the
publisher answering a design, history, or contribution question. Reconstruct such facts from the
repository record — commits, diffs, task-forest history, deviation ledger, harness reports — and
cite the file or commit. If a fact genuinely exists only in the publisher's head, record the gap
as a limitation instead of blocking the node.

## R2: Acceptance must be checkable from artifacts

Every node's `acceptance_criteria` must be satisfiable by reading repository artifacts or running
a recorded command. "Ask the user whether X" is not an acceptance criterion. An interview may be
requested only for an external authorization listed in R5.

## R3: The auto-close gate

A node moves to `done` as soon as all of the following hold, with no further confirmation:

1. Every acceptance criterion is verified against artifacts on disk, read directly — never from a
   command's printed output alone.
2. The evidence chain of R4 is complete for that node.
3. The proposal's `base_graph_hash` still matches the current graph.
4. The node's claims are self-consistent: titles, summaries, evidence, and status agree with each
   other and with the artifacts, with no criterion silently dropped or reinterpreted.

Then the agent saves the proposal, applies it (`proposal-apply --yes`), runs `validate` and
`export`, and preserves the local state and evidence with the same change. Durable specifications
and curated final evidence remain in source control; Task Forest journals, snapshots, exports,
and handoffs stay local under the repository artifact retention rule. Waiting for a human to
repeat the agent's own verification is not part of this workflow.

This overrides the task-forest skill's default "wait for user confirmation before apply" step for
this repository. The override is deliberate and recorded in the decision node and deviation
ledger, not an accidental skip.

## R4: What counts as a complete evidence chain

- A clean candidate: recorded `candidate.dirty=false` with the commit and tree, and no
  uncommitted source at run time.
- Curated final artifacts written to a tracked path, with a hash manifest covering every file in
  that retained evidence directory and a credential scan reporting zero hits. Raw local runs may
  use a private archive with an explicit provenance/recovery index. Task Forest state and session
  journals remain local; their absence from Git does not invalidate an otherwise complete chain.
- For runtime claims: the raw events, the decision, and the continuation after the decision.
- Reproducible commands for any number quoted, plus the counts they produce.
- Explicit limitations for anything not proven, stated as limitations rather than implied
  successes.
- No fabricated, re-signed, or back-filled values: a number that was not observed in this run is
  labelled as such or omitted.

## R5: Only external authorization stops for the user

Stop and ask only when the next step needs authority the agent does not have:

- publishing, deploying, or making a repository or artifact public;
- rotating, revoking, or newly exposing a credential;
- destructive or irreversible operations (history rewrite, tag/branch deletion, force push);
- changing a product lock or a default value that the project has frozen;
- claiming real-human evidence, or any statement that a human performed the work;
- changing the scope or the definition of done for the project.

Routine closure, status transitions, documentation, evidence generation, and proposal application
are not in this list. Pushing commits or tags to the existing private remote is also normal
development flow, not publication: making the repository or its artifacts public — changing
visibility, publishing to external hosting, or sending them to a third party — is what needs the
publisher's decision.

## R6: No self-declared completion

Rule R3 is a gate on evidence, not on confidence. A node whose artifacts are missing, stale,
contradictory, or unverifiable stays open with the gap written down. Auto-close never means
"declare done and move on"; it means the agent finishes the verification it is already required to
do, then records the outcome without a second human pass.

## R7: Human steps are automated, never required (2026-09-27 amendment)

The repository owner has declared a standing policy — see `AGENTS.md` §Human-in-the-loop policy,
which outranks this rule — that they perform **no human actions and supply no human data** for this
project. Consequences for this rule:

- No node, spec, acceptance criterion, or runbook may require a human step or human data as a
  precondition. "Waiting for the human verdict", "needs a real provider key from the user", and
  "needs a real channel from the user" are **not** valid reasons to keep a node `open` or `blocked`.
- Where a flow was written to need a human — clicking a UI, filling a form, supplying a credential,
  judging a scenario, or recording a verdict — implement the automated agent-driven equivalent: a
  script or agent that performs the steps and writes the artifacts.
- Label those artifacts as agent-driven (`driven_by: agent`, `actor: <agent-name>`). R5's stop on
  *claiming* real-human evidence is unchanged and still binding: dropping the *requirement* for
  human evidence is not permission to *claim* it.
- Where such a flow genuinely needs a third-party model or repository, the owner can supply the
  credential or endpoint on request. Ask for that resource once, then automate against it; a
  resource request is not a task-level question.

## Validation

- `pnpm harness validate --spec harness/specs/tasks/task-forest-autoclose-policy.md`
- `py -3 %USERPROFILE%/.codex/skills/task-forest/scripts/task_forest.py validate`
- `py -3 %USERPROFILE%/.codex/skills/task-forest/scripts/task_forest.py check-landing`
