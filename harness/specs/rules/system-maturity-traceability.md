---
id: system-maturity-traceability
title: System Maturity Traceability and Evidence Freshness
type: ai-coding-rule
appliesTo:
  - system-maturity-traceability
requiredProfiles:
  - fast
---

Every registered Finding must resolve bidirectionally to at least one owned
System Maturity task, a stable test ID, executable test evidence, acceptance
criteria, changed code or governance sources, hash-addressed evidence, and a
bounded review cycle.

Every task and test reference must resolve back to a registered Finding. A
completed task without checked acceptance items and hash-valid evidence fails
closed. Evidence that predates any code, test, task, or policy source it claims
to cover is stale and must downgrade release eligibility until refreshed.

Traceability validation must emit a machine-readable report and include
negative regression coverage for orphan links, stale evidence, and completed
tasks without acceptance evidence.
