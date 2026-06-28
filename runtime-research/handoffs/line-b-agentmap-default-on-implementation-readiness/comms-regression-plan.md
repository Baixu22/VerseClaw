# Comms Regression Plan

## Decision Rule

Run:

```text
pnpm --config.verify-deps-before-run=false run comms:replay
pnpm --config.verify-deps-before-run=false run comms:compare
```

if this task touches Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, or renderer Gateway calls.

## Current Intended Touches

The intended implementation-readiness work touches only:

- task spec,
- handoff docs,
- focused unit test,
- possibly runtime index status text.

If the touched-path scan confirms no communication path changes in this task, comms replay/compare may be skipped with that explicit reason.
