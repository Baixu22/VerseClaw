# P1 batch 1: provider error, retry and host metadata boundaries

- Date: 2026-10-10
- Issues: #116, #117, #118, #119
- driven_by: agent
- actor: codex-p1-batch1
- Base: `origin/main = 578817dd902365fa4ead04911a5d11f456aff782`

## Implemented behavior

1. **#116** - `openai-compat-errors.ts` now has an exhaustive
   `Record<FailoverReason, ...>` mapping. Refusal maps to
   `refusal_error`/422 and unknown maps to a neutral `api_error`/500.
   The Chat SSE fallback emits a structured error event instead of writing
   `Error: internal error` with `finish_reason: stop` and zero usage.
2. **#117** - public provider messages and codes are redacted with mandatory
   built-in patterns before the existing bounded preview. JSON, SSE and their
   failure logs share that boundary.
3. **#118** - `invokeHost` throws `AppError` with the echoed request id,
   mapped renderer class and structured details. Main reads nested
   code/status signals and keeps the existing `HostErrorCode` envelope.
   Bridge rejection and renderer timeout are recorded on the same request id.
4. **#119** - `retryAsync` refuses to shorten a finite non-negative
   Retry-After hint. An unsatisfiable hint stops before `onRetry`,
   `sleep` or a second operation; satisfiable hints use positive-only
   jitter and fractional milliseconds are rounded up.

## Verification boundary

The focused tests use synthetic errors, fake timers and loopback HTTP. They prove
the local boundary behavior, not a real provider account, paid inference,
desktop installation, cross-platform behavior or full-system acceptance. No real
credential is read or written, and no real-human evidence is claimed.
