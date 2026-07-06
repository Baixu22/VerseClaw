# Phase 8 AST EditPlan ast-grep Readonly Candidate Generation

Status: accepted_phase_8_ast_editplan_astgrep_readonly_candidate_generation

## Scope

This phase implements the corrected AST route's second slice:

```text
AgentMap/Symbol-selected explicit targets
  -> real ast-grep readonly candidate generation
  -> EditPlan IR plus diagnostics
```

AST remains a structured code-edit planning layer. It is not runtime intelligence, runtime optimization, runtime authority, or task-completion evidence.

## Implemented

- Runtime-core ast-grep adapter using `@ast-grep/napi` for TypeScript/TSX structural pattern matching.
- Explicit caller-owned in-memory targets only.
- Adapter output through the existing `EditPlan` IR, with `source.kind: "ast_grep_readonly_adapter"`.
- Bounded diagnostics, deterministic ordering, source hashes, match ranges, ordered operations, preview diff metadata, conflict diagnostics, and resume drift checks.
- Fixtures and unit coverage for React prop rename, API call migration, import rewrite, Electron IPC route rename, deprecated option removal, invalid rule, overbroad rule, overlap conflict, and fingerprint/range/preview drift.

## Boundary

The adapter does not apply patches, write files, edit workspaces, mutate symbols, invoke TaskLoop, integrate Gateway/Main/renderer/host-api/api-client, change provider transport or ordering, insert prompt/model messages, start services/listeners/daemons, add persistence/cache/database behavior, or enable default-on AST behavior.

The existing TypeScript/TSX text matcher remains a prototype/fallback safety skeleton only. It is not the corrected production AST engine.

ast-grep results, readonly scan output, EditPlan output, preview diffs, match counts, and candidate text remain planning diagnostics only and must not be treated as task-completion evidence.

## Validation

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-astgrep-readonly-candidate-generation.md`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts`

## Next Phase

Future work remains:

```text
AST candidate plan -> Evidence Verifier -> explicit apply gate
```

Any patch apply, workspace edit, symbol mutation, TaskLoop/Gateway/Main/renderer/host-api/api-client integration, provider transport change, prompt/model-message insertion, persistence/cache/database behavior, service/listener/daemon behavior, or default-on behavior requires a fresh accepted task spec.
