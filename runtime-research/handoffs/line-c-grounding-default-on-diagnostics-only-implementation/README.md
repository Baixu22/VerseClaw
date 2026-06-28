# Line C Grounding Default-on Diagnostics-only Implementation

Status: accepted.

## Allowed Surface

- Runtime-core diagnostics summary helper default-on behavior for valid sanitized `GroundingRef` inputs.
- Bounded local metadata-only summaries with `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- Explicit rollback through `enabled: false` and emergency rollback through `killSwitch: true`.
- Fail-closed disabled diagnostics for missing refs, invalid refs, invalid limit/token budget, and exhausted budget.

## Forbidden Surface

- Runtime authority, prompt/model-message/provider-ordering/provider-selection/runtime-decision authority, TaskLoop authority, completion/tool/security/approval/retry authority, Gateway/provider transport changes, Main/renderer/host-api/api-client changes, persistence/database/sidecar/cache/exporter/listener/service, raw retention, untrusted refs, memory promotion, fact acceptance, episode write, patch apply, workspace edit, symbol mutation, UI/settings/public API changes, or production rollout beyond this diagnostics helper.

## Implementation Summary

- `createGroundingShadowConsumerSummary` now defaults to diagnostics-on when valid refs are supplied.
- `enabled: false` and `killSwitch: true` force disabled/default-off parity with zero items.
- Default-on diagnostics metadata carries explicit default-on, boundary, raw, and authority markers.
- Shared grounding metadata sanitization rejects prompt/model-message/provider-ordering/provider-selection/runtime-decision/Gateway-request metadata keys in addition to raw and authority markers.

## Rollback

Set `enabled: false` or `killSwitch: true` at the diagnostics helper call site. Both paths return disabled diagnostics with no items and no accepted refs.

## Validation Plan

- Harness context and validate for the implementation spec.
- Focused Vitest coverage for default-on metadata, explicit disable, kill switch, fail-closed behavior, boundary markers, and registry/provider drift.
- Node TypeScript check.
- Diff check, boundary scan, README review, and comms decision.

## Validation Results

- Harness context passed for the default-on implementation spec.
- Normal harness validate failed because the worktree already contains unrelated dirty/untracked files outside this task's owned surface; `validate --no-diff` passed.
- Focused Vitest passed: 3 files / 12 tests.
- Node TypeScript check passed.
- `git diff --check` passed for touched task files.
- Boundary scan found only expected spec/test/sanitizer references and no new runtime authority, prompt/model-message/provider-ordering/provider-selection/runtime-decision, raw retention, persistence, mutation, UI, API, or transport surface.
- README.md, README.zh-CN.md, README.ja-JP.md, and README.ru-RU.md were reviewed by search; no update is required because this change is a runtime-core helper and tests only, with no user-visible UI/API/settings/command flow.
- Comms replay/compare were not run because this change did not touch Gateway events, runtime send/receive, channel delivery, fallback behavior, Main, host-api, api-client, renderer, or provider transport.
