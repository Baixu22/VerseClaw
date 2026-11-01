---
lifecycleStatus: active
id: session-index-capability-preset-decision
title: Session index and capability preset project decision
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: ee8d58479
intent: Decide whether a rebuildable session index and session capability presets should become a project, using the evidence this line already produced - not an implementation.
touchedAreas:
  - harness/specs/tasks/session-index-capability-preset-decision.md
  - docs/dev/session-lifecycle-control-plane/B1-DECISION.zh-CN.md
  - docs/modules/sessions.md
  - tests/unit/session-lifecycle-decision-doc.test.ts
expectedUserBehavior:
  - No new index, store, adapter or preset is created by this leaf.
  - The decision records the demand evidence, the write set, the owner and the reopening conditions, so a later implementer does not have to re-derive them.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-lifecycle-governance-boundary
  - identity-scope-boundary
  - context-family-boundary
  - docs-sync
  - disk-temp-policy
requiredTests:
  - pnpm exec vitest run tests/unit/session-lifecycle-decision-doc.test.ts --maxWorkers=1
acceptance:
  - The decision document states GO/NO-GO per capability (session index, capability presets) with the evidence behind each.
  - It names the exact write set and owner each GO would require, and the frozen surfaces it must not touch.
  - It records the demand evidence gap: the repository has no measured query latency, no measured session-count pressure, and no user request corpus, so an implementation now would be speculative.
  - A test reads the document from disk and asserts every decision has a status, evidence, write set, owner and reopening condition; a missing section fails.
  - No runtime, schema, store or adapter code is added by this leaf.
docs:
  required: true
  readmeTranslations: not-required
  note: Decision record only; no user-facing flow or default change.
  files:
    - docs/dev/session-lifecycle-control-plane/B1-DECISION.zh-CN.md
    - docs/modules/sessions.md
---

# Session index and capability presets: decision record

This is the B1 leaf (TF-0647). It is a **decision**, not a project: the node's
acceptance criterion is a judgment with evidence, and the non-goals forbid the
implementation.

## What is decided

Two candidate capabilities:

1. **Rebuildable session index** — a derived, rebuildable read model over session
   transcripts and metadata, for cross-session queries.
2. **Session capability presets** — a named set of session-level capability
   settings that can be applied at start.

## Why the default is NO-GO now

The line already has two read models (`session.activitySnapshot`, derivation
lineage) and they are enough for the diagnostics this line needed. What is
missing is not code but demand evidence:

- no measured query latency from a real session corpus in this repo;
- no measured session-count pressure;
- no user-request corpus asking for cross-session search or presets;
- the SessionStore already supports the operations the current UI uses.

Implementing either now would be a second writer/index without a consumer, which
is exactly what the design's §2 withdrawal list warns against.

## Reopening conditions

- A measured query over a real corpus that cannot be answered from the existing
  read models, with latency and session counts recorded.
- A concrete consumer (UI or agent tool) whose acceptance test fails without the
  index/preset.
- An owner named in the change set, and a rebuild path that starts from session
  files only (no second source of truth).

## Non-goals

- No multi-machine SessionStore adapter.
- No new session search index.
- No change to SessionEffectivePolicy semantics.