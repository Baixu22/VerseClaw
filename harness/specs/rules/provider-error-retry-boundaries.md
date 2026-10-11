---
id: provider-error-retry-safety
title: Provider Error and Retry Boundaries
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - comms
---

Public provider error messages and diagnostic previews must reuse the existing sensitive-text
redaction and 500-character provider error budget. Error code metadata is not a trusted bypass.
Apply the same boundary to compatible JSON and SSE outputs and their failure logs.

Finite non-negative Retry-After hints are lower bounds, including fractional milliseconds.
If the hint cannot fit the local maximum delay or the platform timer limit, stop automatic
retry and return the original failure with its retry metadata. Never truncate that lower bound.
For satisfiable hints jitter must not schedule an early retry. Invalid hints use ordinary
backoff. Existing attempts, strict side-effect predicates and defaults remain unchanged.

Verification uses synthetic errors and agent-driven timers/loopback requests; no human data
or paid provider requests are required.
