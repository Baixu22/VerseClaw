---
id: sekb-hermes-write-path-boundary
title: SEKB Hermes write-path boundary
type: ai-coding-rule
appliesTo:
  - sekb-hermes-gap-closure
requiredProfiles:
  - fast
---

# Boundary: SEKB Hermes write path

- `confirm_and_save` is the only durable L2 principle write path.
- Batch assistant and deterministic suggest return suggestions only; no automatic principle, memory, ContextBlock, index, or trajectory state mutation before confirmation.
- Offline evaluation artifacts under `artifacts/sekb-hermes-phase-a5/` are non-authoritative; runtime must not read them for decisions.
- Batch evidence table stores aggregate operational metrics only (no raw model I/O, no suggestion text).