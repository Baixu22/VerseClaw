# Line C Grounding Formal Runtime-use Readiness Boundary

This handoff evaluates the next boundary after the accepted Line C Runtime Grounding default-on diagnostics-only metadata helper.

## Current Accepted Surface

- Allowed: runtime-core `createGroundingShadowConsumerSummary` default-on diagnostics-only metadata helper for valid sanitized refs.
- Output remains local, bounded, summary-only, metadata-only, diagnostics-only, and non-authoritative.
- Required markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- Rollback remains `enabled: false` or `killSwitch: true`, both returning disabled/default-off parity.

## Pending Evaluation

- Whether any formal consumer surface can consume diagnostics metadata without becoming runtime authority.
- Whether a future explicit consumer can prove zero drift in prompt text, model messages, provider ordering/selection, Gateway payloads, TaskLoop behavior, runtime decisions, completion/tool/security/approval/retry behavior, persistence, memory writes, and mutation surfaces.
- Whether a formal diagnostics presentation can remain local, bounded, operator-auditable, non-persistent, non-transport, non-prompt, and non-model-message.

## Still Forbidden

- Runtime authority.
- Prompt or model-message injection.
- Provider ordering or provider selection influence.
- Gateway request payload insertion or provider transport mutation.
- TaskLoop authority or runtime decision influence.
- Completion, tool, security, approval, or retry authority.
- Raw retention, `includeRaw: true`, `includeUntrusted: true`, untrusted refs, transcripts, JSONL imports, full payloads, tool args/output, stdout/stderr/env, secrets, API keys, auth headers, traceparent, tracestate, or baggage.
- Persistence, cache, database, sidecar, service, listener, exporter, daemon, or server.
- Memory promotion, fact acceptance, episode write, memory store write, or fact store write.
- Patch apply, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, or safeDelete.
- UI/settings/public API, renderer IPC, host-api/api-client contract, Gateway route, provider registration, or production rollout beyond diagnostics metadata.

## Readiness Verdict

The current files support only the accepted diagnostics-only metadata helper. A more general "formal runtime use" would need a narrower future spec with explicit proof that it does not cross any forbidden boundary.

Because broad formal use would naturally require prompt/model-message/provider/Gateway/TaskLoop/runtime-decision consumption or another forbidden authority surface, it is not ready to proceed under this spec.

## Validation Plan

- Run harness context for the fresh spec.
- Run normal harness validate for the fresh spec.
- If unrelated dirty/untracked worktree state blocks normal validate, run `--no-diff` and record the reason.
- Run diff and boundary scans for the spec/handoff/index-only change.

## Comms Decision

Comms replay/compare are not required for this documentation/spec-only boundary assessment unless implementation touches Gateway events, runtime send/receive, delivery, fallback behavior, Main, host-api, api-client, renderer, or provider transport.
