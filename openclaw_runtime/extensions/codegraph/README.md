# CodeGraph Runtime Base

CodeGraph is vendored into OpenClaw Runtime as a narrow project-cognition base
layer. It should answer only:

- where task-relevant code probably lives,
- which files/symbols should be read first,
- whether the index is fresh enough to use for navigation.

It is not the final fact source. Any edit or behavior claim must be verified by
reading the real source files.

## Runtime contract

Recommended flow:

```text
codegraph_decide
  -> codegraph_context_plan
  -> direct source read of planned files
  -> edit / validate / test
```

Hard boundaries:

- If the user already named files, read those files directly first.
- Use CodeGraph for location, call-chain, flow, impact, or large-context
  narrowing.
- Use `strict` freshness for high-risk runtime/security/protocol/state tasks.
- Treat `stale`, `unchecked`, low confidence, or missing live files as a signal
  to fall back to grep/search plus direct source reads.
- Do not use CodeGraph as an AST refactoring or quality-governance platform in
  this Runtime base layer.

## Quality gate

Run from `openclaw_runtime/`:

```bash
pnpm test:codegraph-runtime
```

The gate verifies:

- native tool registration count and manifest contract match,
- vendored `dist/` static assets and CommonJS boundary are present,
- temporary TypeScript project indexing works,
- `codegraph_decide` and `codegraph_context_plan` enforce the source-read
  boundary,
- search works,
- fast mode surfaces dirty workspace staleness,
- balanced mode refreshes and recovers high-confidence retrieval.

Metrics are written to:

```text
.artifacts/codegraph-runtime-e2e-metrics.json
```
