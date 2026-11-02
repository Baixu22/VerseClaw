# Fixture decision record: human prerequisite

- driven_by: agent
- Envelope: HostResponse is reused and no third envelope is created.
- Error type: AppError, declared in src/lib/error-model.ts.
- Sources: shared/host-api/types.ts and electron/main/ipc/host-contract.ts.
- Item states: existing, gap, proposal.
- Declared gaps: renderer-drops-host-error-code, duplicate-host-response-copies.
- Identifiers: the local requestId stays separate from the provider request id.
- Stable per layer: HostErrorCode in Main, APP_ERROR_CODES in the renderer.
- Situations kept apart: recoverability, replay, profile or model switch, post-fix retry, cooldown probing.
- Refusal versus failure: a refusal stays a normal result; FailoverError is only thrown for failover failures.
- Versioning: a version or deprecation window is declared only for a contract with an independent consumer.

Approving a persistent browser task requires a human verdict before the agent may
re-queue it.
