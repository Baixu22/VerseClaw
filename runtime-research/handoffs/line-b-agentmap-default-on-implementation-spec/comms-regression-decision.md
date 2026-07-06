# Comms Regression Decision

Status: skipped with reason.

## Decision

`pnpm --config.verify-deps-before-run=false run comms:replay` and `pnpm --config.verify-deps-before-run=false run comms:compare` are skipped for this implementation-spec package.

## Reason

This task adds a task spec, internal handoff docs, a focused unit test, and a runtime index entry. It does not touch Main, Gateway, host-api, api-client, provider transport, runtime send/receive, channel delivery, fallback behavior, renderer IPC, renderer Gateway HTTP calls, or renderer Gateway WebSocket calls.

## Boundary

The live worktree contains unrelated dirty communication-path files. This package separates those from the AgentMap implementation-spec files and records clean overlay proof if live harness validation is blocked by unrelated dirty-tree noise.

Future execution must run comms replay/compare if it touches any communication path.
