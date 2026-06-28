# Production Readiness Plan

## Scope

This plan is a staged path from the accepted AgentMap TaskLoop explicit invocation deep validation into production readiness review. It does not enable production use by default.

The plan treats the existing accepted pilot as a controlled, explicit, named-surface experiment:

- current surface: `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`
- current state: default-off by omission
- current invocation: explicit call only
- current input: explicit valid `AgentMapResult` only
- current authority: non-authoritative prompt candidate only
- current persistence: none for candidate/replay output

## Prerequisites

All must hold before any readiness phase starts:

| Prerequisite | Required State |
|---|---|
| Deep validation synthesis | `Status: accepted` |
| Deep validation score | at least 95/100 |
| Runtime index | records accepted deep validation marker |
| Phase 8/9/10/11/12 AgentMap chain | each synthesis remains accepted |
| AgentMap default state | default-off by omission |
| Explicit pilot surface | candidate only enters `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` |

## Phase Ladder

| Phase | Name | Purpose | Production Permission |
|---|---|---|---|
| A | Replay Proof | Replay real or near-real TaskLoop samples against the explicit pilot. | No production default. |
| B | Cutover Readiness Review | Define and prove future cutover gates without enabling cutover. | No production default. |
| C | Controlled Internal Opt-in | Design internal developer-only opt-in with audit and rollback. | Internal only after A and B evidence. |
| D | Limited Production Opt-in | Define narrow production opt-in criteria after accepted A and B. | Opt-in only, never default-on. |
| E | Default-on Proposal | Define prerequisites for a future default-on proposal. | Proposal only, no implementation. |

## Global Entry Gates

- No candidate leakage into default prompts/model messages/Gateway/provider transport.
- Default TaskLoop reviewer prompt byte drift remains zero.
- Provider ordering drift remains zero.
- Default runtime behavior drift remains zero.
- Every AgentMap gate can restore legacy parity.
- No automatic discovery/build/cache/reuse of `AgentMapResult`.
- No candidate/replay persistence.
- No service/listener/daemon/database/WebSocket/HTTP server.
- No runtime/tool/security/approval/retry/completion/provider/model/Gateway authority.

## Global Exit Criteria

The plan can move from readiness planning into Replay Proof when:

- all required artifacts exist;
- veto gates are explicit and enforceable;
- validation plan and command list are complete;
- quantitative score is at least 95;
- required validation passes or any failure is clearly unrelated/blocked with a clean-baseline alternative;
- synthesis is accepted.

## Current Decision

The current pilot is not production-ready and default-on is not allowed. The next recommended stage is Phase A Replay Proof.
