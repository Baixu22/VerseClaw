---
id: a4-decision-quality-pilot
title: A4 Decision Quality — Active Pilot Gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Promote the A4 decision quality audit from shadow to active pilot, gated by audit coverage and budget compliance.
touchedAreas:
  - openclaw_runtime/src/observability/deprecation-counters.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
requiredTests:
  - tests/unit/deprecation-counters.test.ts
  - tests/unit/performance-budgets.test.ts
acceptance:
  - A4 deprecation counter `lowQualityDecisions` rate ≤ 10% over audited decisions
  - A4 budget violation response `degrade_to_audit_only` triggers when low-quality rate > 10%
  - Per-turn cumulative latency budget respected (A4 is part of degradation order: A4→A3→A5→A1)
docs:
  required: true
---

## Graduation gate

A4 graduates from shadow to active pilot when ALL of the following hold:

1. **Low-quality decision rate** ≤ 10%: `lowQualityDecisions / auditedDecisions ≤ 0.10`.
2. **Audit coverage**: every decision is audited in shadow mode (sampling rate = 1.0).
3. **Budget violation response**: `degrade_to_audit_only` triggers when rate > 10% (criterion 4.14).
4. **Per-turn cumulative budget**: A4 is the first to degrade (degradation order A4→A3→A5→A1).

## Out of scope

- Post-promotion sampling (OQ-004, Stage 5).
- Decision quality scoring model (Stage 5 enhancement).
