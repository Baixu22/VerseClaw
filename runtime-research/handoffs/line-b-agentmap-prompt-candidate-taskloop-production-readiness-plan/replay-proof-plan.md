# Replay Proof Plan

## Goal

Phase A proves the explicit TaskLoop pilot against real or near-real samples without changing default behavior. It must show deterministic replay, byte-identical legacy parity when gates are closed, named-surface-only candidate insertion, and fail-closed behavior for every failure path.

## Entry Criteria

- Production readiness plan synthesis is accepted.
- Deep validation remains accepted at 95/100 or higher.
- AgentMap remains default-off.
- Explicit invocation and explicit valid `AgentMapResult` remain required.
- No candidate/replay output persistence exists.

## Replay Corpus

The corpus must include real TaskLoop transcripts when available and near-real synthetic samples only when they preserve the same TaskLoop context shapes. The replay harness must keep candidate output in memory and must not write replay output to app state, localStorage, indexedDB, electron-store, SQLite, JSONL, or any cache.

Required cases:

| Case | Proof Required |
|---|---|
| successful TaskLoop | inserted candidate only when all gates, explicit invocation, and valid result are present |
| failed TaskLoop | legacy parity for failure self-check paths unless explicitly invoked |
| blocked TaskLoop | legacy parity and no candidate authority over blocked/completion decision |
| long context TaskLoop | deterministic bounded output and no prompt-present leakage |
| large candidate set | budget exhaustion fails closed; no silent truncate |
| budget exhausted | legacy bytes, diagnostic, no partial insertion |
| empty candidate | legacy bytes, diagnostic |
| prompt-present files | excluded for POSIX and Windows paths |
| missing AgentMapResult | legacy bytes, `invalid_agent_map_result` |
| invalid AgentMapResult | legacy bytes, `invalid_agent_map_result` |
| explicitInvocation=false | legacy bytes, `invocation_not_requested` |
| one gate closed | legacy bytes, `gate_disabled` |
| each gate rollback | closing each gate restores legacy parity |
| Windows/POSIX path normalization | equivalent exclusion behavior |
| candidate sentinel leakage | sentinel absent from default prompts, lifecycle, checkpoint, Gateway/model/provider payloads |
| lifecycle/checkpoint default payload scan | no candidate text in default payloads |
| provider ordering snapshot | provider order unchanged |

## Determinism Requirements

- Same input produces byte-identical reviewer prompt output for legacy cases.
- Same valid explicit input produces byte-identical pilot reviewer prompt, candidate summary, diagnostics, and metadata except explicitly allowed generated timestamps.
- Provider ordering snapshots remain byte-identical.
- Replay evidence records hashes and counts, not candidate text persistence.

## Exit Criteria

- Replay corpus covers every required case.
- Default-off legacy byte parity drift is zero.
- Candidate leakage count is zero.
- Provider ordering drift is zero.
- All failures fail closed.
- Re-running the replay suite produces deterministic results.
- Score for Replay coverage is at least 19/20 and no veto fires.

## Rejection Criteria

Any veto gate in `production-veto-gates.md` stops Phase A and returns the pilot to default-off diagnostics-only readiness.
