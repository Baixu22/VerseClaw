---
id: provider-error-retry-boundaries
title: Provider Error, Retry-After and Host Error Metadata Boundaries
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - comms
pathPatterns:
  - openclaw_runtime/src/gateway/openai-compat-errors.ts
  - openclaw_runtime/src/gateway/openai-http.ts
  - openclaw_runtime/src/infra/retry.ts
  - src/lib/host-api-client.ts
  - electron/main/ipc/host-invoke.ts
---

Public provider errors must reuse the existing sensitive-text redaction and
500-character provider error budget. Error code metadata is not a trusted
bypass. Every known FailoverReason must have an explicit compatibility mapping;
refusal is not a parameter error, and unknown must not claim responsibility.
After SSE headers are sent, a failure must be emitted as a structured error
event, never as a normal assistant stop with fabricated zero usage.

Finite non-negative Retry-After hints are lower bounds, including fractional
milliseconds. If the hint cannot fit the local maximum delay or the platform
timer limit, stop automatic retry and return the original failure with its retry
metadata. Never truncate that lower bound. For satisfiable hints jitter must not
schedule an early retry. Invalid hints use ordinary backoff.

Renderer host-api failures must preserve the Main response id, code and
structured details through AppError/error-model classification. Main must
normalize nested code/status signals into the existing HostErrorCode envelope
instead of relying on English message text. Correlation ids and safe details
must survive bridge rejection and renderer timeout.

Verification uses synthetic errors, fake timers and loopback requests; no human
data, real credential or paid provider request is required.
