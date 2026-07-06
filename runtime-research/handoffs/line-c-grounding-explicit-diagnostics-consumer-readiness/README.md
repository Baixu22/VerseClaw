# Line C Grounding Explicit Diagnostics Consumer Readiness

This handoff is the narrow next step after broad formal runtime use was marked `needs_revision`.

## Scope

Allowed:

- Define readiness gates for one future explicit diagnostics-only consumer of Line C grounding metadata.
- Preserve the existing accepted default-on diagnostics-only metadata helper.
- Require `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- Keep rollback through `enabled: false` and `killSwitch: true`.

Not allowed:

- Implement the consumer.
- Wire runtime, TaskLoop, Gateway, provider, prompt, model-message, UI, API, persistence, cache, service, listener, exporter, memory write, patch, workspace edit, or symbol mutation paths.
- Treat this readiness package as broad formal runtime-use approval.

## Readiness Gates

1. Scope is exactly one explicit diagnostics-only consumer surface.
2. Consumer must be explicit by callsite and explicit by consumer id.
3. Output must remain local, bounded, metadata-only, summary-only, diagnostics-only, read-only, and non-authoritative.
4. Required markers must remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
5. Prompt text, model messages, Gateway payloads, provider ordering/selection, TaskLoop behavior, and runtime decisions must be byte-identical or prove zero drift.
6. No raw retention, untrusted refs, persistence, cache, service, listener, exporter, database, sidecar, memory promotion, fact acceptance, episode write, patch apply, workspace edit, or symbol mutation may appear.
7. `enabled: false` and `killSwitch: true` must return disabled/default-off parity.

## Veto Conditions

Verdict must become `needs_revision` if a future consumer requires any of these:

- Runtime authority.
- Prompt/model-message/provider/Gateway/TaskLoop/runtime-decision integration.
- Completion/tool/security/approval/retry authority.
- Raw retention or untrusted refs.
- Persistence/cache/service/listener/exporter/database/sidecar.
- Memory promotion, fact acceptance, or episode write.
- Patch apply, workspace edit, or symbol mutation.
- UI/API/transport changes or production rollout.

## Next Step

After this readiness package, a later implementation proposal may target one explicit diagnostics-only consumer only through a new accepted task spec. This package itself does not authorize implementation.
