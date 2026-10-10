# P2 issue fix: cross-run observability Problems

Scope: issue #122. This record is agent-authored and does not claim a real
production incident, human verdict, or raw-log inspection.

## Change

- Added `electron/services/observability-problems.ts`, a bounded pure/near-pure
  aggregation layer over the existing sanitized `ObservabilityTraceIndexEntry`
  projection.
- Problem signature: `category + normalized title + model/agent + optional tool
  identity` hashed to a stable fingerprint. Source issue IDs provide
  idempotency, and one Problem occurrence counts at most once per trace.
- Promotion:
  - second occurrence in the seven-day window => `open`
  - critical severity with bounded evidence => `open` immediately
  - below-threshold signatures remain `pending` and are not exported
  - out-of-window traces are excluded
- Export writes one directory per promoted Problem:
  - `manifest.json`: signature, severity, occurrence/trace counts, state,
    timeline, bounded refs, `driven_by: agent`, actor and lifecycle notes
  - `evidence.json`: bounded source refs and evidence previews
  - `resolution.md`: current state, root cause/prevention/resolution fields and
    timeline
- Repeated imports derive from the trace index instead of incrementing a local
  counter. A closed Problem that reappears is reopened in the same artifact
  with a preserved timeline.
- Added `pnpm observability:problems -- --index <trace-index.jsonl> --out <dir>`
  as the agent batch entry. It consumes the existing index and never writes a
  second runtime database.

## Verification

```text
node node_modules/vitest/vitest.mjs run tests/unit/observability-problems.test.ts
pnpm observability:problems --index <fixture-index.jsonl> --out <fixture-output-dir> --now <iso>
pnpm run typecheck:test
```

The unit suite covers duplicate import, same-trace diagnostic de-duplication,
out-of-window exclusion, critical promotion, artifact readback and
closed/reopened state preservation. The CLI run reads back the generated
manifest/evidence/resolution files from disk.