# Short-Term Foundation

## Goal

Recover the AST route by moving it from runtime-use framing into structured patch engineering.

The immediate implementation foundation is not apply behavior. It is a planning contract that lets future AST engines produce reviewable, verifier-ready edit candidates.

## Target Contract

`EditPlan IR` should capture:

- plan id and engine id;
- source scope from AgentMap/Symbol;
- target files and source hashes;
- match ranges and AST kinds;
- ordered edit operations;
- conflict and overlap diagnostics;
- preview diff text/hash;
- verifier requirements;
- apply eligibility state.

`applyEligibility` should be descriptive only in the first slice:

```text
ineligible: scan invalid, conflict, overbroad match, drift, missing verifier plan
review_required: candidate is valid but needs operator/verifier review
eligible_after_verification: candidate has required evidence but still does not apply itself
```

## Correct Engine Split

Use separate adapters behind the same `EditPlan IR`:

- ast-grep adapter: structural pattern/fix and batch migration candidates;
- TypeScript semantic adapter: imports, symbol-aware call/property rewrites, type-assisted checks;
- LSP/Symbol adapter: rename/reference/diagnostic evidence.

Do not let adapters write files. Adapters return plans.

## Short-Term Done Criteria

- A fresh spec defines `EditPlan IR + ast-grep adapter readonly candidate generation`.
- The current TypeScript/TSX helper is documented as prototype/fallback only.
- Tests prove docs do not claim runtime optimization, default-on behavior, completion evidence, or apply authority.
- Runtime behavior remains unchanged.

## Non-Goals

- no patch apply;
- no workspace edit;
- no symbol mutation;
- no TaskLoop/Gateway/Main/renderer route;
- no provider transport or provider ordering change;
- no prompt/model-message insertion;
- no persistence/service/listener/daemon;
- no default-on AST behavior.
