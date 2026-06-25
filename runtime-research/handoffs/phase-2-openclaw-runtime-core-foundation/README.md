# Phase 2 Handoff: OpenClaw Runtime Core Foundation

This handoff package governs Phase 2 runtime-core foundation lanes. Phase 2 is a contract and shadow-adapter phase: lanes may document, validate, and propose runtime-core foundation work, but they must not change active runtime behavior as part of the handoff submission.

## Phase Goal

Build the smallest auditable foundation for OpenClaw runtime-core migration:

- canonical runtime-core contracts;
- shadow-only task-loop event capture;
- shadow-only tool invocation protocol mapping;
- shadow-only context provider / loop context pack mapping;
- warning-only evidence verifier shape;
- harness and test evidence for each lane.

This package is governance for lane handoffs. It does not accept implementation work by itself.

## Required Reading

Every lane owner must read these before editing a submission:

- `runtime-research/agent-runtime-index.md`
- `runtime-research/migration-execution-plan.md`
- `runtime-research/implementation-roadmap.md`
- `runtime-research/agent-runtime-core-spec.md`
- `runtime-research/handoffs/phase-1-runtime-surface-inventory/synthesis.md`
- `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md`
- `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submission-template.md`

If a lane touches backend communication paths in a later implementation PR, it must also follow the relevant harness task spec and the `gateway-backend-communication` rule. Handoff-only submissions should record the required spec instead of changing code.

## Lane Output Path

Each lane writes exactly one Markdown submission:

```text
runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/<lane-id>.md
```

Use the lane id as the filename stem. For example:

```text
runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-a-runtime-core-contracts.md
```

The synthesis owner writes or updates only:

```text
runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md
```

Root-level files under `runtime-research/handoffs/` do not count as Phase 2 lane submissions. If old or misplaced files exist, supersede them with a canonical file under `submissions/` and cite the old file as evidence.

## Required Headings

Every lane submission must use these top-level headings, in this order:

1. `## Scope Confirmation`
2. `## Executive Summary`
3. `## Evidence Table`
4. `## Current State`
5. `## Shadow Contract Or Adapter Shape`
6. `## Legacy Behavior Preservation`
7. `## Tests And Harness Evidence`
8. `## Design Conflicts`
9. `## Status`
10. `## Recommended Next Slice`
11. `## Open Questions`
12. `## Handoff Notes`

Do not rename or omit headings. If a section has no findings, write `none found with current evidence` and include the search or file evidence that supports that conclusion.

## Evidence Table Requirements

The `Evidence Table` must be a Markdown table with exactly these columns:

```text
| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
```

Allowed `Evidence Type` values:

- `file`
- `test`
- `command`
- `config`
- `missing-after-search`
- `handoff`

Rules:

- Every material claim in the submission must have a row in the evidence table.
- File evidence must include a repository path and symbol, function, type, or line reference when practical.
- Command evidence must include the exact command run and a short result summary.
- Missing evidence must include the exact search command and the empty or non-matching result.
- Handoff evidence may cite prior handoff files, but it cannot replace code, test, or command evidence for implementation claims.
- Do not use impressions, expected behavior, or inferred ownership as evidence.

## Lane Isolation Rules

Each lane owns only its own output file:

```text
runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/<lane-id>.md
```

Lane owners must not edit:

- another lane's submission file;
- `synthesis.md`;
- root-level handoff files;
- runtime code, renderer code, tests, harness specs, package files, or docs outside this handoff package.

If a lane discovers that another lane needs a correction, record it in `Open Questions` or `Handoff Notes` in the current lane file. The synthesis owner is responsible for reconciling cross-lane conflicts.

## needs_revision Rules

A lane status must be `needs_revision` when any of these are true:

- the submission is not under the required lane output path;
- any required heading is missing, renamed, or out of order;
- the evidence table is missing, has different columns, or has unsupported evidence types;
- any material claim lacks file, test, command, config, missing-search, or handoff evidence;
- the lane changes or endorses active runtime behavior without an explicit shadow-only or warning-only boundary;
- the lane changes files owned by another lane;
- the lane claims a feature flag, test, adapter, or contract exists without local evidence;
- legacy behavior preservation is not addressed;
- conflicts with `agent-runtime-core-spec.md` or Phase 2 synthesis are not recorded under `Design Conflicts`;
- required tests or harness checks are not run and the omission is not explained.

Valid status values are:

- `accepted`
- `needs_revision`
- `blocked`

Use `blocked` only when the lane cannot proceed because required upstream contracts, decisions, or files are absent. A blocked lane still needs the required headings and evidence showing the blocker.

## Final Integration

After lane submissions are complete, the synthesis owner reviews only canonical files under `submissions/*.md` plus cited evidence. The synthesis must classify each lane as `accepted`, `needs_revision`, or `blocked`, and must not treat misplaced root-level handoffs as accepted submissions.
