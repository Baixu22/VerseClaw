---
id: lifecycle-projection-owner
title: Lifecycle consumers use validated trajectory snapshots
type: ai-coding-rule
appliesTo:
  - audit-wiring-remainder
pathPatterns:
  - src/lib/trajectory-view/**
  - src/stores/session-activity.ts
  - src/stores/observability.ts
---

Main supplies validated raw v2 trajectory rows through host-api and host-events.
The renderer assembler owns run/turn/step/tool projection. History and realtime
join by exact sessionKey and sequence; sequence gaps request history repair.
Chat or Observability notifications may request a refresh but must not create
trajectory rows or overwrite projected run lifecycle. Legacy and empty supply
remain explicit no-data. Terminal success, interruption and timeout follow the
runtime state. Git, approval, terminal, queue and subagent state use their current
owners. Tests must exercise the production store or routed page rather than a
disconnected implementation copy.
