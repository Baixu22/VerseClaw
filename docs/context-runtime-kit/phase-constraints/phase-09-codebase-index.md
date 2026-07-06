# Phase 09: Codebase Index MVP

## Goal

Provide deterministic file, line-range, symbol, import hint, and related-test selectors for coding tasks.

## Allowed Changes

- Codebase index module.
- Fixture repositories or fixture files.
- Unit tests for symbol and line-range selectors.
- Staleness tracking based on content hash or commit hash.

## Forbidden Changes

- Full semantic call graph as a hard requirement.
- LLM extraction for deterministic selectors.
- Active prompt routing unless behind a shadow or pilot flag.
- Cross-language SDK work.

## Required Selectors

- `code:file.<path>#L<start>-L<end>`
- `code:symbol.<symbol_name>`
- import dependency hints where cheap and deterministic,
- related-test selectors where cheap and deterministic.

## Required Tests

Use TDD. Add failing tests for:

- file line-range selector resolution,
- symbol selector resolution,
- stable selectors across identical input builds,
- changed source marks old refs stale or creates a new resource version,
- related-test mapping is deterministic when available,
- missing symbols fail closed.

Run:

```powershell
corepack pnpm exec vitest run tests/unit/<codebase-index-tests> --reporter=verbose
corepack pnpm run typecheck
```

## Acceptance

- Symbol lookup fixtures have RRR = 100%.
- Selectors do not drift across identical input builds.
- Staleness is explicit.
- No active prompt behavior changes without a later routing phase.

## Stop Conditions

Stop if the implementation needs a full graph, language server daemon, or non-deterministic LLM extraction.
