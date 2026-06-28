# Line C Grounding Controlled Internal Opt-in Readiness

This handoff records the readiness proof for keeping Line C Runtime Grounding available only as controlled internal opt-in diagnostics metadata.

## Scope

Accepted scope:

- Spec, validation, readiness report, and runtime index registration only.
- Existing explicit/default-off diagnostics paths: Registry `groundingShadow`; Trace, Symbol, AgentMap, and Runtime Memory `groundingDiagnostics`.
- Readonly, local, bounded, summary-only, diagnostics/metadata-only, non-authoritative output.
- Fixed boundary markers: `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.

Rejected scope:

- Default-on behavior, production cutover, UI, settings, Gateway, IPC, host-api/api-client, provider transport, prompt/model-message assembly, provider ordering, runtime decisions, memory promotion, persistence, patch application, workspace edits, or symbol mutation.

## Files

- `design-research.md`
- `implementation-synthesis.md`
- `deep-validation.md`

## Decision

This stage is accepted only if the required harness checks, targeted unit tests, TypeScript check, diff check, boundary scans, README review, and quantitative deep-validation matrix pass or have documented unrelated/pre-existing blockers.
