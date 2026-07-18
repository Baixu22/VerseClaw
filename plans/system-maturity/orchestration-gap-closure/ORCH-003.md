# ORCH-003 — Bounded A2A contract

Status: todo

Gap: a requested `bounded_a2a` communication mode is currently downgraded to `none` while the result can still advertise it as enabled.

Acceptance:

- [ ] A1 the request/result contract reports the effective mode, never the requested mode;
- [ ] A2 bounded messages enforce recipient, size, and tool policy limits;
- [ ] A3 unsupported bounded A2A fails explicitly rather than silently downgrading;
- [ ] A4 unit, integration, and evidence-manifest gates pass on the committed tree.
