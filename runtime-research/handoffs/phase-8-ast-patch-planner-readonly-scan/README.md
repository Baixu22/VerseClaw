# Phase 8 AST Patch Planner Readonly Scan

Status: accepted readonly scan MVP; implementation synthesis is `accepted`.

## Goal

Start the AST Patch Planner with the smallest safe surface:

- validate TypeScript/TSX pattern/fix rules;
- run readonly scans against explicit target files;
- produce match evidence, range diagnostics, and preview diffs;
- record checkpoint metadata needed to detect range drift on resume;
- stop before any apply, workspace edit, symbol mutation, or TaskLoop invocation.

## Non-Negotiable Constraints

1. Do not apply patches or write files.
2. Do not add symbol mutation, rename, replace body, insert before/after, safe delete, or workspace edits.
3. Do not wire planner output into TaskLoop, Gateway, Main, renderer, host-api, api-client, model messages, provider transport, or provider ordering.
4. Do not introduce a service, listener, daemon, local HTTP server, WebSocket server, second Gateway, or second runtime.
5. Preview diffs are diagnostics only and do not count as completed-code evidence.
6. Invalid rules, unbound metavariables, overbroad matches, overlaps, and range drift must fail closed.

## Required Reading

- `runtime-research/agent-runtime-index.md`
- `runtime-research/implementation-roadmap.md`
- `runtime-research/migration-execution-plan.md`
- `runtime-research/agent-runtime-core-spec.md`
- `runtime-research/ast-grep/rule-structure.md`
- `runtime-research/ast-grep/patch-flow.md`
- `runtime-research/ast-grep/useful-tests.md`
- `runtime-research/ast-grep/clawx-mapping.md`
- `harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md`

Then run:

```powershell
rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md
```

## Expected Lanes

- `lane-a-contracts-and-flags`
- `lane-b-rule-validation`
- `lane-c-readonly-scan-preview-diff`
- `lane-d-resume-drift-and-conflict-diagnostics`
- `lane-e-validation-boundary-synthesis`

## Output Rules

Each lane writes exactly one submission under:

```text
runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/<lane-id>.md
```

The synthesis owner writes `synthesis.md`, classifies each lane, and updates `agent-runtime-index.md` only after accepted evidence exists.
