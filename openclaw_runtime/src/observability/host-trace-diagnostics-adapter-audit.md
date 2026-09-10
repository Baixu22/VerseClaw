# Host Trace Diagnostics Adapter Audit

Date: 2026-08-28
Scope: TF-0066 / VS-P2-03, VerseShell observability adapter slice

## Decision

No adapter is added in this slice. The current source tree does not expose a
safe production entry point that can supply host-owned lineage, retain the
host-only signing secret, and emit the bounded diagnostic event without
crossing the boundaries frozen by
`harness/specs/tasks/verseshell-p2-trace-diagnostics.md`.

Adding an exported adapter now would create an uncalled production surface and
would make its reachability appear stronger than it is.

## Evidence

- `host-trace-diagnostics.ts` is referenced by its focused test only; no
  production source imports the authority or consumes its summary.
- `verseshell-runtime.ts` is the runtime-side execution bridge. Its result
  shape contains runtime request identity, outcome metadata, and raw failure
  detail, but no host-issued trace envelope or verified host lineage. It also
  owns the existing degradation and native fallback behavior, which this slice
  must not alter.
- `trace-recorder.ts` and `trace-buffer.ts` own the existing runtime trace
  cache. Their trace identifiers are not a substitute for an envelope issued
  by the host authority, and changing either file would violate this slice's
  no-recorder/no-buffer-wiring boundary.
- The existing diagnostic event path is outside the allowed slice and is
  explicitly listed as a forbidden wiring target by the task spec.
- No host-only secret source or host transport handoff is available inside the
  allowed observability files. The P0 ownership rule places host diagnostics
  at ClawX Main/Electron, not in this OpenClaw runtime module.

## Minimum next step

At the actual host boundary, first establish one owner for the secret and the
approved execution lineage. That host path can then issue the envelope after
approval binding and execution-owner selection, verify it before consumption,
derive the bounded summary, and pass only that summary plus bounded result or
artifact metadata to a designated event sink. The follow-up must add the
cross-layer ownership, lineage, and redaction tests before wiring any existing
diagnostic event consumer.

## Reachability verdict

`productionReachable: false`. The contract and its focused test are present,
but no production adapter or production caller exists in this slice.

## Main adapter slice update (2026-08-29)

The first Main adapter slice now has a production caller:

- `electron/services/terminal-api.ts` consumes an approved terminal permission,
  executes through the existing Gateway path, and records only failed results.
- `electron/services/host-trace-diagnostics.ts` owns a process-local HMAC secret,
  derives lineage from the consumed approval, and keeps a 200-record in-memory sink.
- The sink stores only the signed envelope and safe summary. Command, prompt,
  stdout, stderr, approval token, credential, and secret are not copied.
- The renderer, runtime, model, receipt store, support bundle, OTLP, and existing
  diagnostic event path remain unwired.
