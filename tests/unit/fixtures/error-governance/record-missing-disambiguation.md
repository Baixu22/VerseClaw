# Fixture decision record: collapsed disambiguation

- driven_by: agent
- Envelope: HostResponse is reused and no third envelope is created.
- Error type: AppError, declared in src/lib/error-model.ts.
- Sources: shared/host-api/types.ts and electron/main/ipc/host-contract.ts.
- Item states: existing, gap, proposal.
- Declared gaps: renderer-drops-host-error-code, duplicate-host-response-copies.

This fixture keeps every structural anchor but collapses the flagged semantics into
one "retryable error" bucket, so the identifiers, the per-layer code sets and the
five retry-ish situations are no longer separable.
