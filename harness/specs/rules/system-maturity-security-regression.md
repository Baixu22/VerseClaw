---
id: system-maturity-security-regression
title: System Maturity Security and Fault Regression
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
---

Security and fault-injection scenarios that close System Maturity Findings must
remain runnable from one machine-readable registry. Every scenario has a stable
ID, priority, Finding links, owner, command, and expected fail-closed behavior.

The PR mode must cover all P0/P1 scenarios without silently skipping empty test
shards. The full mode must additionally run communication replay/compare and
the selected built Electron E2E security flows. Any non-zero or missing result
fails the suite and writes a machine-readable report suitable for CI/release
evidence.

The suite composes existing authoritative tests. It must not duplicate runtime
authorization logic, bypass Renderer/Main host-api boundaries, or treat a
report-only result as proof when the underlying command did not execute.
