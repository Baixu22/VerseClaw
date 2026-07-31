---
id: verseshell-single-local-exec-canary-boundary
title: VerseShell single local execution plane canary boundary
severity: error
scope:
  - openclaw_runtime/src/config/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/infra/**
  - openclaw_runtime/src/logging/**
  - openclaw_runtime/extensions/diagnostics-otel/**
  - scripts/uas-06-*
  - artifacts/uas-06-single-local-exec-canary/**
  - docs/dev/verseshell-foundation/**
  - docs/dev/unified-agent-system/**
checks:
  - tools.exec.host=verseshell is accepted only as operator-owned config/session state and remains absent from the model-facing exec parameter enum.
  - Cohort selection is deterministic and scoped; no LLM, command classifier, failure handler, or per-call heuristic chooses VerseShell.
  - Governed VerseShell failure is terminal for that call. Native fallback and process replay are forbidden.
  - Sandbox, node, remote, provider-native, and elevated execution retain their existing owners and are excluded from eligible-local coverage.
  - Diagnostics record route and lifecycle metadata without command text, environment values, approval tokens, or sensitive output.
  - Engineering evidence cannot qualify real provider usage, paired task completion, human recovery, security incidence, ROI, soak, product approval, or TF-0006.
  - A reviewed live observation must retain a zero-drop, low-sensitivity diagnostic route window plus an external provider receipt digest and human recovery attestation. It must not retain command text, prompts, transcripts, credentials, or provider receipt contents.
  - UAS-07 and UAS-08 remain locked until UAS-06 has reviewed real cohort evidence and a confirmed Task Forest closeout.
---

# VerseShell Single Local Execution Plane Canary Boundary

The UAS-06 cohort is selected by operator configuration, not by the Agent model. Inside a selected
scope, the existing `exec/process` facade remains stable and the governed VerseShell lifecycle is
the sole owner of eligible local process creation and control. A governed failure fails closed.

The foundation kill switch stops the route; it does not trigger native fallback. Returning to the
prior execution owner is an explicit operator rollback after in-flight calls have reached a known
terminal or lost state.

Synthetic and engineering matrices remain useful readiness evidence, but their fields must stay
visibly distinct from real provider, human, paired A/B, and soak observations.
