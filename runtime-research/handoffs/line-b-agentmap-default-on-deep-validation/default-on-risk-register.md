# Default-On Risk Register

| Risk | Veto or follow-up |
|---|---|
| Candidate leakage into default prompts, model messages, Gateway, provider transport, lifecycle, or checkpoint payloads | Hard veto. |
| Provider ordering drift or default AgentMap provider registration | Hard veto. |
| Default TaskLoop reviewer prompt byte drift | Hard veto. |
| Candidate/shadow/replay persistence | Hard veto. |
| Runtime/tool/security/approval/retry/completion/provider/model/Gateway authority escalation | Hard veto. |
| Replay corpus below 100 cases | needs_follow_up. |
| Focused tests or typecheck fail | needs_follow_up or blocked, depending on cause. |
| Harness validation blocked by unrelated dirty tree | needs_follow_up unless clean overlay proof is supplied. |
| Performance/noise cannot be bounded | needs_follow_up. |
| Limited production telemetry still required before implementation | Future implementation-spec input; not approval to enable default-on. |

Default-on implementation requires a future independent implementation spec even if this package reaches `ready_for_default_on_proposal`.
