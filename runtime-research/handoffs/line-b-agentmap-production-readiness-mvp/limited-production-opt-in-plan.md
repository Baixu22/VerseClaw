# Limited Production Opt-in Plan MVP

Limited production opt-in is future-only. This Phase B package does not allow production opt-in.

## Future Entry Conditions

- Separate limited-production task spec.
- Separate synthesis accepted after validation.
- Controlled internal opt-in has enough real internal samples.
- No veto gates across internal samples.
- Rollback playbook proven on live internal opt-in.
- Privacy/security review confirms no candidate persistence or authority drift.

## Future Exit Conditions

- Any candidate leakage.
- Any default reviewer prompt byte drift.
- Any provider ordering drift.
- Any persistence of candidate/shadow/replay output.
- Any runtime/tool/security/approval/retry/completion/provider/model/Gateway authority drift.
- Any gate fail-open.

## Future Monitoring Metrics

- coverage
- candidate relevance
- noise rate
- token cost
- latency cost
- fail-closed rate
- leakage count
- provider ordering drift
- rollback success

## Current Phase Decision

Default remains off. Limited production opt-in is not allowed in this phase.
