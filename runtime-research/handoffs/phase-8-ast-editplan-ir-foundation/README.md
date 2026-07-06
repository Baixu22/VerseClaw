# Phase 8 AST EditPlan IR Foundation

Status: accepted_phase_8_ast_editplan_ir_foundation

## Scope

This phase implements the first corrected AST route foundation:

```text
AST readonly scan result / future adapters -> EditPlan IR
```

It preserves the route-correction positioning:

```text
AgentMap/Symbol scope
  -> AST candidate plan
  -> Evidence Verifier
  -> explicit apply gate
```

## Implemented

- Runtime-core `EditPlan` types for plan identity, engine identity, source/mode, source scope, target files, source hashes, match evidence, ordered operations, conflict diagnostics, preview diff metadata, verifier requirements, descriptive apply eligibility, authority boundary, and evidence refs.
- A readonly conversion helper from `scanAstPatchPlannerReadonly` results to `EditPlan`.
- Focused unit coverage for shape, readonly scan conversion, unfixable rules, disabled preview diff, and overlap review diagnostics.

## Boundary

The current TypeScript/TSX matcher remains a prototype/fallback safety skeleton only. It is not the corrected production AST engine.

This phase does not implement patch apply, workspace edit, symbol mutation, TaskLoop/Gateway/Main/renderer/host-api/api-client integration, provider transport/order changes, prompt/model-message insertion, persistence/cache/database, service/listener/daemon behavior, default-on behavior, or a real ast-grep adapter.

Preview diff metadata, match counts, candidate text, readonly scan results, and EditPlan output remain planning diagnostics only and must not be treated as task-completion evidence.

## Next Phase

Phase 2 should introduce the real ast-grep readonly adapter behind the same `EditPlan` IR, fed by AgentMap/Symbol scope and reviewed by Evidence Verifier before any later explicit apply gate.
