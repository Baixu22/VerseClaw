---
id: line-c-grounding-single-explicit-diagnostics-consumer-proposal
title: Line C grounding single explicit diagnostics-only consumer proposal
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define the implementation proposal/design boundary for exactly one future explicit diagnostics-only consumer of Line C grounding metadata after the accepted explicit diagnostics consumer readiness package, without approving direct implementation or broader formal runtime use.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md
  - runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-proposal/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md
  - runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-proposal/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Existing accepted capability remains the runtime-core default-on diagnostics-only metadata helper for valid sanitized refs.
  - This task may produce only a proposal/design for one explicit diagnostics-only consumer.
  - Direct consumer implementation is not approved by this task unless a later fresh spec explicitly approves implementation and proves every boundary.
  - Broad formal runtime use remains unapproved and `needs_revision`.
  - Required markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
  - Rollback remains `enabled: false` and `killSwitch: true`; both must restore disabled/default-off parity.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
allowedSurface:
  - Fresh task spec, handoff, and synthesis documentation for a single explicit diagnostics-only consumer implementation proposal/design.
  - The proposal may identify one explicit consumer id, one explicit callsite boundary, expected diagnostics input/output shape, rollback expectations, proof requirements, and veto gates.
  - The accepted runtime-core default-on diagnostics-only metadata helper may remain documented as the only active allowed runtime capability.
  - Local bounded metadata-only, summary-only, diagnostics-only, read-only, non-authoritative output with `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
proposalLimit:
  - This stage stops at docs/proposal readiness.
  - It must not add consumer code, flags, runtime callsites, provider registration, TaskLoop hooks, Gateway routes, host-api/api-client contracts, UI controls, transport paths, persistence, cache, services, listeners, exporters, database work, sidecars, memory writes, patch paths, workspace edits, or symbol mutation.
  - If the proposed consumer cannot be expressed without any forbidden boundary, the synthesis verdict must be `needs_revision`.
forbiddenPatterns:
  - broad formal runtime use, direct runtime consumer implementation, default consumer registration, provider registration, provider ordering changes, provider selection changes, prompt insertion, model-message insertion, Gateway request insertion, TaskLoop integration, runtime decision integration, completion authority, tool authority, security authority, approval authority, retry authority, or any formal runtime-use cutover
  - runtime authority, prompt authority, model-message authority, provider ordering authority, provider selection authority, Gateway authority, TaskLoop authority, runtime decision authority, completion authority, tool authority, security authority, approval authority, retry authority, memory promotion authority, fact acceptance authority, episode write authority, persistence authority, patch authority, symbol authority, or workspace mutation authority
  - raw prompt, raw trace, full payload, full event payload, tool args, tool output, stdout, stderr, env, secrets, API keys, auth headers, traceparent, tracestate, baggage, transcripts, JSONL imports, raw retention, untrusted refs, includeRaw true, or includeUntrusted true
  - persistence, cache, database, sidecar, service, listener, exporter, daemon, server, memory promotion, fact acceptance, episode write, memory store write, fact store write, patch apply, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, safeDelete, UI setting, public API, renderer IPC, host-api/api-client contract, Gateway route, provider transport mutation, production rollout, or hidden default-on expansion
featureFlags:
  - No new runtime flag is authorized by this proposal task.
  - A later implementation spec must require explicit callsite invocation and explicit consumer id if implementation is ever approved.
  - Existing rollback remains `enabled: false` or `killSwitch: true`.
rollback:
  - Keep the current accepted metadata helper boundary unchanged.
  - Reject or revise the proposal if it requires any forbidden boundary.
  - Any later implementation must prove `enabled: false` and `killSwitch: true` return disabled/default-off parity before code implementation can be accepted.
rejectedBoundaries:
  - broad formal runtime use, runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion, fact acceptance, episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, production rollout, and any direct implementation from this proposal task
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md --no-diff
  - git status --short --branch
  - git diff --name-status
  - git diff --check -- harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-proposal/README.md runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-proposal/implementation-synthesis.md runtime-research/agent-runtime-index.md
  - rg boundary scan for runtime authority/prompt/model-message/provider ordering/provider selection/Gateway request/TaskLoop/runtime decision/completion/tool/security/approval/retry/raw retention/includeRaw/includeUntrusted/untrusted refs/persistence/cache/service/listener/exporter/database/sidecar/memory promotion/fact acceptance/episode write/patch apply/workspace edit/symbol mutation/UI/API/transport/production rollout
acceptance:
  - Fresh task spec exists before any implementation work.
  - The package defines only a single explicit diagnostics-only consumer proposal/design boundary.
  - The package states that direct implementation is not approved by this task.
  - The package states that broad formal runtime use remains unapproved and `needs_revision`.
  - No runtime code, prompt/model-message/provider/Gateway/TaskLoop/runtime decision path, persistence/cache/service/listener/exporter, UI/API/transport, memory write, patch, workspace edit, or symbol mutation is implemented.
  - Final synthesis status is `needs_revision` if the proposal requires any forbidden boundary.
docs:
  required: true
  files:
    - runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-proposal/README.md
    - runtime-research/handoffs/line-c-grounding-single-explicit-diagnostics-consumer-proposal/implementation-synthesis.md
    - runtime-research/agent-runtime-index.md
nextPhaseEntry:
  Allowed next phase:
    - If this docs/proposal package is accepted, a later fresh task spec may request actual implementation for exactly one explicit diagnostics-only consumer and must prove every boundary again before code changes.
  Still forbidden:
    - broad formal runtime use, runtime authority, prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration, completion/tool/security/approval/retry authority, raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory promotion, fact acceptance, episode write, patch apply, workspace edit, symbol mutation, UI/API/transport changes, production rollout, and direct implementation under this proposal task
---

# Line C Grounding Single Explicit Diagnostics-only Consumer Proposal

This task is an implementation proposal/design boundary for one future explicit diagnostics-only consumer. It does not authorize consumer implementation or broader formal runtime use.
