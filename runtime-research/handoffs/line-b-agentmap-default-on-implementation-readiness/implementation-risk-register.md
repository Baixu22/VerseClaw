# Implementation Risk Register

| Risk | Impact | Mitigation | Status |
|---|---|---|---|
| Future default-on spec changes default reviewer prompt bytes | High | Require byte-drift counter and rollback gate tests. | Open for future spec. |
| Candidate text leaks into provider/Gateway/model/checkpoint/lifecycle payloads | High | Sentinel corpus and forbidden field assertions. | Covered by readiness tests/scans. |
| AgentMap provider becomes default or changes ordering | High | Provider ordering test and scan. | Covered by readiness tests/scans. |
| Candidate/shadow/replay output becomes durable | High | Persistence test fields and API scan. | Covered by readiness tests/scans. |
| Telemetry is too weak for rollout | Medium | Future implementation spec must define counters and privacy policy. | Follow-up before rollout. |
| Dirty worktree obscures harness validation | Medium | Record live result and clean overlay proof or remain `needs_follow_up`. | Clean overlay proof passed. |
| Communication path changes sneak in | High | Touched-path scan and comms replay/compare decision. | No readiness-owned communication path changes found. |

No risk in this register permits default-on or default cutover.
