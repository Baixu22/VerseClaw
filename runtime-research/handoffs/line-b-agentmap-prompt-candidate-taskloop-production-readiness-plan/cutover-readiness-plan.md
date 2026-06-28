# Cutover Readiness Plan

## Goal

Phase B defines future cutover requirements without enabling default cutover. It is a review gate, not a production switch.

## Entry Criteria

- Phase A Replay Proof is accepted.
- No replay veto fired.
- Deep validation and production readiness plan remain accepted.
- AgentMap remains default-off outside explicit pilot invocation.

## Required Proofs

| Proof | Required Result |
|---|---|
| Default reviewer prompt byte drift | 0 |
| Candidate leakage | 0 |
| Provider ordering drift | 0 |
| Default runtime behavior drift | 0 |
| Rollback by any gate | 100% restores legacy parity |
| Candidate/replay persistence | none |
| Automatic discovery/cache/reuse | none |
| Authority escalation | none |

## Cutover Gates

A future cutover review cannot pass unless:

- the default TaskLoop reviewer prompt remains byte-identical unless an explicit future accepted cutover spec changes it;
- model messages, Gateway requests, provider transport, lifecycle payloads, and checkpoints are scanned for candidate leakage;
- provider ordering snapshots are compared before/after;
- each gate is independently reversible;
- no provider, runtime, security, approval, retry, completion, model, Gateway, or tool authority is derived from AgentMap candidate output;
- docs, operator diagnostics, and rollback paths are current;
- UI/config exposure, if any, has i18n and Electron E2E coverage.

## Still Forbidden

- Default-on AgentMap.
- Default TaskLoop prompt cutover.
- Provider ordering changes.
- Automatic AgentMapResult discovery/build/cache/reuse.
- Candidate/replay persistence.
- Runtime authority or completion authority.
- New service/listener/daemon/database/WebSocket/HTTP server.
- Renderer direct IPC or direct Gateway HTTP/WebSocket.

## Exit Criteria

- Every required proof records a passing result.
- All veto gates are evaluated.
- The cutover readiness synthesis explicitly says cutover is not enabled.
- The next phase is limited to Controlled Internal Opt-in design.
