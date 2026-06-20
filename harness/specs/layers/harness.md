---
id: harness
title: Harness Layer
type: layer-spec
pathPatterns:
  - AGENTS.md
  - harness/**
---

The harness is the ClawX-owned agent contract system. It stores scenarios, hard rules, task specs, guides, and layer specs in repo files that AI tools can reload.

Keep `AGENTS.md` lightweight. Put durable, reusable policy in `harness/specs/**`, and make hard constraints machine-checkable when practical.

For new harness behavior, add unit tests under `tests/unit/harness-*.test.ts` and keep CLI output deterministic.
