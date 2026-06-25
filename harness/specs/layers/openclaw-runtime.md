---
id: openclaw-runtime
title: OpenClaw Runtime Layer
type: layer-spec
pathPatterns:
  - openclaw_runtime/**
---

`openclaw_runtime/AGENTS.md` remains the source of truth for runtime subtree policy. Verse Claw harness specs may route integration work, but they must not override runtime-owned architecture rules.

When a Verse Claw task touches runtime files, read the scoped runtime `AGENTS.md` first, then the task/scenario specs that explain the Verse Claw integration surface.

Runtime-facing Verse Claw changes should preserve the selected runtime boundary: Gateway, doctor, helper CLI, and packaged runtime paths must agree on which OpenClaw runtime they use.
