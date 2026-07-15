---
id: sekb-hermes-default-off-boundary
title: SEKB Hermes default-off boundary
type: ai-coding-rule
appliesTo:
  - sekb-hermes-gap-closure
requiredProfiles:
  - fast
---

# Boundary: SEKB Hermes default-off

- Master, shadow, and batch flags must default to off.
- Shadow or batch nested flags alone must not enable SEKB capture/injection.
- Flag-off paths must preserve prior non-SEKB behavior (no ambient capture, no ambient LLM).
- `configure-deepseek-runtime` must not enable SEKB unless `--enable-sekb-shadow` is passed.
- No SEKB ops GUI; CLI and Host API only.