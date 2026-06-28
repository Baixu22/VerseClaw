# Implementation Readiness Plan

## Goal

Validate whether AgentMap can move from proposal readiness into a future default-on implementation spec. This is not default-on implementation.

## Sequence

1. Read the existing Line B production-entry and default-on proposal artifacts.
2. Add the implementation-readiness task spec.
3. Add focused implementation-readiness tests proving a corpus of at least 200 cases and every zero-drift/zero-leak/zero-authority counter.
4. Run harness context and harness validate for the new spec.
5. Run the focused AgentMap Vitest suite and typecheck.
6. Run boundary scans for flags, renderer IPC/Gateway, sentinel leakage, persistence, services, mutation/apply/edit, provider ordering, docs/i18n, and touched communication paths.
7. Decide whether comms replay/compare is required from touched paths.
8. Produce one final status only: `ready_for_default_on_implementation_spec`, `needs_follow_up`, or `blocked`.

## Non-Goals

- Do not enable default-on.
- Do not approve default cutover.
- Do not declare production-ready status.
- Do not change default runtime behavior or the default TaskLoop reviewer prompt.
- Do not change provider ordering or default provider registration.
- Do not persist candidate/shadow/replay output.
- Do not add services, listeners, daemons, databases, WebSocket servers, or HTTP servers.
- Do not grant AgentMap runtime/tool/security/approval/retry/completion/provider/model/Gateway/checkpoint/lifecycle authority.
