# Validation Plan

## Preconditions

- Phase 8 runtime shadow pilot synthesis is `Status: accepted`.
- Phase 9 runtime shadow replay proof synthesis is `Status: accepted`.
- Phase 10 cutover readiness synthesis is `Status: accepted`.
- Phase 11 controlled cutover pilot synthesis is `Status: accepted`.
- Phase 12 TaskLoop explicit invocation pilot synthesis is `Status: accepted`.
- `runtime-research/agent-runtime-index.md` records accepted AgentMap Phase 8/9/10/11/12 markers.

## Required Validation

1. Validate the new task spec with harness context and validate.
2. Run the focused AgentMap/TaskLoop Vitest set.
3. Run typecheck.
4. Run boundary scans for prompt/model/Gateway/provider, renderer IPC, persistence, mutation/apply, services/listeners, sentinel leakage, and README docs sync.
5. Run comms replay/compare only if this phase touches Main/Gateway/host-api/api-client/provider transport/runtime send-receive/channel/fallback paths.
6. Record replay case results, hard gate pass/fail, quantitative scorecard, and readiness recommendation.

## Vetoes

Any candidate leakage to default prompts/model messages/Gateway/provider transport, provider ordering change, default reviewer prompt byte drift, gate rollback parity failure, automatic AgentMapResult discovery/build/cache/reuse, persistence/service/listener/daemon addition, or AgentMap authority escalation keeps this phase `needs_revision`.
